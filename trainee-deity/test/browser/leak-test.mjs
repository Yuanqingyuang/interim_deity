// 定向复现：连续读档是否造成 GPU 资源泄漏 / 渲染进程崩溃
// 手段：注入 WebGL 调用计数（createXxx vs deleteXxx）+ CDP Performance.getMetrics + 强制 GC
import { launchBrowser } from './browser.mjs';
import fs from 'fs';
import os from 'os';
import path from 'path';

const OUT = process.env.TD_OUT || path.join(os.tmpdir(), 'td-browser-out');
fs.mkdirSync(OUT, { recursive: true });
const URL = 'http://localhost:8080/?debug=1&seed=12345';
const USER = 'qa_leak_' + Date.now().toString(36);
const PW = 'pw12345678';
const out = { glStats: [], heap: [], notes: [], crashed: null };

const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });

// 必须在页面脚本之前注入：包一层 getContext，统计 GL 对象的创建/销毁
await ctx.addInitScript(() => {
  window.__gl = { texC: 0, texD: 0, bufC: 0, bufD: 0, progC: 0, progD: 0,
                  fbC: 0, fbD: 0, rbC: 0, rbD: 0, upload: 0, patched: false };
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    const gl = orig.call(this, type, attrs);
    try {
      if (gl && !gl.__p && /^webgl/.test(type)) {
        gl.__p = 1; window.__gl.patched = true;
        const w = (name, key) => {
          const o = gl[name];
          if (typeof o === 'function') {
            gl[name] = function (...a) { window.__gl[key]++; return o.apply(gl, a); };
          }
        };
        w('createTexture', 'texC'); w('deleteTexture', 'texD');
        w('createBuffer', 'bufC'); w('deleteBuffer', 'bufD');
        w('createProgram', 'progC'); w('deleteProgram', 'progD');
        w('createFramebuffer', 'fbC'); w('deleteFramebuffer', 'fbD');
        w('createRenderbuffer', 'rbC'); w('deleteRenderbuffer', 'rbD');
        const up = gl.texImage2D;
        if (up) gl.texImage2D = function (...a) { window.__gl.upload++; return up.apply(gl, a); };
      }
    } catch (e) { /* 注入失败不应影响页面 */ }
    return gl;
  };
});

const page = await ctx.newPage();
page.on('pageerror', e => out.notes.push('pageerror: ' + String(e).slice(0, 300)));
page.on('console', m => { if (m.type() === 'error') out.notes.push('console.error: ' + m.text().slice(0, 300)); });
const cdp = await ctx.newCDPSession(page);
await cdp.send('Performance.enable').catch(() => {});

async function metrics(tag) {
  let heapMB = null, nodes = null;
  try {
    const { metrics } = await cdp.send('Performance.getMetrics');
    const get = n => metrics.find(m => m.name === n)?.value;
    heapMB = +(get('JSHeapUsedSize') / 1048576).toFixed(1);
    nodes = get('Nodes');
  } catch (e) { heapMB = 'cdp-err'; }
  let gl = null;
  try { gl = await page.evaluate(() => window.__gl); } catch (e) { gl = 'page-gone'; }
  const row = { tag, heapMB, nodes, gl };
  out.glStats.push(row);
  console.log(`[${tag}] heap=${heapMB}MB nodes=${nodes} ` +
    (gl && gl !== 'page-gone'
      ? `tex ${gl.texC}/${gl.texD} buf ${gl.bufC}/${gl.bufD} prog ${gl.progC}/${gl.progD} fb ${gl.fbC}/${gl.fbD} upload=${gl.upload}`
      : `gl=${gl}`));
  return row;
}

async function waitBoot(pg, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const s = await pg.evaluate(() => ({
        loader: document.getElementById('loader')?.classList.contains('hidden'),
        screens: ['authScreen', 'startScreen', 'menuScreen', 'topBar']
          .filter(id => !document.getElementById(id)?.classList.contains('hidden')),
      }));
      if (s.loader === true || s.screens.length) return { ok: true, ms: Date.now() - t0, s };
    } catch { return { ok: false, ms: Date.now() - t0, s: 'page-gone' }; }
    await pg.waitForTimeout(500);
  }
  return { ok: false, ms: Date.now() - t0, s: 'timeout' };
}

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const b0 = await waitBoot(page);
  out.notes.push(`boot#1 ${b0.ms}ms ok=${b0.ok} ${JSON.stringify(b0.s)}`);

  // 注册/登录
  if (await page.isVisible('#authScreen:not(.hidden)')) {
    await page.click('#tabReg');
    await page.fill('#authUser', USER);
    await page.fill('#authPw', PW);
    await page.click('#authBtn');
    await page.waitForSelector('#menuScreen:not(.hidden)', { timeout: 15000 });
  }
  await metrics('登录后菜单');

  // 新游戏（手动导航保留 debug=1）
  await page.evaluate(() => sessionStorage.setItem('td_boot', 'new'));
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const b1 = await waitBoot(page);
  out.notes.push(`boot#2(新游戏) ${b1.ms}ms ok=${b1.ok}`);
  await page.waitForSelector('#startScreen:not(.hidden)', { timeout: 20000 });
  await page.click('#startBtn');
  await page.waitForSelector('#topBar:not(.hidden)', { timeout: 30000 });
  await page.waitForTimeout(2000);
  await metrics('开局基线');

  // 存档一次
  await page.click('#quickSaveBtn');
  await page.waitForTimeout(1500);
  await metrics('快速存档后');

  // 连续读档 N 次：每次都触发 doLoad → buildTerrain+buildWater+syncWorld
  const N = 6;
  for (let i = 1; i <= N; i++) {
    try {
      await page.click('#pauseBtn');
      await page.waitForSelector('#pauseMenu:not(.hidden)', { timeout: 8000 });
      await page.click('#pauseLoadBtn');
      await page.waitForSelector('#saveDialog:not(.hidden)', { timeout: 8000 });
      const btn = page.locator('#saveSlotList .slot-act:not([disabled])').first();
      await btn.click({ timeout: 8000 });
      await page.waitForTimeout(4000);
      // 读档后 pauseMenu/saveDialog 应被 hideAllScreens 关闭
      const dlgOpen = await page.evaluate(() =>
        !document.getElementById('saveDialog')?.classList.contains('hidden'));
      await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
      await page.waitForTimeout(600);
      const r = await metrics(`第${i}次读档(GC后)`);
      r.dlgStillOpen = dlgOpen;
    } catch (e) {
      out.crashed = { at: `load#${i}`, err: String(e).slice(0, 400) };
      out.notes.push(`读档第${i}次异常: ${String(e).slice(0, 300)}`);
      break;
    }
  }

  // 增量分析
  const rows = out.glStats.filter(r => r.gl && r.gl !== 'page-gone');
  if (rows.length >= 2) {
    const first = rows.find(r => r.tag.includes('基线')) || rows[0];
    const last = rows[rows.length - 1];
    out.summary = {
      heapDeltaMB: (typeof last.heapMB === 'number' && typeof first.heapMB === 'number')
        ? +(last.heapMB - first.heapMB).toFixed(1) : null,
      texLeak: last.gl.texC - last.gl.texD - (first.gl.texC - first.gl.texD),
      bufLeak: last.gl.bufC - last.gl.bufD - (first.gl.bufC - first.gl.bufD),
      progLeak: last.gl.progC - last.gl.progD - (first.gl.progC - first.gl.progD),
      from: first.tag, to: last.tag,
    };
    console.log('\n== 泄漏增量(基线→最后) ==', JSON.stringify(out.summary));
  }
} catch (e) {
  out.crashed = out.crashed || { at: 'outer', err: String(e).slice(0, 400) };
  console.log('EXCEPTION', String(e).slice(0, 400));
}

fs.writeFileSync(path.join(OUT, 'leak-results.json'), JSON.stringify(out, null, 2));
console.log('\nnotes:'); out.notes.forEach(n => console.log(' -', n));
await browser.close().catch(() => {});
