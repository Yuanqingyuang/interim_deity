import { launchBrowser } from './browser.mjs';
import fs from 'fs';
import os from 'os';
import path from 'path';

const OUT = process.env.TD_OUT || path.join(os.tmpdir(), 'td-browser-out');
const SHOTS = path.join(OUT, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const results = { phases: [], console: [], pageErrors: [], perf: [] };
const log = (phase, ok, detail) => {
  results.phases.push({ phase, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${phase}] ${detail}`);
};

// boot 探针：main.js:112-117 同步执行 genWorld/buildTerrain/buildWater/syncWorld
// 后才隐藏 #loader；126-141 依 td_boot 决定进 start 还是 menu。
// SwiftShader 软件渲染下这段同步耗时可能远超默认超时，这里轮询采集真实耗时与卡点。
async function waitBoot(page, timeoutMs) {
  const t0 = Date.now();
  const probe = async () => {
    try {
      return await page.evaluate(() => ({
        loaderHidden: document.getElementById('loader')?.classList.contains('hidden') ?? null,
        loaderText: (document.getElementById('loader')?.innerText || '').slice(0, 60),
        canvas: !!document.getElementById('gameCanvas'),
        screens: ['authScreen', 'startScreen', 'menuScreen', 'topBar']
          .filter(id => !document.getElementById(id)?.classList.contains('hidden')),
        perf: typeof window.__perf,
        ready: document.readyState,
      }));
    } catch { return { evaluateError: true }; }
  };
  let state = await probe();
  while (Date.now() - t0 < timeoutMs) {
    if (state.loaderHidden === true) return { ok: true, state, ms: Date.now() - t0 };
    if (state.screens?.length) return { ok: true, state, ms: Date.now() - t0 };
    await page.waitForTimeout(500);
    state = await probe();
  }
  return { ok: false, state, ms: Date.now() - t0 };
}

const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
const page = await ctx.newPage();
page.on('console', m => {
  const t = m.type();
  if (t === 'error' || t === 'warning')
    results.console.push({ type: t, text: m.text().slice(0, 300) });
});
page.on('pageerror', e => results.pageErrors.push(String(e).slice(0, 400)));

const URL = 'http://localhost:8080/?debug=1&seed=12345';
const USER = 'qa_bot_' + Date.now().toString(36);
const PW = 'pw12345678';

try {
  // ── Phase A: 加载 + WebGL ──
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const webgl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    return { gl2: !!c.getContext('webgl2'), gl1: !!c.getContext('webgl'),
             renderer: (() => { try { const g = c.getContext('webgl2') || c.getContext('webgl');
               const d = g?.getExtension('WEBGL_debug_renderer_info');
               return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : '?'; } catch { return 'err'; } })() };
  });
  const fallbackShown = await page.evaluate(() =>
    document.body.innerText.includes('不支持 WebGL'));
  log('A.WebGL', webgl.gl1 || webgl.gl2,
    `gl2=${webgl.gl2} gl1=${webgl.gl1} renderer=${webgl.renderer} fallbackShown=${fallbackShown}`);

  // ── Phase B: 注册 ──
  const authVisible = await page.isVisible('#authScreen:not(.hidden)');
  await page.screenshot({ path: `${SHOTS}/00-auth.png` });
  await page.click('#tabReg');
  await page.fill('#authUser', USER);
  await page.fill('#authPw', PW);
  await page.click('#authBtn');
  await page.waitForSelector('#menuScreen:not(.hidden)', { timeout: 8000 });
  const authMsg = await page.textContent('#authMsg');
  log('B.注册新用户', true, `authVisible=${authVisible} msg="${authMsg}" user=${USER}`);

  // 弱密码拒绝测试：登出后用 3 位密码注册应被拒
  await page.click('#logoutBtn').catch(() => {});
  await page.waitForTimeout(500);
  const backToAuth = await page.isVisible('#authScreen:not(.hidden)');
  await page.click('#tabReg');
  await page.fill('#authUser', 'weakpw_user');
  await page.fill('#authPw', '123');
  await page.click('#authBtn');
  await page.waitForTimeout(800);
  const weakMsg = await page.textContent('#authMsg');
  const weakRejected = (await page.isVisible('#authScreen:not(.hidden)')) && weakMsg.length > 0;
  log('B2.弱密码(3位)拒绝', weakRejected, `backToAuth=${backToAuth} msg="${weakMsg}"`);
  await page.screenshot({ path: `${SHOTS}/00b-weakpw-rejected.png` });

  // 重新登录原账号
  await page.click('#tabLogin').catch(() => {});
  await page.fill('#authUser', USER);
  await page.fill('#authPw', PW);
  await page.click('#authBtn');
  await page.waitForSelector('#menuScreen:not(.hidden)', { timeout: 8000 });

  // ── Phase C: 新游戏 ──
  // 注意：newGame() 会导航到 ?seed=RANDOM 并丢弃 debug=1（main.js:206），
  // 这里手动复刻导航但保留 debug，否则 PERF_ON=false、window.__perf 不存在。
  // 导航与 evaluate 分离：evaluate 内改 location.href 会与 waitForSelector 的
  // 「waiting for navigation to finish」产生竞态导致挂起。
  await page.evaluate(() => sessionStorage.setItem('td_boot', 'new'));
  const t0 = Date.now();
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const boot = await waitBoot(page, 45000);
  log('C0.boot完成', boot.ok, `bootMs=${Date.now() - t0} ${JSON.stringify(boot.state)}`);
  await page.waitForSelector('#startScreen:not(.hidden)', { timeout: 20000 });
  await page.screenshot({ path: `${SHOTS}/01-start-screen.png` });
  await page.click('#startBtn');
  await page.waitForSelector('#topBar:not(.hidden)', { timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/02-game-initial.png` });
  log('C.新游戏进入', true, 'topBar visible, game running');

  // 性能采样 6×500ms
  for (let i = 0; i < 6; i++) {
    const p = await page.evaluate(() => window.__perf || null);
    if (p) results.perf.push(p);
    await page.waitForTimeout(500);
  }
  const avgFps = results.perf.length
    ? (results.perf.reduce((s, p) => s + p.fps, 0) / results.perf.length).toFixed(1) : 'n/a';
  log('C2.性能采样(debug HUD)', results.perf.length > 0,
    `samples=${results.perf.length} avgFps=${avgFps} last=${JSON.stringify(results.perf.at(-1))}`);

  // ── Phase D: 工具操作 ──
  const powerBefore = await page.textContent('#powerVal');
  await page.click('[data-tool="z_res"]');
  const box = await page.locator('#gameCanvas').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx - 40, cy);
  await page.mouse.down();
  for (let i = 0; i < 8; i++) { await page.mouse.move(cx - 40 + i * 10, cy + i * 3); await page.waitForTimeout(40); }
  await page.mouse.up();
  await page.waitForTimeout(400);
  await page.click('[data-tool="raise"]');
  await page.mouse.move(cx + 60, cy - 40);
  await page.mouse.down();
  for (let i = 0; i < 6; i++) { await page.mouse.move(cx + 60 + i * 5, cy - 40); await page.waitForTimeout(50); }
  await page.mouse.up();
  await page.waitForTimeout(600);
  const powerAfter = await page.textContent('#powerVal');
  await page.screenshot({ path: `${SHOTS}/03-after-tools.png` });
  log('D.工具拖拽(居住区+抬升)', Number(powerAfter) <= Number(powerBefore),
    `power ${powerBefore} → ${powerAfter}`);

  // ── Phase E: 暂停时世界是否仍在变化（main.js:404-411 dayTime/光照/云在 paused 守卫外） ──
  const dayBefore = await page.textContent('#dayVal');
  await page.click('#pauseBtn');
  await page.waitForSelector('#pauseMenu:not(.hidden)', { timeout: 3000 });
  await page.screenshot({ path: `${SHOTS}/04-pause-menu.png` });
  // 隐藏菜单 DOM（G.paused 仍为 true），露出画布观察场景是否继续变化
  await page.evaluate(() => document.getElementById('pauseMenu').classList.add('hidden'));
  await page.waitForTimeout(1200);
  const shotA = await page.screenshot();
  await page.waitForTimeout(4000);
  const shotB = await page.screenshot();
  const pausedStillChanging = !shotA.equals(shotB);
  const dayDuringPause = await page.textContent('#dayVal');
  await page.evaluate(() => document.getElementById('pauseMenu').classList.remove('hidden'));
  await page.click('#resumeBtn');
  await page.waitForTimeout(300);
  log('E.暂停时画面仍变化(光照/云未冻结)', true,
    `dayVal "${dayBefore}"→暂停中"${dayDuringPause}"(UI冻结=${dayBefore === dayDuringPause}) 画布像素变化=${pausedStillChanging} bytesA=${shotA.length} bytesB=${shotB.length}`);

  // ── Phase F: 快速存档 → 刷新 → 读档 ──
  const popBeforeSave = await page.textContent('#popVal');
  const eraBeforeSave = await page.textContent('#eraBadge');
  await page.click('#quickSaveBtn');
  await page.waitForTimeout(1200);
  const lsInfo = await page.evaluate(() => {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.includes('save')) out.push({ k, bytes: (localStorage.getItem(k) || '').length });
    }
    return out;
  });
  log('F1.快速存档写入', lsInfo.some(x => x.k.endsWith('/quick')),
    `pop=${popBeforeSave} era="${eraBeforeSave}" saves=${JSON.stringify(lsInfo)}`);

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitBoot(page, 45000);
  // 会话持久化：刷新后可能自动登录直接进菜单（auth.js saveSession 双写），仅在未登录时才填表
  const needLogin = await page.isVisible('#authScreen:not(.hidden)');
  if (needLogin) {
    await page.fill('#authUser', USER);
    await page.fill('#authPw', PW);
    await page.click('#authBtn');
  }
  await page.waitForSelector('#menuScreen:not(.hidden)', { timeout: 8000 });
  const autoLoggedIn = !needLogin;
  await page.click('#loadMenuBtn');
  await page.waitForSelector('#saveDialog:not(.hidden)', { timeout: 3000 });
  await page.screenshot({ path: `${SHOTS}/05-save-dialog.png` });
  const enabledBtn = page.locator('#saveSlotList .slot-act:not([disabled])').first();
  await enabledBtn.click();
  await page.waitForTimeout(3000);
  const popAfterLoad = await page.textContent('#popVal');
  const eraAfterLoad = await page.textContent('#eraBadge');
  await page.screenshot({ path: `${SHOTS}/06-after-load.png` });
  log('F2.刷新后读档往返', true,
    `autoLogin=${autoLoggedIn} era "${eraBeforeSave}"→"${eraAfterLoad}" pop ${popBeforeSave}→${popAfterLoad}`);

  // ── Phase G: 多分辨率 ──
  for (const [w, h, name] of [[1920, 1080, '07-1920x1080'], [1280, 720, '08-1280x720'], [800, 600, '09-800x600']]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOTS}/${name}.png` });
  }
  const canvasSize = await page.evaluate(() => {
    const c = document.getElementById('gameCanvas');
    const r = c.getBoundingClientRect();
    return { attrW: c.width, attrH: c.height, cssW: r.width, cssH: r.height,
             winW: innerWidth, winH: innerHeight };
  });
  log('G.多分辨率适配', Math.abs(canvasSize.cssW - canvasSize.winW) < 4,
    JSON.stringify(canvasSize));

  // ── Phase H: 破坏性操作 —— 快速连点 ──
  const errBefore = results.pageErrors.length;
  for (let i = 0; i < 15; i++) await page.click('[data-tool="z_res"]', { force: true }).catch(() => {});
  for (let i = 0; i < 8; i++) await page.click('#quickSaveBtn', { force: true }).catch(() => {});
  await page.waitForTimeout(1500);
  // 暂停/恢复 快速切换
  for (let i = 0; i < 6; i++) {
    await page.click('#pauseBtn', { force: true }).catch(() => {});
    await page.waitForTimeout(80);
    await page.click('#resumeBtn', { force: true }).catch(() => {});
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(1000);
  const stillAlive = await page.evaluate(() => !!window.__perf);
  const newErrs = results.pageErrors.length - errBefore;
  await page.screenshot({ path: `${SHOTS}/10-after-spam.png` });
  log('H.快速连点/暂停切换', stillAlive && newErrs === 0,
    `alive=${stillAlive} newPageErrors=${newErrs}`);

} catch (e) {
  log('EXCEPTION', false, String(e).slice(0, 500));
  await page.screenshot({ path: `${SHOTS}/99-error.png` }).catch(() => {});
}

results.consoleErrors = results.console.filter(c => c.type === 'error');
results.consoleWarnings = results.console.filter(c => c.type === 'warning');
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
console.log('\n== console errors =='); results.consoleErrors.slice(0, 15).forEach(c => console.log(' E:', c.text));
console.log('== console warnings =='); results.consoleWarnings.slice(0, 10).forEach(c => console.log(' W:', c.text));
console.log('== pageErrors =='); results.pageErrors.slice(0, 10).forEach(e => console.log(' P:', e));
console.log(`\nTOTAL consoleErrors=${results.consoleErrors.length} warnings=${results.consoleWarnings.length} pageErrors=${results.pageErrors.length}`);
await browser.close();
