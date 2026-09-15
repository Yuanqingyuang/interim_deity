// 实习神明 · GameState（无边界稀疏区块）
import { MINH, DAY_LENGTH, CHUNK, START_CHUNKS } from './config.js';
import { NUM } from './formulas.js';
import { logInit, logEncode, logDecode } from './log.js';

export function makeTile(){
  return { h: MINH, water:0, tree:0, zone:0, prog:0, built:false, variant:0, live:false };
}

function makeChunkTiles(){
  const rows = [];
  for(let ly=0; ly<CHUNK; ly++){
    const row=[];
    for(let lx=0; lx<CHUNK; lx++) row.push(makeTile());
    rows.push(row);
  }
  return rows;
}

export function chunkKey(cx, cy){ return `${cx},${cy}`; }

export function worldToChunk(x, y){
  return { cx: Math.floor(x / CHUNK), cy: Math.floor(y / CHUNK) };
}

export function getTile(G, x, y){
  const {cx, cy} = worldToChunk(x, y);
  const ch = G.chunks.get(chunkKey(cx, cy));
  if(!ch) return null;
  return ch.tiles[y - cy*CHUNK][x - cx*CHUNK];
}

export function tileLive(G, x, y){
  return getTile(G, x, y) != null;
}

/** 遍历所有已生成格子 fn(tile, x, y) */
export function eachTile(G, fn){
  for(const ch of G.chunks.values()){
    const x0 = ch.cx * CHUNK, y0 = ch.cy * CHUNK;
    for(let ly=0; ly<CHUNK; ly++)
      for(let lx=0; lx<CHUNK; lx++)
        fn(ch.tiles[ly][lx], x0+lx, y0+ly);
  }
}

/** 遍历所有区块 fn(chunk) */
export function eachChunk(G, fn){
  for(const ch of G.chunks.values()) fn(ch);
}

export function chunkBounds(G){
  let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity, n=0;
  for(const ch of G.chunks.values()){
    const x0=ch.cx*CHUNK, y0=ch.cy*CHUNK;
    if(x0<minX) minX=x0;
    if(y0<minY) minY=y0;
    if(x0+CHUNK-1>maxX) maxX=x0+CHUNK-1;
    if(y0+CHUNK-1>maxY) maxY=y0+CHUNK-1;
    n++;
  }
  if(!n) return { minX:0, maxX:CHUNK-1, minY:0, maxY:CHUNK-1, n:0, cx:0, cy:0 };
  return { minX, maxX, minY, maxY, n, cx:(minX+maxX)/2, cy:(minY+maxY)/2 };
}

export function createState(seed){
  const chunks = new Map();
  // 开局 4×4 块，以原点为中心
  const half = START_CHUNKS/2;
  for(let cy=-half; cy<half; cy++)
    for(let cx=-half; cx<half; cx++)
      chunks.set(chunkKey(cx,cy), { cx, cy, tiles: makeChunkTiles() });

  return {
    era:0, speed:2, started:false, over:false,
    seed: seed != null ? (seed|0) : ((Math.random()*1e9)|0),
    power:100, powerMax:100, faith:0, totalFaith:0,
    pop:20, stars:0, starProg:0, faithRate:0,
    chunks, terrainDirty:true,
    wonderList:[], wonders:[false,false,false,false,false],
    boostGrow:0, boostBuild:0, boostRain:0,
    time:0,
    dayTime: 0.35,
    dayLength: DAY_LENGTH,
    autoAcc: 0,
    autoLog: [],
    logs: logInit(),
    paused: false,
    userKey: null,
    tool:'raise', hover:null, painting:false, panning:false, placingWonder:false,
  };
}

export function countBuilt(G, zoneType){
  if(G._builtCache && G._builtCache.valid) return G._builtCache[zoneType] || 0;
  let n=0;
  eachTile(G, (t)=>{ if(t.zone===zoneType && t.built) n++; });
  return n;
}

/** 已划定（含在建）的数量 —— 产出立即生效 */
export function countZone(G, zoneType){
  if(G._zoneCache && G._zoneCache.valid) return G._zoneCache[zoneType] || 0;
  let n=0;
  eachTile(G, (t)=>{ if(t.zone===zoneType) n++; });
  return n;
}

export function refreshBuiltCache(G){
  const b = {1:0,2:0,3:0,4:0, valid:true};
  const z = {1:0,2:0,3:0,4:0, valid:true};
  eachTile(G, (t)=>{
    if(t.zone<=0) return;
    z[t.zone]++;
    if(t.built) b[t.zone]++;
  });
  G._builtCache = b;
  G._zoneCache = z;
  return b;
}

export function invalidateBuiltCache(G){
  if(G._builtCache) G._builtCache.valid = false;
  if(G._zoneCache) G._zoneCache.valid = false;
}

export function housingCap(G){
  let cap = countBuilt(G,1) * NUM.C_HOUSE;
  if(G.wonders[1]) cap *= 1.2;
  if(G.wonders[3]) cap *= 1.5;
  return cap;
}

export function foodCap(G){
  return countBuilt(G,2) * NUM.C_FARM;
}

export function faithMult(G){
  let m=1;
  if(G.wonders[0]) m*=1.1;
  if(G.wonders[2]) m*=1.3;
  return m;
}

export const SAVE_KEY = 'trainee-deity-save-v3';

export function serializeState(G){
  const chunks = [];
  for(const ch of G.chunks.values()){
    chunks.push({
      cx: ch.cx, cy: ch.cy,
      tiles: ch.tiles.map(row => row.map(t => [
        +t.h.toFixed(3), t.water|0, t.tree|0, t.zone|0, +t.prog.toFixed(3), t.built?1:0, t.variant|0
      ]))
    });
  }
  return {
    v: 3,
    seed: G.seed, era: G.era, speed: G.speed, over: G.over,
    power: G.power, faith: G.faith, totalFaith: G.totalFaith,
    pop: G.pop, stars: G.stars, starProg: G.starProg,
    dayTime: G.dayTime, time: G.time,
    wonders: G.wonders.slice(),
    wonderList: G.wonderList.map(w=>({era:w.era,x:w.x,y:w.y,prog:w.prog,done:w.done?1:0})),
    boostGrow: G.boostGrow, boostBuild: G.boostBuild, boostRain: G.boostRain,
    chunks,
    logs: logEncode(G.logs),
    savedAt: Date.now(),
  };
}

export function deserializeState(G, data){
  if(!data) return false;
  // v3 无边界区块
  if(data.v===3 && Array.isArray(data.chunks)){
    G.chunks = new Map();
    for(const c of data.chunks){
      const tiles = [];
      for(let ly=0; ly<CHUNK; ly++){
        const row=[];
        for(let lx=0; lx<CHUNK; lx++){
          const a = c.tiles?.[ly]?.[lx] || [MINH,0,0,0,0,0,0];
          const t = makeTile();
          t.h=+a[0]; t.water=a[1]|0; t.tree=a[2]|0; t.zone=a[3]|0;
          t.prog=+a[4]; t.built=!!a[5]; t.variant=a[6]|0; t.live=true;
          row.push(t);
        }
        tiles.push(row);
      }
      G.chunks.set(chunkKey(c.cx|0, c.cy|0), { cx:c.cx|0, cy:c.cy|0, tiles });
    }
  } else if(data.v===2 || data.v===1){
    // 旧 40×40 存档：迁到区块
    G.chunks = new Map();
    const oldRows = data.tiles?.length || 0;
    const oldCols = data.tiles?.[0]?.length || 0;
    for(let y=0;y<oldRows;y++)
      for(let x=0;x<oldCols;x++){
        const a = data.tiles[y][x];
        const {cx,cy} = worldToChunk(x,y);
        const k = chunkKey(cx,cy);
        if(!G.chunks.has(k)) G.chunks.set(k, { cx, cy, tiles: makeChunkTiles() });
        const t = getTile(G,x,y);
        if(t){
          t.h=+a[0]; t.water=a[1]|0; t.tree=a[2]|0; t.zone=a[3]|0;
          t.prog=+a[4]; t.built=!!a[5]; t.variant=a[6]|0; t.live=true;
        }
      }
    // 补一圈
    const keys = [...G.chunks.keys()];
    for(const k of keys){
      const ch = G.chunks.get(k);
      for(let dy=-1;dy<=1;dy++)
        for(let dx=-1;dx<=1;dx++){
          const kk = chunkKey(ch.cx+dx, ch.cy+dy);
          if(!G.chunks.has(kk)) G.chunks.set(kk, { cx:ch.cx+dx, cy:ch.cy+dy, tiles: makeChunkTiles() });
        }
    }
  } else return false;

  G.seed = data.seed|0;
  G.era = data.era|0;
  G.speed = data.speed|0;
  G.over = !!data.over;
  G.power = +data.power || 0;
  G.faith = +data.faith || 0;
  G.totalFaith = +data.totalFaith || 0;
  G.pop = +data.pop || 20;
  G.stars = data.stars|0;
  G.starProg = +data.starProg || 0;
  G.dayTime = +data.dayTime || 0.35;
  G.time = +data.time || 0;
  G.wonders = (data.wonders||[0,0,0,0,0]).map(v=>!!v);
  G.wonderList = (data.wonderList||[]).map(w=>({
    era:w.era|0, x:w.x|0, y:w.y|0, prog:+w.prog||0, done:!!w.done
  }));
  G.boostGrow = +data.boostGrow||0;
  G.boostBuild = +data.boostBuild||0;
  G.boostRain = +data.boostRain||0;
  G.logs = logDecode(data.logs);
  G.autoLog = [];
  G.terrainDirty = true;
  G.started = true;
  G.paused = false;
  if(G._builtCache) G._builtCache.valid = false;
  return true;
}

export function saveToStorage(G){
  try{
    localStorage.setItem(SAVE_KEY, JSON.stringify(serializeState(G)));
    return true;
  }catch(e){ console.warn('save failed', e); return false; }
}

export function loadFromStorage(){
  try{
    const raw = localStorage.getItem(SAVE_KEY)
      || localStorage.getItem('trainee-deity-save-v2')
      || localStorage.getItem('trainee-deity-save-v1');
    if(!raw) return null;
    return JSON.parse(raw);
  }catch(e){ return null; }
}

export function clearSave(){
  try{
    localStorage.removeItem(SAVE_KEY);
    localStorage.removeItem('trainee-deity-save-v2');
    localStorage.removeItem('trainee-deity-save-v1');
  }catch(e){}
}
