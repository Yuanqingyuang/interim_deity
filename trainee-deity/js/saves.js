// 实习神明 · 多槽存档 + 快速存读
// 格式：td/saves/<userKey>/<slot>  slot = slot1|slot2|slot3|quick

const PREFIX = 'td/saves/';
export const SLOTS = ['slot1', 'slot2', 'slot3', 'quick'];
export const SLOT_LABEL = {
  slot1: '存档 1', slot2: '存档 2', slot3: '存档 3', quick: '快速存档',
};

function slotKey(userKey, slot){ return `${PREFIX}${userKey}/${slot}`; }

export function listSaves(userKey){
  const out = {};
  for(const s of SLOTS){
    out[s] = readMeta(userKey, s);
  }
  return out;
}

export function readMeta(userKey, slot){
  try{
    const raw = localStorage.getItem(slotKey(userKey, slot));
    if(!raw) return null;
    const o = JSON.parse(raw);
    return o?.meta || null;
  }catch{ return null; }
}

// 旧版单键存档：本版本已不再写入，属于可安全回收的死数据（配额不足时优先清理）
const LEGACY_SINGLE_KEYS = ['trainee-deity-save-v3', 'trainee-deity-save-v2', 'trainee-deity-save-v1'];

/** #2 存档卡死：让出一轮事件循环，给渲染/输入留出执行机会 */
export function yieldToMain(){
  return new Promise(r=>setTimeout(r, 0));
}

/** 配额不足时的兜底：清掉旧版单键存档，返回回收的字节数 */
function reclaimSpace(){
  let freed = 0;
  for(const k of LEGACY_SINGLE_KEYS){
    try{
      const v = localStorage.getItem(k);
      if(v != null){ localStorage.removeItem(k); freed += v.length; }
    }catch{}
  }
  return freed;
}

// 同一槽位的写入序号：异步写档期间若出现更新的写入（如离场同步保存），
// 旧的那次必须放弃提交，否则会用更早的状态快照覆盖新档。
const _slotSeq = new Map();
function bumpSeq(key){
  const n = (_slotSeq.get(key) || 0) + 1;
  _slotSeq.set(key, n);
  return n;
}
function isLatestSeq(key, seq){ return (_slotSeq.get(key) || 0) === seq; }

/**
 * 提交 payload 到槽位。首次失败（多为 QuotaExceeded）时回收死数据后重试一次，
 * 仍失败则返回 ok:false，由调用方给出用户可见错误。
 */
function commitSave(userKey, slot, payload){
  const key = slotKey(userKey, slot);
  try{
    localStorage.setItem(key, payload);
    return { ok: true, retried: false, freed: 0 };
  }catch(e1){
    const freed = reclaimSpace();
    try{
      localStorage.setItem(key, payload);
      console.warn('[save] setItem 重试成功（已回收旧存档）', slot, { freedKb: Math.round(freed/1024) });
      return { ok: true, retried: true, freed };
    }catch(e2){
      console.error('[save] setItem failed', slot, { bytes: payload.length, err: e2, freedKb: Math.round(freed/1024) });
      return { ok: false, err: e2, retried: true, freed };
    }
  }
}

/**
 * 写档（同步 localStorage）。返回 meta（含 _stats）或 null。
 * 供 beforeunload / visibilitychange 等「必须当场写完」的离场路径使用；
 * 正常存/自动存档请用 writeSaveAsync（不阻塞主线程）。
 */
export function writeSave(userKey, slot, serializeFn, metaExtra){
  const t0 = performance.now();
  let body;
  try{
    body = serializeFn();
  }catch(e){
    console.error('[save] serialize failed', slot, e);
    return null;
  }
  const tSer = performance.now();
  const meta = {
    name: metaExtra?.name || SLOT_LABEL[slot],
    seed: body.seed|0,
    era: body.era|0,
    pop: Math.floor(body.pop||0),
    savedAt: Date.now(),
    v: body.v,
  };
  let payload;
  try{
    payload = JSON.stringify({ meta, body });
  }catch(e){
    console.error('[save] stringify failed', slot, e);
    return null;
  }
  const tStr = performance.now();
  bumpSeq(slotKey(userKey, slot));
  const res = commitSave(userKey, slot, payload);
  const tEnd = performance.now();
  if(!res.ok) return null;
  const stats = {
    chunks: body.chunks?.length || 0,
    logs: body.logs?.length || 0,
    bytes: payload.length,
    kb: Math.round(payload.length / 1024),
    serMs: +(tSer - t0).toFixed(1),
    strMs: +(tStr - tSer).toFixed(1),
    setMs: +(tEnd - tStr).toFixed(1),
    totalMs: +(tEnd - t0).toFixed(1),
    retried: res.retried,
    freedKb: Math.round((res.freed||0) / 1024),
  };
  console.info('[save]', slot, stats);
  return { ...meta, _stats: stats };
}

/** 分块序列化 + 让出主线程 + 进度提示 + 失败降级重试（#2 存档卡死主路径） */
export async function writeSaveAsync(userKey, slot, serializeFn, metaExtra, opts = {}){
  const onProgress = opts.onProgress || null;
  const yieldFn = opts.yieldFn || yieldToMain;
  // 第 1 次完整写；失败则依次裁剪日志体积重试（档越小越可能挤进配额）
  const logCaps = Array.isArray(opts.logCaps) ? opts.logCaps : [null, 120, 48];
  const t0 = performance.now();
  const key = slotKey(userKey, slot);
  const seq = bumpSeq(key);
  let lastErr = null;
  for(let i=0;i<logCaps.length;i++){
    onProgress?.({ pct: 4, stage:'serialize', try: i+1 });
    let body;
    try{
      body = await serializeFn(logCaps[i], yieldFn, onProgress);
    }catch(e){
      console.error('[save] serialize failed', slot, e);
      return null;
    }
    const tSer = performance.now();
    const meta = {
      name: metaExtra?.name || SLOT_LABEL[slot],
      seed: body.seed|0,
      era: body.era|0,
      pop: Math.floor(body.pop||0),
      savedAt: Date.now(),
      v: body.v,
    };
    let payload;
    onProgress?.({ pct: 52, stage:'stringify', try: i+1 });
    await yieldFn();
    try{
      payload = JSON.stringify({ meta, body });
    }catch(e){
      console.error('[save] stringify failed', slot, e);
      return null;
    }
    const tStr = performance.now();
    onProgress?.({ pct: 72 + i * 9, stage:'write', try: i+1 });
    await yieldFn();
    // 检查与提交之间不得再有 await，保证「最新写入者获胜」
    if(!isLatestSeq(key, seq)){
      console.warn('[save] 已被更新的写入取代，放弃本次提交', slot, { try: i+1 });
      return null;
    }
    const res = commitSave(userKey, slot, payload);
    const tEnd = performance.now();
    if(res.ok){
      const stats = {
        chunks: body.chunks?.length || 0,
        logs: body.logs?.length || 0,
        bytes: payload.length,
        kb: Math.round(payload.length / 1024),
        serMs: +(tSer - t0).toFixed(1),
        strMs: +(tStr - tSer).toFixed(1),
        setMs: +(tEnd - tStr).toFixed(1),
        totalMs: +(tEnd - t0).toFixed(1),
        retried: res.retried,
        freedKb: Math.round((res.freed||0) / 1024),
        trimTry: i,
        logCap: logCaps[i],
      };
      onProgress?.({ pct: 100, stage:'done', try: i+1 });
      console.info('[save]', slot, stats);
      return { ...meta, _stats: stats };
    }
    lastErr = res.err;
    if(i < logCaps.length - 1){
      console.warn('[save] 配额不足，裁剪日志降级重试', slot, { try: i+1, nextLogCap: logCaps[i+1] });
      onProgress?.({ pct: 62, stage:'retry', try: i+2 });
      await yieldFn();
    }
  }
  console.error('[save] all retries failed', slot, lastErr);
  return null;
}

export function readSave(userKey, slot){
  try{
    const raw = localStorage.getItem(slotKey(userKey, slot));
    if(!raw) return null;
    return JSON.parse(raw).body || null;
  }catch{ return null; }
}

export function deleteSave(userKey, slot){
  localStorage.removeItem(slotKey(userKey, slot));
}

/** R11：导出槽位为 JSON 字符串 */
export function exportSaveJson(userKey, slot){
  const raw = localStorage.getItem(slotKey(userKey, slot));
  if(!raw) return null;
  return raw;
}

/** R11：导入 JSON 到槽位（校验 meta/body） */
export function importSaveJson(userKey, slot, json){
  let o;
  try{ o = JSON.parse(json); }catch{ return false; }
  if(!o || !o.body || !o.meta) return false;
  if(!o.body.v || !Array.isArray(o.body.chunks)) return false;
  try{
    localStorage.setItem(slotKey(userKey, slot), JSON.stringify(o));
    return true;
  }catch{ return false; }
}
