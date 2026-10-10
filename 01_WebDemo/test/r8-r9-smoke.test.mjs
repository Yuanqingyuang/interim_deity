// R8/R9 冒烟：树木密度、工具配置
import { TOOLS } from '../js/config.js';
import { createState, eachTile } from '../js/state.js';
import { genWorld } from '../js/terrain.js';

function assert(cond, msg){
  if(!cond) throw new Error('FAIL: ' + msg);
  console.log('  ok -', msg);
}

assert(TOOLS.demolish, 'demolish tool exists');
assert(TOOLS.raise.strength === 0.9, 'raise strength');

const G = createState(11);
genWorld(G);
let trees = 0, land = 0;
eachTile(G, (t)=>{
  if(!t.water){ land++; if(t.tree) trees++; }
});
const density = trees / Math.max(1, land);
assert(density < 0.45, `tree density ${density.toFixed(3)} < 0.45`);
assert(land > 100, `has land ${land}`);

console.log('R8/R9 smoke PASS', { land, trees, density: +density.toFixed(3) });
