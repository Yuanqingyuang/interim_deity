// R5：里程碑出星 + 五时代不强制 over
import { createState, getTile } from '../js/state.js';
import { MILESTONES, ERAS } from '../js/config.js';

function assert(cond, msg){
  if(!cond) throw new Error('FAIL: ' + msg);
  console.log('  ok -', msg);
}

assert(MILESTONES.length === 5, '5 eras milestones');
for(let e=0;e<5;e++) assert(MILESTONES[e].length === 3, `era${e} has 3 ms`);

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

// eraReady 规则
function eraReady(G){
  if(G.era >= 4) return false;
  const needWonder = G.era >= 1;
  const wonderOk = !needWonder || !!G.wonders[G.era];
  return G.pop >= ERAS[G.era].popGoal && wonderOk && G.stars >= ERAS[G.era].starCost;
}
G.era = 0; G.pop = 200; G.stars = 3; G.wonders = [false,false,false,false,false];
assert(eraReady(G), 'E1 ready without wonder');
G.era = 1; G.pop = 2000; G.stars = 3;
assert(!eraReady(G), 'E2 blocked without wonder');
G.wonders[1] = true;
assert(eraReady(G), 'E2 ready with wonder');
G.era = 4; G.pop = 5e9; G.stars = 99;
assert(!eraReady(G), 'cannot leave E5');

// serialize roundtrip
import { serializeState, deserializeState } from '../js/state.js';
const body = serializeState(G);
assert(Array.isArray(body.starMilestones) && body.starMilestones[0][0]===1, 'milestones serialized');
const G2 = createState(0);
deserializeState(G2, body);
assert(G2.starMilestones[0][0] === true && G2.starMilestones[0].length===3, 'milestones restored');

console.log('R5 stars/era tests PASS');
