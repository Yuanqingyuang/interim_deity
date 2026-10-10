// 时代进阶与星星里程碑（js/progression.js）
//
// 为什么单独有这份测试：这些逻辑原先在 main.js 内，而 main.js 顶层会 boot() 并注册
// window 监听 → Node 无法 import → **零覆盖**。本项目最贵的一次回归正是时代硬锁
// （某些种子永久停在工业 9/s、12/s，玩家无法通关），却没有任何门禁。
// 抽取到 js/progression.js（无 DOM 依赖）后即可直接断言四项条件。
//
// 覆盖要点：
//   1. 四项进阶条件**各自单独缺失**时都必须挡住进阶（逐项隔离，避免"只有全缺才挡"）
//   2. 产能门槛必须是**逻辑口径**（地块数 × buildQ），传错会少算 BUILD_Q 倍
//   3. 星星只加一次（位图防重复）
//   4. 进阶的状态迁移：扣星、era+1、清放置中/雕刻中残留
//   5. milestoneSummary 与判定共用同一口径

import { ERAS, MILESTONES } from '../js/config.js';
import * as F from '../js/formulas.js';
import { eraReadiness, eraReady, claimMilestones, milestoneSummary, applyEraAdvance } from '../js/progression.js';

let pass = 0, fail = 0;
const ok = (cond, msg)=>{
  if(cond){ pass++; console.log('  ok - ' + msg); }
  else { fail++; console.log('  FAIL - ' + msg); }
};
const near = (a, b, eps = 1e-9)=> Math.abs(a - b) < eps;

/** 造一个「刚好满足进阶」的状态，便于逐项破坏后观察是否仍能进阶 */
function makeReadyG(era){
  const G = {
    era, pop: ERAS[era].popGoal, stars: ERAS[era].starCost,
    wonders: [true, true, true, true, true],
    starMilestones: [[],[],[],[],[]],
    _builtCache: { 1:0, 2:0, 3:0, 4:0, valid: true },
  };
  // 工业地块数取「刚好达到门槛」：gateOf 是逻辑口径
  const needLogical = F.gateOf(era) / F.NUM.K_IND;
  G._builtCache[3] = Math.ceil(needLogical / F.buildQ(era));
  return G;
}

console.log('=== 1) 基线：刚好满足则应可进阶 ===');
for(let era=0; era<4; era++){
  const G = makeReadyG(era);
  const r = eraReadiness(G);
  ok(r.ok, `E${era+1} 基线可进阶（reasons: ${r.reasons.join('、') || '无'}）`);
}
{
  const G = makeReadyG(4);
  const r = eraReadiness(G);
  ok(!r.ok && r.reasons.includes('已是最终时代'), 'E5 是终点：不可再进阶（通关看太空电梯）');
}

console.log('=== 2) 四项条件逐项隔离：单独破坏任一项都必须挡住 ===');
for(let era=1; era<4; era++){
  const base = ()=>makeReadyG(era);

  let G = base(); G.pop = ERAS[era].popGoal - 1;
  let r = eraReadiness(G);
  ok(!r.ok && r.reasons.includes('人口不足'), `E${era+1} 人口差 1 → 挡住（${r.reasons.join('、')}）`);

  G = base(); G.stars = ERAS[era].starCost - 1;
  r = eraReadiness(G);
  ok(!r.ok && r.reasons.includes('星星不足'), `E${era+1} 星星差 1 → 挡住（${r.reasons.join('、')}）`);

  G = base(); G.wonders[era] = false;
  r = eraReadiness(G);
  ok(!r.ok && r.reasons.includes('本时代奇迹未建成'), `E${era+1} 缺本时代奇迹 → 挡住（${r.reasons.join('、')}）`);

  G = base(); G._builtCache[3] = 0;
  r = eraReadiness(G);
  ok(!r.ok && r.reasons.includes('产能不足'), `E${era+1} 产能为 0 → 挡住（${r.reasons.join('、')}）`);
}

console.log('=== 3) 产能门槛必须是逻辑口径（地块数 × buildQ）===');
{
  // E3（buildQ=3）：地块数按「不乘 buildQ」算会差 3 倍
  const era = 2;
  const q = F.buildQ(era);
  const gateLogical = F.gateOf(era);
  const tilesNeeded = Math.ceil(gateLogical / F.NUM.K_IND / q);
  const G = makeReadyG(era);
  G._builtCache[3] = tilesNeeded;
  const r = eraReadiness(G);
  ok(near(r.checks.indLogical, tilesNeeded * q), `E${era+1} indLogical = ${r.checks.indLogical} = 地块 ${tilesNeeded} × buildQ ${q}`);
  ok(r.checks.indPerSec >= gateLogical, `E${era+1} 逻辑产能 ${r.checks.indPerSec.toFixed(0)} ≥ 门槛 ${gateLogical.toFixed(0)} → 可进阶`);
  ok(r.ok, `E${era+1} 按逻辑口径取地块数即可进阶`);
  // 反证：若按「地块数当逻辑数」比（旧口径），同样的地块数会不达标 → 说明口径确实有别
  const wrong = F.industryPerSec(tilesNeeded);
  ok(wrong < gateLogical, `E${era+1} 若漏乘 buildQ 则只有 ${wrong.toFixed(0)} < ${gateLogical.toFixed(0)} → 会被误判为不达标`);
}

console.log('=== 4) eraReady 是 eraReadiness().ok 的等价简写 ===');
for(let era=0; era<5; era++){
  const G = makeReadyG(era);
  ok(eraReady(G) === eraReadiness(G).ok, `E${era+1} eraReady() === eraReadiness().ok`);
}

console.log('=== 5) 里程碑：达成即加星，且只加一次 ===');
{
  const era = 0;
  const G = makeReadyG(era);
  G.stars = 0;
  G.pop = 999;
  const list = MILESTONES[era] || [];
  ok(list.length > 0, `E${era+1} 定义了 ${list.length} 个里程碑`);

  // 用极大投入一次性满足所有里程碑（阈值都是逻辑口径）
  const huge = { farms: 99999, inds: 99999, churches: 99999, houses: 99999 };
  const first = claimMilestones(G, huge);
  ok(first.length === list.length, `首次结算新达成 ${first.length} 个（应为 ${list.length}）`);
  ok(G.stars === list.length, `星星数 ${G.stars} === 里程碑数 ${list.length}`);
  ok(G.starMilestones[era].every(Boolean), '位图全部置位');

  const second = claimMilestones(G, huge);
  ok(second.length === 0, '重复结算不再加星（位图防重复）');
  ok(G.stars === list.length, `星星数保持 ${G.stars}`);
}

console.log('=== 6) 里程碑：投入不足时不应误加星 ===');
{
  const G = makeReadyG(0);
  G.stars = 0;
  const none = claimMilestones(G, { farms:0, inds:0, churches:0, houses:0 });
  const list = MILESTONES[0] || [];
  // 允许「零投入也成立的里程碑」存在，但不能全部达成
  ok(none.length < list.length, `零投入只达成 ${none.length}/${list.length}（不会全部误判）`);
  ok(G.stars === none.length, `星星数 ${G.stars} === 新达成数 ${none.length}`);
}

console.log('=== 7) 里程碑口径：地块数须乘 buildQ 后再判定 ===');
{
  const era = 2;                       // E3，buildQ=3
  const q = F.buildQ(era);
  const G = makeReadyG(era);
  G.stars = 0;
  // 找出「按逻辑阈值」需要的投入：取一个明确高于所有阈值的规模
  const tiles = 100;
  claimMilestones(G, { farms: tiles, inds: tiles, churches: tiles, houses: tiles });
  const logical = tiles * q;
  ok(logical === 300, `E${era+1} 地块 ${tiles} → 逻辑 ${logical}（buildQ=${q}）`);
  // milestoneSummary 必须与判定一致：已达成项显示 ✓
  const text = milestoneSummary(G, tiles, tiles, tiles, tiles);
  ok(!text.includes('○'), `milestoneSummary 全部显示 ✓（实测：${text}）`);
}

console.log('=== 8) milestoneSummary 与判定同口径 ===');
{
  const era = 1;
  const G = makeReadyG(era);
  G.stars = 0;
  const before = milestoneSummary(G, 0, 0, 0, 0);
  ok(typeof before === 'string' && before.length > 0, `E${era+1} 摘要非空：${before}`);
  // 给足资源后，摘要里的 ✓ 数量应增加
  const ticks = (s)=> (s.match(/✓/g) || []).length;
  const n0 = ticks(before);
  G.starMilestones = [[],[],[],[],[]];
  const after = milestoneSummary(G, 99999, 99999, 99999, 99999);
  ok(ticks(after) > n0, `投入拉满后 ✓ 数增加（${n0} → ${ticks(after)}）`);
}

console.log('=== 9) 进阶状态迁移 ===');
{
  for(let era=0; era<4; era++){
    const G = makeReadyG(era);
    G.stars = ERAS[era].starCost + 5;          // 多带 5 星，验证只扣 starCost
    G.starProg = 7;
    // 制造「放置中 + 雕刻中」的残留输入态（审计发现的实际缺陷场景）
    G.placingWonder = { id: 1 };
    G.painting = true;
    G.panning = true;
    G.hover = [3, 4];
    G.terrainDirty = false;

    const res = applyEraAdvance(G);
    ok(res.from === era && res.to === era + 1, `E${era+1} → E${era+2}（返回 ${res.from}→${res.to}）`);
    ok(G.era === era + 1, `G.era 已推进到 ${G.era}`);
    ok(G.stars === 5, `只扣本时代 starCost ${ERAS[era].starCost}，余 ${G.stars} 星`);
    ok(G.starProg === 0, 'starProg 归零');
    ok(G.placingWonder === null, '清掉「放置中」残留（否则奇迹按钮永久停留在放置中样式）');
    ok(G.painting === false, '清掉「雕刻中」残留（否则新时代表格继续被雕刻）');
    ok(G.panning === false && G.hover === null, '清掉 panning / hover 残留');
    ok(G.terrainDirty === true, '置地形脏标记以触发重建');
    ok(typeof res.name === 'string' && res.name.length > 0, `返回新时代名「${res.name}」`);
  }
}
{
  // 星星不足时不应出现负星
  const G = makeReadyG(1);
  G.stars = 0;
  applyEraAdvance(G);
  ok(G.stars === 0, `starCost 大于持有星数时不出现负星（stars=${G.stars}）`);
}

console.log('=== 10) 全程可通关：五个时代连续进阶 ===');
{
  const G = makeReadyG(0);
  G.wonders = [true,true,true,true,true];
  G.stars = 99;
  let advanced = 0;
  for(let era=0; era<4; era++){
    G.era = era;
    G.pop = ERAS[era].popGoal;
    G._builtCache[3] = Math.ceil(F.gateOf(era) / F.NUM.K_IND / F.buildQ(era));
    if(eraReady(G)){ applyEraAdvance(G); advanced++; }
    else break;
  }
  ok(advanced === 4, `连续进阶 ${advanced}/4 次，最终 era=${G.era}（应能一路到 E5）`);
  ok(G.era === 4, '最终停在 E5');
  ok(!eraReady(G), 'E5 不再可进阶');
}

console.log('');
console.log(`时代进阶与里程碑测试 ${fail === 0 ? 'PASS' : 'FAIL'}  （${pass} 通过 / ${fail} 失败）`);
if(fail) process.exit(1);
