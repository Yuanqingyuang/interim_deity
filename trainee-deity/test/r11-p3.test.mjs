// R11：formulas 断言 + 存档导入导出
import { T, NUM, buildingLow, buildingHigh, popCap, foodPerSec, foodNeed, faithPerSec, industryPerSec, buildSpeed, renderVillagers } from '../js/formulas.js';
import { createState, serializeState, deserializeState } from '../js/state.js';
import { writeSave, readSave, exportSaveJson, importSaveJson, deleteSave } from '../js/saves.js';

function assert(cond, msg){
  if(!cond) throw new Error('FAIL: ' + msg);
  console.log('  ok -', msg);
}

// formulas
assert(T[0]===200 && T[4]===5e9, 'T array');
assert(buildingLow(0, 1) === Math.ceil(200*0.25), 'house low E1');
assert(buildingHigh(0, 1) === Math.ceil(200*0.25*1.25), 'house high E1');
assert(popCap(0, 10, 0, 0) === 40, 'popCap housing E1');
assert(popCap(2, 0, 10, 0) === 50, 'popCap food E3');
assert(popCap(4, 0, 0, 100) === Math.floor(100*1/0.12), 'popCap industry E5');
assert(foodPerSec(10)===50 && foodNeed(20)===20, 'food');
assert(Math.abs(faithPerSec(5, 20) - (5*2 + 20*0.1)) < 1e-9, 'faith');
assert(industryPerSec(8)===8, 'industry');
const v = buildSpeed(0, 30, 50);
assert(v > 0 && v <= NUM.V0*2, `buildSpeed ${v}`);
assert(renderVillagers(20, 0) >= NUM.RENDER_MIN[0], 'render min');
assert(renderVillagers(5e9, 4) <= NUM.RENDER_MAX[4], 'render max');

// import/export
const store = new Map();
globalThis.localStorage = {
  getItem(k){ return store.has(k) ? store.get(k) : null; },
  setItem(k,v){ store.set(k, String(v)); },
  removeItem(k){ store.delete(k); },
};
const G = createState(77);
G.pop = 88;
const meta = writeSave('u', 'quick', ()=>serializeState(G), {});
assert(meta, 'write for export');
const json = exportSaveJson('u', 'quick');
assert(json && json.includes('"v":3'), 'export json');
assert(importSaveJson('u', 'slot1', json), 'import to slot1');
const b = readSave('u', 'slot1');
assert(b && b.pop === 88 || Math.abs(b.pop-88)<0.1, `import pop ${b?.pop}`);
assert(importSaveJson('u', 'slot2', 'not-json') === false, 'reject bad json');
deleteSave('u', 'quick');

console.log('R11 formulas/export tests PASS');
