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

/**
 * 写档（同步 localStorage）。返回 meta（含 _stats）或 null。
 * Console 记录 stringify / setItem 耗时与体积，便于定位卡死。
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
  try{
    localStorage.setItem(slotKey(userKey, slot), payload);
  }catch(e){
    // QuotaExceeded 等
    console.error('[save] setItem failed', slot, { bytes: payload.length, err: e });
    return null;
  }
  const tEnd = performance.now();
  const stats = {
    chunks: body.chunks?.length || 0,
    logs: body.logs?.length || 0,
    bytes: payload.length,
    kb: Math.round(payload.length / 1024),
    serMs: +(tSer - t0).toFixed(1),
    strMs: +(tStr - tSer).toFixed(1),
    setMs: +(tEnd - tStr).toFixed(1),
    totalMs: +(tEnd - t0).toFixed(1),
  };
  console.info('[save]', slot, stats);
  return { ...meta, _stats: stats };
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
