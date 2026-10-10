// 子民自动建造 —— 优先级决策（纯逻辑）
//
// 为什么单独成模块（2026-10）：
// `autoBuild` 的决策段注释里记录了两个**真实的玩法灾难**，而它们全都零测试覆盖
// （main.js 顶层 `boot()`，Node 无法 import）：
//   1. S-04 棘轮：原 `need[z] = cnt[z] + 2` 使 need 恒 > cnt → 三个缺口判定恒真
//      → 无条件刷到 high 水位（把岛铺满）
//   2. 住房死锁：房屋要求「8 邻域全空」，农田/工业会先占掉这类空格。
//      若人口已被住房卡满时仍先放农田/工业，房屋再也找不到点位 → 人口永久停滞。
//      极坏情形是「一栋房都没有」：E1–2 人口上限 = 住房×C_HOUSE，无住房则 popCap=0，
//      人口从开局 20 衰减到 1；而工业在 pop<15 时放弃 → 无工业 → indOk 恒假
//      → 永远建不出第一栋房（实测：人口卡在 1，农田却建到 40+ 格、粮产 45/s）。
//
// 把决策抽出来后可对这两个灾难直接写回归断言。

import * as F from './formulas.js';

/**
 * 按公式计算「本轮各分区的建造目标」（地块口径）。
 *
 * 关键：**达标后缺口必须归零**，即 `cnt >= lo` 时 `need = min(hi, cnt)`。
 * 若写成 `cnt + k`，need 会恒大于 cnt、缺口恒真 —— 这正是 S-04 棘轮。
 *
 * @returns {{1:number,2:number,3:number,4:number}} 地块数目标
 */
export function buildNeeds(E, cnt){
  const need = {};
  for(const z of [1,2,3,4]){
    const lo = F.buildingLowTiles(E, z);
    const hi = F.buildingHighTiles(E, z);
    need[z] = (cnt[z] || 0) < lo ? lo : Math.min(hi, cnt[z] || 0);
  }
  return need;
}

/** 待建加权需求（与 tick 同口径，按 BUILD_COST 加权） */
export function pendingWeight(E, cnt, built){
  let w = 0;
  for(const z of [1,2,3,4]){
    w += Math.max(0, (cnt[z] || 0) - (built[z] || 0)) * (F.NUM.BUILD_COST[z] ?? 1);
  }
  return w;
}

/**
 * 供需与门槛判定（产出用逻辑口径：地块数 × buildQ(E)）。
 *
 * 注意：`houseShort` 依赖 `housingPressure` 阈值，故本函数接收该阈值而**不自己造一个** ——
 * 早先版本在内部用占位阈值算出 houseShort、再由调用方覆盖，属易误读的重复计算。
 */
export function buildGates(E, { cnt, built, need, pop, housingCap, faithRate, faithPressure, housingPressure }){
  const qB = F.buildQ(E);
  const farmsBuilt = built[2] || 0, indsBuilt = built[3] || 0;
  const foodOut = F.foodPerSec(farmsBuilt * qB);
  const foodNeed = F.foodNeed(pop);
  const indOut = F.industryPerSec(indsBuilt * qB);
  const buildDemand = pendingWeight(E, cnt, built) * F.NUM.C0 * Math.pow(1.5, E);

  // 粮食有余：能养活当前人口，且再养 4 人（一栋房）仍够
  const foodOk = foodOut >= foodNeed * 1.05 && foodOut >= (pop + 4) * F.NUM.R_FOOD;
  // 产能有余：建造需求可控，且已有基本工业底子
  const indBase = F.industryPerSec(Math.max(1, F.buildingLow(E, 3) * 0.2));
  const indOk = indOut >= Math.max(indBase, buildDemand * 1.05);

  const hc = housingCap || 0;
  const popPress = hc > 0 && pop / hc > housingPressure;
  const houseShort = (cnt[1] || 0) < need[1] || popPress || hc <= 0;

  // 缺口：公式目标用 zoned（还要继续建），实际供不应求用 built
  const farmShort = (cnt[2] || 0) < need[2] || foodOut < foodNeed;
  const indShort = (cnt[3] || 0) < need[3] || indOut < buildDemand;
  const churchShort = (cnt[4] || 0) < need[4] || !faithRate || faithRate < faithPressure;

  return { foodOut, foodNeed, indOut, buildDemand, foodOk, indOk, hc, houseShort, farmShort, indShort, churchShort };
}

/**
 * 本轮的行动优先级。
 *
 * 三个不变量（均由回归测试锁定）：
 *   A. **无住房时住房必须置顶**（forceHouse）：否则名额被农田/工业占掉，
 *      而房屋要求 8 邻域全空 → 第一栋房永远建不出来 → 人口卡死。
 *   B. **住房缺口且人口已被卡满时必须置顶**（housingCritical）：同上，
 *      但发生在「已有住房但人口已达上限」的场景。
 *   C. 非紧急住房只有在粮产都有余时才建（避免饿死人口换住房）。
 *
 * 注意：本函数**不做**「人口太少不建工业」的过滤 —— 该门槛属 `tryPlaceIndustry`
 * 的运行时门槛（`pop < 15` 直接放弃），留在调用方，以免同一条件散落两处后行为分叉。
 * 调用方按本顺序逐个尝试、受 AUTO.maxPerTick 限制提前返回，故顺序即优先级。
 *
 * @returns {{list:string[], forceHouse:boolean, housingCritical:boolean, fallbackHouse:boolean}}
 */
export function buildOrder({ cnt, need, gates, pop }){
  // 无任何住房 → 极紧急：E1–2 无住房则人口上限为 0
  const noHousing = (cnt[1] || 0) <= 0;
  // 住房缺口且人口已达住房上限（含无住房）→ 建不出房则人口永久停滞
  const housingCritical = gates.houseShort && (gates.hc <= 0 || pop >= gates.hc - 0.5);

  // 住房置顶：A + B 两条不变量
  const forceHouse = noHousing || housingCritical;

  const list = [];
  if(forceHouse) list.push('house');
  if(gates.farmShort) list.push('farm');
  if(gates.indShort) list.push('industry');
  // 非紧急住房：粮产都有余才建
  if(!forceHouse && gates.foodOk && gates.indOk && gates.houseShort) list.push('house');
  if(gates.churchShort) list.push('church');

  // 本轮啥也没建成且住房仍缺时，放宽资源门槛再补一次房
  const fallbackHouse = gates.houseShort && ((cnt[2] || 0) > 0 || gates.foodOut > 0);

  return { list, forceHouse, housingCritical, fallbackHouse };
}

/**
 * 一次性算出完整决策（供 main.autoBuild 调用）。
 * 返回顺序、紧急标志与全部中间量，便于诊断与测试。
 */
export function autoBuildDecision(E, opts){
  const { cnt, built, pop, housingCap, faithRate, housingPressure, faithPressure } = opts;
  const need = buildNeeds(E, cnt);
  const gates = buildGates(E, { cnt, built, need, pop, housingCap, faithRate, faithPressure, housingPressure });
  const order = buildOrder({ cnt, need, gates, pop });
  return { need, gates, ...order };
}
