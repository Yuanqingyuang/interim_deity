// 实习神明 · UI
import { ERAS, powerMaxOf, WONDERS } from './config.js';
import * as F from './formulas.js';
import { countZone } from './state.js';

function $(id){ return document.getElementById(id); }

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
    };
    this.bind();
  }

  bind(){
    document.querySelectorAll('.tool').forEach(b=>{
      b.addEventListener('click', ()=>{
        document.querySelectorAll('.tool').forEach(x=>x.classList.remove('active'));
        b.classList.add('active');
        this.h.onTool(b.dataset.tool);
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
    });
    $('tabReg')?.addEventListener('click', ()=>{
      this._authMode = 'register';
      $('tabReg').classList.add('active'); $('tabLogin')?.classList.remove('active');
      $('authBtn').textContent = '注 册';
      const pw = $('authPw');
      if(pw) pw.setAttribute('autocomplete', 'new-password');
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
    $('logClose')?.addEventListener('click', ()=>this.h.onToggleLog?.());
    $('saveDialogClose')?.addEventListener('click', ()=>this.h.onCloseSaves?.());
    // R11 导出/导入
    $('saveExportBtn')?.addEventListener('click', ()=>{
      const slot = this._exportSlot || 'quick';
      const json = this.h.onExportSave?.(slot);
      if(!json){ /* toast 由 main 处理 */ return; }
      const blob = new Blob([json], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `trainee-deity-${slot}-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
    $('saveImportBtn')?.addEventListener('click', ()=> $('saveImportFile')?.click());
    $('saveImportFile')?.addEventListener('change', (e)=>{
      const f = e.target.files?.[0];
      if(!f) return;
      const reader = new FileReader();
      reader.onload = ()=>{
        const ok = this.h.onImportSave?.(String(reader.result||''), this._exportSlot || 'quick');
        if(ok === false) this.h.onToast?.('导入失败：格式无效');
      };
      reader.readAsText(f);
      e.target.value = '';
    });

    const cv = $('gameCanvas');
    // 全局屏蔽右键菜单，避免与相机操作抢浏览器快捷键/菜单
    document.addEventListener('contextmenu', (e)=>{
      if(e.target === cv || cv.contains(e.target)) e.preventDefault();
    });
    const down = (e)=>{
      // 中键 / 右键：交给相机，禁止浏览器默认
      if(e.button === 1 || e.button === 2){
        e.preventDefault();
        e.stopPropagation();
      }
      const t = e.touches ? e.touches[0] : e;
      // 0=左键施法  1=中键平移  2=右键旋转
      const btn = e.touches ? 0 : e.button;
      this.h.onCanvasDown(t.clientX, t.clientY, btn);
    };
    const move = (e)=>{
      const t = e.touches ? e.touches[0] : e;
      this.h.onCanvasMove(t.clientX, t.clientY);
    };
    const up = ()=>this.h.onCanvasUp();
    cv.addEventListener('mousedown', down);
    cv.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    cv.addEventListener('touchstart', down, {passive:false});
    cv.addEventListener('touchmove', move, {passive:false});
    window.addEventListener('touchend', up);
    cv.addEventListener('contextmenu', e=>{ e.preventDefault(); e.stopPropagation(); });
    cv.addEventListener('auxclick', e=>e.preventDefault());
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
    box.innerHTML = list.map(it =>
      `<div class="log-item"><span class="t">${it.clock}</span>${it.text}</div>`
    ).join('') || '<div class="log-item">暂无记录</div>';
    panel.classList.remove('hidden');
  }
  closeLog(){ $('logPanel')?.classList.add('hidden'); }

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
      const meta = m
        ? `时代${m.era+1} · 人口${m.pop} · 种子${m.seed} · ${new Date(m.savedAt).toLocaleString()}`
        : '空';
      div.innerHTML = `<div class="slot-name">${label}</div><div class="slot-meta">${meta}</div>`;
      const btn = document.createElement('button');
      btn.className = 'slot-act';
      btn.textContent = mode==='save' ? '保存' : '读取';
      btn.disabled = mode==='load' && !m;
      btn.onclick = ()=>onAct(slot);
      div.appendChild(btn);
      box.appendChild(div);
    }
  }

  refresh(){
    const G = this.G;
    const e = this._el;

    e.powerVal.textContent = String(Math.floor(G.power));
    e.powerCap.textContent = `/${powerMaxOf(G.era)}`;
    e.powerRate.textContent = `+${(2.5+Math.min(10,G.faithRate*0.02)).toFixed(1)}/s`;
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
    e.popVal.textContent = Math.floor(G.pop).toLocaleString();
    e.starVal.textContent = String(G.stars);
    e.starProg.textContent = `${Math.floor(G.starProg*100)}%`;

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
      e.indNeed.textContent = `需 ${fmtNum(indNeed)}/s`;
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
