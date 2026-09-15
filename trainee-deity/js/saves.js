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

export function writeSave(userKey, slot, serializeFn, metaExtra){
  const body = serializeFn();
  const meta = {
    name: metaExtra?.name || SLOT_LABEL[slot],
    seed: body.seed|0,
    era: body.era|0,
    pop: Math.floor(body.pop||0),
    savedAt: Date.now(),
    v: body.v,
  };
  try{
    localStorage.setItem(slotKey(userKey, slot), JSON.stringify({ meta, body }));
    return meta;
  }catch(e){
    console.warn('save failed', e);
    return null;
  }
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
