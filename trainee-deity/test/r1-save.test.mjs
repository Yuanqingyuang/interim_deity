// R1 自测：serialize 压缩 + writeSave 计时 + 连续 10 次存读
// 运行：node trainee-deity/test/r1-save.test.mjs
const performance = { now: () => Date.now() };

// --- localStorage mock ---
const store = new Map();
const localStorage = {
  getItem(k){ return store.has(k) ? store.get(k) : null; },
  setItem(k,v){ store.set(k, String(v)); },
  removeItem(k){ store.delete(k); },
  key(i){ return [...store.keys()][i] ?? null; },
  get length(){ return store.size; },
};
globalThis.localStorage = localStorage;
globalThis.performance = performance;

const { serializeState, deserializeState, createState, SAVE_LOG_CAP } = await import('../js/state.js');
const { writeSave, readSave } = await import('../js/saves.js');
const { logPush, logInit } = await import('../js/log.js');

function assert(cond, msg){
  if(!cond) throw new Error('FAIL: ' + msg);
  console.log('  ok -', msg);
}

const G = createState(12345);
// 模拟一些进度
G.pop = 150;
G.faith = 88.5;
G.power = 120;
G.stars = 2;
for(let i=0;i<800;i++) logPush(G, 1, i % 40, (i * 7) % 40);
G.logs = G.logs; // already filled

const body = serializeState(G);
assert(body.v === 3, 'v3');
assert(body.logs.length <= SAVE_LOG_CAP, `logs capped ${body.logs.length}<=${SAVE_LOG_CAP}`);
assert(Array.isArray(body.chunks) && body.chunks.length > 0, 'chunks present');

const t0 = Date.now();
const meta = writeSave('tester', 'quick', () => serializeState(G), {});
const writeMs = Date.now() - t0;
assert(meta, 'writeSave returns meta');
assert(meta._stats, 'has _stats');
console.log('  stats', meta._stats);
assert(writeMs < 2000, `write fast enough ${writeMs}ms`);

// 连续 10 次存读
for(let i=0;i<10;i++){
  const m = writeSave('tester', 'quick', () => serializeState(G), {});
  assert(m, `save #${i+1}`);
  const b = readSave('tester', 'quick');
  assert(b, `load #${i+1}`);
  const G2 = createState(0);
  assert(deserializeState(G2, b), `deserialize #${i+1}`);
  assert(Math.abs(G2.pop - 150) < 0.11, `pop roundtrip #${i+1} got ${G2.pop}`);
  assert(G2.chunks.size === G.chunks.size, `chunk count #${i+1}`);
}

// 失败路径：setItem 抛错
const orig = localStorage.setItem;
localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
const fail = writeSave('tester', 'slot1', () => serializeState(G), {});
assert(fail === null, 'quota failure returns null');
localStorage.setItem = orig;

console.log('R1 save tests PASS');
