// 时代进阶 / 星星里程碑 —— 纯决策逻辑
//
// 为什么单独成模块（2026-10）：
// `main.js` 在顶层直接 `boot()` 并注册 window/document 监听，因此 **Node 无法 import 它**，
// 导致 eraReady / advanceEra / checkStarMilestones / milestoneSummary 这四段核心进度逻辑
// **零测试覆盖**。而本项目最贵的一次回归恰恰就出在这里（时代硬锁：某些种子永久停在
// 工业 9/s、12/s，玩家无法通关）。把决策逻辑抽到无 DOM 依赖的纯模块后即可单元测试。
//
// 约定：本模块**只做判定、不改 G**（除 claimMilestones 的位图与星数记账外无副作用），
// 所有表现（toast / 粒子 / 音效 / 渲染刷新）留在 main.js，便于测试与复用。

import { ERAS, MILESTONES } from './config.js';
import * as F from './formulas.js';

/**
 * 时代进阶条件逐项判定（**不改动 G**）。
 *
 * 注意四项条件必须**同口径**：`gateOf` 是逻辑口径（0.5 × 逻辑刚需工业产能），
 * 故地块数须乘 `buildQ(era)` 后再比 —— 传错口径会让后期少算 BUILD_Q 倍（E5 差 20 倍）。
 *
 * @param {object} G 游戏状态（需 era / pop / stars / wonders / _builtCache）
 * @returns {{ok:boolean, reasons:string[], checks:object}}
 *   reasons 为空即满足；checks 给出每一项的实测值，便于 UI 与排障直接复用同一口径。
 */
export function eraReadiness(G){
  const era = G.era | 0;
  const popGoal = ERAS[era]?.popGoal ?? Infinity;
  const starCost = ERAS[era]?.starCost ?? 0;
  // E5 已是终点：通关看太空电梯，不再进阶
  const isLastEra = era >= 4;
  const needWonder = era >= 1;
  const wonderOk = !needWonder || !!G.wonders?.[era];
  const indTiles = (G._builtCache && G._builtCache[3]) || 0;
  const indLogical = indTiles * F.buildQ(era);
  const indPerSec = F.industryPerSec(indLogical);
  const gate = F.gateOf(era);
  const checks = {
    era, pop: G.pop, popGoal, stars: G.stars, starCost,
    needWonder, wonderOk, indTiles, indLogical, indPerSec, gate,
  };
  const reasons = [];
  if(isLastEra) reasons.push('已是最终时代');
  else {
    if(!(G.pop >= popGoal)) reasons.push('人口不足');
    if(!wonderOk) reasons.push('本时代奇迹未建成');
    if(!(G.stars >= starCost)) reasons.push('星星不足');
    if(!(indPerSec >= gate)) reasons.push('产能不足');
  }
  return { ok: reasons.length === 0, reasons, checks };
}

/** 兼容旧调用形态：只问「是否可进阶」 */
export function eraReady(G){ return eraReadiness(G).ok; }

/**
 * 结算当前时代的里程碑：把**新达成**的项置位并加星。
 * 返回新达成的里程碑数组（供调用方 toast / 记日志），不在这里做表现层副作用。
 *
 * 入参 farms/inds/churches/houses 是**地块数**，内部乘 `buildQ(era)` 换算为逻辑数，
 * 与 `MILESTONES[].check` 的阈值口径一致（config.js 注释如「农田≥10」「工业≥200」）。
 */
export function claimMilestones(G, { farms = 0, inds = 0, churches = 0, houses = 0 } = {}){
  const era = F.eraIndex(G);
  if(!G.starMilestones) G.starMilestones = [[],[],[],[],[]];
  while(G.starMilestones.length < 5) G.starMilestones.push([false,false,false]);
  const flags = G.starMilestones[era] || (G.starMilestones[era] = [false,false,false]);
  const list = MILESTONES[era] || [];
  const qm = F.buildQ(era);
  const ctx = { farms: farms*qm, inds: inds*qm, churches: churches*qm, houses: houses*qm };
  const newly = [];
  for(let i=0; i<list.length; i++){
    if(flags[i]) continue;
    if(list[i].check(G, ctx)){
      flags[i] = true;
      G.stars += 1;
      newly.push({ index: i, label: list[i].label });
    }
  }
  return newly;
}

/**
 * 里程碑进度文本（UI 用）。
 * 与 `claimMilestones` 共用同一口径换算，避免「HUD 说未达标但实际已满足」。
 */
export function milestoneSummary(G, farms, inds, churches, houses = 0){
  const era = F.eraIndex(G);
  const list = MILESTONES[era] || [];
  const flags = G.starMilestones?.[era] || [];
  const qm = F.buildQ(era);
  const ctx = { farms: farms*qm, inds: inds*qm, churches: churches*qm, houses: houses*qm };
  return list.map((m, i)=>{
    const done = !!flags[i];
    const ok = done || m.check(G, ctx);
    return `${ok ? '✓' : '○'} ${m.label}`;
  }).join(' · ');
}

/**
 * 进阶的状态迁移（**只改 G 的字段，不做任何表现层副作用**）。
 * 返回给调用方去执行渲染刷新 / 音效 / 提示。
 *
 * 关键：必须同时清掉「放置中」与「雕刻中」两类残留输入态 ——
 * 否则进阶前若点过奇迹按钮或正卡着 painting，新时代表格会继续被雕刻，
 * 且奇迹按钮会永久停留在"放置中"样式（2026-10 审计发现）。
 */
export function applyEraAdvance(G){
  const from = G.era | 0;
  G.stars = Math.max(0, G.stars - (ERAS[from]?.starCost ?? 0));
  G.era = from + 1;
  G.starProg = 0;
  // 清残留输入态，避免跨时代继续施工 / 按钮卡住
  G.placingWonder = null;
  G.painting = false;
  G.panning = false;
  G.hover = null;
  G.terrainDirty = true;
  return { from, to: G.era, name: ERAS[G.era]?.name ?? '' };
}
