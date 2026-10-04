// P1 高人口压测（规划书 §4.4）：借助 ?debug=1 调试面板逐时代刷建筑/跳时代，
// 采样 window.__perf（fps/frameMs/maxMs/drawCalls/triangles）与人口曲线，
// 输出 E1→E5 建筑规模 vs 帧率数据，作为 §5「建筑代理比」决策输入。
import { launchBrowser } from './browser.mjs';
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

const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
const page = await ctx.newPage();
page.setDefaultTimeout(30000);
page.on('console', m => { if (m.type() === 'error') results.consoleErrors.push(m.text().slice(0, 300)); });
page.on('pageerror', e => results.pageErrors.push(String(e).slice(0, 400)));

const URL = 'http://localhost:8080/?debug=1&seed=777';
const USER = 'stress_bot_' + Date.now().toString(36);
const PW = 'pw12345678';

const eraText = () => page.textContent('#eraBadge');
const samplePerf = () => page.evaluate(() => window.__perf || null).catch(() => null);

// 连续采样 n 次（间隔 gapMs），返回均值与末值
// 规模读数（era/pop/houses/farms/inds/churches）取自 __perf：
// toast 会被里程碑提示覆盖，不能作为建筑数来源
async function sampleN(n, gapMs) {
  const arr = [];
  for (let i = 0; i < n; i++) {
    const p = await samplePerf();
    if (p) arr.push(p);
    await page.waitForTimeout(gapMs);
  }
  if (!arr.length) return null;
  const avg = k => +(arr.reduce((s, p) => s + (p[k] || 0), 0) / arr.length).toFixed(1);
  const last = arr.at(-1);
  return { avgFps: avg('fps'), avgFrameMs: avg('frameMs'), maxMs: Math.max(...arr.map(p => p.maxMs)),
           drawCalls: last.drawCalls, triangles: last.triangles,
           houses: last.houses, farms: last.farms, inds: last.inds, churches: last.churches,
           popStart: arr[0].pop, popEnd: last.pop, samples: arr.length };
}

// 点调试按钮并计时（dbgFill 会全量重建地形，可能阻塞主线程数十秒）
async function clickTimed(sel, timeoutMs = 300000) {
  const t0 = Date.now();
  await hardClick(sel, timeoutMs);
  await page.waitForTimeout(300);
  return Date.now() - t0;
}

// 软渲染下长帧常占满主线程，playwright 真实点击会在「稳定性检查 + 事件派发」阶段超时
// （实测：39 万三角面满城视图下 #dbgEra 点击 30s 超时）；超时后退回页内 click，
// 对调试面板 / 顶栏按钮效果等价，不影响游戏逻辑断言
async function hardClick(sel, timeoutMs = 60000) {
  try {
    await page.click(sel, { timeout: timeoutMs });
  } catch {
    await page.evaluate((s) => document.querySelector(s)?.click(), sel);
  }
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
  // 各时代奇迹耗时（config.js WONDERS.time）：低帧率下 sim 仅 ~0.2s/真实秒（×4 速），
  // 完工等待 ≈ time×5 秒，另加 60s 余量
  const WONDER_TIME = { 1: 24, 2: 30, 3: 36 };
  for (let eraIdx = 0; eraIdx <= 3; eraIdx++) {
    const eraLabel = `E${eraIdx + 1}`;
    // D1 奇迹（E2 起需要；E1 无奇迹门槛）
    if (eraIdx >= 1) {
      await hardClick('#dbgGive'); // 信仰补满（cap = 2×cost，必然够）
      await page.waitForTimeout(200);
      // 相机传送到 +x 轴 eraIdx*80 单位处，逃离以原点为中心的刷建筑区
      // （E1 半径~22 / E2~70 / E3~139；W 键平移受 dt clamp 限制，~1fps 下 5s 仅挪 ~3 单位，无效）
      await page.evaluate((d) => window.__tdPan(d, 0), eraIdx * 80);
      await page.waitForTimeout(1500);
      await hardClick('#wonderBtn'); // 走真实 UI 进入放置模式
      await page.waitForTimeout(200);
      const isPlacing = () => page.evaluate(() =>
        document.getElementById('wonderBtn').classList.contains('placing'));
      let placed = false, probe = null;
      if (await isPlacing()) {
        // 先试屏幕中心真实点击；斜视角下落点常偏离相机目标（水面/未生成区块），
        // 失败则用 __tdWonder 探针兜底（在已生成区块内找最近合法格，复用 placeWonder 校验）
        const box = await page.locator('#gameCanvas').boundingBox();
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(400);
        placed = !(await isPlacing());
        if (!placed) {
          probe = await page.evaluate(() => window.__tdWonder?.() || null);
          placed = !!probe?.ok;
        }
      }
      // 等奇迹完工：低帧率下 sim ≈ 0.2s/真实秒，需 time×5 + 60s 余量
      await page.waitForFunction(() =>
        (document.getElementById('wonderBtn')?.title || '').includes('已建成'),
        null, { timeout: (WONDER_TIME[eraIdx] * 5 + 60) * 1000 }).catch(() => {});
      const title = await page.evaluate(() => document.getElementById('wonderBtn')?.title || '');
      log(`D${eraLabel}.奇迹`, placed && title.includes('已建成'), `placed=${placed} probe=${JSON.stringify(probe)} title="${title}"`);
      await page.screenshot({ path: `${SHOTS}/02-wonder-${eraLabel}.png` });
      // 相机回城市中心（原点）：dbgFill 恒以原点为中心刷建筑，采样必须看城市视角；
      // 否则传送距离超过城市半径时（E4 传送 240 单位 > 城市半径 ~206 单位）采样到的是空景
      await page.evaluate(() => window.__tdPan(0, 0));
      await page.waitForTimeout(1500);
    }
    // D2 刷建筑（计时）
    const fillMs = await clickTimed('#dbgFill');
    const perfFill = await sampleN(6, 500);
    results.perfByEra.push({ stage: `${eraLabel}.刷建筑后`, fillMs, ...perfFill });
    log(`D${eraLabel}.刷建筑`, !!perfFill,
      `fillMs=${fillMs} 居${perfFill?.houses} 田${perfFill?.farms} 工${perfFill?.inds} 教${perfFill?.churches} ` +
      `fps=${perfFill?.avgFps} draws=${perfFill?.drawCalls} tris=${perfFill?.triangles} pop=${perfFill?.popEnd}`);
    // D3 跳时代（失败则中止：时代错位会污染后续所有数据）
    // 实测首次点击偶发不生效（里程碑提示与 dbgEra 竞态），重试 3 次
    if (eraIdx < 3) {
      const before = await eraText();
      let after = before, eraToast = '';
      for (let attempt = 1; attempt <= 3; attempt++) {
        await hardClick('#dbgEra');
        await page.waitForFunction(([sel, old]) =>
          document.querySelector(sel)?.textContent !== old, ['#eraBadge', before], { timeout: 15000 }).catch(() => {});
        after = await eraText();
        eraToast = await page.evaluate(() => document.getElementById('toast')?.textContent || '');
        if (before !== after) break;
        await page.waitForTimeout(1000);
      }
      log(`D${eraLabel}.跳时代`, before !== after, `eraBadge "${before.trim().replace(/\s+/g, '')}"→"${after.trim().replace(/\s+/g, '')}" toast="${eraToast}"`);
      if (before === after) throw new Error(`跳时代失败于 ${eraLabel}，toast="${eraToast}"`);
    }
    await page.screenshot({ path: `${SHOTS}/03-fill-${eraLabel}.png` });
  }

  // ── E: 末代（IV 工业时代）城市视角长采样（60×1s，含人口增长曲线）──
  // 注：V 星际时代门槛为产能 1500/s，压测规模（工业封顶 2000 座 ≈921/s）达不到，故末代止于 IV
  const fillMsE5 = await clickTimed('#dbgFill'); // 再刷一轮（每类封顶 2000；原点区饱和时新增≈0）
  const scaleE5 = await samplePerf();
  log('E0.末代刷建筑', !!scaleE5,
    `fillMs=${fillMsE5} 居${scaleE5?.houses} 田${scaleE5?.farms} 工${scaleE5?.inds} 教${scaleE5?.churches} pop=${scaleE5?.pop}`);
  for (let i = 0; i < 60; i++) {
    const p = await samplePerf();
    if (p) results.e5Timeline.push({ t: i, ...p });
    await page.waitForTimeout(1000);
  }
  const fpsArr = results.e5Timeline.map(x => x.fps);
  const avgFps = fpsArr.length ? +(fpsArr.reduce((a, b) => a + b, 0) / fpsArr.length).toFixed(1) : -1;
  const minFps = fpsArr.length ? Math.min(...fpsArr) : -1;
  const last = results.e5Timeline.at(-1) || {};
  log('E1.末代长采样', fpsArr.length >= 30,
    `samples=${fpsArr.length} avgFps=${avgFps} minFps=${minFps} maxMs=${last.maxMs} draws=${last.drawCalls} tris=${last.triangles} pop ${results.e5Timeline[0]?.pop}→${last.pop}`);
  // 软渲染下满城视图单帧截图可超默认 30s：放宽到 120s，且失败降级为尽力而为
  // （截图仅存档用，不影响数据结论；此前正是此处超时导致 results.json 未落盘）
  await page.screenshot({ path: `${SHOTS}/04-e5-final.png`, timeout: 120000 }).catch(() => {});

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
