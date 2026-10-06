// 建筑代理比 BUILD_Q 与玩法可达性回归（2026-10）
//
// 背景：岛屿可建造格实测 4,979~5,881/种子（半径 94 格外恒为海洋），8 邻域空置规则
// （刻意视觉设计）把非农田建筑密度压到 ≤25% → 建筑格硬上限 ≈1,350 个。
// 而 E5 原需求 = 25,000 房 + 7,500 工 = 32,500 格（超上限 25 倍），时代链物理不可达。
// 方案：引入建筑代理比 BUILD_Q(E)（1 地块 = N 栋逻辑建筑），与村民代理比 RENDER_Q 同构。
// 本测试锁死「各时代关键路径所需地块数 ≤ 岛屿可容纳量」，防止目标再次超出地形容量。
import { T, NUM, buildQ, toTiles, buildingLow, buildingHigh, buildingLowTiles, buildingHighTiles, gateOf, industryPerSec } from '../js/formulas.js';
import { ERAS, MILESTONES } from '../js/config.js';

function assert(cond, msg){
  if(!cond) throw new Error('FAIL: ' + msg);
  console.log('  ok -', msg);
}

// ---- 1) BUILD_Q 自身 ----
assert(Array.isArray(NUM.BUILD_Q) && NUM.BUILD_Q.length === 5, `BUILD_Q 有 5 个时代取值 [${NUM.BUILD_Q}]`);
assert(NUM.BUILD_Q[0] === 1 && NUM.BUILD_Q[1] === 1, 'E1/E2 无代理（1 地块 = 1 栋，早期体验不变）');
assert(NUM.BUILD_Q.every((q,i,a)=> i===0 || q >= a[i-1]), 'BUILD_Q 随时代单调不减');
for(let E=0; E<5; E++) assert(buildQ(E) === NUM.BUILD_Q[E], `buildQ(${E+1}) = ${NUM.BUILD_Q[E]}`);
assert(buildQ(9) === NUM.BUILD_Q[4] && buildQ(-3) === NUM.BUILD_Q[0], 'buildQ 越界夹取到 0..4');

// ---- 2) 地块口径 = 逻辑口径 ÷ BUILD_Q（且逻辑口径未被改动）----
for(let E=0; E<5; E++){
  for(const z of [1,2,3,4]){
    const L = buildingLow(E, z), Tt = buildingLowTiles(E, z);
    assert(Tt === Math.ceil(L / buildQ(E)), `E${E+1} zone${z}: 地块 ${Tt} = ⌈逻辑 ${L} ÷ ${buildQ(E)}⌉`);
    assert(buildingHighTiles(E, z) >= Tt, `E${E+1} zone${z}: high 地块 ≥ low 地块`);
  }
}
// 逻辑口径必须仍是规范原式（T × r_b），不能被代理比污染
for(let E=0; E<5; E++) for(const z of [1,2,3,4]){
  assert(buildingLow(E, z) === Math.ceil(T[E] * NUM.R_B[z]),
    '逻辑口径 buildingLow 仍为规范原式 ceil(T(E) × r_b)，未被 BUILD_Q 污染'
      + '（E' + (E+1) + ' zone' + z + '：期望 ' + Math.ceil(T[E] * NUM.R_B[z]) + '，实测 ' + buildingLow(E, z) + '）');
}

// ---- 3) E5 目标与核算 ----
assert(T[4] === 60000, `E5 目标人口 ${T[4]}（6 万，为容纳进岛屿容量而自 10 万下调）`);
assert(ERAS[4].popGoal === T[4], 'ERAS[4].popGoal 与 T[4] 一致（HUD/进阶判定同源）');
assert(ERAS[0].popGoal === T[0] && ERAS[3].popGoal === T[3], '其余时代 popGoal 与 T 一致');

// ---- 4) 核心断言：各时代关键路径地块数 ≤ 岛屿可容纳量 ----
// 岛屿实测（见 修改计划书-v2.md §2.2）：可建造格 4,979~5,881/种子；
// 8 邻域空置 → 密度 ≤25% → 建筑格预算 ≈1,350（取保守 1,250 留余量）。
const BUILD_BUDGET = 1250;

for(let E=0; E<5; E++){
  const q = buildQ(E);
  // 关键路径 = 人口（→住房地块）+ 门槛工业地块 + 里程碑工业 + 农田功能刚需
  const houseTiles = toTiles(Math.ceil(T[E] / NUM.C_HOUSE), E);
  const gateIndTiles = toTiles(Math.ceil(gateOf(E) / NUM.K_IND), E);
  // 里程碑里的工业阈值（逻辑口径），换算成地块
  const msInd = (MILESTONES[E] || []).reduce((mx, m) => {
    const mm = /工业≥(\d+)/.exec(m.label);
    return mm ? Math.max(mx, +mm[1]) : mx;
  }, 0);
  const msIndTiles = toTiles(msInd, E);
  const farmTiles = toTiles(Math.ceil(T[E] * NUM.R_FOOD / NUM.C_FARM), E);
  const total = houseTiles + gateIndTiles + msIndTiles + farmTiles;
  assert(total <= BUILD_BUDGET,
    `E${E+1} 关键路径 ${total} 地块 ≤ 预算 ${BUILD_BUDGET}` +
    `（房 ${houseTiles} + 门槛工业 ${gateIndTiles} + 里程碑工业 ${msIndTiles} + 农田 ${farmTiles}，代理比 ${q}）`);
}

// ---- 5) 若去掉代理比，E4/E5 必须超预算（证明代理比确有必要，而非可选项）----
for(const E of [3,4]){
  const houseL = Math.ceil(T[E] / NUM.C_HOUSE);                 // 假设 1 地块 = 1 栋
  const gateL = Math.ceil(gateOf(E) / NUM.K_IND);
  const totalL = houseL + gateL;
  assert(totalL > BUILD_BUDGET,
    `E${E+1} 若不设代理比需 ${totalL} 地块 > 预算 ${BUILD_BUDGET}（故 BUILD_Q 是必要条件）`);
}

// ---- 6) 产出用逻辑口径：同一地块数在 E5 的产出必须是 E1 口径的 BUILD_Q 倍 ----
{
  const tiles = 100;
  const out1 = industryPerSec(tiles * buildQ(0));
  const out5 = industryPerSec(tiles * buildQ(4));
  assert(Math.abs(out5 / out1 - NUM.BUILD_Q[4]) < 1e-9,
    `同样 ${tiles} 地块工业：E5 产出 ${out5}/s = E1 的 ${NUM.BUILD_Q[4]} 倍（逻辑口径生效）`);
}

console.log('BUILD_Q 玩法可达性 regression PASS');
