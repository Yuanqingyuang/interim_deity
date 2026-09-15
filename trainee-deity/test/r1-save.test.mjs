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

const { serializeState, serializeStateAsync, deserializeState, createState, SAVE_LOG_CAP } = await import('../js/state.js');
const { writeSave, writeSaveAsync, readSave } = await import('../js/saves.js');
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

// === #2 异步分块写档 ===
// 1) 正常路径：异步写档与同步路径同构，往返一致，且无需裁剪
const prog = [];
const metaA = await writeSaveAsync('tester', 'quick',
  (logCap, yieldFn, onProgress)=>serializeStateAsync(G, yieldFn, onProgress, logCap),
  {}, { onProgress: p=>prog.push(p.pct) });
assert(metaA, 'writeSaveAsync returns meta');
assert(metaA._stats.trimTry === 0, `async first try no trim got ${metaA._stats && metaA._stats.trimTry}`);
const bA = readSave('tester', 'quick');
assert(bA, 'async body readable');
const G3 = createState(0);
assert(deserializeState(G3, bA), 'async body deserializable');
assert(Math.abs(G3.pop - 150) < 0.11, `async pop roundtrip got ${G3.pop}`);
assert(G3.chunks.size === G.chunks.size, 'async chunk count matches');
assert(prog.length >= 2 && prog[prog.length-1] === 100, `progress reported ${prog.join('/')}`);

// 异步体必须与同步体同构（字段集/区块数/日志数一致），否则读档会错位
const bodyAsync = await serializeStateAsync(G);
const bodySync = serializeState(G);
assert(Object.keys(bodyAsync).length === Object.keys(bodySync).length, 'async/sync body same key count');
assert(bodyAsync.chunks.length === bodySync.chunks.length, 'async/sync same chunk count');
assert(bodyAsync.logs.length === bodySync.logs.length, 'async/sync same log count');

// 2) 降级重试：前两次 setItem 失败（配额），第 3 次成功 ⇒ trimTry>0 且日志被裁剪
let setCalls = 0;
const origSet = localStorage.setItem;
localStorage.setItem = function(k, v){
  setCalls++;
  if(setCalls <= 2) throw new Error('QuotaExceededError');
  return origSet.call(localStorage, k, v);
};
const metaTrim = await writeSaveAsync('tester', 'slot3',
  (logCap, yieldFn, onProgress)=>serializeStateAsync(G, yieldFn, onProgress, logCap), {});
localStorage.setItem = origSet;
assert(metaTrim, 'degrade retry eventually succeeds');
assert(metaTrim._stats.trimTry === 1, `trimTry=1 got ${metaTrim._stats && metaTrim._stats.trimTry}`);
assert(metaTrim._stats.logs <= 120, `logs trimmed <=120 got ${metaTrim._stats.logs}`);

// 3) 最新写入者获胜：异步写档进行中若出现更晚的同步写入，前者必须放弃提交
const pSuperseded = writeSaveAsync('tester', 'slot2',
  (logCap, yieldFn, onProgress)=>serializeStateAsync(G, yieldFn, onProgress, logCap), {});
const syncMeta = writeSave('tester', 'slot2', () => serializeState(G), {});
assert(syncMeta, 'interleaved sync write ok');
const superseded = await pSuperseded;
assert(superseded === null, 'superseded async write abandoned (returns null)');
assert(readSave('tester', 'slot2'), 'slot2 still holds sync-written body');

// 失败路径：setItem 抛错（commitSave 回收重试后仍失败 ⇒ null）
const orig = localStorage.setItem;
localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
const fail = writeSave('tester', 'slot1', () => serializeState(G), {});
assert(fail === null, 'quota failure returns null');
localStorage.setItem = orig;

console.log('R1 save tests PASS');
