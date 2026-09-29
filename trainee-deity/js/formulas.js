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
  // 显示比例 p(E)（可选展示）
  RENDER_P: [0.15, 0.04, 0.003, 5e-5, 8e-8],
};

// 建筑布局参数（numeric-design §8.6）
export const LAYOUT = {
  R_farm: 3,
  R_ind: 6,          // 工业距居住最小切比雪夫距离
  D_max: 8,          // 异类簇最大中心距
  D_chunk_max: 1,
  BlockCap: 25,      // 单区块建筑容量
  CHUNK: 10,
  gap_min: 1,
  gap_farm: 0,
  batch: { 1: 9, 2: 9, 3: 2, 4: 1 },
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

// N_cap：E1–2 住房，E3–4 粮食，E5 产能
export function popCap(E, houses, farms, industries){
  if(E <= 1) return houses * NUM.C_HOUSE;
  if(E <= 3) return Math.floor(farms * NUM.C_FARM / NUM.R_FOOD);
  return Math.floor(industries * NUM.K_IND / NUM.R_INDPOP);
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

// 建造速度 V(E) = V0 * clamp(产能供给 / 产能需求, 0.2, 2)
export function buildSpeed(E, industries, pending){
  if(pending <= 0) return NUM.V0;
  const supply = industryPerSec(industries);
  const eW = Math.pow(1.5, E);
  const demand = Math.max(1e-6, pending * NUM.C0 * eW);
  const ratio = supply / demand;
  // F2：0.2 下限假设「已有工业」；零工业开局 V=0.014/s（单栋约 71 游戏秒），
  // 首栋住房建成远慢于人口压力。无工业时改用村民「自建」底速 0.5×V0（约 14 游戏秒/栋）。
  const floor = industries > 0 ? 0.2 : 0.5;
  return NUM.V0 * Math.max(floor, Math.min(2.0, ratio));
}

// N_render = clamp(round(50*log10(N) - 85), min(E), max(E))
export function renderVillagers(N, E){
  if(N <= 1) return NUM.RENDER_MIN[E];
  const raw = Math.round(50 * Math.log10(N) - 85);
  const lo = NUM.RENDER_MIN[E], hi = NUM.RENDER_MAX[E];
  return Math.max(lo, Math.min(hi, raw));
}
