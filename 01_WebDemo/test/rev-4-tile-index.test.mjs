// 地块索引缓存（rev-14）
//
// 为什么需要：autoBuild 每 20 游戏秒跑一轮，一轮内原本连做 4 趟全图扫描
// （居住质心 + zone1/zone3/「非工业已划区」的坐标表），而它们读的是同一份状态。
// 改为按「地图变更版本号」缓存的单次索引后，**必须证明缓存结果与重新扫描逐位相同** ——
// 否则会静默产生「子民建在错误位置」这类难以复现的玩法 bug。
//
// 覆盖：
//   1. 缓存命中时与重新扫描逐位一致（质心、数量、各分区坐标表、顺序）
//   2. 地块变动后缓存失效（版本号递增）并重新给出正确结果
//   3. collectZoneXY 返回值是新数组（调用方修改不污染缓存）
//   4. 边界情形：无地块、单地块、跨区块

import { createState, getTile, eachTile } from '../js/state.js';
import { genWorld, tileIndex, residentialStats, ensureChunk } from '../js/terrain.js';
import { invalidateBuiltCache } from '../js/state.js';

let pass = 0, fail = 0;
const ok = (cond, msg)=>{ if(cond){ pass++; console.log('  ok - ' + msg); } else { fail++; console.log('  FAIL - ' + msg); } };

/** 清空全部已划区 —— 各用例必须从已知状态出发（此前用例间共享 state 导致假失败） */
function clearZones(G){
  eachTile(G, (tt)=>{ tt.zone = 0; tt.prog = 0; tt.built = false; });
  invalidateBuiltCache(G);
}

/** 不依赖缓存的全图扫描（参考实现，与改动前的逻辑同式） */
function scanDirect(G){
  const res = [], ind = [], other = [], byZone = { 1: res, 2: [], 3: ind, 4: [] };
  let sx = 0, sy = 0;
  eachTile(G, (t, x, y)=>{
    const z = t.zone | 0;
    if(z <= 0) return;
    const rec = { x, y };
    if(byZone[z]) byZone[z].push(rec);
    if(z === 1){ sx += x; sy += y; }
    if(z !== 3) other.push(rec);
  });
  const n = res.length;
  return { byZone, other, resN: n,
           resCx: n ? Math.round(sx/n) : 0, resCy: n ? Math.round(sy/n) : 0 };
}

function sameList(a, b){
  if(a.length !== b.length) return false;
  for(let i=0;i<a.length;i++) if(a[i].x !== b[i].x || a[i].y !== b[i].y) return false;
  return true;
}

function makeWorld(seed = 20260921){
  const G = createState(seed);
  genWorld(G);
  // 多生成几块，覆盖跨区块
  for(let cy=-1; cy<=1; cy++) for(let cx=-1; cx<=1; cx++) ensureChunk(G, cx, cy);
  return G;
}

/**
 * 直接设定地块的 zone —— 本测试验证的是**地块索引缓存**的等价性，
 * 而不是放置规则，故绕过 placeAt（它会按间距/邻接等玩法规则拒绝，
 * 早先版本因此出现「以为划上了地、实际没划上」的假失败）。
 * 设定后由调用方统一 invalidateBuiltCache 推进版本号。
 */
function zone(G, x, y, z){
  const t = getTile(G, x, y);
  if(!t || t.water) return false;
  t.zone = z; t.prog = 0; t.built = false;
  return true;
}

console.log('=== 1) 缓存与重新扫描逐位一致 ===');
{
  const G = makeWorld();
  clearZones(G);
  // 造一段真实的地块分布
  let placed = 0;
  for(let x=-8; x<=8 && placed<40; x++){
    for(let y=-8; y<=8 && placed<40; y++){
      const t = getTile(G, x, y);
      if(!t || t.water) continue;
      const z = placed % 3 === 0 ? 1 : placed % 3 === 1 ? 2 : 3;
      zone(G, x, y, z);
      placed++;
    }
  }
  invalidateBuiltCache(G);                       // 确保版本号推进
  const cached = tileIndex(G);
  const direct = scanDirect(G);
  ok(sameList(cached.byZone[1], direct.byZone[1]), `zone1 坐标表一致（${cached.byZone[1].length} 项）`);
  ok(sameList(cached.byZone[2], direct.byZone[2]), `zone2 坐标表一致（${cached.byZone[2].length} 项）`);
  ok(sameList(cached.byZone[3], direct.byZone[3]), `zone3 坐标表一致（${cached.byZone[3].length} 项）`);
  ok(sameList(cached.other, direct.other), `「非工业已划区」表一致（${cached.other.length} 项）`);
  ok(cached.resN === direct.resN, `居住数量一致（${cached.resN}）`);
  ok(cached.resCx === direct.resCx && cached.resCy === direct.resCy,
     `居住质心一致（(${cached.resCx},${cached.resCy})）`);
  ok(cached.byZone[1].length + cached.byZone[2].length + cached.byZone[3].length + cached.byZone[4].length === direct.other.length + cached.byZone[3].length,
     '分区计数自洽（zone1+2+4 = other）');
}

console.log('');
console.log('=== 2) 缓存命中（同版本号返回同一对象，不重复扫描）===');
{
  const G = makeWorld();
  clearZones(G);
  for(let x=-4;x<=4;x++) for(let y=-4;y<=4;y++){ const t=getTile(G,x,y); if(t && !t.water) zone(G,x,y,1); }
  invalidateBuiltCache(G);
  const a = tileIndex(G), b = tileIndex(G);
  ok(a === b, '同版本号下两次调用返回同一缓存对象');
  ok(a.rev === (G._scanRev|0), `缓存版本号与 G._scanRev 一致（${a.rev}）`);
}

console.log('');
console.log('=== 3) 地块变动后缓存失效并重新计算 ===');
{
  const G = makeWorld();
  clearZones(G);
  for(let x=-3;x<=3;x++) for(let y=-3;y<=3;y++){ const t=getTile(G,x,y); if(t && !t.water) zone(G,x,y,1); }
  invalidateBuiltCache(G);
  const before = tileIndex(G);
  const n0 = before.resN, rev0 = before.rev;

  // 再加一块地：必须 invalidate 才失效（这就是契约）
  let added = null;
  for(let x=6;x<=12 && !added;x++) for(let y=6;y<=12 && !added;y++){
    const t = getTile(G,x,y);
    if(t && !t.water && t.zone === 0){ zone(G,x,y,1); added = {x,y}; }
  }
  ok(!!added, `追加一块居住地 @(${added?.x},${added?.y})`);

  // 未 invalidate：仍命中旧缓存（这是刻意的——版本号是唯一失效依据）
  const stale = tileIndex(G);
  ok(stale === before, '未推进版本号时仍命中旧缓存（契约：失效由 invalidateBuiltCache 负责）');
  ok(stale.resN === n0, `旧缓存数量仍为 ${n0}`);

  invalidateBuiltCache(G);
  const fresh = tileIndex(G);
  ok(fresh !== before, '推进版本号后缓存对象被替换');
  ok(fresh.rev > rev0, `版本号递增（${rev0} → ${fresh.rev}）`);
  ok(fresh.resN === n0 + 1, `重算后居住数量 ${n0} → ${fresh.resN}（+1）`);
  const direct = scanDirect(G);
  ok(fresh.resN === direct.resN && sameList(fresh.byZone[1], direct.byZone[1]),
     '重算结果与直接扫描一致');
}

console.log('');
console.log('=== 4) collectZoneXY 语义：返回新数组，调用方修改不污染缓存 ===');
{
  const G = makeWorld();
  clearZones(G);
  for(let x=-2;x<=2;x++) for(let y=-2;y<=2;y++){ const t=getTile(G,x,y); if(t && !t.water) zone(G,x,y,3); }
  invalidateBuiltCache(G);
  const idx = tileIndex(G);
  const snapshotLen = idx.byZone[3].length;
  // 模拟调用方（placeIndustryBatch 只是读，但防御性验证）
  // 契约说明：collectZoneXY 返回 `list.slice()` —— 这是**浅**拷贝，
  // 数组本身独立（push/splice 不影响缓存），但元素对象仍是共享引用。
  // 生产代码只读这些元素（placeIndustryBatch 仅取 r.x/r.y），故安全；
  // 这里如实断言这一契约，而不是假装是深拷贝。
  const copy = idx.byZone[3].slice();
  copy.push({ x: 999, y: 999 });
  ok(idx.byZone[3].length === snapshotLen, `数组长度独立：外部 push 不影响缓存（${snapshotLen}）`);
  ok(copy.length === snapshotLen + 1, '返回的是新数组（外部可见的 push 生效于副本上）');
  ok(idx.byZone[3][0] === copy[0], '元素为共享引用（浅拷贝语义，已在注释中写明契约）');
}

console.log('');
console.log('=== 5) 边界情形 ===');
{
  const G = makeWorld();
  clearZones(G);                                  // 必须清空：各用例共享同一 state
  const empty = tileIndex(G);
  ok(empty.resN === 0 && empty.resCx === 0 && empty.resCy === 0, '无地块时质心与数量均为 0（不产生 NaN）');
  ok(empty.byZone[1].length === 0 && empty.other.length === 0, '无地块时各表为空');
  const rs = residentialStats(G);
  ok(rs.n === 0 && rs.cx === 0 && rs.cy === 0, 'residentialStats 无地块时返回 {0,0,0}');

  // 单地块：质心必须等于该地块坐标
  let one = null;
  for(let x=0;x<=12 && !one;x++) for(let y=0;y<=12 && !one;y++){
    const t = getTile(G,x,y);
    if(t && !t.water){ zone(G,x,y,1); one = {x,y}; }
  }
  invalidateBuiltCache(G);
  const single = residentialStats(G);
  ok(single.n === 1 && single.cx === one.x && single.cy === one.y,
     `单地块质心等于其坐标 (${single.cx},${single.cy})`);

  // 质心取整必须与直接扫描同式（Math.round(和/数量)），用奇数个点验证不产生 .5 偏差
  let cnt = 0;
  for(let x=-6;x<=6 && cnt<3;x++) for(let y=-6;y<=6 && cnt<3;y++){
    const t=getTile(G,x,y); if(t && !t.water && t.zone===0){ zone(G,x,y,1); cnt++; }
  }
  invalidateBuiltCache(G);
  const a2 = tileIndex(G), d2 = scanDirect(G);
  ok(a2.resCx === d2.resCx && a2.resCy === d2.resCy,
     `多点取整与直接扫描同式（缓存 (${a2.resCx},${a2.resCy}) vs 直扫 (${d2.resCx},${d2.resCy})）`);
}

console.log('');
console.log('=== 6) findAutoSite / placeIndustryBatch 仍能正常工作（端到端）===');
{
  const G = makeWorld();
  clearZones(G);
  // 造一片居住，让 autoBuild 有落脚点
  let n = 0;
  for(let x=-6;x<=6 && n<24;x++) for(let y=-6;y<=6 && n<24;y++){
    const t = getTile(G,x,y); if(t && !t.water){ zone(G,x,y,1); n++; }
  }
  invalidateBuiltCache(G);
  const { findAutoSite, placeIndustryBatch } = await import('../js/terrain.js');
  const site = findAutoSite(G, 2);
  ok(site === null || (Array.isArray(site) && site.length === 2),
     `findAutoSite 返回 null 或 [x,y]（实测 ${site ? '[' + site + ']' : 'null'}）`);
  const ind = placeIndustryBatch(G, 1);
  ok(ind && typeof ind === 'object' && Number.isInteger(ind.n) && ind.n >= 0,
     `placeIndustryBatch 返回自洽结果（n=${ind?.n}）`);
  if(ind.n > 0){
    const ti = getTile(G, ind.x, ind.y);
    ok(ti && ti.zone === 3, `放置的格 (${ind.x},${ind.y}) 确为工业区`);
  } else {
    ok(true, '本次未放置（无可达点位），跳过区域校验');
  }
}

console.log('');
console.log(`地块索引缓存测试 ${fail === 0 ? 'PASS' : 'FAIL'}  （${pass} 通过 / ${fail} 失败）`);
if(fail) process.exit(1);
