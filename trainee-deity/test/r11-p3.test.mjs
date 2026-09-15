// R11：formulas 断言 + 存档导入导出
import { T, NUM, buildingLow, buildingHigh, popCap, foodPerSec, foodNeed, faithPerSec, industryPerSec, buildSpeed, renderVillagers } from '../js/formulas.js';
import { createState, serializeState, deserializeState } from '../js/state.js';
import { ERAS, WONDERS, FAITH_ERA_BASE, FAITH_ERA_DAMP, FAITH_FILL_SEC, faithCostOf, FAITH_CAP_MULT, faithCapOf } from '../js/config.js';
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
assert(Math.abs(faithPerSec(5, 20, 0) - (5*2 + 20*0.1) * FAITH_ERA_DAMP[0]) < 1e-9, 'faith 按时代阻尼');
// 信仰关键不变量：每个时代「满规模攒满本时代奇迹」耗时一致 = FAITH_FILL_SEC
// （人口每时代涨 10~1000 倍，若不阻尼则后期信仰会秒出、经济失效）
for(let E=0; E<5; E++){
  const N = ERAS[E].popGoal;
  const churches = buildingLow(E, 4);
  const rate = faithPerSec(churches, N, E);
  const sec = WONDERS[E].faithCost / rate;
  assert(Math.abs(rate - FAITH_ERA_BASE[E]) < 1e-6, `E${E+1} 满规模信仰/秒 = ${FAITH_ERA_BASE[E]}`);
  assert(Math.abs(sec - FAITH_FILL_SEC) < 1e-6, `E${E+1} 攒满奇迹 ${sec.toFixed(1)}s ≈ ${FAITH_FILL_SEC}s`);
}
// 信仰库存上限回归：信仰只有奇迹一个出口，无上限会跨时代无限囤积
// （实测：城邦时代囤到 2300 万，而奇迹只要 1.5 万 → 奇迹瞬间建成、信仰经济失效）
assert(FAITH_CAP_MULT >= 1, 'FAITH_CAP_MULT ≥ 1（攒满上限耗时 ≥ FAITH_FILL_SEC）');
for(let E=0; E<5; E++){
  const cap = faithCapOf(E);
  assert(Math.abs(cap - faithCostOf(E)*FAITH_CAP_MULT) < 1e-9, `E${E+1} 上限 = 奇迹消耗×${FAITH_CAP_MULT}`);
  assert(cap >= WONDERS[E].faithCost, `E${E+1} 上限 ${cap} ≥ 奇迹消耗 ${WONDERS[E].faithCost}`);
}
assert(faithCapOf(9) === faithCapOf(4) && faithCapOf(-3) === faithCapOf(0), 'faithCapOf 越界夹取到 0..4');
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

// 读档时信仰按当前时代上限收敛（兼容旧的无上限存档）
const GF = createState(3);
GF.era = 1; GF.faith = 1e9;
const GF2 = createState(0);
assert(deserializeState(GF2, serializeState(GF)) === true, 'deserialize for faith clamp');
assert(GF2.faith <= faithCapOf(1) + 1e-6,
  `读档信仰截断到上限 ${faithCapOf(1)}（实际 ${GF2.faith}）`);

console.log('R11 formulas/export tests PASS');
