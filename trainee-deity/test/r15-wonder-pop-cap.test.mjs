// 奇迹人口容量回归（2026-10 修复）
//
// 背景：WONDERS[1] 承诺「人口容量+20%」、WONDERS[3] 承诺「人口容量+50%」（config.js 文案），
// 但 tick 的人口上限一度只走 F.popCap(E,houses,farms,inds)，不含乘区；
// 含乘区的 state.housingCap 只被 autoBuild 的压力判断使用 → UI 承诺不兑现。
// 本测试锁死「乘区必须作用于实际人口上限」，并强制 housingCap 与 popCap 同源，
// 防止两份实现再次分叉（这是本次回归的根因）。
import { createState, housingCap, countBuilt, refreshBuiltCache, getTile } from '../js/state.js';
import { popCap, wonderPopMult, growPop, NUM } from '../js/formulas.js';
import { WONDERS } from '../js/config.js';

function assert(cond, msg){
  if(!cond) throw new Error('FAIL: ' + msg);
  console.log('  ok -', msg);
}

const none = [false,false,false,false,false];
const pyramid = [false,true,false,false,false];
const tower = [false,false,false,true,false];
const both = [false,true,false,true,false];

// ---- 1) 乘区本身 ----
assert(wonderPopMult(undefined) === 1, '无 wonders 参数时乘区为 1（保持纯公式语义）');
assert(wonderPopMult(none) === 1, '无奇迹 → 乘区 1');
assert(Math.abs(wonderPopMult(pyramid) - 1.2) < 1e-9, '仅金字塔 → 乘区 1.2');
assert(Math.abs(wonderPopMult(tower) - 1.5) < 1e-9, '仅摩天塔 → 乘区 1.5');
assert(Math.abs(wonderPopMult(both) - 1.2*1.5) < 1e-9, '金字塔+摩天塔 → 乘区 1.8（相乘）');

// ---- 2) popCap 必须带上乘区（各时代分支都要）----
{
  const houses = 100, farms = 100, inds = 100;
  for(let E=0; E<5; E++){
    const base = popCap(E, houses, farms, inds, none);
    const p = popCap(E, houses, farms, inds, pyramid);
    const t = popCap(E, houses, farms, inds, tower);
    assert(Math.abs(p - base*1.2) < 1e-6, `E${E+1} 金字塔使 popCap ×1.2（${base} → ${p}）`);
    assert(Math.abs(t - base*1.5) < 1e-6, `E${E+1} 摩天塔使 popCap ×1.5（${base} → ${t}）`);
    // 不传 wonders 必须与传 none 一致（向后兼容：纯公式调用点不受影响）
    assert(popCap(E, houses, farms, inds) === base, `E${E+1} 省略 wonders 等价于无奇迹`);
  }
  // 文案与实现的对应关系（防止 WONDERS 文案改了而乘区没跟上）
  assert(WONDERS[1].bonus.includes('20%'), `WONDERS[1] 文案声明 ${WONDERS[1].bonus}`);
  assert(WONDERS[3].bonus.includes('50%'), `WONDERS[3] 文案声明 ${WONDERS[3].bonus}`);
}

// ---- 3) 同源约束：housingCap（autoBuild 压力）必须与 popCap 同口径 ----
// 本项是本次回归的核心：两份实现分叉时，UI/压力判断与真实人口上限会给出不同答案。
{
  const G = createState(4242);
  G.era = 0;                       // E1：住房主导，popCap = houses × C_HOUSE
  G.wonders = [false,false,false,false,false];
  // 造 12 栋已建成的住房
  let n = 0;
  for(let y=-6; y<=6 && n<12; y++)
    for(let x=-6; x<=6 && n<12; x++){
      const t = getTile(G, x, y);
      if(!t || t.water) continue;
      t.zone = 1; t.built = true; t.prog = 1; n++;
    }
  refreshBuiltCache(G);
  const houses = countBuilt(G, 1);
  assert(houses === 12, `构造住房 ${houses} 栋`);

  const baseTick = popCap(G.era, houses, 0, 0, G.wonders);
  assert(Math.abs(housingCap(G) - baseTick) < 1e-9,
    `无奇迹时 housingCap(${housingCap(G)}) === popCap(${baseTick})`);

  G.wonders = pyramid;
  const pTick = popCap(G.era, houses, 0, 0, G.wonders);
  assert(Math.abs(pTick - baseTick*1.2) < 1e-6, `金字塔后 tick 用 cap ${pTick} = 基础×1.2`);
  assert(Math.abs(housingCap(G) - pTick) < 1e-9,
    `金字塔后 housingCap(${housingCap(G)}) === popCap(${pTick}) —— 同源，无分叉`);

  // ---- 3b) 逐时代口径：housingCap 必须随 buildQ(E) 缩放 ----
  // 2026-10 审计发现的偏差：housingCap 漏乘 buildQ(E)。因为 E1/E2 的 buildQ 恰为 1，
  // 上面 era=0 的断言**锁不住**它；E3 起 hc 会比真实人口上限小一个量级，使 autoBuild 的
  // housingCritical 恒真 → 每轮无条件 tryPlace(1) 无限建房。故这里对所有时代逐一断言。
  const { buildQ } = await import('../js/formulas.js');
  const { NUM } = await import('../js/formulas.js');
  for(let era=0; era<5; era++){
    G.era = era;
    G.wonders = [false,false,false,false,false];
    const q = buildQ(era);
    const expect = houses * q * NUM.C_HOUSE;      // 地块数 × buildQ × 每栋容量
    const got = housingCap(G);
    assert(Math.abs(got - expect) < 1e-9,
      `E${era+1}（buildQ=${q}）housingCap ${got} === 地块数 ${houses} × buildQ ${q} × C_HOUSE ${NUM.C_HOUSE} = ${expect}`);
    // E1/E2 住房即主导项，故必须与 popCap 完全一致
    if(era <= 1){
      assert(Math.abs(got - popCap(era, houses*q, 0, 0, G.wonders)) < 1e-9,
        `E${era+1} 住房主导：housingCap 与 popCap 同值`);
    }
    // 关键不变式：E3 起 housingCap 不得再小于「地块数 × C_HOUSE」——
    // 那正是旧 bug 的形态（少了 buildQ），会让 pressure 判断恒真
    if(era >= 2){
      assert(got > houses * NUM.C_HOUSE,
        `E${era+1} housingCap ${got} > 未换算值 ${houses*NUM.C_HOUSE}（旧 bug 形态不会再现）`);
    }
  }
  G.era = 0;   // 还原，避免影响后续断言

  G.wonders = tower;
  const tTick = popCap(G.era, houses, 0, 0, G.wonders);
  assert(Math.abs(tTick - baseTick*1.5) < 1e-6, `摩天塔后 tick 用 cap ${tTick} = 基础×1.5`);
  assert(Math.abs(housingCap(G) - tTick) < 1e-9,
    `摩天塔后 housingCap(${housingCap(G)}) === popCap(${tTick}) —— 同源，无分叉`);
}

// ---- 4) 端到端：奇迹建成后人口确实能长过旧上限 ----
{
  const G = createState(99);
  G.era = 0;
  // 20 栋住房（E1 人口上限走住房分支）+ 4 块农田：growPop 另有粮食硬约束，
  // 20 栋房对应 80 人需 80 粮/秒，而 C_FARM=50 → 至少 2 块田；放 4 块留余量。
  let n = 0, nf = 0;
  for(let y=-8; y<=8 && (n<20 || nf<4); y++)
    for(let x=-8; x<=8 && (n<20 || nf<4); x++){
      const t = getTile(G, x, y);
      if(!t || t.water || t.zone > 0) continue;
      if(n < 20){ t.zone = 1; t.built = true; t.prog = 1; n++; }
      else if(nf < 4){ t.zone = 2; t.built = true; t.prog = 1; nf++; }
    }
  refreshBuiltCache(G);
  const houses = countBuilt(G, 1);
  const farms = countBuilt(G, 2);
  const baseCap = houses * NUM.C_HOUSE;
  assert(farms > 0, `构造农田 ${farms} 块（粮食需 ≥ ${Math.ceil(baseCap/NUM.C_FARM)} 块）`);
  assert(farms * NUM.C_FARM >= baseCap,
    `粮食充足：${farms}×${NUM.C_FARM} = ${farms*NUM.C_FARM}/s ≥ ${baseCap}`);

  // 无奇迹：人口封顶在 baseCap
  G.wonders = none; G.pop = baseCap;
  let pop0 = G.pop;
  for(let i=0;i<600;i++){
    const cap = popCap(G.era, countBuilt(G,1), 0, 0, G.wonders);
    pop0 = growPop(pop0, cap, G.era, countBuilt(G,2), 0.25);
  }
  assert(pop0 <= baseCap + 1e-6, `无奇迹时人口收敛于 ${pop0} ≤ ${baseCap}（未被粮食压制到 0：${pop0 > 0}）`);

  // 建金字塔：人口应越过旧上限（新上限 1.2×，粮食需同步够）
  const newCap = baseCap * 1.2;
  G.wonders = pyramid; G.pop = baseCap;
  let pop1 = G.pop;
  for(let i=0;i<600;i++){
    const cap = popCap(G.era, countBuilt(G,1), 0, 0, G.wonders);
    pop1 = growPop(pop1, cap, G.era, countBuilt(G,2), 0.25);
  }
  assert(pop1 > baseCap + 0.5, `金字塔后人口长过旧上限：${pop1} > ${baseCap}`);
  assert(pop1 <= newCap + 1e-6, `且不超过新上限 ${newCap}（实际 ${pop1}）`);
}

console.log('奇迹人口容量 regression PASS');
