// 子民自动建造的优先级决策（rev-6）
//
// 为什么需要：`autoBuild` 的决策段承载了两个**真实的玩法灾难**的修复，
// 而它原先内联在 main.js 里 —— main.js 顶层 `boot()`，Node 无法 import → 零覆盖。
//   1. S-04 棘轮：`need[z] = cnt[z] + 2` 使 need 恒 > cnt → 三个缺口判定恒真
//      → 无条件刷到 high 水位（把岛铺满）
//   2. 住房死锁：房屋要求「8 邻域全空」，农田/工业会先占掉这类空格。若人口已被住房
//      卡满时仍先放农田/工业，房屋再也找不到点位 → 人口永久停滞。极坏情形是
//      「一栋房都没有」：E1–2 人口上限 = 住房×C_HOUSE → popCap=0 → 人口从 20 衰减到 1，
//      而工业在 pop<15 时放弃 → 无工业 → indOk 恒假 → 永远建不出第一栋房
//      （实测：人口卡在 1，农田却建到 40+ 格、粮产 45/s）
//
// 等价性另由开发期脚本用 2000 组随机输入 × 5 时代验证过（与改动前的内联逻辑零差异）。

import { AUTO } from '../js/config.js';
import * as F from '../js/formulas.js';
import { buildNeeds, pendingWeight, buildGates, buildOrder, autoBuildDecision } from '../js/autobuild.js';

let pass = 0, fail = 0;
const ok = (cond, msg)=>{ if(cond){ pass++; console.log('  ok - ' + msg); } else { fail++; console.log('  FAIL - ' + msg); } };

/** 造一组输入；未给的字段用「富足」默认值，便于逐项隔离 */
function mk(over = {}){
  const o = {
    E: 0, cnt: {1:100,2:100,3:100,4:10}, built: {1:100,2:100,3:100,4:10},
    pop: 200, housingCap: 1000, faithRate: 50,
    housingPressure: AUTO.housingPressure, faithPressure: AUTO.faithPressure,
    ...over,
  };
  return o;
}
const decide = (o)=> autoBuildDecision(o.E, {
  cnt:o.cnt, built:o.built, pop:o.pop, housingCap:o.housingCap, faithRate:o.faithRate,
  housingPressure:o.housingPressure, faithPressure:o.faithPressure,
});

console.log('=== 1) S-04 棘轮不得复现：need 在达标后必须「等于 cnt」而非「cnt + k」 ===');
{
  for(let E=0; E<5; E++){
    const lo = F.buildingLowTiles(E, 1);
    const hi = F.buildingHighTiles(E, 1);
    // 恰好达标
    const need1 = buildNeeds(E, {1: lo, 2: lo, 3: lo, 4: lo});
    ok(need1[1] === Math.min(hi, lo), `E${E+1} 住房恰好达标（cnt=lo=${lo}）→ need=${need1[1]}（不虚增）`);
    ok(need1[1] <= lo + 0.0001, `E${E+1} need 未超过 cnt（无棘轮）`);
    // 远超达标：need 必须等于 cnt（守住 hi 上限）
    const big = lo + 5000;
    const need2 = buildNeeds(E, {1: big, 2: big, 3: big, 4: big});
    ok(need2[1] === Math.min(hi, big), `E${E+1} 远超达标（cnt=${big}）→ need=${need2[1]} = min(hi, cnt)`);
    // 未达标：need 必须抬到 lo（否则永远不建）
    const low = Math.max(0, lo - 1);
    if(lo > 0){
      const need3 = buildNeeds(E, {1: low, 2: low, 3: low, 4: low});
      ok(need3[1] === lo, `E${E+1} 未达标（cnt=${low} < lo=${lo}）→ need 抬到 lo`);
    }
  }
  // 棘轮的判定性检验：达标后缺口必须归零（否则 autoBuild 会无脑刷满）
  const E = 0, lo = F.buildingLowTiles(E, 2);
  const d = decide(mk({ E, cnt:{1:lo,2:lo,3:lo,4:lo}, built:{1:lo,2:lo,3:lo,4:lo}, pop: 1, housingCap: 99999 }));
  ok(d.gates.farmShort === false, `农田达标且粮足 → farmShort=false（棘轮会使它恒真）`);
}

console.log('');
console.log('=== 2) 住房死锁：无住房时 house 必须置顶且不受资源门槛阻挡 ===');
{
  // 灾难场景：一栋房都没有，工业为 0（indOk 必假），pop 已衰减到 1
  const d = decide(mk({
    E: 0, cnt:{1:0,2:40,3:0,4:0}, built:{1:0,2:40,3:0,4:0},
    pop: 1, housingCap: 0, faithRate: 0,
  }));
  ok(d.list[0] === 'house', `无住房 → 顺序首位是 house（实测 [${d.list}]）`);
  ok(d.forceHouse === true, 'forceHouse=true（无住房属极紧急）');
  ok(d.housingCritical === true, 'housingCritical=true（hc<=0）');
  // 关键：即使 foodOk/indOk 都为假，house 也必须在列表里
  ok(d.gates.indOk === false, '此时 indOk 为假（无工业）—— 死锁正是「等工业好转才建房」造成的');
  ok(d.list.includes('house'), 'house 不因资源门槛不足而被剔除（破除死锁）');

  // 第二类：已有住房但人口已达上限，且农田/工业仍有缺口
  const lo2 = F.buildingLowTiles(0, 1);
  const d2 = decide(mk({
    E: 0, cnt:{1:lo2, 2:5000, 3:5000, 4:0}, built:{1:lo2, 2:0, 3:0, 4:0},
    pop: lo2 * F.NUM.C_HOUSE, housingCap: lo2 * F.NUM.C_HOUSE, faithRate: 0,
  }));
  ok(d2.housingCritical === true, `人口恰好达住房上限 → housingCritical=true`);
  ok(d2.list[0] === 'house', `此时 house 仍置顶（实测 [${d2.list}]）—— 否则房屋再无点位`);
  ok(d2.list.includes('farm'), '农田缺口仍在列表中（置顶不等于放弃其他）');
}

console.log('');
console.log('=== 3) 非紧急住房：粮产都有余且住房有缺口时才建 ===');
{
  const lo = F.buildingLowTiles(0, 1);
  // 住房有缺口（cnt<need）、人口未压满、粮产充足 → 应建
  const good = decide(mk({
    E: 0, cnt:{1:0,2:2000,3:2000,4:20}, built:{1:0,2:2000,3:2000,4:20},
    pop: 10, housingCap: 10000, faithRate: 50,
  }));
  // cnt[1]=0 → noHousing → forceHouse，这条走的是不变量 A；换一个「有房但缺口」的场景
  const partial = decide(mk({
    E: 0, cnt:{1:Math.max(1, lo-1), 2:2000, 3:2000, 4:20}, built:{1:Math.max(1, lo-1), 2:2000, 3:2000, 4:20},
    pop: 10, housingCap: 100000, faithRate: 50,
  }));
  ok(partial.gates.foodOk && partial.gates.indOk, '粮产都有余');
  ok(partial.list.includes('house'), `住房有缺口 → house 在列表中（[${partial.list}]）`);

  // 粮不足时不应把非紧急住房排在农田前面
  const hungry = decide(mk({
    E: 0, cnt:{1:1, 2:5000, 3:5000, 4:0}, built:{1:1, 2:0, 3:0, 4:0},
    pop: 5000, housingCap: 100000, faithRate: 0,
  }));
  ok(hungry.gates.foodOk === false, '粮产不足（foodOk=false）');
  const farmIdx = hungry.list.indexOf('farm');
  const houseIdx = hungry.list.indexOf('house');
  ok(houseIdx === -1 || farmIdx < houseIdx,
     `粮不足时农田优先于非紧急住房（顺序 [${hungry.list}]）`);
}

console.log('');
console.log('=== 4) 住房置顶不吞掉其他行动（顺序而非排他）===');
{
  const d = decide(mk({
    E: 0, cnt:{1:0,2:5000,3:5000,4:0}, built:{1:0,2:0,3:0,4:0},
    pop: 500, housingCap: 0, faithRate: 0,
  }));
  ok(d.list[0] === 'house', 'house 置顶');
  ok(d.list.includes('farm'), '农田缺口仍在');
  ok(d.list.includes('church'), '教堂缺口仍在');
  // 顺序必须是 house → 其余按优先级
  const uniq = new Set(d.list);
  ok(uniq.size === d.list.length, `列表中无重复项（[${d.list}]）`);
  ok(d.list.filter(x=>x==='house').length === 1, 'house 只出现一次（不重复占位）');
}

console.log('');
console.log('=== 5) 工业门槛不在决策层：indShort 决定是否列出，pop 门槛留给执行层 ===');
{
  // indShort=true 且 pop 很小 → 决策层仍应列出 industry（门槛在 tryPlaceIndustry 内）
  const d = decide(mk({
    E: 0, cnt:{1:500,2:500,3:0,4:0}, built:{1:500,2:500,3:0,4:0},
    pop: 2, housingCap: 99999, faithRate: 0,
  }));
  ok(d.gates.indShort === true, 'indShort=true（工业为 0）');
  ok(d.list.includes('industry'), `决策层如实列出 industry（[${d.list}]）—— pop<15 的门槛在执行层`);
}

console.log('');
console.log('=== 6) 兜底补房（fallbackHouse）===');
{
  // 住房缺口 + 有农田或粮产 → 允许放宽门槛再补一次
  const a = decide(mk({ E:0, cnt:{1:0,2:5,3:0,4:0}, built:{1:0,2:0,3:0,4:0}, pop:1, housingCap:0, faithRate:0 }));
  ok(a.fallbackHouse === true, '有农田 → fallbackHouse=true');
  const b = decide(mk({ E:0, cnt:{1:0,2:0,3:0,4:0}, built:{1:0,2:0,3:0,4:0}, pop:1, housingCap:0, faithRate:0 }));
  ok(b.fallbackHouse === false, '既无农田又无粮产 → fallbackHouse=false（无谓重试）');
  // 住房不缺时不应触发兜底
  const lo = F.buildingLowTiles(0, 1);
  const c = decide(mk({ E:0, cnt:{1:lo+10,2:900,3:900,4:20}, built:{1:lo+10,2:900,3:900,4:20}, pop:10, housingCap:100000, faithRate:50 }));
  ok(c.gates.houseShort === false && c.fallbackHouse === false, '住房不缺 → 不触发兜底');
}

console.log('');
console.log('=== 7) pendingWeight 与 tick 同口径（按 BUILD_COST 加权）===');
{
  const E = 2;
  const cnt = {1:100, 2:100, 3:100, 4:100};
  const built = {1:50, 2:50, 3:50, 4:50};
  let expect = 0;
  for(const z of [1,2,3,4]) expect += 50 * (F.NUM.BUILD_COST[z] ?? 1);
  const got = pendingWeight(E, cnt, built);
  ok(Math.abs(got - expect) < 1e-9, `待建加权 ${got} === 手算 ${expect}`);
  ok(pendingWeight(E, built, cnt) === 0, '已建成 ≥ 划定 → 待建为 0（不出现负数）');
  // buildDemand 随时代指数增长
  const d0 = buildGates(0, { cnt, built, need: buildNeeds(0, cnt), pop: 100, housingCap: 1000, faithRate: 10, faithPressure: 1, housingPressure: 0.8 });
  const d4 = buildGates(4, { cnt, built, need: buildNeeds(4, cnt), pop: 100, housingCap: 1000, faithRate: 10, faithPressure: 1, housingPressure: 0.8 });
  ok(d4.buildDemand > d0.buildDemand, `buildDemand 随时代增长（E1 ${d0.buildDemand.toFixed(0)} → E5 ${d4.buildDemand.toFixed(0)}）`);
}

console.log('');
console.log('=== 8) 教堂门槛用传入的 faithPressure（不得硬编码 0）===');
{
  // faithRate 低于阈值 → churchShort 为真；高于阈值且目标达标 → 为假
  const base = { cnt:{1:500,2:500,3:500,4:50}, built:{1:500,2:500,3:500,4:50}, need:null,
                 pop: 100, housingCap: 99999 };
  const need = buildNeeds(0, base.cnt);
  const low = buildGates(0, { ...base, need, faithRate: 0.5, faithPressure: 2.0, housingPressure: 0.8 });
  ok(low.churchShort === true, 'faithRate 0.5 < 阈值 2.0 → churchShort=true');
  const mid = buildGates(0, { ...base, need, faithRate: 5.0, faithPressure: 2.0, housingPressure: 0.8 });
  ok(mid.churchShort === false, 'faithRate 5.0 > 阈值 2.0 且目标达标 → churchShort=false');
  // 阈值应为正数：若硬编码 0，上面的 low 用例会误判为「不缺教堂」
  ok(low.churchShort !== (0.5 < 0), 'churchShort 不受「硬编码阈值 0」影响');
}

console.log('');
console.log(`自动建造决策测试 ${fail === 0 ? 'PASS' : 'FAIL'}  （${pass} 通过 / ${fail} 失败）`);
if(fail) process.exit(1);
