// R5：里程碑出星 + 五时代不强制 over
import { createState, getTile, eachTile, housingCap } from '../js/state.js';
import { genWorld, findAutoSite, placeDistrict, placeIndustryBatch } from '../js/terrain.js';
import { MILESTONES, ERAS } from '../js/config.js';
import { buildingLow, industryPerSec, gateOf } from '../js/formulas.js';

function assert(cond, msg){
  if(!cond) throw new Error('FAIL: ' + msg);
  console.log('  ok -', msg);
}

assert(MILESTONES.length === 5, '5 eras milestones');
for(let e=0;e<5;e++) assert(MILESTONES[e].length === 3, `era${e} has 3 ms`);

// B1 回归：星星预算是「零冗余」的 —— starCost 必须恰好等于里程碑数。
// 一旦 starCost > 里程碑数，本时代最多只能拿满里程碑数颗星，时代链必然硬锁死。
for(let e=0;e<5;e++)
  assert(ERAS[e].starCost === MILESTONES[e].length,
    `E${e+1} starCost ${ERAS[e].starCost} == 里程碑数 ${MILESTONES[e].length}（零冗余）`);

// B2 回归：奇迹里程碑必须指向「本时代」奇迹 wonders[E]。
// startWonderPlacement 只允许建 WONDERS[G.era]，若里程碑指向上一时代奇迹 →
// 该星永久不可得（配合上面的零冗余 → 硬锁）。
for(let e=1;e<5;e++){
  const ms = MILESTONES[e][MILESTONES[e].length-1];
  const onlyMine = [false,false,false,false,false]; onlyMine[e] = true;
  assert(ms.check({ wonders: onlyMine }) === true,
    `E${e+1} 里程碑「${ms.label}」认本时代奇迹 wonders[${e}]`);
  const onlyPrev = [false,false,false,false,false]; onlyPrev[e-1] = true;
  assert(ms.check({ wonders: onlyPrev }) === false,
    `E${e+1} 里程碑不认上一时代奇迹 wonders[${e-1}]`);
}

const G = createState(1);
assert(Array.isArray(G.starMilestones) && G.starMilestones.length===5, 'starMilestones init');

// 模拟 check 逻辑（与 main 相同规则）
function runCheck(G, E, farms, inds, churches){
  const flags = G.starMilestones[E];
  const ctx = { farms, inds, churches, houses: 0 };
  let gained = 0;
  MILESTONES[E].forEach((m,i)=>{
    if(flags[i]) return;
    if(m.check(G, ctx)){ flags[i]=true; G.stars++; gained++; }
  });
  return gained;
}

G.pop = 50;
let g = runCheck(G, 0, 10, 0, 1);
assert(G.stars === 3 && g === 3, `E1 three milestones stars=${G.stars}`);
g = runCheck(G, 0, 10, 0, 1);
assert(G.stars === 3 && g === 0, 'no double star');

// eraReady 规则（与 main.js 同口径：人口 + 本时代奇迹 + 星星 + 工业门槛）
function eraReady(G){
  if(G.era >= 4) return false;
  const needWonder = G.era >= 1;
  const wonderOk = !needWonder || !!G.wonders[G.era];
  const gateOk = industryPerSec(G._ind||0) >= gateOf(G.era);
  return G.pop >= ERAS[G.era].popGoal && wonderOk && G.stars >= ERAS[G.era].starCost && gateOk;
}
assert(gateOf(0) === 0.5*industryPerSec(buildingLow(0,3)), 'gateOf(E) = 0.5×刚需产能');
G.era = 0; G.pop = 200; G.stars = 3; G.wonders = [false,false,false,false,false];
G._ind = buildingLow(0, 3);
assert(eraReady(G), 'E1 ready without wonder');
// 门槛回归：人口/星星都满足，但工业产能低于门槛时不得进阶
assert(!eraReady({ era:0, pop:200, stars:3, wonders:[false,false,false,false,false], _ind:0 }),
  'E1 blocked when industry below gate');
G.era = 1; G.pop = 2000; G.stars = 3; G._ind = buildingLow(1, 3);
assert(!eraReady(G), 'E2 blocked without wonder');
G.wonders[1] = true;
assert(eraReady(G), 'E2 ready with wonder');
G.era = 4; G.pop = 5e9; G.stars = 99;
assert(!eraReady(G), 'cannot leave E5');

// B1/B3 回归：工业容量必须随城镇扩张而增长，否则时代仍会硬锁。
// placeIndustryBatch 原先只在居住质心周围固定环带 [R_ind, R_ind+D_max] 采样；
// 农田允许「田-田」相邻、又按 nearRes 加成贴着居住区铺开，会把这圈很快糊满，
// 工业又硬性要求 8 邻域全空 → 采样点被全部否决、工业永久停止建造。
// 实测：种子 11 永久停在 9/s、种子 338748320 停在 12/s，而 E1 门槛 = 15/s，
// 于是人口/星星全满也永远进不了下一时代（与 B1 零冗余叠加 → 硬锁）。
for(const seed of [11, 338748320]){
  const T0 = createState(seed); genWorld(T0);
  T0.pop = 20;
  for(let round=0; round<60; round++){
    T0.pop = Math.max(T0.pop, Math.min(housingCap(T0), 200));
    for(let k=0;k<2;k++){ const h = findAutoSite(T0,1); if(h) placeDistrict(T0,h[0],h[1],1,1); }
    for(let k=0;k<2;k++){ const f = findAutoSite(T0,2); if(f) placeDistrict(T0,f[0],f[1],2,1); }
    T0.time += 0.5;
    if(T0.pop >= 15) placeIndustryBatch(T0, 2);
  }
  let inds = 0;
  eachTile(T0, (t)=>{ if(t.zone===3) inds++; });
  assert(industryPerSec(inds) >= gateOf(0),
    `种子 ${seed}：城镇扩张后工业 ${inds} 格 ${industryPerSec(inds)}/s ≥ 门槛 ${gateOf(0)}/s`);
}

// serialize roundtrip
import { serializeState, deserializeState } from '../js/state.js';
const body = serializeState(G);
assert(Array.isArray(body.starMilestones) && body.starMilestones[0][0]===1, 'milestones serialized');
const G2 = createState(0);
deserializeState(G2, body);
assert(G2.starMilestones[0][0] === true && G2.starMilestones[0].length===3, 'milestones restored');

// 存档紧凑化回归：未开发地块只写一个高度数字（原先一律写 7 元组 → 111 区块 230KB+）
const P = createState(9);
const plainChunks = serializeState(P).chunks;
assert(plainChunks.flatMap(c=>c.tiles.flat()).every(v=>typeof v === 'number'),
  '整图未开发时全部编码为单个数字（体积最小）');
const t0 = getTile(P, 0, 0);
t0.zone = 2; t0.built = true; t0.prog = 0.5; t0.water = 1;
const enc00 = (S)=> serializeState(S).chunks.find(c=>c.cx===0 && c.cy===0).tiles[0][0];
const dev = enc00(P);
assert(Array.isArray(dev) && dev.length === 7, '开发过的地块编码为 7 元组');
const P2 = createState(0);
deserializeState(P2, serializeState(P));
const t1 = getTile(P2, 0, 0);
assert(t1.zone === 2 && t1.built === true && t1.water === 1 && Math.abs(t1.prog - 0.5) < 1e-9,
  '紧凑/完整两种编码都能还原');
assert(typeof getTile(P2, 5, 5).h === 'number', '未开发地块高度可还原');

console.log('R5 stars/era tests PASS');
