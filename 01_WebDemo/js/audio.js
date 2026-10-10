// 实习神明 · 最小音频集（project-plan §4.3）
// 三类关键事件的声音反馈：放置成功 / 奇迹完工 / 时代进阶。
// 全部由 Web Audio 振荡器实时合成，不引入任何外部音频资产
// （规避 project-summary §10 的资产依赖，也不触发 CSP 的媒体来源限制）。
//
// 自动播放策略：AudioContext 必须由用户手势创建或恢复，否则浏览器会静默丢弃输出。
// 因此这里采用「首次交互惰性建 context + 每次播放前尝试 resume」，
// 未解锁前调用 play 一律静默返回，不抛异常、不打断游戏逻辑。

const MUTE_KEY = 'td/audio/muted';

let ctx = null;
let master = null;
let muted = false;
try{ muted = localStorage.getItem(MUTE_KEY) === '1'; }catch(_){ muted = false; }

// 放置音效在拖动涂格时会逐帧触发，必须限流，否则叠成一片噪声
let lastPlaceAt = 0;
const PLACE_GAP_MS = 70;

function ensureCtx(){
  if(ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if(!AC) return null;
  try{
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }catch(_){
    ctx = null;
    master = null;
  }
  return ctx;
}

/** 用户手势后调用：建 context 并解除挂起。可在 pointerdown/keydown 上重复挂载。 */
export function unlockAudio(){
  const c = ensureCtx();
  if(!c) return false;
  if(c.state === 'suspended') c.resume().catch(()=>{});
  return c.state !== 'suspended';
}

export function isMuted(){ return muted; }

export function setMuted(v){
  muted = !!v;
  try{ localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); }catch(_){ /* 隐私模式下忽略 */ }
  if(master && ctx) master.gain.value = muted ? 0 : 0.5;
  return muted;
}

/**
 * 单个音符：起音 12ms、指数衰减到静音，避免爆音。
 * slideTo 给出时做频率滑移（放置音效的「上挑」质感）。
 */
function note({ freq = 440, slideTo = null, dur = 0.14, type = 'sine', gain = 0.2, delay = 0 }){
  if(muted) return;
  const c = ensureCtx();
  if(!c || c.state === 'suspended') return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if(slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

/** 放置/划定成功：短促上挑，限流 70ms */
export function sfxPlace(){
  const now = performance.now();
  if(now - lastPlaceAt < PLACE_GAP_MS) return;
  lastPlaceAt = now;
  note({ freq: 300, slideTo: 520, dur: 0.07, type: 'triangle', gain: 0.14 });
}

/** 奇迹完工：三音上行琶音（C5-E5-G5），带柔和正弦尾音 */
export function sfxWonder(){
  note({ freq: 523.25, dur: 0.26, type: 'sine', gain: 0.2 });
  note({ freq: 659.25, dur: 0.26, type: 'sine', gain: 0.2, delay: 0.13 });
  note({ freq: 783.99, dur: 0.5,  type: 'sine', gain: 0.22, delay: 0.26 });
  note({ freq: 1046.5, dur: 0.5, type: 'sine', gain: 0.1, delay: 0.26 });
}

/** 时代进阶：四音号角（G4-C5-E5-G5），方波叠加做厚度 */
export function sfxEra(){
  const seq = [392.0, 523.25, 659.25, 783.99];
  seq.forEach((f, i)=>{
    note({ freq: f, dur: i === seq.length - 1 ? 0.7 : 0.22, type: 'triangle', gain: 0.18, delay: i * 0.15 });
    note({ freq: f * 2, dur: 0.18, type: 'sine', gain: 0.06, delay: i * 0.15 });
  });
}
