// 实习神明 · GameState（无边界稀疏区块）
import { MINH, MAXH, DAY_LENGTH, CHUNK, START_CHUNKS, ERAS, faithCapOf } from './config.js';
import { NUM, wonderPopMult, buildQ } from './formulas.js';
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
    power:100, faith:0, totalFaith:0,
    pop:20, stars:0, starProg:0, faithRate:0,
    // R5：每时代 3 个里程碑完成位图（存档兼容：缺失则全 false）
    starMilestones: [[false,false,false],[false,false,false],[false,false,false],[false,false,false],[false,false,false]],
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
  G._pendingValid = false;
}

export function housingCap(G){
  // 乘区统一走 formulas.wonderPopMult，禁止在此另写一份（2026-10 回归教训：
  // 两份实现分叉 → UI 承诺 +20%/+50%、实际人口上限拿不到）。
  //
  // countBuilt 返回**地块数**，而 C_HOUSE 是「每栋房容纳人数」，故必须乘 buildQ(E)
  // 换算成逻辑栋数（2026-10 审计发现：此前漏乘 → E3 起本值比真实人口上限小一个量级，
  // 使 autoBuild 的 housingCritical 恒真、每轮无条件 tryPlace(1) 无限建房，
  // 并因房屋要求 8 邻域全空而挤占农田/工业用地）。
  return countBuilt(G,1) * buildQ(G.era || 0) * NUM.C_HOUSE * wonderPopMult(G.wonders);
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
// 日志写入上限：控制 stringify/setItem 体积（R1 存档卡死）
export const SAVE_LOG_CAP = 400;

const r2 = (v)=> Math.round(+v * 100) / 100;
const r3 = (v)=> Math.round(+v * 1000) / 1000;

// 未开发地块只序列化高度（一个数字），开发过的才写完整 7 元组。
// 一个区块 100 格，绝大多数是「只有高度」的地形格，原先一律写
// [h,0,0,0,0,0,0] 使得 111 区块的存档膨胀到 230KB+（R1 存档卡死）。
function encTile(t){
  const h = r3(t.h);
  if(!(t.water|0) && !(t.tree|0) && !(t.zone|0) && !(t.variant|0) && !t.built && !(+t.prog))
    return h;
  return [h, t.water|0, t.tree|0, t.zone|0, r3(t.prog), t.built?1:0, t.variant|0];
}

function encodeChunk(ch){
  return {
    cx: ch.cx, cy: ch.cy,
    tiles: ch.tiles.map(row => row.map(encTile))
  };
}

function logSliceOf(G, logCap){
  const logs = logEncode(G.logs);
  const cap = logCap || SAVE_LOG_CAP;
  return logs.length > cap ? logs.slice(-cap) : logs;
}

// 统一构造存档头，sync / async 两条路径必须产出完全一致的字段集
function saveHead(G, chunks, logs){
  return {
    v: 3,
    seed: G.seed|0, era: G.era|0, speed: G.speed|0, over: G.over,
    power: r2(G.power), faith: r2(G.faith), totalFaith: r2(G.totalFaith),
    pop: r2(G.pop), stars: G.stars|0, starProg: r3(G.starProg),
    starMilestones: (G.starMilestones||[]).map(arr=>(arr||[]).map(v=>v?1:0)),
    dayTime: r3(G.dayTime), time: r2(G.time),
    wonders: G.wonders.map(v=>v?1:0),
    wonderList: G.wonderList.map(w=>({era:w.era|0,x:w.x|0,y:w.y|0,prog:r3(w.prog),done:w.done?1:0})),
    boostGrow: r2(G.boostGrow), boostBuild: r2(G.boostBuild), boostRain: r2(G.boostRain),
    chunks,
    logs,
    savedAt: Date.now(),
  };
}

export function serializeState(G){
  const chunks = [];
  for(const ch of G.chunks.values()) chunks.push(encodeChunk(ch));
  return saveHead(G, chunks, logSliceOf(G, SAVE_LOG_CAP));
}

/**
 * #2 存档卡死：分块序列化 —— 区块编码拆成多批，批间 await 让出主线程，
 * 避免「编码 + stringify + setItem」一次性同步执行把帧率打穿。
 * logCap 用于配额不足时的降级重试（裁剪日志体积）。
 */
export async function serializeStateAsync(G, yieldFn, onProgress, logCap){
  const yieldTo = yieldFn || (()=>new Promise(r=>setTimeout(r, 0)));
  const list = [...G.chunks.values()];
  const total = list.length || 1;
  const BATCH = 8;
  const chunks = [];
  for(let i=0;i<list.length;i++){
    chunks.push(encodeChunk(list[i]));
    if((i+1) % BATCH === 0){
      onProgress?.({ pct: Math.round((i+1) / total * 40), stage:'serialize' });
      await yieldTo();
    }
  }
  onProgress?.({ pct: 42, stage:'logs' });
  await yieldTo();
  const logs = logSliceOf(G, logCap);
  onProgress?.({ pct: 48, stage:'ready' });
  await yieldTo();
  return saveHead(G, chunks, logs);
}

// ---- S-01：反序列化校验设施（存档可来自导入文件/被篡改的 localStorage，一律按不可信输入处理）----
const MAX_SAVE_CHUNKS = 4096;   // 4096 区块 = 40.96 万格，远超正常游玩规模
const MAX_CHUNK_COORD = 4096;   // 区块坐标上限（对应 ±40960 格）
const MAX_WONDER_LIST = 64;
const MAX_SAVE_LOGS = 5000;
const NUM_HI = 1e12;            // 资源类数值上限（防 Infinity/天文数字打爆运算与渲染）

/** 取有限数值并夹到 [lo, hi]，非法值回退 def */
function num(v, def, lo, hi){
  const n = typeof v === 'number' ? v : +v;
  if(!Number.isFinite(n)) return def;
  return Math.min(hi, Math.max(lo, n));
}
function int(v, def, lo, hi){ return Math.floor(num(v, def, lo, hi)); }

function decodeTileInto(t, a){
  if(Array.isArray(a)){
    t.h       = num(a[0], MINH, MINH, MAXH);
    t.water   = int(a[1], 0, 0, 1e6);
    t.tree    = int(a[2], 0, 0, 1e6);
    t.zone    = int(a[3], 0, 0, 4);
    t.prog    = num(a[4], 0, 0, 1);
    t.built   = !!a[5];
    t.variant = int(a[6], 0, 0, 1e6);
  } else if(a != null){
    t.h = num(a, MINH, MINH, MAXH);
  }
  t.live = true;
}

export function deserializeState(G, data){
  if(!data || typeof data !== 'object') return false;
  // v3 无边界区块
  if(data.v===3 && Array.isArray(data.chunks)){
    if(data.chunks.length === 0 || data.chunks.length > MAX_SAVE_CHUNKS) return false;
    G.chunks = new Map();
    for(const c of data.chunks){
      if(!c || typeof c !== 'object' || !Array.isArray(c.tiles)) continue;
      const cx = int(c.cx, NaN, -MAX_CHUNK_COORD, MAX_CHUNK_COORD);
      const cy = int(c.cy, NaN, -MAX_CHUNK_COORD, MAX_CHUNK_COORD);
      if(!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
      const tiles = [];
      for(let ly=0; ly<CHUNK; ly++){
        const row=[];
        for(let lx=0; lx<CHUNK; lx++){
          // 兼容两种编码：数字 = 只存高度的未开发地块；数组 = 完整 7 元组
          const t = makeTile();
          decodeTileInto(t, c.tiles[ly]?.[lx]);
          row.push(t);
        }
        tiles.push(row);
      }
      G.chunks.set(chunkKey(cx, cy), { cx, cy, tiles });
    }
    if(G.chunks.size === 0) return false;
  } else if(data.v===2 || data.v===1){
    // 旧 40×40 存档：迁到区块
    if(!Array.isArray(data.tiles)) return false;
    G.chunks = new Map();
    const oldRows = Math.min(data.tiles.length, 1024);
    const oldCols = Math.min(Array.isArray(data.tiles[0]) ? data.tiles[0].length : 0, 1024);
    for(let y=0;y<oldRows;y++)
      for(let x=0;x<oldCols;x++){
        const a = data.tiles[y][x];
        const {cx,cy} = worldToChunk(x,y);
        const k = chunkKey(cx,cy);
        if(!G.chunks.has(k)) G.chunks.set(k, { cx, cy, tiles: makeChunkTiles() });
        const t = getTile(G,x,y);
        if(t) decodeTileInto(t, a);
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

  G.seed = int(data.seed, 0, -2147483648, 2147483647);
  G.era = int(data.era, 0, 0, ERAS.length - 1);
  const spd = int(data.speed, 2, 0, 8);
  G.speed = (spd===1 || spd===2 || spd===4) ? spd : 2;
  G.over = !!data.over;
  G.power = num(data.power, 0, 0, NUM_HI);
  G.faith = num(data.faith, 0, 0, NUM_HI);
  // 旧存档可能已囤积巨量信仰（旧版本无上限），读档时按当前时代上限收敛
  const fcap = faithCapOf(G.era);
  if(G.faith > fcap) G.faith = fcap;
  G.totalFaith = num(data.totalFaith, 0, 0, NUM_HI);
  G.pop = num(data.pop, 20, 0, NUM_HI);
  G.stars = int(data.stars, 0, 0, 1e6);
  G.starProg = num(data.starProg, 0, 0, NUM_HI);
  const msIn = Array.isArray(data.starMilestones) ? data.starMilestones : [];
  G.starMilestones = [];
  for(let e=0; e<5; e++){
    const row = Array.isArray(msIn[e]) ? msIn[e] : [];
    G.starMilestones.push([!!row[0], !!row[1], !!row[2]]);
  }
  const dt = num(data.dayTime, 0.35, -1, 2);
  G.dayTime = ((dt % 1) + 1) % 1;
  G.time = num(data.time, 0, 0, NUM_HI);
  const wIn = Array.isArray(data.wonders) ? data.wonders : [];
  G.wonders = [!!wIn[0], !!wIn[1], !!wIn[2], !!wIn[3], !!wIn[4]];
  G.wonderList = (Array.isArray(data.wonderList) ? data.wonderList : [])
    .slice(0, MAX_WONDER_LIST)
    .filter(w => w && typeof w === 'object')
    .map(w=>({
      era: int(w.era, 0, 0, ERAS.length - 1),
      x: int(w.x, 0, -1e5, 1e5),
      y: int(w.y, 0, -1e5, 1e5),
      prog: num(w.prog, 0, 0, 1),
      done: !!w.done
    }));
  G.boostGrow = num(data.boostGrow, 0, 0, 1e6);
  G.boostBuild = num(data.boostBuild, 0, 0, 1e6);
  G.boostRain = num(data.boostRain, 0, 0, 1e6);
  G.logs = logDecode(Array.isArray(data.logs) ? data.logs.slice(-MAX_SAVE_LOGS) : []);
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
