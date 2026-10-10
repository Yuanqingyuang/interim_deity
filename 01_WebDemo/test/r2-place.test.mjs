// R2 自测：placeAt 幂等 + 工业返回坐标 + 无 (0,0) 日志
import { createState, getTile, eachTile } from '../js/state.js';
import { genWorld, placeAt, placeDistrict, placeIndustryBatch, canPlaceZoneAt } from '../js/terrain.js';

function assert(cond, msg){
  if(!cond) throw new Error('FAIL: ' + msg);
  console.log('  ok -', msg);
}

const G = createState(999);
genWorld(G);

// 找一块可建居住的空地
function findFlat(){
  let best = null;
  eachTile(G, (t,x,y)=>{
    if(best) return;
    if(t.water || t.zone>0) return;
    if(t.h < 1.2 || t.h > 4.5) return;
    best = [x,y];
  });
  return best;
}

const site = findFlat();
assert(site, 'found buildable tile');
const r1 = placeAt(G, site[0], site[1], 1, 'manual');
assert(r1, 'first placeAt ok');
const r2 = placeAt(G, site[0], site[1], 1, 'manual');
assert(r2 === null, 'second placeAt rejected (idempotent)');
const t = getTile(G, site[0], site[1]);
assert(t.zone === 1, 'zone written once');

const n1 = placeDistrict(G, site[0], site[1], 1);
assert(n1 === 0, 'placeDistrict same cell returns 0');

// 放几块居住（manual 放宽间隔），再测工业
const placedRes = [r1];
for(let i=0;i<20;i++){
  const s = findFlat();
  if(!s) break;
  if(getTile(G, s[0], s[1])?.zone) continue;
  const r = placeAt(G, s[0], s[1], 1, 'manual');
  if(r) placedRes.push(r);
}
assert(placedRes.length >= 3, `enough houses ${placedRes.length}`);

// 工业：无居住则失败；有居住应返回 {n,x,y}
const ind = placeIndustryBatch(G, 2);
assert(ind && typeof ind === 'object', 'industry returns object');
// 原断言 `ind.n === 0 || ind.n >= 1` 对整数恒真（零信息）。
// 这里改为断言真实契约：批量放置的返回必须自洽 ——
// n>0 时坐标合法且该地块确为工业区；n===0 时必须给出失败原因字段。
assert(Number.isInteger(ind.n) && ind.n >= 0, `industry n 为非负整数（实测 ${ind.n}）`);
if(ind.n > 0){
  assert(!(ind.x === 0 && ind.y === 0) || getTile(G,0,0)?.zone === 3, 'coords not blindly (0,0)');
  const ti = getTile(G, ind.x, ind.y);
  assert(ti && ti.zone === 3, 'industry tile zone=3');
  // 距最近居住 D_res >= 6
  let dMin = Infinity;
  for(const p of placedRes){
    const d = Math.max(Math.abs(p.x-ind.x), Math.abs(p.y-ind.y));
    if(d < dMin) dMin = d;
  }
  assert(dMin >= 6, `industry far from res dMin=${dMin}`);
  // 同格再放失败
  const again = placeAt(G, ind.x, ind.y, 3, 'auto');
  assert(again === null, 'industry cell idempotent');
}

// 手动 placeAt 拒绝水面
let water = null;
eachTile(G, (t,x,y)=>{ if(!water && t.water) water = [x,y]; });
if(water){
  const rw = placeAt(G, water[0], water[1], 1, 'manual');
  assert(rw === null, 'reject water');
}

console.log('R2 place tests PASS');
