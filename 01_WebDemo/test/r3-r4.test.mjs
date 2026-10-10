// R3+R4 自测：autoRng 可复现；地形强度约 50%
import { mulberry32, autoRng, TOOLS } from '../js/config.js';
import { createState, getTile, eachTile } from '../js/state.js';
import { genWorld, applyTool, placeAt, placeIndustryBatch } from '../js/terrain.js';

function assert(cond, msg){
  if(!cond) throw new Error('FAIL: ' + msg);
  console.log('  ok -', msg);
}

// mulberry32 同种子同序列
const a = mulberry32(42), b = mulberry32(42);
const seqA = [a(), a(), a()];
const seqB = [b(), b(), b()];
assert(seqA.every((v,i)=>v===seqB[i]), 'mulberry32 deterministic');
const c = mulberry32(43);
assert(c() !== seqA[0], 'different seed differs');

// TOOLS strength
assert(TOOLS.raise.strength === 0.9, 'raise strength 0.9');
assert(TOOLS.lower.strength === 0.9, 'lower strength 0.9');
assert(TOOLS.raise.strength < 3.4*0.4, 'raise slower than 40% of original');

// 地形 1s 抬升（dt=0.016 * 60 帧 ≈ 1s，f≈1 中心）
const G1 = createState(7); genWorld(G1);
const G2 = createState(7); genWorld(G2);
let flat = null;
eachTile(G1, (t,x,y)=>{ if(!flat && !t.water && t.h>1.2 && t.h<4) flat = [x,y]; });
const h0 = getTile(G1, flat[0], flat[1]).h;
G1.tool = 'raise'; G1.power = 1000;
for(let i=0;i<60;i++) applyTool(G1, flat[0], flat[1], 0.016);
const h1 = getTile(G1, flat[0], flat[1]).h;
const delta = h1 - h0;
// 原强度 3.4*1s ≈ 3.4（边缘衰减后更少）；新应 ≤ 原 60%
assert(delta < 1.2, `raise 1s delta ${delta.toFixed(2)} < 1.2`);
assert(delta > 0.08, `still raisable ${delta.toFixed(2)}`);

// autoRng 同 G 同 salt 同序列
const GA = createState(100); GA.time = 12;
const GB = createState(100); GB.time = 12;
const r1 = autoRng(GA, 3), r2 = autoRng(GB, 3);
assert(r1() === r2() && r1() === r2(), 'autoRng same state+salt');

// 工业两次同状态同结果（在无写入前）
const G = createState(55); genWorld(G);
for(let i=0;i<6;i++) placeAt(G, 2+i, 2, 1, 'manual');
G.time = 5;
const i1 = placeIndustryBatch(G, 2);
const Gb = createState(55); genWorld(Gb);
for(let i=0;i<6;i++) placeAt(Gb, 2+i, 2, 1, 'manual');
Gb.time = 5;
const i2 = placeIndustryBatch(Gb, 2);
assert(i1.n === i2.n && i1.x === i2.x && i1.y === i2.y, `industry repro n=${i1.n} @${i1.x},${i1.y}`);

console.log('R3+R4 tests PASS');
