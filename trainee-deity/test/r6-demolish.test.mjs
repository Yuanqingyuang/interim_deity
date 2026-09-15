// R6：拆除
import { createState, getTile } from '../js/state.js';
import { genWorld, placeAt, applyTool } from '../js/terrain.js';
import { eachTile } from '../js/state.js';

function assert(cond, msg){
  if(!cond) throw new Error('FAIL: ' + msg);
  console.log('  ok -', msg);
}

const G = createState(3);
genWorld(G);
let site = null;
eachTile(G, (t,x,y)=>{ if(!site && !t.water && t.h>1.2 && t.h<4.5) site=[x,y]; });
const r = placeAt(G, site[0], site[1], 1, 'manual');
assert(r, 'place house');
G.tool = 'demolish';
G.power = 100;
const h0 = getTile(G, site[0], site[1]).h;
applyTool(G, site[0], site[1], 0.05);
const t = getTile(G, site[0], site[1]);
assert(t.zone === 0, 'demolished zone cleared');
assert(Math.abs(t.h - h0) < 1e-6, 'terrain height kept');
// 再放成功（腾出格子）
const r2 = placeAt(G, site[0], site[1], 2, 'manual');
assert(r2, 'can rebuild after demolish');
console.log('R6 demolish tests PASS');
