// 实习神明 · 数值公式（对齐 numeric-design.md）
// E 为 1..5；代码里 era 下标 0..4

import { FAITH_ERA_DAMP } from './config.js';

export const T = [200, 2000, 8000, 20000, 100000];

export const NUM = {
  C_HOUSE: 4,
  C_FARM: 50,
  R_FOOD: 1,
  R_IND: 0.15,
  R_CHURCH: 0.05,
  K_FAITH_POP: 0.1,
  K_CHURCH: 2,
  K_IND: 1.0,
  K: 1.25,
  V0: 0.07,
  C0: 0.5,
  R_INDPOP: 0.01,
  // 人均建筑系数 r_b
  R_B: { 1: 0.25, 2: 0.20, 3: 0.15, 4: 0.05 },
  // 人口增长率 g(E)
  GROWTH: [0.035, 0.04, 0.045, 0.05, 0.058],
  // 村民渲染上下限（numeric-design §7.2）
  RENDER_MIN: [10, 50, 100, 165, 250],
  RENDER_MAX: [60, 120, 200, 300, 400],
  // 代理比 q(E) = T(E)÷R(E)：1 个渲染村民代表 q 个实际村民（§7.2，p(E) = 1/q(E)）。
  // E3 取 53.33（表内 53 为舍入显示），保证 T(E) 下输出恰为 30/80/150/250/400。
  RENDER_Q: [6.7, 25, 53.33, 80, 250],
  // 各建筑造价权重（§3⑤/§6）：产能需求 = c_build(E) × cost(zone)。
  // 按刚需配比 r_b 加权后均值恰为 1.0（0.25×0.6+0.20×0.8+0.15×1.6+0.05×2.0 = 0.65 = Σr_b），
  // 不改变 §4.3 整体建造速度曲线，只重新分配四类建筑间的经济压力。
  BUILD_COST: { 1: 0.6, 2: 0.8, 3: 1.6, 4: 2.0 },
};

// 建筑布局参数（numeric-design §8.6）
export const LAYOUT = {
  R_ind: 6,          // 工业距居住最小切比雪夫距离
  D_max: 8,          // 异类簇最大中心距
  BlockCap: 25,      // 单区块建筑容量
  // P2-B（2026-10 决策：以代码为准）：原 batch={1:9,2:9,3:2,4:1} 为死值（全库零引用），已删除。
  // 批次方阵不实施；工业 2 格配对由 AUTO.industryPerTick 承担，见 numeric-design §8 实现差异注。
  // 2026-10 校准：CHUNK/R_farm/D_chunk_max/gap_min/gap_farm 同为全库零引用死值，已删除。
  // 区块尺寸统一取 config.js 的 CHUNK（此前 terrain.js 用 LAYOUT.CHUNK、state.js 用 config.CHUNK，
  // 两处定义分裂在两条路径上，任一处改动都会造成区块尺寸理解不一致的静默错位）。
  // 间隔规则（gap_min/gap_farm）实际由 terrain.js canPlaceZoneAt 的硬编码 8 邻域判定实现。
  // 打分权重
  w1: 3.0, w2: 2.0, w3: 1.5, w4: 2.5, w5: 2.0,
};

export function eraIndex(G){ return Math.max(0, Math.min(4, G.era|0)); }

export function buildingLow(E, zone){
  return Math.ceil(T[E] * NUM.R_B[zone]);
}
export function buildingHigh(E, zone){
  return Math.ceil(T[E] * NUM.R_B[zone] * NUM.K);
}

/**
 * 奇迹「人口容量」乘区：金字塔 +20%、摩天塔 +50%（config.js WONDERS[1]/[3] 的 bonus 文案）。
 * 单一来源 —— state.housingCap（autoBuild 压力判断）与 tick 的人口上限都必须经此计算，
 * 否则会出现「UI 与 HUD 承诺加成、实际人口上限拿不到」的口径分叉（2026-10 修复的回归即属此类）。
 */
export function wonderPopMult(wonders){
  if(!wonders) return 1;
  let m = 1;
  if(wonders[1]) m *= 1.2;
  if(wonders[3]) m *= 1.5;
  return m;
}

/**
 * N_cap：E1–2 住房，E3–4 粮食，E5 产能；再乘奇迹人口容量乘区。
 * @param wonders 可选；未传时视为无奇迹（保持纯公式语义，便于测试与文档对照）
 */
export function popCap(E, houses, farms, industries, wonders){
  let cap;
  if(E <= 1) cap = houses * NUM.C_HOUSE;
  else if(E <= 3) cap = Math.floor(farms * NUM.C_FARM / NUM.R_FOOD);
  else cap = Math.floor(industries * NUM.K_IND / NUM.R_INDPOP);
  return cap * wonderPopMult(wonders);
}

export function foodPerSec(farms){ return farms * NUM.C_FARM; }
export function foodNeed(N){ return N * NUM.R_FOOD; }
/**
 * 信仰/秒 = (教堂 × K_CHURCH + 人口 × K_FAITH_POP) × 时代阻尼
 * 人口项必须按时代阻尼：否则人口每时代涨 10~1000 倍会直接把信仰产出带爆
 * （各时代满规模产出见 config.js FAITH_ERA_BASE）
 */
export function faithPerSec(churches, N, E=0){
  const i = Math.max(0, Math.min(4, E|0));
  return (churches * NUM.K_CHURCH + N * NUM.K_FAITH_POP) * FAITH_ERA_DAMP[i];
}
export function industryPerSec(industries){ return industries * NUM.K_IND; }

/**
 * 时代进阶产能门槛 GATE(E) = 0.5 × 刚需工业产能/秒
 * （numeric-design ⑥c；E1 可达标较易，E5 不用于离开时代）
 */
export function gateOf(E){
  return 0.5 * industryPerSec(buildingLow(E, 3));
}

// 人口：N ← min(N_cap, N*(1+g*dt) + 0.6*dt)，且粮食须够吃
export function growPop(N, cap, E, farms, dt){
  const g = NUM.GROWTH[Math.max(0, Math.min(4, E))];
  let next = N * (1 + g * dt) + 0.6 * dt;
  if(next > cap) next = cap;
  // 粮食约束：缺粮时按缺口比例连续（dt 比例）衰减；
  // 旧实现「每 tick 减半」下限与帧率耦合，低帧下人口数秒内从 20 崩到 1。
  const food = foodPerSec(farms);
  if(food < foodNeed(next)){
    const supported = food / NUM.R_FOOD;
    const deficit = (foodNeed(next) - food) / Math.max(1e-6, foodNeed(next));
    next = supported - supported * Math.min(0.5, deficit) * dt;
  }
  return Math.max(0, next);
}

// 建造速度 V(E) = V0 * clamp((产能供给 − 奇迹占用) / 产能需求, floor, 2)
// pending 为按 BUILD_COST 加权后的待建数（§3⑤）；wonderDraw 为在建奇迹的每秒产能占用（§3⑥b）
export function buildSpeed(E, industries, pending, wonderDraw = 0){
  if(pending <= 0) return NUM.V0;
  const supply = Math.max(0, industryPerSec(industries) - wonderDraw);
  const eW = Math.pow(1.5, E);
  const demand = Math.max(1e-6, pending * NUM.C0 * eW);
  const ratio = supply / demand;
  // F2：0.2 下限假设「已有工业」；零工业开局 V=0.014/s（单栋约 71 游戏秒），
  // 首栋住房建成远慢于人口压力。无工业时改用村民「自建」底速 0.5×V0（约 14 游戏秒/栋）。
  const floor = industries > 0 ? 0.2 : 0.5;
  return NUM.V0 * Math.max(floor, Math.min(2.0, ratio));
}

/**
 * 在建奇迹的每秒产能占用（§3⑥b/§4.4）。
 * coinCost(E) = 建造时长(E) × 产能/秒(E)，产能/秒(E) 取本时代刚需工业水位
 * industryPerSec(buildingLow(E,3)) = 30/300/1200/3000/15000（与 §4.4 表一致）。
 * 游戏无产能库存，实现口径 = 施工期内持续占用该流量，施工总消耗恰为 coinCost(E)。
 */
export function wonderDrawPerSec(E){
  return industryPerSec(buildingLow(E, 3));
}

// N_render = clamp(round(N ÷ q(E)), min(E), max(E))（§7.1 线性方案，2026-09-30 重标定）
// 目标人口 T(E) 下输出恰为 R(E) = 30/80/150/250/400（旧对数式 (50,−85) 按旧 T 标定，
// 新 T 下 E3–E5 仅 110/165/250，视觉成长感不足，见 numeric-design §7.2 注）
export function renderVillagers(N, E){
  if(N <= 1) return NUM.RENDER_MIN[E];
  const raw = Math.round(N / NUM.RENDER_Q[E]);
  const lo = NUM.RENDER_MIN[E], hi = NUM.RENDER_MAX[E];
  return Math.max(lo, Math.min(hi, raw));
}
