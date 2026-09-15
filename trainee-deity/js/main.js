// 实习神明 · 主循环
import { TILE, MIRACLES, WONDERS, ERAS, AUTO, TOOLS, MILESTONES, ZONES,
  powerMaxOf, powerRegenOf, faithCapOf, sampleSun } from './config.js';
import { createState, housingCap, faithMult, serializeState, serializeStateAsync, deserializeState,
  refreshBuiltCache, invalidateBuiltCache, getTile, eachTile } from './state.js';
import { genWorld, applyTool, findAutoSite, placeDistrict, placeIndustryBatch, clearTreesNearZones, ensureChunkRing,
  canPlaceZoneManual } from './terrain.js';
import * as F from './formulas.js';
import { Renderer } from './render.js';
import { UI } from './ui.js';
import * as Auth from './auth.js';
import * as Saves from './saves.js';
import { logPush, logZonePlaced, logList } from './log.js';

const qSeed = parseInt(new URLSearchParams(location.search).get('seed')||'', 10);
const G = createState(Number.isFinite(qSeed) ? qSeed : undefined);
let R, ui;
let last = performance.now();
let uiAcc = 0;
let entitySyncAcc = 0;
let skyAcc = 0;
let paintRebuildAcc = 0;
let saveDialogMode = 'load';
let userKey = null;

function ensureBuiltCache(){
  if(!G._builtCache || !G._builtCache.valid) refreshBuiltCache(G);
  return G._builtCache;
}

function boot(){
  const canvas = document.getElementById('gameCanvas');
  try {
    R = new Renderer(canvas);
  } catch(err){
    console.error('WebGL 初始化失败:', err);
    document.getElementById('loader').classList.add('hidden');
    const notice = document.createElement('div');
    notice.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;background:#0d1117;color:#e0aa66;z-index:70;text-align:center;padding:24px;';
    notice.innerHTML = '<div style="font-size:20px;letter-spacing:3px;">当前环境不支持 WebGL</div><div style="color:#9aa0a6;font-size:13px;max-width:420px;line-height:1.7;">请在支持 WebGL 的浏览器中打开本页面。</div>';
    document.body.appendChild(notice);
    return;
  }
  ui = new UI(G, {
    onTool:(t)=>{
      if(t === 'view_home'){ R.viewHome(G); return; }
      if(t === 'view_top'){ R.viewTop(G); return; }
      // 方案 A：视角旋转 / 移动视角 — 再点一次关闭
      if(t === 'cam_rot' || t === 'cam_pan'){
        const already = G.tool === t;
        if(already){
          G.tool = G._lastPaintTool || 'raise';
          setCamMode('none');
          ui?.syncToolActive?.(G.tool);
        } else {
          if(G.tool !== 'cam_rot' && G.tool !== 'cam_pan') G._lastPaintTool = G.tool;
          G.tool = t;
          G.placingWonder = false;
          G.painting = false;
          setCamMode(t === 'cam_rot' ? 'rotate' : 'pan');
          ui?.syncToolActive?.(t);
        }
        updateCursor();
        refreshHover();
        return;
      }
      if(G.tool === 'cam_rot' || G.tool === 'cam_pan') G._lastPaintTool = t;
      setCamMode('none');
      G.tool = t; G.placingWonder=false; G.painting=false;
      updateCursor();
      refreshHover();
    },
    onSpeed:(s)=>{ G.speed = s; },
    onMiracle:(k)=>castMiracle(k),
    onWonder:()=>startWonderPlacement(),
    onAdvance:()=>advanceEra(),
    onStart:()=>startGame(),
    onRestart:()=>location.reload(),
    onNewWorld:()=>{ location.href = location.pathname + '?seed=' + ((Math.random()*1e9)|0); },
    onAuth:()=>doAuth(),
    onNewGame:()=>newGame(),
    onLogout:()=>doLogout(),
    onPause:()=>openPause(),
    onResume:()=>closePause(),
    onToMenu:()=>toMenu(),
    onOpenSaves:(m)=>openSaveDialog(m),
    onCloseSaves:()=>{
      ui.hideAllScreens();
      if(G.started && !G.over) { /* 仍在游戏中 */ }
      else ui.showScreen('menu');
    },
    onQuickSave:()=>quickSave(),
    onQuickLoad:()=>quickLoad(),
    onExportSave:(slot)=>{
      const json = Saves.exportSaveJson(userKey, slot || 'quick');
      if(!json){ toast('该槽位为空'); return null; }
      toast('已导出存档文件');
      return json;
    },
    onImportSave:(json, slot)=>{
      if(!userKey){ toast('请先登录'); return false; }
      const ok = Saves.importSaveJson(userKey, slot || 'quick', json);
      toast(ok ? '导入成功，可读取该槽位' : '导入失败');
      return ok;
    },
    onToast:(m)=>toast(m),
    onToggleLog:()=>toggleLog(),
    onCanvasDown:(px,py,b)=>handleDown(px,py,b),
    onCanvasMove:(px,py)=>handleMove(px,py),
    onCanvasUp:()=>{ G.painting=false; G.panning=false; },
  });
  genWorld(G);
  R.buildTerrain(G);
  R.buildWater(G);
  R.syncWorld(G);
  R.updateDayLight(G.dayTime, G.era);
  document.getElementById('loader').classList.add('hidden');
  window.addEventListener('resize', ()=>R.resize());
  window.addEventListener('keydown', (e)=>{
    if(e.key === 'Escape'){
      if(!document.getElementById('saveDialog')?.classList.contains('hidden')) ui.showScreen(G.started?'pause':'menu');
      else if(G.started && !G.paused) openPause();
      else if(G.paused) closePause();
    }
  });
  // 入口：已登录 → 新局则直接「开始试炼」，否则主菜单；未登录 → 登录框
  const sess = Auth.getUser();
  const wantNew = sessionStorage.getItem('td_boot') === 'new';
  sessionStorage.removeItem('td_boot');
  if(sess?.key){
    userKey = sess.key;
    G.userKey = sess.key;
    ui.setMenuUser(sess.username);
    // 强制先全隐藏，再显示目标层（避免登录框残留）
    ui.hideAllScreens();
    if(wantNew) ui.showScreen('start');
    else ui.showScreen('menu');
  } else {
    ui.hideAllScreens();
    ui.showScreen('auth');
  }
  G.onZonePlaced = (x, y, z)=>{
    logZonePlaced(G, z, x, y);
    invalidateBuiltCache(G);
    refreshBuiltCache(G);
    R.syncWorld(G);
    updateUI();
  };
  G.onZoneRemoved = (x, y, z)=>{
    // 拆除日志已在 terrain 写 code 90，这里只同步视图
    invalidateBuiltCache(G);
    refreshBuiltCache(G);
    R.syncWorld(G);
    syncNpc();
    updateUI();
  };
  // R6：点击/拖动命中粒子（节流，避免掉帧）
  let _hitAcc = 0;
  G.onToolHit = (x, y, toolKey)=>{
    const now = performance.now();
    if(now - _hitAcc < 80) return;
    _hitAcc = now;
    const col = toolKey === 'demolish' ? 0x9e9e9e
      : toolKey === 'tree' ? 0x8bc34a
      : toolKey === 'water' ? 0x4fc3f7
      : 0xffe082;
    R.spawnBurst(x * TILE, y * TILE, col, 5);
  };
  updateCursor();
  requestAnimationFrame(loop);
}

async function doAuth(){
  const mode = ui.authMode();
  const { user, pw } = ui.authValues();
  try{
    const name = mode==='register' ? await Auth.register(user, pw) : await Auth.login(user, pw);
    const sess = Auth.getUser();
    userKey = sess.key;
    G.userKey = sess.key;
    ui.setAuthMsg('', true);
    ui.setMenuUser(name);
    ui.showScreen('menu');
    toast(mode==='register' ? '注册成功' : '登录成功');
  }catch(e){
    ui.setAuthMsg(e.message || '失败');
  }
}

function doLogout(){
  Auth.logout();
  userKey = null;
  G.userKey = null;
  G.started = false;
  G.paused = false;
  ui.setMenuUser(null);
  ui.showScreen('auth');
  ['topBar','toolBar','miracleBar','advanceBar','speedCtrl','autoBar','logPanel'].forEach(id=>{
    document.getElementById(id)?.classList.add('hidden');
  });
}

function newGame(){
  if(!userKey){ toast('请先登录'); ui.showScreen('auth'); return; }
  sessionStorage.setItem('td_boot', 'new');
  location.href = location.pathname + '?seed=' + ((Math.random()*1e9)|0);
}

function openPause(){
  if(!G.started) return;
  G.paused = true;
  G.painting = false;
  updateCursor();
  ui.showScreen('pause');
}

function closePause(){
  G.paused = false;
  updateCursor();
  ui.hideAllScreens();
}

function toMenu(){
  G.started = false;
  G.paused = false;
  ['topBar','toolBar','miracleBar','advanceBar','speedCtrl','autoBar'].forEach(id=>{
    document.getElementById(id)?.classList.add('hidden');
  });
  ui.closeLog();
  ui.setMenuUser(Auth.getUsername());
  ui.showScreen('menu');
}

let _saving = false;

/** 方案 A：none | rotate | pan */
function setCamMode(mode){
  R?.setCamMode?.(mode);
}

/** #2 存档卡死：异步分块写档 + 阶段进度提示；失败给出可见错误 */
async function doSave(slot){
  if(!userKey){ toast('请先登录'); return; }
  if(_saving){ toast('正在保存，请稍候'); return; }
  _saving = true;
  toast('保存中… 0%');
  try{
    const meta = await Saves.writeSaveAsync(
      userKey, slot,
      (logCap, yieldFn, onProgress)=>serializeStateAsync(G, yieldFn, onProgress, logCap),
      {},
      { onProgress: p=>toast(`保存中… ${p.pct}%`) },
    );
    if(meta){
      logPush(G, 80, 0, 0);
      const s = meta._stats;
      const trim = s.trimTry > 0 ? ` · 日志裁剪至${s.logs}条` : '';
      toast(`已保存 · ${s.totalMs}ms · ${s.kb}KB${trim}`);
    } else {
      // 序列化/配额全失败：必须让玩家看见，否则会以为存上了
      toast('保存失败：存储空间不足，请删除旧存档或导出后清理浏览器数据');
    }
  }catch(e){
    console.error('[save] doSave failed', e);
    toast('保存失败');
  }finally{
    _saving = false;
  }
}

function doLoad(slot){
  if(!userKey){ toast('请先登录'); return; }
  const t0 = performance.now();
  const body = Saves.readSave(userKey, slot);
  if(!body){ toast('该槽位为空'); return; }
  if(!deserializeState(G, body)){ toast('存档损坏'); return; }
  const tLoad = performance.now();
  invalidateBuiltCache(G);
  R.applyEraVisuals(G);
  R.buildTerrain(G);
  R.buildWater(G);
  R.syncWorld(G);
  refreshBuiltCache(G);
  logPush(G, 50, 0, 0);
  G.started = true;
  G.paused = false;
  document.getElementById('startScreen')?.classList.add('hidden');
  ['topBar','toolBar','miracleBar','advanceBar','speedCtrl','autoBar'].forEach(id=>{
    document.getElementById(id)?.classList.remove('hidden');
  });
  syncNpc();
  ui.hideAllScreens();
  updateUI();
  updateCursor();
  console.info('[load]', slot, { ms: +(tLoad - t0).toFixed(1), chunks: G.chunks.size });
  toast('已读取存档');
}

function quickSave(){
  if(!G.started){ toast('尚未开始游戏'); return; }
  doSave('quick');
}
function quickLoad(){
  doLoad('quick');
}

function openSaveDialog(mode){
  if(!userKey){ toast('请先登录'); return; }
  saveDialogMode = mode;
  const act = (slot)=>{
    if(mode==='save'){
      doSave(slot);
      ui.renderSaveSlots(Saves.listSaves(userKey), 'save', act);
    } else {
      doLoad(slot);
    }
  };
  ui.renderSaveSlots(Saves.listSaves(userKey), mode, act);
  ui.showScreen('save');
}

function toggleLog(){
  const p = document.getElementById('logPanel');
  if(!p) return;
  if(p.classList.contains('hidden')){
    ui.openLog(logList(G.logs, 200));
  } else ui.closeLog();
}

function startGame(){
  G.started = true;
  G.paused = false;
  G.autoAcc = Math.max(0, AUTO.interval - 8);
  // 关掉所有全屏层（含登录/菜单/开始）
  ui.hideAllScreens();
  ['topBar','toolBar','miracleBar','advanceBar','speedCtrl','autoBar'].forEach(id=>{
    document.getElementById(id)?.classList.remove('hidden');
  });
  logPush(G, 60, 0, 0);
  syncNpc();
  ui.refresh();
  updateCursor();
  toast(`试炼开始 · 种子 ${G.seed}。`);
  // R10 首局引导
  if(!localStorage.getItem('td_tutorial')){
    setTimeout(()=>toast('① 用「居住」划一块地'), 900);
    setTimeout(()=>toast('② 子民会自动建田/工业/教堂'), 3200);
    setTimeout(()=>toast('③ 底部进阶条看条件，满足后可进阶'), 5600);
    localStorage.setItem('td_tutorial', '1');
  }
}

// R8：周期自动保存 + 离开前保存
let _autosaveAcc = 0;
let _autosaveWarned = false;
let _autosaveBusy = false;
const AUTOSAVE_SEC = 180;
// #2 存档卡死：自动存档改走异步分块路径，不再在 tick 里同步 stringify/setItem 卡帧
function tryAutosave(dt){
  if(!G.started || G.over || !userKey) return;
  if(_autosaveBusy || _saving) return;
  _autosaveAcc += dt;
  if(_autosaveAcc < AUTOSAVE_SEC) return;
  _autosaveAcc = 0;
  _autosaveBusy = true;
  // 写档失败返回 null，必须检查：静默失败会让玩家以为一直在自动存档
  Saves.writeSaveAsync(
    userKey, 'quick',
    (logCap, yieldFn, onProgress)=>serializeStateAsync(G, yieldFn, onProgress, logCap),
    {},
  ).then(meta=>{
    if(meta) return;
    console.warn('[autosave] quick FAILED (quota / serialize)');
    if(!_autosaveWarned){
      _autosaveWarned = true;
      toast('自动存档失败，请手动保存或导出存档');
    }
  }).catch(e=>{
    console.warn('[autosave] failed', e);
  }).finally(()=>{
    _autosaveBusy = false;
  });
}

function loop(now){
  requestAnimationFrame(loop);
  const rawDt = (now - last)/1000;
  let dt = rawDt;
  last = now;
  dt = Math.max(0, Math.min(0.05, dt));
  const gdt = dt * G.speed;

  if(G.started && !G.over && !G.paused){
    const camTool = G.tool === 'cam_rot' || G.tool === 'cam_pan';
    if(G.painting && G.hover && !camTool){
      applyTool(G, G.hover[0], G.hover[1], gdt);
    }
    tick(gdt);
    tryAutosave(dt);
    uiAcc += dt;
    if(uiAcc > 0.12){ updateUI(); uiAcc = 0; }
  }

  G.dayTime = (G.dayTime + dt / G.dayLength) % 1;
  skyAcc += dt;
  if(skyAcc > 0.5){
    skyAcc = 0;
    R._buildSkyTexture(G.era, G.dayTime);
  }
  R.updateDayLight(G.dayTime, G.era);
  R.updateClouds(G.time, sampleSun(G.dayTime).day);

  if(G.painting && (G.terrainDirty || R.terrainDirty)){
    paintRebuildAcc += dt;
    entitySyncAcc += dt;
    if(paintRebuildAcc >= 0.1){
      paintRebuildAcc = 0;
      R.buildTerrain(G);
      G.terrainDirty = false;
      R.terrainDirty = false;
      if(entitySyncAcc > 0.2){
        R.syncWorld(G);
        entitySyncAcc = 0;
      }
    }
  } else if(R.terrainDirty || G.terrainDirty){
    paintRebuildAcc = 0;
    R.buildTerrain(G);
    G.terrainDirty = false;
    R.terrainDirty = false;
    R.syncWorld(G);
    entitySyncAcc = 0;
  }
  R.updateCameraKeys?.(dt);
  R.updateWater(G.time);
  R.updateParticles(dt);
  R.updateNpcs(dt, G);
  R.render();
  perfTick(rawDt);
  if(!G.paused) G.time += dt;
}

// ---- 性能读数（仅 ?debug=1 开启，同时写入 window.__perf 供外部探针读取）----
const PERF_ON = /[?&]debug=1/.test(location.search);
let perfAcc = 0, perfFrames = 0, perfMaxMs = 0, perfEl = null;
function perfTick(rawDt){
  if(!PERF_ON) return;
  perfAcc += rawDt; perfFrames++;
  const ms = rawDt * 1000;
  if(ms > perfMaxMs) perfMaxMs = ms;
  if(perfAcc < 0.5) return;
  const fps = perfFrames / perfAcc;
  const frameMs = perfAcc / perfFrames * 1000;
  const info = R.renderer.info.render;
  if(!perfEl) perfEl = document.getElementById('perfHud');
  if(perfEl){
    perfEl.classList.remove('hidden');
    perfEl.textContent =
      `FPS ${fps.toFixed(0)}   帧 ${frameMs.toFixed(1)}ms   峰值 ${perfMaxMs.toFixed(1)}ms\n` +
      `DrawCall ${info.calls}   三角面 ${info.triangles}`;
  }
  window.__perf = { fps:Math.round(fps), frameMs:+frameMs.toFixed(2), maxMs:+perfMaxMs.toFixed(1), drawCalls:info.calls, triangles:info.triangles };
  perfAcc = 0; perfFrames = 0; perfMaxMs = 0;
}

function tick(dt){
  if(G.boostGrow>0)  G.boostGrow  = Math.max(0, G.boostGrow-dt);
  if(G.boostBuild>0) G.boostBuild= Math.max(0, G.boostBuild-dt);
  if(G.boostRain>0)  G.boostRain = Math.max(0, G.boostRain-dt);

  const E = F.eraIndex(G);
  ensureBuiltCache();
  // R8 产出口径：粮/产/信仰按「已建成」计（与 UI 一致）；住房亦按已建成
  const zc = G._zoneCache || {1:0,2:0,3:0,4:0};
  const bc = G._builtCache || {1:0,2:0,3:0,4:0};
  const farms = bc[2]||0, inds = bc[3]||0, churches = bc[4]||0;
  const houses = bc[1]||0;

  G.autoAcc += dt;
  if(G.autoAcc >= AUTO.interval){
    G.autoAcc = 0;
    autoBuild();
  }

  // 待建数：划定 − 建成
  const zSum = (zc[1]||0)+(zc[2]||0)+(zc[3]||0)+(zc[4]||0);
  const bSum = (bc[1]||0)+(bc[2]||0)+(bc[3]||0)+(bc[4]||0);
  let pending = Math.max(0, zSum - bSum);
  G._pendingBuild = pending;
  let vBuild = F.buildSpeed(E, inds, pending);
  if(G.boostBuild>0) vBuild *= 3;

  // R11：仅推进 pending 列表，避免每帧全图 eachTile
  if(!G._pendingValid || !G._pendingTiles){
    const list = [];
    eachTile(G, (t,x,y)=>{ if(t.zone>0 && !t.built) list.push({x,y}); });
    G._pendingTiles = list;
    G._pendingValid = true;
  }
  let buildChanged = false;
  const still = [];
  for(const p of G._pendingTiles){
    const t = getTile(G, p.x, p.y);
    if(!t || t.zone<=0 || t.built) continue;
    t.prog += vBuild * dt;
    if(t.prog >= 1){
      t.prog = 1; t.built = true;
      const col = t.zone===1?0xffb74d : t.zone===2?0x8bc34a : t.zone===3?0x78909c : 0xb39ddb;
      R.spawnBurst(p.x*TILE, p.y*TILE, col, 8);
      buildChanged = true;
      ensureChunkRing(G, p.x, p.y);
      clearTreesNearZones(G, 1, p.x, p.y, 2);
      invalidateBuiltCache(G);
      G._pendingValid = false;
    } else {
      still.push(p);
    }
  }
  // #25 性能：still 已是权威待建列表（已剔除刚建成者），
  // 无需再依赖 _pendingValid=false 在下一帧全图重建；
  // 真正新增划定（autoBuild / 手动放置）会各自 invalidate，届时重建即可。
  G._pendingTiles = still;
  G._pendingValid = true;
  if(buildChanged){
    refreshBuiltCache(G);
    R.syncWorld(G);
    syncNpc();
  } else {
    G._buildSyncAcc = (G._buildSyncAcc || 0) + dt;
    if(G._buildSyncAcc >= 0.5){
      G._buildSyncAcc = 0;
      if(pending > 0) R.syncWorld(G);
    }
  }

  let wonderChanged = false;
  for(const w of G.wonderList){
    if(!w.done){
      w.prog += dt / WONDERS[w.era].time * (G.boostBuild>0?2:1);
      if(w.prog>=1){
        w.prog=1; w.done=true; G.wonders[w.era]=true;
        R.spawnBurst(w.x*TILE, w.y*TILE, 0xffd54f, 40);
        toast(`${WONDERS[w.era].name}建成！${WONDERS[w.era].bonus}`);
        wonderChanged = true;
        checkFinalWin();
      }
    }
  }
  if(wonderChanged) R.syncWorld(G);

  const nightBonus = (G.dayTime < 0.22 || G.dayTime > 0.78) ? 1.15 : 1.0;
  G.faithRate = F.faithPerSec(churches, G.pop, G.era) * faithMult(G) * nightBonus;
  const faithGain = G.faithRate * dt;
  G.faith += faithGain; G.totalFaith += faithGain;
  // R4：信仰禁止为负
  if(G.faith < 0) G.faith = 0;
  // 信仰库存上限：避免跨时代无限囤积（否则奇迹瞬间建成、信仰经济失效）
  const faithCap = faithCapOf(G.era);
  if(G.faith > faithCap) G.faith = faithCap;

  const regen = powerRegenOf(G.faithRate);
  G.power = Math.min(powerMaxOf(G.era), G.power + regen*dt);

  const cap = F.popCap(E, houses, farms, inds);
  let nextPop = F.growPop(G.pop, cap, E, farms, dt);
  if(G.boostGrow>0) nextPop = Math.min(cap, G.pop + (nextPop-G.pop)*2 + 0.6*dt);
  G.pop = Math.max(1, nextPop);

  // R5：星星只由里程碑触发，删除 faithRate 时间累积
  checkStarMilestones(E, farms, inds, churches, houses);

  if(G.boostRain>0 && Math.random()<dt*14) R.spawnRain(0, 0);
}

/** 每时代 3 个里程碑；完成 +1 星（位图防重复） */
function checkStarMilestones(E, farms, inds, churches, houses){
  if(!G.starMilestones) G.starMilestones = [[],[],[],[],[]];
  while(G.starMilestones.length < 5) G.starMilestones.push([false,false,false]);
  const flags = G.starMilestones[E] || (G.starMilestones[E] = [false,false,false]);
  const list = MILESTONES[E] || [];
  const ctx = { farms, inds, churches, houses };
  for(let i=0;i<list.length;i++){
    if(flags[i]) continue;
    if(list[i].check(G, ctx)){
      flags[i] = true;
      G.stars += 1;
      toast(`里程碑达成：${list[i].label} ⭐`);
      logPush(G, 40, 0, 0);
    }
  }
}

/** 当前时代里程碑文本（UI） */
export function milestoneSummary(G, farms, inds, churches){
  const E = F.eraIndex(G);
  const list = MILESTONES[E] || [];
  const flags = G.starMilestones?.[E] || [];
  const ctx = { farms, inds, churches, houses: 0 };
  return list.map((m,i)=>{
    const done = !!flags[i];
    const ok = done || m.check(G, ctx);
    return `${ok?'✓':'○'} ${m.label}`;
  }).join(' · ');
}

const ZONE_COLORS = {
  1: ZONES[1].color, 2: ZONES[2].color,
  3: ZONES[3].color, 4: ZONES[4].color,
};

// ---- 自动建造：粮/产能有余建房，教堂跟上公式目标 ----
function autoBuild(){
  const E = F.eraIndex(G);
  // #25 性能：划定数直接取缓存（refreshBuiltCache 同趟产出 _zoneCache），不再全图扫
  ensureBuiltCache();
  const zcA = G._zoneCache || {1:0,2:0,3:0,4:0};
  const cnt = {1: zcA[1]||0, 2: zcA[2]||0, 3: zcA[3]||0, 4: zcA[4]||0 };

  // 公式目标（low = 刚需）
  const need = {};
  for(const z of [1,2,3,4]){
    const lo = F.buildingLow(E, z);
    const hi = F.buildingHigh(E, z);
    need[z] = cnt[z] < lo ? lo : Math.min(hi, cnt[z] + 2);
  }

  // R-review：供需与 tick 一致，按「已建成」计
  const bcA = G._builtCache || {1:0,2:0,3:0,4:0};
  const farmsBuilt = bcA[2]||0, indsBuilt = bcA[3]||0;
  const foodOut = F.foodPerSec(farmsBuilt);
  const foodNeed = F.foodNeed(G.pop);
  const indOut = F.industryPerSec(indsBuilt);
  // #25 性能：待建 = 划定 − 建成（与 tick 的 zSum−bSum 同口径），不再全图扫
  const zSumA = (cnt[1]||0)+(cnt[2]||0)+(cnt[3]||0)+(cnt[4]||0);
  const bSumA = (bcA[1]||0)+(bcA[2]||0)+(bcA[3]||0)+(bcA[4]||0);
  const pending = Math.max(0, zSumA - bSumA);
  const buildDemand = pending * F.NUM.C0 * Math.pow(1.5, E);

  // 粮食有余：能养活当前人口，且再养 4 人（一栋房）仍够
  const foodOk = foodOut >= foodNeed * 1.05 && foodOut >= (G.pop + 4) * F.NUM.R_FOOD;
  // 产能有余：建造需求可控，且已有基本工业底子
  const indBase = F.industryPerSec(Math.max(1, F.buildingLow(E, 3) * 0.2));
  const indOk = indOut >= Math.max(indBase, buildDemand * 1.05);

  const hc = housingCap(G);
  const popPress = hc>0 && G.pop/hc > AUTO.housingPressure;
  const houseShort = cnt[1] < need[1] || popPress || hc <= 0;

  let placed = 0;
  const thisTick = new Set();
  const names = {1:'房屋',2:'农田',3:'工业区',4:'教堂'};

  const tryPlaceIndustry = ()=>{
    if(placed >= AUTO.maxPerTick) return false;
    // 无居住区时不狂刷工业（placeIndustryBatch 亦要求 resList 非空）
    if(G.pop < 15) return false;
    const res = placeIndustryBatch(G, AUTO.industryPerTick);
    if(!res || res.n <= 0) return false;
    placed++;
    cnt[3] += res.n;
    logZonePlaced(G, 3, res.x, res.y);
    G.autoLog.unshift(`子民在郊外建起工业区（${res.n}格 @${res.x},${res.y}）`);
    if(G.autoLog.length>6) G.autoLog.pop();
    toast(`子民在郊外建起工业区（${res.n}格）`);
    return true;
  };

  const tryPlace = (zone)=>{
    if(placed >= AUTO.maxPerTick) return false;
    // 工业只走 placeIndustryBatch，禁止 findAutoSite(zone=3)
    if(zone === 3) return tryPlaceIndustry();
    const site = findAutoSite(G, zone);
    if(!site) return false;
    const key = `${site[0]},${site[1]}`;
    if(thisTick.has(key)) return false;
    const n = placeDistrict(G, site[0], site[1], zone, 1);
    if(!n) return false;
    thisTick.add(key);
    placed++;
    cnt[zone] += n;
    logZonePlaced(G, zone, site[0], site[1]);
    G.autoLog.unshift(`子民建起一座${names[zone]}`);
    if(G.autoLog.length>6) G.autoLog.pop();
    toast(`子民建起一座${names[zone]}`);
    R.spawnBurst(site[0]*TILE, site[1]*TILE, ZONE_COLORS[zone], 6);
    return true;
  };

  // 优先级：
  // 1) 粮不够 → 田
  // 2) 产能不够 → 工
  // 3) 粮+产有余且住房缺口 → 房
  // 4) 教堂缺口（按公式 low，不只看信仰压力）
  // 缺口：公式目标用 zoned（还要继续建），实际供不应求用 built
  const farmShort = cnt[2] < need[2] || foodOut < foodNeed;
  const indShort = cnt[3] < need[3] || indOut < buildDemand;
  const churchShort = cnt[4] < need[4] || (!G.faithRate || G.faithRate < AUTO.faithPressure);

  // 房屋要求「8 邻域全空」（见 canPlaceZoneAt），农田/工业会先占掉这类空格；
  // 人口已被住房卡满时若仍先放农田/工业，房屋就再也找不到点位 → 人口永久停滞。
  // 更严重的是「一栋房都没有」时必须置顶且不看产能条件：
  // E1–2 人口上限 = 住房×C_HOUSE，无住房 → popCap=0 → 人口从开局 20 迅速衰减到 1；
  // 而 tryPlaceIndustry 在 pop<15 时直接放弃 → 无工业 → indOk 恒假 → 永远建不出第一栋房，
  // 形成死锁（实测：人口卡在 1，农田却一路建到 40+ 格、粮产 45/s）。
  const housingCritical = houseShort && (hc <= 0 || G.pop >= hc - 0.5);

  if(housingCritical) tryPlace(1);
  if(farmShort) tryPlace(2);
  if(indShort) tryPlaceIndustry();
  if(!housingCritical && foodOk && indOk && houseShort) tryPlace(1);
  if(churchShort) tryPlace(4);

  // 若本轮啥也没建成且住房仍缺，再补一轮房（放宽资源门槛）
  if(placed===0 && houseShort){
    if(cnt[2] > 0 || foodOut > 0) tryPlace(1);
  }

  if(placed){
    invalidateBuiltCache(G);
    refreshBuiltCache(G);
    R.syncWorld(G);
    updateUI();
  }
}

function castMiracle(key){
  const m = MIRACLES[key];
  if(!m) return;
  if(G.power < m.cost){ toast('神力不足'); return; }
  G.power -= m.cost;
  G[m.field] = m.dur;
  const code = key==='grow'?10 : key==='build'?11 : 12;
  logPush(G, code, 0, 0);
  const col = key==='grow'?0x66bb6a : key==='build'?0xffd54f : 0x64b5f6;
  for(let i=0;i<3;i++){
    R.spawnBurst((Math.random()-0.5)*8, (Math.random()-0.5)*8, col, 18);
  }
  if(key==='build'){
    // 只推 pending，避免全图 eachTile
    if(!G._pendingValid || !G._pendingTiles){
      const list = [];
      eachTile(G, (t,x,y)=>{ if(t.zone>0 && !t.built) list.push({x,y}); });
      G._pendingTiles = list;
      G._pendingValid = true;
    }
    for(const p of G._pendingTiles){
      const t = getTile(G, p.x, p.y);
      if(t && t.zone>0 && !t.built) t.prog = Math.min(1, t.prog+0.35);
    }
    for(const w of G.wonderList){ if(!w.done) w.prog = Math.min(1, w.prog+0.12); }
    R.syncWorld(G);
  }
  toast(`${m.label}！持续${m.dur}秒`);
}

function startWonderPlacement(){
  const era = G.era;
  const w = WONDERS[era];
  if(G.wonderList.some(x=>!x.done)){ toast('已有奇迹在建'); return; }
  if(G.wonders[era]){ toast('本时代奇迹已建成'); return; }
  if(G.faith < w.faithCost){ toast(`信仰不足，需 ${w.faithCost}`); return; }
  G.placingWonder = true;
  ui.setWonderPlacing(true);
  updateCursor();
  refreshHover();
  toast(`选择地块放置「${w.name}」（消耗信仰 ${w.faithCost}）`);
}

function placeWonder(x, y){
  const era = G.era;
  const w = WONDERS[era];
  const t = getTile(G, x, y);
  if(!t){ toast('这里还不能放置奇迹'); return; }
  if(t.water){ toast('不能在水面放置奇迹'); return; }
  if(t.zone > 0){ toast('该地块已有分区'); return; }
  if(t.h < 1.0 || t.h > 5.5){ toast('地形不适合放置奇迹'); return; }
  if(G.faith < w.faithCost){ toast(`信仰不足，需 ${w.faithCost}`); return; }
  G.faith = Math.max(0, G.faith - w.faithCost);
  G.wonderList.push({ era, x, y, prog:0, done:false });
  G.placingWonder = false;
  ui.setWonderPlacing(false);
  updateCursor();
  refreshHover();
  R.syncWorld(G);
  toast(`开始建造「${w.name}」`);
}

function eraReady(){
  // R5：E1 无需奇迹；E2–E5 需本时代奇迹；E5 已是终点（通关看太空电梯）
  // P3：另需产能/秒 ≥ GATE(E)
  if(G.era >= 4) return false;
  const needWonder = G.era >= 1;
  const wonderOk = !needWonder || !!G.wonders[G.era];
  if(G.pop < ERAS[G.era].popGoal) return false;
  if(!wonderOk) return false;
  if(G.stars < ERAS[G.era].starCost) return false;
  ensureBuiltCache();
  const indN = (G._builtCache && G._builtCache[3]) || 0;
  return F.industryPerSec(indN) >= F.gateOf(G.era);
}
function advanceEra(){
  if(!eraReady()){ toast('进阶条件未满足'); return; }
  G.stars = Math.max(0, G.stars - ERAS[G.era].starCost);
  G.era += 1;
  G.starProg = 0;
  G.terrainDirty = true;
  R.applyEraVisuals(G);
  R.syncWorld(G);
  syncNpc();
  for(let i=0;i<5;i++){
    R.spawnBurst((Math.random()-0.5)*10, (Math.random()-0.5)*10, 0xffd54f, 30);
  }
  toast(`迈入「${ERAS[G.era].name}」！`);
  logPush(G, 30, 0, 0);
  // R5：不再强制 over；仅 E5 太空电梯通关
}

/** E5 太空电梯完工 → 通关 */
function checkFinalWin(){
  if(G.over) return;
  if(G.era >= 4 && G.wonders[4]){
    G.over = true;
    const win = document.getElementById('winScreen');
    if(win){
      const sub = win.querySelector('.subtitle');
      if(sub) sub.textContent = '文明迈入 · 星际时代';
      const desc = win.querySelector('.desc');
      if(desc) desc.textContent = '太空电梯建成，试炼完成。你的子民已仰望群星。';
      win.classList.remove('hidden');
    }
  }
}

function syncNpc(){
  // numeric-design §7：N_render = clamp(round(50*log10(N)-85), min(E), max(E))
  const n = F.renderVillagers(G.pop, F.eraIndex(G));
  R.markNpcHomesDirty?.();
  R.setNpcCount(n, G);
}

function screenToTile(px, py){
  return R.screenToTile(px, py);
}

function handleDown(px, py, button){
  if(!G.started || G.paused) return;
  // 中键(1) / 右键(2)：只转镜头，不施法
  if(button === 1 || button === 2 || G.panning){ G.panning = true; return; }
  const cell = screenToTile(px, py);
  if(!cell) return;
  if(G.placingWonder){ placeWonder(cell[0], cell[1]); return; }
  G.hover = cell;
  G.painting = true;
  // 单击立刻放一格；拖动由 loop 连续 applyTool
  applyTool(G, cell[0], cell[1], 0.05);
}

// #24：光标随工具切换（笔刷 / 拆除 / 镜头）
function updateCursor(){
  const b = document.body;
  if(!b) return;
  const t = G.tool;
  const cam = G.paused || t === 'cam_rot' || t === 'cam_pan';
  const cls = cam ? 'cur-cam' : (t === 'demolish' ? 'cur-demolish' : 'cur-paint');
  if(b.classList.contains(cls)) return;
  b.classList.remove('cur-paint','cur-cam','cur-demolish');
  b.classList.add(cls);
}

// #24：当前悬停格的合法性 → 悬停环配色
function hoverStyle(x, y){
  const t = getTile(G, x, y);
  if(!t) return 'none';
  if(G.placingWonder){
    if(t.water || t.zone > 0 || t.h < 1.0 || t.h > 5.5) return 'bad';
    return 'ok';
  }
  const tool = TOOLS[G.tool];
  if(!tool) return 'none';
  if(tool.kind === 'demolish') return (!t.water && t.zone > 0) ? 'demolish' : 'bad';
  if(tool.kind === 'zone') return canPlaceZoneManual(G, x, y, tool.zone) ? 'ok' : 'bad';
  switch(G.tool){
    case 'raise':
    case 'lower':
    case 'flatten': return 'ok';
    case 'water': return (!t.water && t.h < 2.8) ? 'ok' : 'bad';
    case 'tree': return (!t.water && t.h > 0.9 && t.h < 6.2) ? 'ok' : 'bad';
    default: return 'ok';
  }
}

function handleMove(px, py){
  if(!G.started) return;
  const cell = screenToTile(px, py);
  if(!cell){ R.setHover(null,G); return; }
  G.hover = cell;
  R.setHover(cell[0], cell[1], G, hoverStyle(cell[0], cell[1]));
}

// #24：工具/奇迹态切换后立即刷新悬停环配色，不必等下一次鼠标移动
function refreshHover(){
  if(!G.hover) return;
  R.setHover(G.hover[0], G.hover[1], G, hoverStyle(G.hover[0], G.hover[1]));
}

function updateUI(){
  if(!ui) return;
  ui.refresh();
  const ready = eraReady();
  const btn = document.getElementById('advanceBtn');
  btn.disabled = !ready;
  const E = F.eraIndex(G);
  const list = MILESTONES[E] || [];
  const flags = G.starMilestones?.[E] || [];
  const ms = list.map((m,i)=> (flags[i]?'✓':'○') + m.label.slice(0,6)).join(' ');
  const finalEra = G.era >= 4;
  const popOk = G.pop >= ERAS[G.era].popGoal;
  const wonderOk = G.era === 0 || !!G.wonders[G.era];
  const starOk = G.stars >= ERAS[G.era].starCost;
  const indN = G._builtCache?.valid ? (G._builtCache[3]||0) : 0;
  const gate = F.gateOf(E);
  const indOut = F.industryPerSec(indN);
  const gateOk = indOut >= gate;
  const wonder = G.era===0 ? '（进阶无需奇迹）' : (wonderOk?'奇迹✓':'奇迹✗');
  // 「门槛」与顶栏使用同一数值（GATE(E) = 0.5 × 刚需工业产能），同屏口径一致
  const gateTxt = `门槛 ${indOut.toFixed(0)}/${Math.ceil(gate)}/s`;
  // 未满足的条件必须写成可见文本：禁用按钮的 title 在部分浏览器不弹出悬停提示，
  // 只靠 title 会退回「无法点击又无理由」的死按钮。
  const miss = [];
  if(finalEra) miss.push('已是最终时代');
  else {
    if(!popOk) miss.push(`人口 ${Math.floor(G.pop)}/${ERAS[G.era].popGoal}`);
    if(!wonderOk) miss.push('本时代奇迹未建成');
    if(!starOk) miss.push(`星星 ${G.stars}/${ERAS[G.era].starCost}`);
    if(!gateOk) miss.push(`产能 ${indOut.toFixed(0)}/${Math.ceil(gate)}/s`);
  }
  document.getElementById('advReq').textContent =
    `人口 ${Math.floor(G.pop)}/${ERAS[G.era].popGoal} · ${wonder} · ⭐${G.stars}/${ERAS[G.era].starCost} · ${gateTxt} · ${ms}`
    + (miss.length ? ` ｜ 还差：${miss.join('、')}` : '');
  // 按钮文字随「下一时代」重算（原为 index.html 硬编码，进阶后仍写着「城邦时代」）
  btn.textContent = finalEra ? '已是最终时代' : `时代进阶 · ${ERAS[G.era + 1].name}`;
  btn.title = finalEra ? 'E5 无法再进阶：建成太空电梯即通关'
    : (ready ? '条件已满足，点击进入下一时代' : `进阶条件未满足 —— ${miss.join('、')}`);
}

let toastTimer;
function toast(msg){
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>el.classList.remove('show'), 2200);
}

window.addEventListener('contextmenu', e=>e.preventDefault());
// 离场/后台保存必须当场写完，无法 await ⇒ 保留同步 writeSave；
// 它会 bump 槽位序号，使在飞的异步写档自动放弃提交（最新者获胜）
window.addEventListener('beforeunload', ()=>{
  if(G.started && userKey && !G.over){
    try{ if(!Saves.writeSave(userKey, 'quick', ()=>serializeState(G), {})) console.warn('[save] 离场保存失败'); }
    catch(e){ console.warn('[save] 离场保存异常', e); }
  }
});
document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState === 'hidden' && G.started && userKey){
    try{ if(!Saves.writeSave(userKey, 'quick', ()=>serializeState(G), {})) console.warn('[save] 后台保存失败'); }
    catch(e){ console.warn('[save] 后台保存异常', e); }
  }
});
boot();
