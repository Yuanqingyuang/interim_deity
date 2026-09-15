// 实习神明 · 主循环
import { TILE, MIRACLES, WONDERS, ERAS, AUTO, TOOLS, MILESTONES, ZONES,
  powerMaxOf, powerRegenOf, sampleSun } from './config.js';
import { createState, housingCap, faithMult, serializeState, deserializeState,
  refreshBuiltCache, invalidateBuiltCache, getTile, eachTile } from './state.js';
import { genWorld, applyTool, findAutoSite, placeDistrict, placeIndustryBatch, clearTreesNearZones, ensureChunkRing } from './terrain.js';
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
      if(t === 'navigate'){
        G.tool = 'navigate';
        G.placingWonder = false;
        G.painting = false;
        setNavMode(true);
        return;
      }
      setNavMode(false);
      G.tool = t; G.placingWonder=false; G.painting=false;
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
  ui.showScreen('pause');
}

function closePause(){
  G.paused = false;
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

/** 导航工具：单指/左键旋转；否则施法 */
function setNavMode(on){
  if(!R?.controls) return;
  // 0=ROTATE 1=PAN 2=DOLLY_PAN — 用 THREE.MOUSE 数值：LEFT=0, MIDDLE=1, RIGHT=2
  if(on){
    R.controls.mouseButtons = { LEFT: 0, MIDDLE: 1, RIGHT: 2 };
    R.controls.touches = { ONE: 0, TWO: 2 };
  } else {
    R.controls.mouseButtons = { LEFT: null, MIDDLE: 1, RIGHT: 0 };
    R.controls.touches = { ONE: null, TWO: 2 };
  }
}

function doSave(slot){
  if(!userKey){ toast('请先登录'); return; }
  if(_saving){ toast('正在保存，请稍候'); return; }
  _saving = true;
  toast('保存中…');
  // 先让「保存中…」画出一帧，再跑同步 stringify/setItem，避免体感卡死
  requestAnimationFrame(()=>{
    try{
      const meta = Saves.writeSave(userKey, slot, ()=>serializeState(G), {});
      if(meta){
        logPush(G, 80, 0, 0);
        const s = meta._stats;
        toast(s
          ? `已保存 · ${s.totalMs}ms · ${s.kb}KB`
          : `已保存 · ${Saves.SLOT_LABEL[slot]}`);
      } else toast('保存失败');
    }catch(e){
      console.error('[save] doSave failed', e);
      toast('保存失败');
    }finally{
      _saving = false;
    }
  });
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
const AUTOSAVE_SEC = 180;
function tryAutosave(dt){
  if(!G.started || G.over || !userKey) return;
  _autosaveAcc += dt;
  if(_autosaveAcc >= AUTOSAVE_SEC){
    _autosaveAcc = 0;
    try{
      Saves.writeSave(userKey, 'quick', ()=>serializeState(G), {});
      console.info('[autosave] quick ok');
    }catch(e){ console.warn('[autosave] failed', e); }
  }
}

function loop(now){
  requestAnimationFrame(loop);
  let dt = (now - last)/1000;
  last = now;
  dt = Math.max(0, Math.min(0.05, dt));
  const gdt = dt * G.speed;

  if(G.started && !G.over && !G.paused){
    if(G.painting && G.hover && G.tool !== 'navigate'){
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
  R.updateWater(G.time);
  R.updateParticles(dt);
  R.updateNpcs(dt, G);
  R.render();
  if(!G.paused) G.time += dt;
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
  if(!buildChanged) G._pendingTiles = still;
  else G._pendingTiles = still;
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
  G.faithRate = F.faithPerSec(churches, G.pop) * faithMult(G) * nightBonus;
  const faithGain = G.faithRate * dt;
  G.faith += faithGain; G.totalFaith += faithGain;
  // R4：信仰禁止为负
  if(G.faith < 0) G.faith = 0;

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
  const cnt = {1:0,2:0,3:0,4:0};
  eachTile(G, (t)=>{ if(t.zone>0) cnt[t.zone]++; });

  // 公式目标（low = 刚需）
  const need = {};
  for(const z of [1,2,3,4]){
    const lo = F.buildingLow(E, z);
    const hi = F.buildingHigh(E, z);
    need[z] = cnt[z] < lo ? lo : Math.min(hi, cnt[z] + 2);
  }

  // R-review：供需与 tick 一致，按「已建成」计
  ensureBuiltCache();
  const bcA = G._builtCache || {1:0,2:0,3:0,4:0};
  const farmsBuilt = bcA[2]||0, indsBuilt = bcA[3]||0;
  const foodOut = F.foodPerSec(farmsBuilt);
  const foodNeed = F.foodNeed(G.pop);
  const indOut = F.industryPerSec(indsBuilt);
  let pending = 0;
  eachTile(G, (t)=>{ if(t.zone>0 && !t.built) pending++; });
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

  if(farmShort) tryPlace(2);
  if(indShort) tryPlaceIndustry();
  if(foodOk && indOk && houseShort) tryPlace(1);
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
  R.syncWorld(G);
  toast(`开始建造「${w.name}」`);
}

function eraReady(){
  // R5：E1 无需奇迹；E2–E5 需本时代奇迹；E5 已是终点（通关看太空电梯）
  if(G.era >= 4) return false;
  const needWonder = G.era >= 1;
  const wonderOk = !needWonder || !!G.wonders[G.era];
  return G.pop >= ERAS[G.era].popGoal && wonderOk && G.stars >= ERAS[G.era].starCost;
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

function handleMove(px, py){
  if(!G.started) return;
  const cell = screenToTile(px, py);
  if(!cell){ R.setHover(null,G); return; }
  G.hover = cell;
  R.setHover(cell[0], cell[1], G);
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
  const wonder = G.era===0 ? '（进阶无需奇迹）' : (G.wonders[G.era]?'奇迹✓':'奇迹✗');
  document.getElementById('advReq').textContent =
    `人口 ${Math.floor(G.pop)}/${ERAS[G.era].popGoal} · ${wonder} · ⭐${G.stars}/${ERAS[G.era].starCost} · ${ms}`;
}

let toastTimer;
function toast(msg){
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>el.classList.remove('show'), 2200);
}

window.addEventListener('contextmenu', e=>e.preventDefault());
window.addEventListener('beforeunload', ()=>{
  if(G.started && userKey && !G.over){
    try{ Saves.writeSave(userKey, 'quick', ()=>serializeState(G), {}); }catch(_){}
  }
});
document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState === 'hidden' && G.started && userKey){
    try{ Saves.writeSave(userKey, 'quick', ()=>serializeState(G), {}); }catch(_){}
  }
});
boot();
