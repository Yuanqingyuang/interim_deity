// 存档策略（rev-5）
//
// 为什么需要：三条存档路径（周期自动存档 / 离场同步写 / 转后台异步写）原先各自把
// 「是否该写」「节流窗口」「互斥条件」写死在 main.js 的事件回调里。main.js 顶层会 boot()
// 并注册 window 监听 → Node 无法 import → 这些条件**零测试覆盖**。
// 而它们恰好是「静默丢档」的发生地。抽到 js/savepolicy.js 后即可直接断言。
//
// 覆盖两个真实缺陷：
//   ① 互斥条件漏项：visibilitychange 只查 `_saving || _bgSaveBusy`，**漏查 autosaveBusy**
//      → 自动存档在飞时切后台会并发两份全量序列化
//   ② 「因忙跳过时是否吞掉本轮到点」：若把累加器清零，这次到点就被白白吞掉，
//      会推迟整整一个 AUTOSAVE_SEC 才再试
//
// 另一条同样重要的教训：抽函数时**极易漏掉监听器的重新注册**。
// 本轮把 beforeunload 的匿名回调换成具名 saveOnExit 时，就曾把监听器本身丢掉
// （实测注册数由 1 变 0），会直接导致桌面端关页/刷新时丢档。
// 故末尾加一项「main.js 的离场监听注册数」静态断言作为门禁。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSaveBusy, autosaveTick, exitSaveTick, bgSaveTick } from '../js/savepolicy.js';

let pass = 0, fail = 0;
const ok = (cond, msg)=>{ if(cond){ pass++; console.log('  ok - ' + msg); } else { fail++; console.log('  FAIL - ' + msg); } };

const NO_BUSY = { autosaveBusy:false, saving:false, bgSaveBusy:false };

console.log('=== 1) isSaveBusy：三个标志任一为真都必须判忙 ===');
{
  ok(isSaveBusy(NO_BUSY) === false, '三者皆假 → 不忙');
  ok(isSaveBusy({ ...NO_BUSY, autosaveBusy:true }) === true, 'autosaveBusy → 忙');
  ok(isSaveBusy({ ...NO_BUSY, saving:true }) === true, 'saving → 忙');
  ok(isSaveBusy({ ...NO_BUSY, bgSaveBusy:true }) === true, 'bgSaveBusy → 忙');
  ok(isSaveBusy({ ...NO_BUSY, autosaveBusy:true, bgSaveBusy:true }) === true, '多个标志同时为真 → 忙');
  // 防御：缺字段/undefined 不应抛错，且视为不忙
  ok(isSaveBusy({}) === false && isSaveBusy(undefined) === false && isSaveBusy(null) === false,
     '缺字段/undefined/null 视为不忙且不抛错');
  // 真值语义：非布尔真值也应判忙（避免调用方传 1/"x" 时静默放行）
  ok(isSaveBusy({ autosaveBusy: 1 }) === true, '真值型标志（1）也判忙');
}

console.log('');
console.log('=== 2) 缺陷①：切后台必须把「自动存档在飞」也算作忙 ===');
{
  // 这正是原实现的漏洞：visibilitychange 只查 saving/bgSaveBusy。
  // 修复后三条路径共用 isSaveBusy，故自动存档在飞时必须挡住后台写。
  const autoInFlight = { autosaveBusy:true, saving:false, bgSaveBusy:false };
  const d = bgSaveTick({ busy: isSaveBusy(autoInFlight), started:true, over:false, hasUser:true });
  ok(d.run === false && d.reason === 'busy',
     `自动存档在飞时切后台 → 不发起第二份序列化（reason=${d.reason}）`);
  // 同理：后台写在飞时，周期自动存档也必须被挡住
  const bgInFlight = { autosaveBusy:false, saving:false, bgSaveBusy:true };
  const a = autosaveTick({ acc: 999, dt: 1, intervalSec: 180, busy: isSaveBusy(bgInFlight),
                           started:true, over:false, hasUser:true });
  ok(a.due === false && a.reason === 'busy',
     `后台写在飞时周期存档 → 不发起（reason=${a.reason}）`);
  // 离场写与在飞的异步写：靠槽位序号「最新者获胜」兜底，故 exitSaveTick 不查忙标志，
  // 只做节流。这里断言该设计确实不因忙而被挡（否则真卸载时会丢档）。
  const e = exitSaveTick({ lastSaveOk: 0, now: 1e9, minIntervalMs: 15000,
                           started:true, over:false, hasUser:true });
  ok(e.run === true, '离场写不因在飞的异步写而被挡（靠序号兜底，避免真卸载丢档）');
}

console.log('');
console.log('=== 3) autosaveTick：到点与累加器语义 ===');
{
  const base = { intervalSec: 180, busy:false, started:true, over:false, hasUser:true };
  let d = autosaveTick({ ...base, acc: 0, dt: 100 });
  ok(d.due === false && d.acc === 100 && d.reason === 'not-due', `未到点：累加到 100，不触发`);

  d = autosaveTick({ ...base, acc: 170, dt: 20 });
  ok(d.due === true && d.acc === 0 && d.reason === 'due', `恰好到点（190≥180）：触发且累加器清零`);

  d = autosaveTick({ ...base, acc: 179, dt: 1 });
  ok(d.due === true, '边界 180 视为到点（>= 而非 >）');

  // 缺陷②：因忙跳过时**不得清零**，否则这次到点被白白吞掉，要再等一整轮
  d = autosaveTick({ ...base, busy:true, acc: 179, dt: 1 });
  ok(d.due === false && d.acc === 180 && d.reason === 'busy',
     `因忙跳过：累加器保留 180（不清零），下帧立即重试`);
  const again = autosaveTick({ ...base, acc: d.acc, dt: 0.016 });
  ok(again.due === true, '忙解除后下一帧立刻触发（不会白等一整轮）');

  // 前置条件
  ok(autosaveTick({ ...base, started:false, acc:999, dt:9 }).reason === 'not-started', '未开始 → 不存');
  ok(autosaveTick({ ...base, over:true, acc:999, dt:9 }).reason === 'game-over', '通关后 → 不存');
  ok(autosaveTick({ ...base, hasUser:false, acc:999, dt:9 }).reason === 'no-user', '无用户 → 不存');
  // 大 dt（标签页切回）也不应异常
  const big = autosaveTick({ ...base, acc: 0, dt: 1e6 });
  ok(big.due === true && Number.isFinite(big.acc), '极大 dt 不产生 NaN/Infinity');
}

console.log('');
console.log('=== 4) exitSaveTick：节流窗口 ===');
{
  const base = { minIntervalMs: 15000, started:true, over:false, hasUser:true };
  let d = exitSaveTick({ ...base, lastSaveOk: 1000, now: 1000 });
  ok(d.run === false && d.reason === 'throttled', '刚存过 → 跳过（0ms）');
  d = exitSaveTick({ ...base, lastSaveOk: 1000, now: 1000 + 14999 });
  ok(d.run === false, '差 1ms 到窗口 → 仍跳过');
  d = exitSaveTick({ ...base, lastSaveOk: 1000, now: 1000 + 15000 });
  ok(d.run === true, '恰好满窗口 → 执行（>= 而非 >）');
  d = exitSaveTick({ ...base, lastSaveOk: 0, now: 1e9 });
  ok(d.run === true, '从未存过（lastSaveOk=0）→ 执行');
  // 相邻触发：beforeunload 与 pagehide 之间第二次必须被节流
  const afterFirst = { lastSaveOk: 5000, now: 5000 + 10 };
  ok(exitSaveTick({ ...base, ...afterFirst }).run === false,
     'beforeunload 与 pagehide 相邻触发时第二次被节流（不重复全量序列化）');
  // 前置条件
  ok(exitSaveTick({ ...base, lastSaveOk:0, now:1e9, started:false }).reason === 'not-started', '未开始 → 不存');
  ok(exitSaveTick({ ...base, lastSaveOk:0, now:1e9, over:true }).reason === 'game-over', '通关后 → 不存');
  ok(exitSaveTick({ ...base, lastSaveOk:0, now:1e9, hasUser:false }).reason === 'no-user', '无用户 → 不存');
}

console.log('');
console.log('=== 5) bgSaveTick：前置条件与忙判据 ===');
{
  const base = { started:true, over:false, hasUser:true };
  ok(bgSaveTick({ ...base, busy:false }).run === true, '空闲 → 发起后台写');
  ok(bgSaveTick({ ...base, busy:true }).reason === 'busy', '忙 → 跳过');
  ok(bgSaveTick({ ...base, busy:false, started:false }).reason === 'not-started', '未开始 → 跳过');
  ok(bgSaveTick({ ...base, busy:false, over:true }).reason === 'game-over', '通关后 → 跳过');
  ok(bgSaveTick({ ...base, busy:false, hasUser:false }).reason === 'no-user', '无用户 → 跳过');
}

console.log('');
console.log('=== 6) 静态门禁：main.js 的离场监听必须仍被注册 ===');
{
  // 抽函数时极易漏掉重新注册监听器 —— 本轮就发生过（beforeunload 注册数由 1 变 0，
  // 会直接导致桌面端关页/刷新丢档）。这一类缺陷静态检查最有效。
  const __dir = path.dirname(fileURLToPath(import.meta.url));
  const mainSrc = fs.readFileSync(path.join(__dir, '..', 'js', 'main.js'), 'utf8');
  const count = (ev)=> mainSrc.split("addEventListener('" + ev + "'").length - 1;
  ok(count('beforeunload') === 1, `beforeunload 注册 1 处（实测 ${count('beforeunload')}）`);
  ok(count('pagehide') === 1, `pagehide 注册 1 处（实测 ${count('pagehide')}）`);
  ok(count('visibilitychange') === 1, `visibilitychange 注册 1 处（实测 ${count('visibilitychange')}）`);
  // 三者都必须真的把「保存」写进去（而不是注册了个空壳）
  const exitCalls = mainSrc.split("saveOnExit('").length - 1;
  ok(exitCalls === 2, `beforeunload 与 pagehide 都调用 saveOnExit（实测 ${exitCalls} 处调用）`);
  ok(mainSrc.includes('from \'./savepolicy.js\''), 'main.js 已引入 savepolicy 模块');
  ok(!/Date\.now\(\) - _lastSaveOk < EXIT_SAVE_MIN_MS/.test(mainSrc),
     '节流比较已收口到 savepolicy（main.js 内不再有写死的比较）');
}

console.log('');
console.log(`存档策略测试 ${fail === 0 ? 'PASS' : 'FAIL'}  （${pass} 通过 / ${fail} 失败）`);
if(fail) process.exit(1);
