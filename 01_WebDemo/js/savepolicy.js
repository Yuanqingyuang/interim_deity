// 存档策略 —— 纯决策逻辑
//
// 为什么单独成模块（2026-10）：
// 三条存档路径（周期自动存档 / 离场同步写 / 转后台异步写）原先把**互斥条件与节流算术**
// 直接写死在 main.js 的事件回调里。而 main.js 顶层会 boot() 并注册 window 监听，
// Node 无法 import → 这些条件零测试覆盖。它们又恰好是「静默丢档」的发生地：
//   · 节流窗口写错 → 玩家的最后一次进度被吞掉
//   · 互斥条件漏一个标志 → 两份全量序列化并发跑（CPU/内存翻倍，槽位靠序号兜底）
//
// 审计发现的实际问题：visibilitychange 只查 `_saving || _bgSaveBusy`，
// **不查 `_autosaveBusy`**，故自动存档在飞时切后台会出现两份并发序列化。
// 本模块把「是否忙」统一为单一判据，三条路径共用。

/**
 * 是否有存档正在写。
 *
 * 三条路径必须共用本判据 —— 此前各自检查不同的标志组合（漏项），
 * 属「靠路径枚举正确」的脆弱写法，新增一条路径就会漏。
 * @param {object} s 形如 { autosaveBusy, saving, bgSaveBusy }
 */
export function isSaveBusy(s){
  return !!(s && (s.autosaveBusy || s.saving || s.bgSaveBusy));
}

/**
 * 周期自动存档是否到点。
 *
 * 注意返回值语义：只回答「该不该写」。累加器 `acc` 与「已到点」标志由调用方维护，
 * 因为「到点后是否真的发起写入」还取决于 `isSaveBusy` —— 若因忙而跳过，
 * 累加器**不应**清零，否则这次到点就被白白吞掉（会推迟一整轮才再试）。
 *
 * @returns {{due:boolean, acc:number, reason:string}}
 *   acc 是调用方应写回的新累加值：未到点时为累加后的值，到点且不忙时为 0。
 */
export function autosaveTick({ acc, dt, intervalSec, busy, started, over, hasUser }){
  if(!started) return { due:false, acc, reason:'not-started' };
  if(over)      return { due:false, acc, reason:'game-over' };
  if(!hasUser)  return { due:false, acc, reason:'no-user' };
  const next = (acc || 0) + (dt || 0);
  if(busy)      return { due:false, acc:next, reason:'busy' };      // 保留累加，下帧再试
  if(next < intervalSec) return { due:false, acc:next, reason:'not-due' };
  return { due:true, acc:0, reason:'due' };
}

/**
 * 离场保存（beforeunload / pagehide）是否应执行。
 *
 * 两条离场路径共用同一节流窗口：相邻触发时第二次直接跳过，避免重复全量序列化
 * （大图数 MB，同步 stringify + setItem 可达秒级，会阻塞卸载）。
 *
 * @returns {{run:boolean, reason:string}}
 */
export function exitSaveTick({ lastSaveOk, now, minIntervalMs, started, over, hasUser }){
  if(!started) return { run:false, reason:'not-started' };
  if(over)     return { run:false, reason:'game-over' };
  if(!hasUser) return { run:false, reason:'no-user' };
  if(now - (lastSaveOk || 0) < minIntervalMs) return { run:false, reason:'throttled' };
  return { run:true, reason:'due' };
}

/**
 * 转后台异步存档是否应发起。
 * 已并入统一的忙判据（原实现漏查 autosaveBusy）。
 */
export function bgSaveTick({ busy, started, over, hasUser }){
  if(!started) return { run:false, reason:'not-started' };
  if(over)     return { run:false, reason:'game-over' };
  if(!hasUser) return { run:false, reason:'no-user' };
  if(busy)     return { run:false, reason:'busy' };
  return { run:true, reason:'due' };
}
