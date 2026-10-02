// P1 高人口压测（规划书 §4.4）：借助 ?debug=1 调试面板逐时代刷建筑/跳时代，
// 采样 window.__perf（fps/frameMs/maxMs/drawCalls/triangles）与人口曲线，
// 输出 E1→E5 建筑规模 vs 帧率数据，作为 §5「建筑代理比」决策输入。
import { chromium } from 'playwright-core';
import fs from 'fs';
import os from 'os';
import path from 'path';

const OUT = process.env.TD_OUT || path.join(os.tmpdir(), 'td-stress-out');
const SHOTS = path.join(OUT, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const results = { phases: [], perfByEra: [], e5Timeline: [], pageErrors: [], consoleErrors: [] };
const log = (phase, ok, detail) => {
  results.phases.push({ phase, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${phase}] ${detail}`);
};

// boot 探针（同 game-test.mjs）：轮询 #loader 隐藏或任一屏幕出现
async function waitBoot(page, timeoutMs) {
  const t0 = Date.now();
  const probe = async () => {
    try {
      return await page.evaluate(() => ({
        loaderHidden: document.getElementById('loader')?.classList.contains('hidden') ?? null,
        screens: ['authScreen', 'startScreen', 'menuScreen', 'topBar']
          .filter(id => !document.getElementById(id)?.classList.contains('hidden')),
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

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
         '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-proxy-server'],
});
const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
const page = await ctx.newPage();
page.setDefaultTimeout(30000);
page.on('console', m => { if (m.type() === 'error') results.consoleErrors.push(m.text().slice(0, 300)); });
page.on('pageerror', e => results.pageErrors.push(String(e).slice(0, 400)));

const URL = 'http://localhost:8080/?debug=1&seed=777';
const USER = 'stress_bot_' + Date.now().toString(36);
const PW = 'pw12345678';

const eraText = () => page.textContent('#eraBadge');
const popText = () => page.textContent('#popVal').catch(() => '?');
const samplePerf = () => page.evaluate(() => window.__perf || null).catch(() => null);

// 连续采样 n 次（间隔 gapMs），返回均值与末值
async function sampleN(n, gapMs) {
  const arr = [];
  for (let i = 0; i < n; i++) {
    const p = await samplePerf();
    if (p) arr.push({ ...p, pop: await popText() });
    await page.waitForTimeout(gapMs);
  }
  if (!arr.length) return null;
  const avg = k => +(arr.reduce((s, p) => s + (p[k] || 0), 0) / arr.length).toFixed(1);
  return { avgFps: avg('fps'), avgFrameMs: avg('frameMs'), maxMs: Math.max(...arr.map(p => p.maxMs)),
           drawCalls: arr.at(-1).drawCalls, triangles: arr.at(-1).triangles,
           popStart: arr[0].pop, popEnd: arr.at(-1).pop, samples: arr.length };
}

// 点调试按钮并计时（dbgFill 会全量重建地形，可能阻塞主线程数十秒）
async function clickTimed(sel, timeoutMs = 300000) {
  const t0 = Date.now();
  await page.click(sel, { timeout: timeoutMs });
  await page.waitForTimeout(300);
  return Date.now() - t0;
}

try {
  // ── A: 注册 + 新游戏（保留 debug=1，否则无 __perf 与调试面板）──
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.click('#tabReg');
  await page.fill('#authUser', USER);
  await page.fill('#authPw', PW);
  await page.click('#authBtn');
  await page.waitForSelector('#menuScreen:not(.hidden)', { timeout: 10000 });
  await page.evaluate(() => sessionStorage.setItem('td_boot', 'new'));
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const boot = await waitBoot(page, 60000);
  await page.waitForSelector('#startScreen:not(.hidden)', { timeout: 20000 });
  await page.click('#startBtn');
  await page.waitForSelector('#topBar:not(.hidden)', { timeout: 30000 });
  await page.waitForTimeout(2000);
  log('A.boot+新游戏', boot.ok, `bootMs=${boot.ms}`);

  // ── B: 调试面板 + 静音按钮冒烟 ──
  const panelVisible = await page.isVisible('#debugPanel:not(.hidden)');
  const power0 = await page.textContent('#powerVal');
  await page.click('#dbgGive');
  await page.waitForTimeout(400);
  const power1 = await page.textContent('#powerVal');
  log('B1.调试面板+刷资源', panelVisible && Number(power1) >= Number(power0),
    `panel=${panelVisible} power ${power0}→${power1}`);
  const mute0 = await page.textContent('#muteBtn');
  await page.click('#muteBtn');
  await page.waitForTimeout(200);
  const mute1 = await page.textContent('#muteBtn');
  const lsMuted = await page.evaluate(() => localStorage.getItem('td/audio/muted'));
  await page.click('#muteBtn'); // 恢复非静音，避免干扰后续（音频无碍，但保持默认态）
  log('B2.静音按钮', mute0 !== mute1 && lsMuted !== null,
    `"${mute0}"→"${mute1}" ls=${lsMuted}`);
  await page.screenshot({ path: `${SHOTS}/01-debug-panel.png` });

  // ── C: ×4 加速 ──
  await page.click('[data-spd="4"]');
  const era0 = await eraText();

  // ── D: 逐时代「奇迹→刷建筑→跳时代」──
  // 奇迹必须先于 dbgFill：刷建筑后地块 zone>0，placeWonder 会拒绝
  // 中心点优先 + 8 向 ±150px（对角 ~±106）兜底：相机已传送出建筑区，中心即空地
  const wonderOffsets = [
    [0, 0],
    [0, -150], [150, 0], [0, 150], [-150, 0],
    [106, -106], [106, 106], [-106, 106], [-106, -106],
  ];
  // 各时代奇迹耗时（config.js WONDERS.time）：低帧率下 sim 仅 ~0.2s/真实秒（×4 速），
  // 完工等待 ≈ time×5 秒，另加 60s 余量
  const WONDER_TIME = { 1: 24, 2: 30, 3: 36 };
  for (let eraIdx = 0; eraIdx <= 3; eraIdx++) {
    const eraLabel = `E${eraIdx + 1}`;
    // D1 奇迹（E2 起需要；E1 无奇迹门槛）
    if (eraIdx >= 1) {
      await page.click('#dbgGive'); // 信仰补满（cap = 2×cost，必然够）
      await page.waitForTimeout(200);
      // 相机传送到 +x 轴 eraIdx*80 单位处，逃离以原点为中心的刷建筑区
      // （E1 半径~22 / E2~70 / E3~139；W 键平移受 dt clamp 限制，~1fps 下 5s 仅挪 ~3 单位，无效）
      await page.evaluate((d) => window.__tdPan(d, 0), eraIdx * 80);
      await page.waitForTimeout(1500);
      await page.click('#wonderBtn');
      await page.waitForTimeout(200);
      const box = await page.locator('#gameCanvas').boundingBox();
      const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
      let placed = false;
      for (const [dx, dy] of wonderOffsets) {
        const placing = await page.evaluate(() =>
          document.getElementById('wonderBtn').classList.contains('placing'));
        if (!placing) break; // 已放置或未能进入放置模式
        await page.mouse.click(cx + dx, cy + dy);
        await page.waitForTimeout(400);
        placed = !(await page.evaluate(() =>
          document.getElementById('wonderBtn').classList.contains('placing')));
        if (placed) break;
      }
      // 等奇迹完工：低帧率下 sim ≈ 0.2s/真实秒，需 time×5 + 60s 余量
      await page.waitForFunction(() =>
        (document.getElementById('wonderBtn')?.title || '').includes('已建成'),
        null, { timeout: (WONDER_TIME[eraIdx] * 5 + 60) * 1000 }).catch(() => {});
      const title = await page.evaluate(() => document.getElementById('wonderBtn')?.title || '');
      log(`D${eraLabel}.奇迹`, placed && title.includes('已建成'), `placed=${placed} title="${title}"`);
      await page.screenshot({ path: `${SHOTS}/02-wonder-${eraLabel}.png` });
    }
    // D2 刷建筑（计时）
    const fillMs = await clickTimed('#dbgFill');
    const fillToast = await page.evaluate(() =>
      document.getElementById('toast')?.textContent || '');
    const perfFill = await sampleN(6, 500);
    results.perfByEra.push({ stage: `${eraLabel}.刷建筑后`, fillMs, toast: fillToast, ...perfFill });
    log(`D${eraLabel}.刷建筑`, true, `fillMs=${fillMs} toast="${fillToast}" perf=${JSON.stringify(perfFill)}`);
    // D3 跳时代（失败则中止：时代错位会污染后续所有数据）
    if (eraIdx < 3) {
      const before = await eraText();
      await page.click('#dbgEra');
      await page.waitForFunction(([sel, old]) =>
        document.querySelector(sel)?.textContent !== old, ['#eraBadge', before], { timeout: 15000 }).catch(() => {});
      const after = await eraText();
      const eraToast = await page.evaluate(() => document.getElementById('toast')?.textContent || '');
      log(`D${eraLabel}.跳时代`, before !== after, `eraBadge "${before.trim().replace(/\s+/g, '')}"→"${after.trim().replace(/\s+/g, '')}" toast="${eraToast}"`);
      if (before === after) throw new Error(`跳时代失败于 ${eraLabel}，toast="${eraToast}"`);
    }
    await page.screenshot({ path: `${SHOTS}/03-fill-${eraLabel}.png` });
  }

  // ── E: E5 规模长采样（60×1s，含人口增长曲线）──
  const fillMsE5 = await clickTimed('#dbgFill'); // era=E5 时再刷一轮（每类封顶 2000）
  log('E0.E5刷建筑', true, `fillMs=${fillMsE5}`);
  for (let i = 0; i < 60; i++) {
    const p = await samplePerf();
    if (p) results.e5Timeline.push({ t: i, ...p, pop: await popText() });
    await page.waitForTimeout(1000);
  }
  const fpsArr = results.e5Timeline.map(x => x.fps);
  const avgFps = fpsArr.length ? +(fpsArr.reduce((a, b) => a + b, 0) / fpsArr.length).toFixed(1) : -1;
  const minFps = fpsArr.length ? Math.min(...fpsArr) : -1;
  const last = results.e5Timeline.at(-1) || {};
  log('E1.E5长采样', fpsArr.length >= 30,
    `samples=${fpsArr.length} avgFps=${avgFps} minFps=${minFps} maxMs=${last.maxMs} draws=${last.drawCalls} tris=${last.triangles} pop ${results.e5Timeline[0]?.pop}→${last.pop}`);
  await page.screenshot({ path: `${SHOTS}/04-e5-final.png` });

  // ── F: 全程无 pageError ──
  log('F.pageErrors', results.pageErrors.length === 0,
    `pageErrors=${results.pageErrors.length} consoleErrors=${results.consoleErrors.length}`);
} catch (e) {
  log('EXCEPTION', false, String(e).slice(0, 500));
  await page.screenshot({ path: `${SHOTS}/99-error.png` }).catch(() => {});
}

fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
console.log('\n== pageErrors =='); results.pageErrors.slice(0, 8).forEach(e => console.log(' P:', e));
console.log('== consoleErrors =='); results.consoleErrors.slice(0, 8).forEach(c => console.log(' E:', c));
const fail = results.phases.filter(p => !p.ok);
console.log(`\nTOTAL phases=${results.phases.length} fail=${fail.length} OUT=${OUT}`);
await browser.close();
process.exit(fail.length ? 1 : 0);
