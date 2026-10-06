// 实习神明 · 地形系统（无边界区块）
// 种子确定性：域扭曲 + 大陆度 + 脊状山脉 + 丘陵 + 蜿蜒河谷（适配无限区块采样）
import { MAXH, MINH, WATER_LEVEL, TOOLS, PALETTES, fbm, valueNoise, hash2, CHUNK, mulberry32, autoRng } from './config.js';
import { chunkKey, worldToChunk, getTile, tileLive, eachTile, eachChunk, chunkBounds, makeTile, invalidateBuiltCache } from './state.js';
import { LAYOUT } from './formulas.js';
import { logPush } from './log.js';

const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const smstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

export const LAND_RATIO = 0.56;
export const RIDGE_STRENGTH = 0.75;
export const ELEV_PCT = 0.98;
// 无限图：用固定海平面阈值（与 cont 场量纲对齐），保证任意种子陆海稳定
const SEA_LEVEL = 0.42;

/** 脊状多重分形 → 山脉 */
function ridgedNoise(x, y, oct = 5, seed = 0, lac = 2.0, gain = 0.5){
  let v = 0, amp = 1, f = 1, n = 0, prev = 1;
  for(let i = 0; i < oct; i++){
    let q = valueNoise(x * f, y * f, seed + i * 197);
    q = 1 - Math.abs(q * 2 - 1);
    q *= q;
    q *= prev;
    prev = Math.max(q, 0.15);
    v += amp * q; n += amp; amp *= gain; f *= lac;
  }
  return v / n;
}

/** 域扭曲 → 海岸/河流蜿蜒 */
function warp2(x, y, seed, strength = 6, freq = 0.06){
  const wx = fbm(x * freq + 13.7, y * freq + 5.1, 4, seed + 911);
  const wy = fbm(x * freq + 47.3, y * freq + 19.6, 4, seed + 1237);
  return { x: x + (wx - 0.5) * 2 * strength, y: y + (wy - 0.5) * 2 * strength };
}

/** 大陆度场（不规则岛屿掩码）；d = 距原点归一化 0..1 */
function continentField(x, y, seed, d){
  const base = fbm(x * 0.065, y * 0.065, 4, seed + 7);
  const b2 = fbm(x * 0.15, y * 0.15, 3, seed + 31);
  const cont = clamp01((base * 0.8 + b2 * 0.2 - 0.5) * 1.9 + 0.5);
  const dw = clamp01(d + (fbm(x * 0.09, y * 0.09, 3, seed + 404) - 0.5) * 0.35);
  return cont * (1 - smstep(0.55, 1.05, dw));
}

/** 陆地高程 0..1+（平原/丘陵/山地分层） */
function landElevation(x, y, seed, land){
  const inland = smstep(0.05, 0.55, land);
  const ridge = ridgedNoise(x * 0.10, y * 0.10, 6, seed + 77);
  const hill = fbm(x * 0.20, y * 0.20, 4, seed + 123) - 0.5;
  return Math.max(0, land * 0.30 + inland * 0.25 + ridge * inland * RIDGE_STRENGTH + hill * 0.10);
}

/**
 * 高度场（点采样，无限世界可用）
 * 海床 / 陆地；原点附近 d 小 → 更多陆地
 */
export function heightAt(wx, wy, seed){
  const p = warp2(wx, wy, seed);
  const d = Math.hypot(wx, wy) / 90;
  const cont = continentField(p.x, p.y, seed, d);

  if(cont < SEA_LEVEL){
    const t = clamp01(cont / Math.max(1e-6, SEA_LEVEL));
    return mix(MINH, WATER_LEVEL - 0.06, t);
  }

  const land = clamp01((cont - SEA_LEVEL) / (1 - SEA_LEVEL));
  let elev = landElevation(p.x, p.y, seed, land);
  // 局部归一：用固定参考分位，保证有峰又不炸
  const eNorm = clamp01(elev / 1.15);
  return mix(WATER_LEVEL, MAXH, Math.pow(eNorm, 1.15));
}

/**
 * 河流掩码 0..1
 * 域扭曲 + 细谷噪声；>0.32 可开河
 */
/**
 * 水面平面的实际世界 y（= WATER_LEVEL − 0.04）。
 *
 * 水面网格为避开与岸边的 z-fighting，刻意画在 WATER_LEVEL 之下 0.04；
 * 而水陆判据用的是 WATER_LEVEL 本身。两者相差的 0.04 会让
 * h ∈ (WATER_PLANE_Y, WATER_LEVEL] 的格「判为水却露在水面之上」。
 * 提为单一来源：判据仍用 WATER_LEVEL，定高时保证水格低于本值；
 * render.js 的水面网格也引用同一常量，避免两处各写 0.04。
 */
export const WATER_PLANE_Y = WATER_LEVEL - 0.04;

export function riverMask(wx, wy, seed){
  const p = warp2(wx, wy, seed, 8, 0.05);
  // 沿山向的细线谷：用两向 ridged 交叉
  const a = ridgedNoise(p.x * 0.09, p.y * 0.09, 4, seed + 301);
  const b = fbm(p.x * 0.04, p.y * 0.04, 3, seed + 307);
  // 高大陆上的河谷更明显
  const cont = continentField(p.x, p.y, seed, Math.hypot(wx, wy) / 90);
  const inland = smstep(0.35, 0.75, cont);
  const line = 1 - Math.abs(a * 2 - 1);
  let r = Math.pow(clamp01(line), 2.2) * (0.35 + b * 0.65) * inland;
  // 主河带：域扭曲后的低频河槽
  const main = 1 - Math.abs(fbm(p.x * 0.03, p.y * 0.03, 3, seed + 41) * 2 - 1);
  r = Math.max(r, Math.pow(clamp01(main), 3.5) * 0.85 * inland);
  return clamp01(r);
}

/** 含河道冲刷的采样高度（旷野与管理区共用） */
export function sampleHeight(wx, wy, seed){
  let h = heightAt(wx, wy, seed);
  const rm = riverMask(wx, wy, seed);
  if(rm > 0.28 && h > WATER_LEVEL - 0.05){
    const carve = Math.min(1, (rm - 0.28) / 0.45);
    const bed = WATER_LEVEL - 0.12 - carve * 0.5;
    h = h * (1 - carve * 0.85) + bed * carve * 0.85;
    if(h > WATER_LEVEL - 0.02 && carve > 0.55) h = Math.min(h, WATER_LEVEL - 0.15);
  }
  return Math.min(Math.max(h, MINH), MAXH);
}

/** 地形分类（供着色/逻辑） */
export function terrainClass(h){
  if(h <= WATER_LEVEL) return 'water';
  if(h < 1.15) return 'sand';
  if(h < 2.6) return 'plain';
  if(h < 4.6) return 'hill';
  if(h < 6.5) return 'mountain';
  return 'peak';
}

function moistureAt(x, y, seed){
  return fbm(x * 0.07, y * 0.07, 4, seed + 555);
}

function fillTileFromNoise(t, x, y, seed){
  let h = sampleHeight(x, y, seed);

  // 开局原点：羽化平整，不破坏自然轮廓
  const dist = Math.hypot(x, y);
  const w = 1 - smstep(3.2, 5.0, dist);
  if(w > 0 && h > WATER_LEVEL + 0.05){
    h = mix(h, WATER_LEVEL + 0.95, w * 0.88);
  }

  t.h = Math.min(Math.max(h, MINH), MAXH);
  t.water = t.h <= WATER_LEVEL ? 1 : 0;
  // 水陆判据用 WATER_LEVEL，但水面网格画在 WATER_PLANE_Y（低 0.04）；
  // 若不压平，h ∈ (WATER_PLANE_Y, WATER_LEVEL] 的水格会穿出水面（实测每区块 20–25 格）。
  // 保证不变量：水格一律低于水面平面。判据值不变，故「能否建造」口径也不变。
  if(t.water && t.h > WATER_PLANE_Y) t.h = WATER_PLANE_Y;
  t.tree = 0;
  t.zone = 0; t.prog = 0; t.built = false;
  t.variant = (hash2(x, y, seed + 13) * 3) | 0;
  // 树：湿度 × 高度带
  if(!t.water && t.h > 1.2 && t.h < 6.0){
    const m = moistureAt(x, y, seed);
    // R9 + review：略低于原稿，仍保留林地感（原 0.52*1.8）
    if(m > 0.55 && hash2(x, y, seed + 9) < (m - 0.55) * 1.35) t.tree = 1;
  }
  t.live = true;
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

export function ensureChunk(G, cx, cy){
  const k = chunkKey(cx, cy);
  if(G.chunks.has(k)) return false;
  const tiles = makeChunkTiles();
  const seed = G.seed|0;
  const x0 = cx*CHUNK, y0 = cy*CHUNK;
  for(let ly=0; ly<CHUNK; ly++)
    for(let lx=0; lx<CHUNK; lx++)
      fillTileFromNoise(tiles[ly][lx], x0+lx, y0+ly, seed);
  // 不做热侵蚀：区块高度必须与 sampleHeight（旷野采样/紧凑存档还原）严格一致，
  // 否则区块接缝错位、且紧凑编码还原的高度与生成值漂移
  G.chunks.set(k, { cx, cy, tiles });
  G.terrainDirty = true;
  return true;
}

/** 有建筑的区块：补一圈 8 邻域 */
export function ensureChunkRing(G, wx, wy){
  const {cx,cy} = worldToChunk(wx, wy);
  let n = 0;
  for(let dy=-1;dy<=1;dy++)
    for(let dx=-1;dx<=1;dx++)
      if(ensureChunk(G, cx+dx, cy+dy)) n++;
  if(n) G.terrainDirty = true;
  return n;
}

export function genWorld(G){
  // 开局 4×4 块（createState 已建空壳，这里填地形）
  const seed = G.seed|0;
  eachChunk(G, (ch)=>{
    const x0=ch.cx*CHUNK, y0=ch.cy*CHUNK;
    for(let ly=0; ly<CHUNK; ly++)
      for(let lx=0; lx<CHUNK; lx++)
        fillTileFromNoise(ch.tiles[ly][lx], x0+lx, y0+ly, seed);
  });
  // 原点清树
  for(let y=-3;y<=3;y++)
    for(let x=-3;x<=3;x++){
      const t = getTile(G,x,y);
      if(t) t.tree = 0;
    }
  seedVillage(G);
  G.terrainDirty = true;
}

// F2：开局村落 —— 设计的人口上限 = 住房×C_HOUSE（E1–2），零住房开局即 cap=0 人口崩溃，
// 设计前提是开局已有住房。此处直接放置 5 房（cap=20=开局人口）+ 1 农田（粮 50/s）
// 且为已建成态，人口自第一 tick 起即可随新房建成增长；原点若为水面则回退到最近陆地。
function seedVillage(G){
  const spots = [
    [0,0,1],[2,1,1],[-2,1,1],[1,-2,1],[-1,-2,1],[0,2,2],
  ];
  const landNear = (x, y)=>{
    for(let r=0;r<=6;r++){
      for(let dy=-r;dy<=r;dy++)
        for(let dx=-r;dx<=r;dx++){
          const t = getTile(G, x+dx, y+dy);
          if(t && !t.water && t.h >= 0.95 && t.h <= 5.4) return [x+dx, y+dy];
        }
    }
    return null;
  };
  for(const [x, y, z] of spots){
    let p = null;
    const t0 = getTile(G, x, y);
    if(t0 && !t0.water && t0.h >= 0.95 && t0.h <= 5.4) p = [x, y];
    else p = landNear(x, y);
    if(!p) continue;
    const t = getTile(G, p[0], p[1]);
    if(t.zone > 0) continue;
    t.zone = z; t.built = true; t.prog = 1; t.tree = 0;
    ensureChunkRing(G, p[0], p[1]);
  }
}

/**
 * 统一落位入口（幂等）：同一坐标绝不写入第二座。
 * mode: 'manual'（玩家，放宽间隔）| 'auto'（自动，走 canPlaceZoneAt）
 * 成功返回 {x,y,zone}；失败返回 null。
 */
export function placeAt(G, x, y, zoneType, mode='auto'){
  const px = x|0, py = y|0;
  if(!(zoneType >= 1 && zoneType <= 4)) return null;
  const t = getTile(G, px, py);
  if(!t) return null;
  if(t.water || t.zone > 0) return null;
  if(t.h < 0.95 || t.h > 5.4) return null;
  if(mode === 'manual'){
    if(!canPlaceZoneManual(G, px, py, zoneType)) return null;
  } else {
    if(!canPlaceZoneAt(G, px, py, zoneType)) return null;
  }
  t.zone = zoneType;
  t.prog = 0;
  t.built = false;
  t.tree = 0;
  ensureChunkRing(G, px, py);
  clearTreesNearZones(G, 1, px, py, 2);
  G.terrainDirty = true;
  invalidateBuiltCache(G);
  return { x: px, y: py, zone: zoneType };
}

// ---- 工具 ----
export function applyTool(G, hx, hy, dt){
  const tool = TOOLS[G.tool];
  if(!tool) return null;
  const consume = tool.cost * dt;
  // G-06：返回原因码供 UI 提示（'ok' / 'power' / 'out' / 'water' / 'occupied' / 'height' / 'blocked' / 'empty'）
  if(G.power < consume*0.5) return 'power';

  if(tool.kind === 'zone'){
    const tx = Math.round(hx), ty = Math.round(hy);
    if(!tileLive(G, tx, ty)) return 'out';
    // 手动：放宽间隔，玩家可贴着放；一律走 placeAt 幂等
    if(placeAt(G, tx, ty, tool.zone, 'manual')){
      G.power = Math.max(0, G.power - consume);
      if(typeof G.onZonePlaced === 'function') G.onZonePlaced(tx, ty, tool.zone);
      return 'ok';
    }
    const t = getTile(G, tx, ty);
    if(t && t.water) return 'water';
    if(t && t.zone > 0) return 'occupied';
    if(t && (t.h < 0.95 || t.h > 5.4)) return 'height';
    return 'blocked';
  }

  // R6 拆除：清除 zone/built/prog，保留地形
  if(tool.kind === 'demolish'){
    const tx = Math.round(hx), ty = Math.round(hy);
    if(!tileLive(G, tx, ty)) return 'out';
    const t = getTile(G, tx, ty);
    if(!t || t.zone <= 0) return 'empty';
    const z = t.zone;
    t.zone = 0; t.prog = 0; t.built = false;
    ensureChunkRing(G, tx, ty);
    G.terrainDirty = true;
    invalidateBuiltCache(G);
    G.power = Math.max(0, G.power - consume);
    logPush(G, 90, tx, ty);
    // 只走移除回调，禁止 onZonePlaced（会误写「建起」日志）
    if(typeof G.onZoneRemoved === 'function') G.onZoneRemoved(tx, ty, z);
    return 'ok';
  }

  const R = tool.radius;
  const reach = R + 0.7;
  const x0 = Math.floor(hx - reach);
  const x1 = Math.ceil(hx + reach);
  const y0 = Math.floor(hy - reach);
  const y1 = Math.ceil(hy + reach);

  const cx = Math.round(hx), cy = Math.round(hy);
  // 平整：笔刷内高度中位数 + 中心加权，抗离群点、避免被水坑/高峰拽跑
  const samples = [];
  const pr = Math.max(1, Math.round(R));
  for(let dy=-pr; dy<=pr; dy++)
    for(let dx=-pr; dx<=pr; dx++){
      if(dx*dx + dy*dy > pr*pr) continue;
      const a = getTile(G, cx+dx, cy+dy);
      if(!a || a.water) continue;
      samples.push(a.h);
    }
  samples.sort((a,b)=>a-b);
  const median = samples.length
    ? samples[samples.length >> 1]
    : (getTile(G, cx, cy)?.h ?? 2.0);
  const centerH = getTile(G, cx, cy) && !getTile(G, cx, cy).water
    ? getTile(G, cx, cy).h
    : median;
  // 目标 = 中位数为主，略向中心高度靠（保留玩家在高台/洼地的手感）
  const flattenTarget = Math.max(1.12, Math.min(5.2, median * 0.75 + centerH * 0.25));

  let used = 0;
  for(let y=y0;y<=y1;y++){
    for(let x=x0;x<=x1;x++){
      const t = getTile(G,x,y);
      if(!t) continue;
      const dx = x-hx, dy = y-hy;
      const d = Math.sqrt(dx*dx + dy*dy);
      if(d > reach) continue;
      const f = Math.max(0, 1 - d/reach);

      if(tool.kind === 'terrain'){
        if(G.tool === 'raise'){
          if(t.water){ t.water=0; t.h = Math.max(1.0, WATER_LEVEL + 0.05); }
          else { t.h = Math.min(MAXH, t.h + (tool.strength ?? 0.9)*dt*f); }
        } else if(G.tool === 'lower'){
          t.h = Math.max(MINH, t.h - (tool.strength ?? 0.9)*dt*f);
          if(t.h <= WATER_LEVEL){ t.water=1; t.tree=0; }
        } else if(G.tool === 'flatten'){
          // 限速逼近：单帧最大位移，避免猛拽；仅在高于水面时强制抬离水
          const k = Math.min(1, (tool.strength ?? 1.1) * dt * (0.35 + 0.65 * f));
          const next = t.h + (flattenTarget - t.h) * k;
          const maxStep = 0.55 * dt * 60 * f; // 约 0.55 单位/秒 @ f=1
          t.h = t.h + Math.max(-maxStep, Math.min(maxStep, next - t.h));
          if(t.h < 1.10) t.h = 1.10;
          if(t.h > 5.2) t.h = 5.2;
          if(t.water && t.h > WATER_LEVEL + 0.02){ t.water = 0; }
          if(t.tree && f > 0.2) t.tree = 0;
        } else if(G.tool === 'water'){
          if(!t.water && t.h < 2.8){ t.water=1; t.tree=0; t.h = Math.min(t.h,0.7); }
        } else if(G.tool === 'tree'){
          if(!t.water && t.h>0.9 && t.h<6.2 && f>0.3){ t.tree = 1; }
        }
      }
      used = Math.max(used, consume);
    }
  }
  G.power = Math.max(0, G.power - used);
  G.terrainDirty = true;
  // R6：地形笔刷命中点粒子（由 main 注入 R，避免 terrain 依赖 render）
  if(typeof G.onToolHit === 'function'){
    const hx0 = Math.round(hx), hy0 = Math.round(hy);
    G.onToolHit(hx0, hy0, G.tool);
  }
  return 'ok';
}

function mixRGB(a, b, t){
  const k = Math.max(0, Math.min(1, t));
  return { r: a.r+(b.r-a.r)*k, g: a.g+(b.g-a.g)*k, b: a.b+(b.b-a.b)*k };
}
function smoothstep(a, b, x){
  const t = Math.max(0, Math.min(1, (x - a) / (b - a || 1e-6)));
  return t * t * (3 - 2 * t);
}

/**
 * 高度 → 地表色：连续混色，避免色带硬切。
 * 带：河床 → 沙 → 草 → 深草 → 岩 → 雪
 */
export function cornerColor(h, adjWater, hRight, hDown, era=0){
  const p = PALETTES[Math.max(0, Math.min(4, era|0))] || PALETTES[0];
  const bed = hexRGB(0x8a7a5a);
  const sand = hexRGB(p.sand);
  const grass = hexRGB(p.grass);
  const grass2 = hexRGB(p.grass2);
  const rock = hexRGB(p.rock);
  const snow = hexRGB(p.snow);

  // 关键高度（与 WATER_LEVEL=0.75、MAXH≈9 对齐）
  const h0 = WATER_LEVEL - 0.35;   // 深河床
  const h1 = WATER_LEVEL + 0.05;   // 水线
  const h2 = WATER_LEVEL + 0.95;   // 沙→草
  const h3 = 2.8;                  // 草→深草
  const h4 = 4.3;                  // 深草→岩
  const h5 = 6.2;                  // 岩→雪

  let c;
  if(h <= h1){
    c = mixRGB(bed, sand, smoothstep(h0, h1, h));
  } else if(h <= h2){
    c = mixRGB(sand, grass, smoothstep(h1, h2, h) * 0.85);
  } else if(h <= h3){
    c = mixRGB(grass, grass2, smoothstep(h2, h3, h));
  } else if(h <= h4){
    c = mixRGB(grass2, rock, smoothstep(h3, h4, h));
  } else if(h <= h5){
    c = mixRGB(rock, snow, smoothstep(h4, h5, h));
  } else {
    c = snow;
  }

  // 邻差微阴影（比原先更弱，避免条带感）
  const dh = (h - (hRight ?? h)) * 0.06 + (h - (hDown ?? h)) * 0.04;
  const sh = Math.max(0.72, Math.min(1.28, 1 + dh));
  return { r: c.r * sh, g: c.g * sh, b: c.b * sh };
}

function hexRGB(hex){
  return {
    r: ((hex>>16)&255)/255,
    g: ((hex>>8)&255)/255,
    b: (hex&255)/255,
  };
}

export function zoneNeedsGap(zoneType){
  return zoneType !== 2;
}

/** 玩家手动放置：只禁水面 / 已占用 / 高度，不强制间隔与工业距离 */
export function canPlaceZoneManual(G, x, y, zoneType){
  const t = getTile(G, x, y);
  if(!t) return false;
  if(t.water || t.zone>0) return false;
  if(t.h < 0.95 || t.h > 5.4) return false;
  return true;
}

export function canPlaceZoneAt(G, x, y, zoneType){
  const t = getTile(G, x, y);
  if(!t) return false;
  if(t.water || t.zone>0) return false;
  if(t.h < 0.95 || t.h > 5.4) return false;

  if(zoneType === 2){
    let neighRes = 0, orthRes = 0;
    for(let dy=-1;dy<=1;dy++){
      for(let dx=-1;dx<=1;dx++){
        if(dx===0 && dy===0) continue;
        const a = getTile(G, x+dx, y+dy);
        if(a && a.zone===1){
          neighRes++;
          if(dx===0 || dy===0) orthRes++;
        }
      }
    }
    if(neighRes >= 5 || orthRes >= 3) return false;
  }

  // 工业：硬约束 D_res ≥ 6（切比雪夫）
  if(zoneType === 3){
    let dMin = Infinity;
    for(let dy=-6;dy<=6;dy++)
      for(let dx=-6;dx<=6;dx++){
        const a = getTile(G, x+dx, y+dy);
        if(a && a.zone===1){
          const d = Math.max(Math.abs(dx), Math.abs(dy));
          if(d < dMin) dMin = d;
        }
      }
    if(dMin < LAYOUT.R_ind) return false;
  }

  // 间隔：仅「农田-农田」可相邻；其余任意组合至少空 1 格
  for(let dy=-1;dy<=1;dy++){
    for(let dx=-1;dx<=1;dx++){
      if(dx===0 && dy===0) continue;
      const a = getTile(G, x+dx, y+dy);
      if(!a || a.zone<=0) continue;
      if(zoneType===2 && a.zone===2) continue; // 田-田
      return false;
    }
  }
  return true;
}

function residentialStats(G){
  let sx=0, sy=0, n=0;
  eachTile(G, (t,x,y)=>{
    if(t.zone===1){ sx+=x; sy+=y; n++; }
  });
  if(!n) return { cx:0, cy:0, n:0 };
  return { cx:sx/n, cy:sy/n, n };
}

function minDistToRes(G, x, y){
  let best = Infinity;
  eachTile(G, (t,xx,yy)=>{
    if(t.zone!==1) return;
    const d = Math.hypot(xx-x, yy-y);
    if(d < best) best = d;
  });
  return best;
}

function countResNear(G, x, y, r=2){
  let n = 0;
  for(let dy=-r;dy<=r;dy++)
    for(let dx=-r;dx<=r;dx++){
      const a = getTile(G, x+dx, y+dy);
      if(a && a.zone===1) n++;
    }
  return n;
}

function countAdjRes(G, x, y){
  let n = 0;
  for(let dy=-1;dy<=1;dy++)
    for(let dx=-1;dx<=1;dx++){
      if(dx===0 && dy===0) continue;
      const a = getTile(G, x+dx, y+dy);
      if(a && a.zone===1) n++;
    }
  return n;
}

// ---- 工业专用：按 numeric-design §8 生成 ----

function chunkStats(G, cx, cy){
  const x0 = cx*CHUNK, y0 = cy*CHUNK;
  let total=0, by={1:0,2:0,3:0,4:0};
  for(let ly=0; ly<CHUNK; ly++)
    for(let lx=0; lx<CHUNK; lx++){
      const t = getTile(G, x0+lx, y0+ly);
      if(t && t.zone>0){ total++; by[t.zone]++; }
    }
  return {
    total, by,
    typeShare(z){ return total===0 ? 0.5 : (by[z]/total); }
  };
}

/**
 * 工业单格打分（numeric-design §8.3 / §8.4）
 * 硬约束：D_res ≥ R_ind、间隔 ≥1、区块未满、非水面、坡度可接受
 */
function scoreIndustrialCell(G, x, y, resList, indList, otherList){
  const t = getTile(G, x, y);
  if(!t || t.water || t.zone>0) return -1e9;
  if(t.h < 1.0 || t.h > 5.2) return -1e9;

  for(let dy=-1;dy<=1;dy++)
    for(let dx=-1;dx<=1;dx++){
      if(dx===0 && dy===0) continue;
      const a = getTile(G, x+dx, y+dy);
      if(a && a.zone>0) return -1e9;
    }

  let dR = Infinity;
  if(resList.length){
    for(const r of resList){
      const d = Math.max(Math.abs(x-r.x), Math.abs(y-r.y));
      if(d < dR) dR = d;
    }
  } else {
    dR = 99;
  }
  const R = LAYOUT.R_ind;
  if(dR < R) return -1e9;

  const {cx,cy} = worldToChunk(x,y);
  const st = chunkStats(G, cx, cy);
  if(st.total >= LAYOUT.BlockCap) return -1e9;

  let dSame = Infinity;
  for(const p of indList){
    const d = Math.max(Math.abs(x-p.x), Math.abs(y-p.y));
    if(d < dSame) dSame = d;
  }
  let dOther = Infinity;
  for(const p of otherList){
    const d = Math.max(Math.abs(x-p.x), Math.abs(y-p.y));
    if(d < dOther) dOther = d;
  }
  if(dSame===Infinity) dSame = 8;
  if(dOther===Infinity) dOther = LAYOUT.D_max;

  let flat=0, n=0;
  for(let dy=-1;dy<=1;dy++)
    for(let dx=-1;dx<=1;dx++){
      const a=getTile(G,x+dx,y+dy);
      if(!a) continue;
      flat += a.h; n++;
    }
  flat = n ? Math.abs(t.h - flat/n) : 0;
  if(flat > 0.9) return -1e9;

  const A_same = 1 / (1 + dSame);
  const A_other = Math.min(1, dOther / LAYOUT.D_max);
  const A_anchor = Math.min(1, (dR - R) / R);
  const occ = st.total / LAYOUT.BlockCap;
  const A_chunk = 2.0 * st.typeShare(3) - 1.0 * occ;
  const overFar = Math.max(0, dR - (R + LAYOUT.D_max));
  const farPen = 4 * Math.pow(Math.max(0, (dOther - LAYOUT.D_max) / LAYOUT.D_max), 2);

  let sameNear = 0;
  for(const p of indList){
    const d = Math.max(Math.abs(x-p.x), Math.abs(y-p.y));
    if(d <= 2) sameNear++;
  }
  const S = Math.min(1, sameNear / 4) * 0.7 + 0.3;

  return LAYOUT.w1 * S
    + LAYOUT.w2 * A_same
    + LAYOUT.w3 * A_other
    + LAYOUT.w4 * A_anchor
    + LAYOUT.w5 * A_chunk
    - flat * 1.2
    - overFar * 1.0
    - farPen
    + hash2(x,y,G.seed+7)*0.12;
}

function collectZoneXY(G, zone){
  const list = [];
  eachTile(G, (t,x,y)=>{
    if(t.zone===zone) list.push({x,y});
  });
  return list;
}

export function placeIndustryBatch(G, maxTiles=2){
  maxTiles = Math.max(1, Math.min(2, maxTiles|0));
  const resList = collectZoneXY(G, 1);
  if(!resList.length) return { n: 0, x: 0, y: 0 };
  const indList = collectZoneXY(G, 3);
  const otherList = [];
  eachTile(G, (t,x,y)=>{
    if(t.zone>0 && t.zone!==3) otherList.push({x,y});
  });

  // 居住质心 + 局部环带搜索，避免全图 O(n²)
  let sx=0, sy=0;
  for(const r of resList){ sx+=r.x; sy+=r.y; }
  sx = Math.round(sx/resList.length);
  sy = Math.round(sy/resList.length);

  const Rmin = LAYOUT.R_ind;
  const Rmax = Rmin + LAYOUT.D_max;
  const shapes = maxTiles >= 2 ? [[1,0],[0,1]] : [[0,0]];
  // R3：种子 PRNG，禁止 Math.random
  const rnd = autoRng(G, 3);

  let best = null, bestScore = -1e9;
  // 半径写死会让中心环带饱和后点位恒不可行：农田允许「田-田」相邻、且按 nearRes
  // 加成贴着居住区铺开，会很快糊满 [R_ind, R_ind+D_max]；工业又硬性要求 8 邻域全空，
  // 于是采样点全部被否决。实测 4 个种子中有 2 个工业永久停在 9~12/s（门槛 15/s），
  // 时代因此永久锁死。与 findAutoSite 同源修法：采样分三档逐圈外扩。
  const samples = 96;
  for(let i=0;i<samples;i++){
    const scale = i < samples*0.5 ? 1 : (i < samples*0.75 ? 1.7 : 2.6);
    const Rlo = Rmin * scale, Rhi = Rmax * scale;
    const ang = rnd()*Math.PI*2;
    const rad = Rlo + rnd()*(Rhi-Rlo);
    const x = Math.round(sx + Math.cos(ang)*rad);
    const y = Math.round(sy + Math.sin(ang)*rad);
    for(const [dx,dy] of shapes){
      const s0 = scoreIndustrialCell(G, x, y, resList, indList, otherList);
      if(s0 < -1e8) continue;
      let s = s0;
      if(maxTiles >= 2){
        const s1 = scoreIndustrialCell(G, x+dx, y+dy, resList, indList, otherList);
        if(s1 < -1e8) continue;
        s += s1;
      }
      if(s > bestScore){ bestScore = s; best = {x,y,dx,dy}; }
    }
  }
  if(!best) return { n: 0, x: 0, y: 0 };

  // 工业只保留本打分路径；落位统一 placeAt（幂等）
  let placed = 0;
  const put = (x,y)=>{
    if(placed >= maxTiles) return false;
    if(scoreIndustrialCell(G, x, y, resList, indList, otherList) < -1e8) return false;
    const r = placeAt(G, x, y, 3, 'auto');
    if(!r) return false;
    indList.push({x:r.x, y:r.y});
    placed++;
    return true;
  };

  put(best.x, best.y);
  if(maxTiles >= 2) put(best.x+best.dx, best.y+best.dy);
  if(placed < maxTiles){
    for(const [ox,oy] of [[2,0],[-2,0],[0,2],[0,-2],[1,1],[-1,-1],[1,-1],[-1,1]]){
      if(placed>=maxTiles) break;
      put(best.x+ox, best.y+oy);
    }
  }

  if(placed){
    G.terrainDirty = true;
    ensureChunkRing(G, best.x, best.y);
  }
  // 返回真实坐标，供日志使用（禁止写 (0,0)）
  return { n: placed, x: best.x, y: best.y };
}

export function findAutoSite(G, zoneType){
  const seed = G.seed|0;
  const res = residentialStats(G);
  const sx = res.cx, sy = res.cy;
  const b = chunkBounds(G);

  // R3：种子 PRNG 采样
  const rnd = autoRng(G, zoneType);
  const R0 = zoneType===3 ? 18 : 14;
  const tries = 96;
  let best=null, bestScore=-1e9;

  for(let i=0;i<tries;i++){
    // 近处排满时逐圈外扩：半径写死会在中心区饱和后永远找不到点位
    const R = i < tries*0.5 ? R0 : (i < tries*0.75 ? R0*1.7 : R0*2.6);
    const x = Math.round(sx + (rnd()*2-1)*R);
    const y = Math.round(sy + (rnd()*2-1)*R);
    if(x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) continue;
    const t = getTile(G,x,y);
    if(!t || t.water || t.zone>0 || t.tree) continue;
    if(t.h < 1.0 || t.h > 5.2) continue;
    if(!canPlaceZoneAt(G, x, y, zoneType)) continue;

    let adj=0, adjWater=0, flat=0, n=0;
    for(let dy=-1;dy<=1;dy++)
      for(let dx=-1;dx<=1;dx++){
        const a=getTile(G, x+dx, y+dy);
        if(!a) continue;
        if(a.zone>0) adj++;
        if(a.water) adjWater++;
        flat += a.h; n++;
      }
    if(n>0) flat = Math.abs(t.h - flat/n);
    if(flat > 0.85) continue;

    const dist = Math.hypot(x-sx, y-sy);
    let score = 1.2 + adj*2 - dist*0.28 - flat*2.0;

    if(zoneType===1){
      // 住房受「不得与任何已划区相邻」的硬约束（见 canPlaceZoneAt），adj 恒为 0，
      // 拿不到上面的 adj*2 加成；改用 2 格环内的居住密度计分，
      // 否则只剩 1.2 - dist*0.28，只有质心约 4 格内才可能过阈值（而那里早被占满）
      score += countResNear(G, x, y, 2) * 1.2;
      score += hash2(x,y,seed+4)*0.3;
      if(dist > 16) score -= 1.5;
    } else if(zoneType===2){
      const adjRes = countAdjRes(G, x, y);
      const nearRes = countResNear(G, x, y, 2);
      // 农田受「不得与非农田相邻」硬约束（见 canPlaceZoneAt），adjRes 恒为 0，
      // 原先唯一正项 adjRes*5 等于失效：得分只剩 1.2 - dist*0.28 - flat*2，
      // 中心区饱和后恒为负 → findAutoSite(2) 永久 null → 食物停在刚好够吃 →
      // 住房被 foodOk 锁死 → 人口/时代永久停滞。
      // 改用 2 格环内居住密度作正项，让农田能随居住区外扩持续落位。
      score += nearRes * 2.5;
      if(nearRes < 1) score -= 2;
      score += adjRes * 5;
      score += adjWater*1.5 + hash2(x,y,seed+2)*0.3;
    } else if(zoneType===3){
      const dRes = Math.max(Math.abs(x-sx), Math.abs(y-sy));
      if(dRes < LAYOUT.R_ind) continue;
      score += dRes * 0.5;
      score += hash2(x,y,seed+7)*0.4;
    } else if(zoneType===4){
      const nearRes = countResNear(G, x, y, 2);
      if(nearRes < 2) score -= 8;
      score += nearRes * 1.8;
      score += (t.h-2.2)*0.4 - dist*0.1;
    }

    if(score > bestScore){ bestScore=score; best=[x,y]; }
  }
  // 几何合法性（t.h / canPlaceZoneAt / flat）已是硬门槛；score 只用于「在合法点位中挑最优」。
  // 原先按 score>0.2 过滤会让远处但完全合法的点位被静默丢弃（农田尤甚），
  // 自动建造表现为「无日志、无原因地停止」，故只要有合法候选就返回。
  if(zoneType === 1) return best;
  return best;
}

export function placeDistrict(G, cx, cy, zoneType, maxTiles=1){
  // 自动单格 + 幂等 placeAt；禁止全图扫树
  const r = placeAt(G, cx, cy, zoneType, 'auto');
  return r ? 1 : 0;
}

export function clearTreesNearZones(G, radius=1, cx=null, cy=null, span=null){
  if(cx==null){
    eachTile(G, (t,x,y)=>{
      if(!t.tree) return;
      let near = false;
      for(let dy=-radius; dy<=radius && !near; dy++)
        for(let dx=-radius; dx<=radius; dx++){
          const a = getTile(G, x+dx, y+dy);
          if(a && a.zone>0){ near = true; break; }
        }
      if(near){ t.tree = 0; G.terrainDirty = true; }
    });
    return;
  }
  const s = span==null ? 2 : span;
  const x0 = cx - s, x1 = cx + s, y0 = cy - s, y1 = cy + s;
  for(let y=y0;y<=y1;y++)
    for(let x=x0;x<=x1;x++){
      const t = getTile(G,x,y);
      if(!t || !t.tree) continue;
      let near = false;
      for(let dy=-radius; dy<=radius && !near; dy++)
        for(let dx=-radius; dx<=radius; dx++){
          const a = getTile(G, x+dx, y+dy);
          if(a && a.zone>0){ near = true; break; }
        }
      if(near){ t.tree = 0; G.terrainDirty = true; }
    }
}

export function cornerHeightAt(G, x, y){
  const t = getTile(G,x,y);
  return t ? t.h : 0;
}
