// 实习神明 · UI
import { ERAS, powerMaxOf, powerRegenOf, WONDERS, MILESTONES } from './config.js';
import * as F from './formulas.js';

function $(id){ return document.getElementById(id); }

// 与 WONDERS 顺序一一对应：巨石阵/金字塔/大教堂/摩天塔/太空电梯
const WONDER_ICON = ['💫','🔺','⛪','🏙️','🚀'];

function fmtNum(v){
  if(!Number.isFinite(v)) return '—';
  if(v >= 1e8) return (v/1e8).toFixed(1)+'亿';
  if(v >= 1e4) return (v/1e4).toFixed(1)+'万';
  if(v >= 100) return String(Math.round(v));
  if(v >= 10) return v.toFixed(0);
  return v.toFixed(1);
}

export class UI {
  constructor(G, handlers){
    this.G = G;
    this.h = handlers;
    this._el = {
      powerVal: $('powerVal'),
      powerCap: document.querySelector('.res .cap'),
      powerRate: $('powerRate'),
      faithVal: $('faithVal'),
      faithRate: $('faithRate'),
      faithNeed: $('faithNeed'),
      popVal: $('popVal'),
      starVal: $('starVal'),
      starProg: $('starProg'),
      foodOut: $('foodOut'),
      foodNeed: $('foodNeed'),
      indOut: $('indOut'),
      indNeed: $('indNeed'),
      eraRoman: document.querySelector('.era-roman'),
      eraName: document.querySelector('.era-name'),
      dayVal: $('dayVal'),
      autoLog: $('autoLog'),
      wonderBtn: $('wonderBtn'),
      wonderIco: $('wonderIco'),
      wonderName: $('wonderName'),
      wonderCost: $('wonderCost'),
    };
    this.bind();
  }

  /**
   * 分类菜单折叠：点分类头收起/展开。
   * 默认收起低频分类以减轻画面拥挤；用户选择记在 localStorage。
   */
  _bindGroups(){
    const KEY = 'td/ui/collapsed';
    const DEFAULT_COLLAPSED = ['操作', '视角', '神迹'];
    let saved = {};
    try{ saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; }catch(_){ saved = {}; }
    const collapsedOf = (name)=> (name in saved) ? !!saved[name] : DEFAULT_COLLAPSED.includes(name);
    document.querySelectorAll('.tool-group > .group-head, .mb-group > .group-head').forEach(head=>{
      const group = head.parentElement;
      const name = group?.dataset.group || '';
      const apply = (collapsed)=>{
        group.classList.toggle('collapsed', collapsed);
        head.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        head.title = collapsed ? '展开分类' : '收起分类';
      };
      apply(collapsedOf(name));
      head.addEventListener('click', ()=>{
        const next = !group.classList.contains('collapsed');
        apply(next);
        saved[name] = next;
        try{ localStorage.setItem(KEY, JSON.stringify(saved)); }catch(_){}
      });
    });
  }

  bind(){
    this._bindGroups();
    document.querySelectorAll('.tool').forEach(b=>{
      b.addEventListener('click', ()=>{
        // 视角旋转/移动视角由 main 决定是否保持 active（可开关）
        const key = b.dataset.tool;
        if(key === 'cam_rot' || key === 'cam_pan'){
          this.h.onTool(key);
          return;
        }
        document.querySelectorAll('.tool').forEach(x=>x.classList.remove('active'));
        b.classList.add('active');
        this.h.onTool(key);
      });
    });
    document.querySelectorAll('.spd').forEach(b=>{
      b.addEventListener('click', ()=>{
        document.querySelectorAll('.spd').forEach(x=>x.classList.remove('active'));
        b.classList.add('active');
        this.h.onSpeed(parseInt(b.dataset.spd,10));
      });
    });
    document.querySelectorAll('.mir[data-mir]').forEach(b=>{
      b.addEventListener('click', ()=>this.h.onMiracle(b.dataset.mir));
    });
    this._el.wonderBtn?.addEventListener('click', ()=>this.h.onWonder());
    $('advanceBtn').addEventListener('click', ()=>this.h.onAdvance());
    $('startBtn')?.addEventListener('click', ()=>this.h.onStart());
    $('restartBtn')?.addEventListener('click', ()=>this.h.onRestart());
    $('newWorldBtn')?.addEventListener('click', ()=>this.h.onNewWorld());

    // 账号 / 菜单 / 存档 / 日志
    $('authBtn')?.addEventListener('click', ()=>this.h.onAuth?.());
    $('tabLogin')?.addEventListener('click', ()=>{
      this._authMode = 'login';
      $('tabLogin').classList.add('active'); $('tabReg')?.classList.remove('active');
      $('authBtn').textContent = '登 录';
      const pw = $('authPw');
      if(pw){ pw.setAttribute('autocomplete', 'current-password'); pw.placeholder = '至少 8 位'; }
    });
    $('tabReg')?.addEventListener('click', ()=>{
      this._authMode = 'register';
      $('tabReg').classList.add('active'); $('tabLogin')?.classList.remove('active');
      $('authBtn').textContent = '注 册';
      const pw = $('authPw');
      if(pw){ pw.setAttribute('autocomplete', 'new-password'); pw.placeholder = '注册：至少 8 位'; }
    });
    $('authPw')?.addEventListener('keydown', (e)=>{ if(e.key==='Enter') this.h.onAuth?.(); });
    $('newGameBtn')?.addEventListener('click', ()=>this.h.onNewGame?.());
    $('loadMenuBtn')?.addEventListener('click', ()=>this.h.onOpenSaves?.('load'));
    $('logoutBtn')?.addEventListener('click', ()=>this.h.onLogout?.());
    $('resumeBtn')?.addEventListener('click', ()=>this.h.onResume?.());
    $('pauseSaveBtn')?.addEventListener('click', ()=>this.h.onOpenSaves?.('save'));
    $('pauseLoadBtn')?.addEventListener('click', ()=>this.h.onOpenSaves?.('load'));
    $('pauseMenuBtn')?.addEventListener('click', ()=>this.h.onToMenu?.());
    $('pauseBtn')?.addEventListener('click', ()=>this.h.onPause?.());
    $('quickSaveBtn')?.addEventListener('click', ()=>this.h.onQuickSave?.());
    $('quickLoadBtn')?.addEventListener('click', ()=>this.h.onQuickLoad?.());
    $('logBtn')?.addEventListener('click', ()=>this.h.onToggleLog?.());
    $('pauseLogBtn')?.addEventListener('click', ()=>this.h.onToggleLog?.());
    $('logClose')?.addEventListener('click', ()=>this.h.onToggleLog?.());
    $('saveDialogClose')?.addEventListener('click', ()=>this.h.onCloseSaves?.());
    // R11 导出/导入
    const downloadSlot = (slot)=>{
      const json = this.h.onExportSave?.(slot);
      if(!json) return;
      const blob = new Blob([json], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `trainee-deity-${slot}-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    };
    this._downloadSlot = downloadSlot;
    $('saveExportBtn')?.addEventListener('click', ()=>{
      downloadSlot(this._exportSlot || 'quick');
    });
    $('saveImportBtn')?.addEventListener('click', ()=> $('saveImportFile')?.click());
    $('saveImportFile')?.addEventListener('change', (e)=>{
      const f = e.target.files?.[0];
      if(!f) return;
      const slot = this._exportSlot || 'quick';
      const reader = new FileReader();
      reader.onload = ()=>{
        const ok = this.h.onImportSave?.(String(reader.result||''), slot);
        if(ok === false) this.h.onToast?.('导入失败：格式无效');
        else this.h.onRefreshSaves?.();  // G-05：导入成功后立即刷新槽位列表
      };
      reader.readAsText(f);
      e.target.value = '';
    });
    this.syncImportTarget();

    const cv = $('gameCanvas');
    // 全局屏蔽右键菜单，避免与相机操作抢浏览器快捷键/菜单
    document.addEventListener('contextmenu', (e)=>{
      if(e.target === cv || cv.contains(e.target)) e.preventDefault();
    });
    // ---- 视角 vs 浏览器手势隔离 ----
    // 1) 中键/右键/滚轮在画布上一律 preventDefault，避免自动滚动、页面缩放、后退手势
    // 2) 触控双指交给 OrbitControls（DOLLY_PAN），单指=当前工具
    // 3) Alt+方向键 / Alt+Left（部分浏览器后退）在游戏进行时拦截
    const blockKeys = new Set(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Backspace']);
    const onKey = (e)=>{
      if(!this.G?.started) return;
      // Alt+Left 等：浏览器后退
      if(e.altKey && (e.key === 'ArrowLeft' || e.key === 'Left' || e.button === 3)){
        e.preventDefault();
      }
      if(e.altKey && blockKeys.has(e.key)) e.preventDefault();
    };
    window.addEventListener('keydown', onKey, true);

    const down = (e)=>{
      if(e.button === 1 || e.button === 2){
        e.preventDefault();
        e.stopPropagation();
      }
      const t = e.touches ? e.touches[0] : e;
      // 触控：多指只给 OrbitControls，不施法
      if(e.touches && e.touches.length > 1){
        this.h.onCanvasUp();
        return;
      }
      const btn = e.touches ? 0 : e.button;
      this.h.onCanvasDown(t.clientX, t.clientY, btn);
    };
    const move = (e)=>{
      if(e.touches && e.touches.length > 1){ this.h.onCanvasUp(); return; }
      const t = e.touches ? e.touches[0] : e;
      this.h.onCanvasMove(t.clientX, t.clientY);
    };
    const up = ()=>this.h.onCanvasUp();
    const wheel = (e)=>{
      // 缩放只作用于相机，禁止触发浏览器整页缩放/历史手势链
      e.preventDefault();
      e.stopPropagation();
    };
    cv.addEventListener('mousedown', down);
    cv.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    cv.addEventListener('wheel', wheel, { passive: false });
    cv.addEventListener('pointerdown', (e)=>{
      if(e.button === 1 || e.button === 2) e.preventDefault();
    }, { passive: false });
    cv.addEventListener('touchstart', down, { passive: false });
    cv.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', up);
    cv.addEventListener('contextmenu', e=>{ e.preventDefault(); e.stopPropagation(); });
    cv.addEventListener('auxclick', e=>e.preventDefault());
    // 中键自动滚动（Windows）
    cv.addEventListener('mousedown', e=>{ if(e.button===1) e.preventDefault(); }, { passive: false });
  }

  /** 同步工具栏 active（含视角开关） */
  syncToolActive(tool){
    document.querySelectorAll('.tool').forEach(x=>{
      const k = x.dataset.tool;
      if(!k) return;
      x.classList.toggle('active', k === tool);
    });
  }

  setWonderPlacing(on){
    this._el.wonderBtn?.classList.toggle('placing', on);
  }

  authMode(){ return this._authMode || 'login'; }
  authValues(){
    return {
      user: $('authUser')?.value || '',
      pw: $('authPw')?.value || '',
    };
  }
  setAuthMsg(msg, ok){
    const el = $('authMsg');
    if(!el) return;
    el.textContent = msg || '';
    el.style.color = ok ? '#66bb6a' : '#e07a5f';
  }
  showScreen(name){
    const ids = { auth:'authScreen', menu:'menuScreen', start:'startScreen', pause:'pauseMenu', save:'saveDialog' };
    // 先全隐藏，保证不会叠层
    for(const id of Object.values(ids)) $(id)?.classList.add('hidden');
    if(!name) return;
    $(ids[name])?.classList.remove('hidden');
  }
  hideAllScreens(){
    ['authScreen','menuScreen','startScreen','pauseMenu','saveDialog'].forEach(id=>$(id)?.classList.add('hidden'));
  }
  setMenuUser(name){
    const el = $('menuUser');
    if(el) el.textContent = name ? `欢迎，${name}` : '未登录';
  }

  openLog(list){
    const panel = $('logPanel');
    const box = $('logList');
    if(!panel || !box) return;
    box.innerHTML = '';
    const items = Array.isArray(list) ? list : [];
    if(!items.length){
      const empty = document.createElement('div');
      empty.className = 'log-item';
      empty.textContent = '暂无记录';
      box.appendChild(empty);
    }else{
      for(const it of items){
        const row = document.createElement('div');
        row.className = 'log-item';
        const t = document.createElement('span');
        t.className = 't';
        t.textContent = String(it.clock ?? '');
        row.appendChild(t);
        row.appendChild(document.createTextNode(String(it.text ?? '')));
        box.appendChild(row);
      }
    }
    panel.classList.remove('hidden');
  }
  closeLog(){ $('logPanel')?.classList.add('hidden'); }

  /** G-04：把导入/导出的目标槽位显式写在按钮上，避免静默写入非预期槽位 */
  syncImportTarget(){
    const slot = this._exportSlot || 'quick';
    const label = slot==='quick' ? '快速存档' : `存档 ${slot.slice(-1)}`;
    const btn = $('saveImportBtn');
    if(btn) btn.textContent = `导入到「${label}」`;
    const exp = $('saveExportBtn');
    if(exp) exp.textContent = `导出「${label}」`;
  }

  renderSaveSlots(list, mode, onAct){
    const box = $('saveSlotList');
    const title = $('saveDialogTitle');
    const hint = $('saveDialogHint');
    if(title) title.textContent = mode==='save' ? '保存到槽位' : '读取存档';
    if(hint) hint.textContent = mode==='save' ? '选择一个槽位覆盖保存；「快速存档」也可在顶栏一键保存。' : '选择一个槽位读取（会覆盖当前进度）';
    if(!box) return;
    box.innerHTML = '';
    for(const slot of ['slot1','slot2','slot3','quick']){
      const m = list[slot];
      const div = document.createElement('div');
      div.className = 'slot';
      const label = slot==='quick' ? '快速存档' : `存档 ${slot.slice(-1)}`;
      const nameEl = document.createElement('div');
      nameEl.className = 'slot-name';
      nameEl.textContent = label;
      const metaEl = document.createElement('div');
      metaEl.className = 'slot-meta';
      metaEl.textContent = m
        ? `时代${(m.era|0)+1} · 人口${Math.floor(Number(m.pop)||0).toLocaleString()} · 种子${m.seed|0} · ${new Date(Number(m.savedAt)||Date.now()).toLocaleString()}`
        : '空';
      div.appendChild(nameEl);
      div.appendChild(metaEl);
      const btn = document.createElement('button');
      btn.className = 'slot-act';
      btn.textContent = mode==='save' ? '保存' : '读取';
      btn.disabled = mode==='load' && !m;
      btn.onclick = ()=>{
        this._exportSlot = slot;
        this.syncImportTarget();
        onAct(slot);
      };
      div.appendChild(btn);
      // 导出：有档才可点
      const exp = document.createElement('button');
      exp.className = 'slot-act';
      exp.textContent = '导出';
      exp.disabled = !m;
      exp.onclick = ()=>{ this._exportSlot = slot; this.syncImportTarget(); this._downloadSlot?.(slot); };
      div.appendChild(exp);
      box.appendChild(div);
    }
    this.syncImportTarget();
  }

  refresh(){
    const G = this.G;
    const e = this._el;

    e.powerVal.textContent = String(Math.floor(G.power));
    e.powerCap.textContent = `/${powerMaxOf(G.era)}`;
    e.powerRate.textContent = `+${powerRegenOf(G.faithRate).toFixed(1)}/s`;
    e.faithVal.textContent = String(Math.floor(G.faith));
    e.faithRate.textContent = `+${G.faithRate.toFixed(1)}/s`;
    // 下一奇观信仰差额（已建/在建则显示完成）
    if(e.faithNeed){
      const w = WONDERS[G.era];
      if(G.wonders?.[G.era]) e.faithNeed.textContent = '已建成';
      else if(w){
        const gap = w.faithCost - G.faith;
        e.faithNeed.textContent = gap <= 0 ? '可建造' : `差 ${fmtNum(Math.ceil(gap))}`;
        e.faithNeed.classList.toggle('low', gap > 0);
      }
    }
    // 奇观按钮：名称/花费随当前时代重算（原为 index.html 硬编码，时代进阶后仍写着「巨石阵」）
    if(e.wonderName){
      const w = WONDERS[G.era];
      if(w){
        e.wonderIco.textContent = WONDER_ICON[G.era] || '💫';
        e.wonderName.textContent = `建${w.name}`;
        e.wonderCost.textContent = `🙏${fmtNum(w.faithCost)}`;
        // 不可建时置灰 + 写明原因（styles.css 已有 .mir:disabled 样式）。
        // 原先按钮永不置灰，点了只弹一句 toast，玩家无法预判能否建造。
        const done = !!G.wonders?.[G.era];
        const busy = (G.wonderList || []).some(x=>!x.done);
        const afford = G.faith >= w.faithCost;
        e.wonderBtn.disabled = done || busy || !afford;
        if(done) e.wonderBtn.title = `${w.name} 已建成（${w.bonus}）`;
        else if(busy) e.wonderBtn.title = '已有奇迹在建，完工后才能再建';
        else if(!afford) e.wonderBtn.title = `信仰不足：${fmtNum(Math.floor(G.faith))}/${fmtNum(w.faithCost)}（建${w.name}）`;
        else e.wonderBtn.title = `${w.name}：${w.bonus}（耗时 ${w.time}s）`;
      } else {
        e.wonderBtn.disabled = true;
        e.wonderBtn.title = '本时代没有可建造的奇迹';
      }
    }
    e.popVal.textContent = Math.floor(G.pop).toLocaleString();
    e.starVal.textContent = String(G.stars);
    if(e.starProg){
      const eraMs = MILESTONES[G.era] || [];
      const flags = G.starMilestones?.[G.era] || [];
      const done = eraMs.reduce((n,_,i)=> n + (flags[i]?1:0), 0);
      e.starProg.textContent = `${done}/${eraMs.length}`;
    }

    const c = G._builtCache;
    const farms = (c && c.valid) ? (c[2]||0) : 0;
    const inds  = (c && c.valid) ? (c[3]||0) : 0;
    const E = F.eraIndex(G);
    const foodOut = F.foodPerSec(farms);
    const foodNeed = F.foodNeed(G.pop);
    const indOut = F.industryPerSec(inds);
    const indForEra = F.buildingLow(E, 3);
    const indForPop = Math.max(1, Math.ceil(G.pop * F.NUM.R_INDPOP / F.NUM.K_IND));
    const indNeed = F.industryPerSec(Math.max(indForEra, indForPop));

    if(e.foodOut) e.foodOut.textContent = `${fmtNum(foodOut)}/s`;
    if(e.foodNeed){
      e.foodNeed.textContent = `需 ${fmtNum(foodNeed)}/s`;
      e.foodNeed.classList.toggle('low', foodOut < foodNeed);
    }
    if(e.indOut) e.indOut.textContent = `${fmtNum(indOut)}/s`;
    if(e.indNeed){
      // 统一口径：刚需 = 建造与人口所需产能；门槛 = 刚需×50%（即 GATE(E)，与底部进阶条同一数值）。
      // 原先只写「刚需 300/s」，而底部进阶条写「进阶门槛 150/s」，同屏两个数字互相矛盾。
      const gate = Math.ceil(F.gateOf(E));
      e.indNeed.textContent = `刚需 ${fmtNum(indNeed)}/s · 门槛 ${fmtNum(gate)}/s`;
      e.indNeed.classList.toggle('low', indOut < indNeed);
    }

    if(e.eraRoman) e.eraRoman.textContent = ERAS[G.era].roman;
    if(e.eraName) e.eraName.textContent = ERAS[G.era].name;

    const t = G.dayTime;
    let phase = '白昼', icon = '☀';
    if(t < 0.22){ phase='黎明前'; icon='🌙'; }
    else if(t < 0.32){ phase='日出'; icon='🌅'; }
    else if(t < 0.68){ phase='白昼'; icon='☀'; }
    else if(t < 0.80){ phase='日落'; icon='🌇'; }
    else { phase='夜晚'; icon='🌙'; }
    if(e.dayVal) e.dayVal.textContent = `${icon} ${phase}`;
    if(e.autoLog && G.autoLog.length) e.autoLog.textContent = G.autoLog[0];
  }
}
