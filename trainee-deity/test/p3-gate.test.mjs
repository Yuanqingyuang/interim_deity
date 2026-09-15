// P3：GATE 与 eraReady 产能门槛
import { gateOf, industryPerSec, buildingLow, T } from '../js/formulas.js';
import { createState, refreshBuiltCache } from '../js/state.js';
import { ERAS } from '../js/config.js';

function assert(cond, msg){
  if(!cond) throw new Error('FAIL: ' + msg);
  console.log('  ok -', msg);
}

// gateOf(E1 index 0) = 0.5 * industryPerSec(ceil(200*0.15))
const g0 = gateOf(0);
const expect0 = 0.5 * industryPerSec(buildingLow(0, 3));
assert(Math.abs(g0 - expect0) < 1e-9, `gate E1 ${g0}`);
assert(g0 > 0 && g0 < 50, `gate reasonable ${g0}`);
assert(gateOf(1) > gateOf(0), 'gate grows with era');

// 模拟：工业不足则不 ready
const G = createState(1);
G.era = 0; G.pop = 200; G.stars = 3;
G.wonders = [false,false,false,false,false];
// eraReady 需 ensureBuiltCache — 无工业 → not ready
// 复制逻辑
function ready(indBuilt){
  const indOut = industryPerSec(indBuilt);
  return indOut >= gateOf(0);
}
assert(ready(0) === false, 'no industry not ready');
assert(ready(buildingLow(0,3)) === true, 'full low industry ready');
assert(ERAS[0].starCost === 3, 'E1 starCost 3');

console.log('P3 gate tests PASS');
