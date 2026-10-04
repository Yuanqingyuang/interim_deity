// 全平台矩阵实测：浏览器引擎 × 设备档案（桌面/移动触控），逐格采集
// boot 耗时 / WebGL 能力 / 注册→新游戏→建造→暂停→读档 主链路 / 布局健壮性 / 控制台错误 / 截图证据。
// 引擎不可用时标记 skipped，不阻塞其余格子。
import { chromium, firefox, webkit } from 'playwright-core';
import { launchBrowser, resolveBrowserPath } from './browser.mjs';
import fs from 'fs';
import os from 'os';
import path from 'path';

// 浏览器子进程继承环境代理会导致 localhost 请求失败，统一清除
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'])
  delete process.env[k];

const OUT = process.env.TD_OUT || path.join(os.tmpdir(), 'td-browser-out');
const SHOTS = path.join(OUT, 'platform');
fs.mkdirSync(SHOTS, { recursive: true });

const BASE = 'http://localhost:8080/?debug=1&seed=12345';
const PW = 'pw12345678';

const ALL_ENGINES = [
  // chromium 走共享启动器：优先复用系统已装的 Edge/Chrome，避免依赖
  // `npx playwright install` 下载（数百 MB）。firefox/webkit 仍需各自构建。
  { name: 'chromium', mod: chromium, sys: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  { name: 'firefox', mod: firefox, args: [] },
  { name: 'webkit', mod: webkit, args: [] },
];

// TD_ENGINES=chromium,webkit 可只跑部分引擎；TD_PROFILES=mobile 可只跑部分设备档案
// （单引擎结果落独立文件，便于分批执行后合并；带档案过滤时文件名追加档案，避免覆盖整批结果）
const ONLY = (process.env.TD_ENGINES || '').split(',').map(s => s.trim()).filter(Boolean);
const ONLY_P = (process.env.TD_PROFILES || '').split(',').map(s => s.trim()).filter(Boolean);
const ENGINES = ONLY.length ? ALL_ENGINES.filter(e => ONLY.includes(e.name)) : ALL_ENGINES;
const RESULT_FILE = path.join(
  OUT,
  ONLY.length === 1
    ? `platform-results-${ONLY[0]}${ONLY_P.length ? '-' + ONLY_P.join('+') : ''}.json`
    : 'platform-results.json',
);

const PROFILES = [
  { name: 'desktop', viewport: { width: 1440, height: 900 } },
  {
    name: 'mobile',
    viewport: { width: 390, height: 844 },
    context: {
      isMobile: true, hasTouch: true, deviceScaleFactor: 3,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    },
  },
];

const PROFILES_RUN = ONLY_P.length ? PROFILES.filter(p => ONLY_P.includes(p.name)) : PROFILES;

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
    if (state.loaderHidden === true || state.screens?.length) return { ok: true, state, ms: Date.now() - t0 };
    await page.waitForTimeout(500);
    state = await probe();
  }
  return { ok: false, state, ms: Date.now() - t0 };
}

const matrix = [];

async function runCell(engine, profile) {
  const cell = { engine: engine.name, profile: profile.name, steps: [], consoleErrors: [], pageErrors: [] };
  const shotDir = path.join(SHOTS, `${engine.name}_${profile.name}`);
  fs.mkdirSync(shotDir, { recursive: true });
  const step = (name, ok, detail) => {
    cell.steps.push({ name, ok, detail });
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  [${engine.name}/${profile.name}] ${name} — ${detail}`);
  };
  const shot = async (page, name) => {
    try { await page.screenshot({ path: path.join(shotDir, `${name}.png`), timeout: 60000 }); } catch (e) { cell.shotErrors = (cell.shotErrors || []).concat(String(e).slice(0, 120)); }
  };

  let browser;
  try {
    browser = engine.sys
      ? await launchBrowser({ args: engine.args, timeout: 45000 })
      : await engine.mod.launch({ headless: true, args: engine.args, timeout: 45000 });
  } catch (e) {
    cell.skipped = true;
    cell.skipReason = String(e).split('\n')[0].slice(0, 200);
    console.log(`SKIP  [${engine.name}/${profile.name}] launch failed: ${cell.skipReason}`);
    matrix.push(cell);
    return;
  }

  const page = await (await browser.newContext({
    viewport: profile.viewport, ...(profile.context || {}),
  })).newPage();
  page.on('console', m => { if (m.type() === 'error') cell.consoleErrors.push(m.text().slice(0, 250)); });
  page.on('pageerror', e => cell.pageErrors.push(String(e).slice(0, 300)));

  try {
    // P1 加载 + WebGL 能力
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);
    const gl = await page.evaluate(() => {
      const c = document.createElement('canvas');
      const g = c.getContext('webgl2') || c.getContext('webgl');
      let renderer = '?';
      try { const d = g?.getExtension('WEBGL_debug_renderer_info'); if (d) renderer = g.getParameter(d.UNMASKED_RENDERER_WEBGL); } catch {}
      return { gl2: !!c.getContext('webgl2'), gl1: !!g, renderer };
    });
    cell.webgl = gl;
    const fallbackShown = await page.evaluate(() => document.body.innerText.includes('不支持 WebGL'));
    cell.fallbackShown = fallbackShown;
    step('P1.加载+WebGL', gl.gl1 || gl.gl2 || fallbackShown,
      `gl2=${gl.gl2} gl1=${gl.gl1} renderer=${String(gl.renderer).slice(0, 60)} fallbackShown=${fallbackShown}`);
    await shot(page, '01-load');

    if (!gl.gl1 && !gl.gl2) {
      // 无 WebGL：只验证降级路径是否可用，不再进游戏
      step('P2.降级路径', fallbackShown, '无 WebGL 时应展示「不支持 WebGL」降级提示');
      await shot(page, '02-fallback');
      cell.skipped = true; cell.skipReason = 'no WebGL';
      await browser.close(); matrix.push(cell); return;
    }

    // P3 注册新用户（移动端用触控 tap，桌面用点击）
    const authVisible = await page.isVisible('#authScreen:not(.hidden)');
    const user = `qa_${engine.name}_${profile.name}_${Date.now().toString(36)}`;
    const tap = async (sel) => profile.context?.hasTouch ? page.touchscreen.tap(...(await page.locator(sel).evaluate(e => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }))) : page.click(sel);
    step('P3a.登录卡可见', authVisible, `authVisible=${authVisible}`);
    await tap('#tabReg');
    await page.fill('#authUser', user);
    await page.fill('#authPw', PW);
    await shot(page, '03-register-form');
    await tap('#authBtn');
    await page.waitForSelector('#menuScreen:not(.hidden)', { timeout: 15000 });
    const authMsg = await page.textContent('#authMsg');
    step('P3b.注册进入菜单', true, `user=${user} msg="${authMsg}"`);
    await shot(page, '04-menu');

    // P4 新游戏 boot
    await page.evaluate(() => sessionStorage.setItem('td_boot', 'new'));
    const t0 = Date.now();
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 90000 });
    const boot = await waitBoot(page, 120000);
    cell.bootMs = Date.now() - t0;
    step('P4.boot新世界', boot.ok, `bootMs=${cell.bootMs}`);
    if (!boot.ok) throw new Error('boot timeout');
    await page.waitForSelector('#startScreen:not(.hidden)', { timeout: 30000 });
    await shot(page, '05-start-screen');
    await tap('#startBtn');
    await page.waitForSelector('#topBar:not(.hidden)', { timeout: 60000 });
    await page.waitForTimeout(2500);
    await shot(page, '06-world');
    step('P5.进入游戏世界', true, 'topBar visible');

    // P6 布局健壮性：无横向溢出 + 关键 HUD 在视口内（顶栏为 overflow-x:auto 单行设计，
    // 小屏下右侧控件可能落在视口外，需要记录证据：scrollWidth/clientWidth 与各控件 rect）
    const layout = await page.evaluate(() => {
      const vw = innerWidth, vh = innerHeight;
      const overflowX = document.documentElement.scrollWidth > vw + 1;
      const ids = ['topBar', 'powerVal', 'popVal', 'dayVal', 'eraBadge', 'quickSaveBtn', 'pauseBtn'];
      const rects = {};
      const offscreen = ids.filter(id => {
        const el = document.getElementById(id); if (!el) return true;
        const r = el.getBoundingClientRect();
        rects[id] = [Math.round(r.left), Math.round(r.right)];
        return r.width === 0 || r.right > vw + 1 || r.bottom > vh + 1 || r.left < -1 || r.top < -1;
      });
      const tb = document.getElementById('topBar');
      const c = document.getElementById('gameCanvas'); const cr = c?.getBoundingClientRect();
      return {
        vw, vh, overflowX, offscreen, rects,
        topbarScroll: tb ? { sw: tb.scrollWidth, cw: tb.clientWidth } : null,
        pop: document.getElementById('popVal')?.textContent ?? null,
        canvasCss: cr ? { w: Math.round(cr.width), h: Math.round(cr.height) } : null,
      };
    });
    cell.layout = layout;
    step('P6.布局健壮性', !layout.overflowX && layout.offscreen.length === 0,
      `viewport=${layout.vw}x${layout.vh} overflowX=${layout.overflowX} offscreen=[${layout.offscreen}] ` +
      `topbar=${JSON.stringify(layout.topbarScroll)} pop=${layout.pop} canvas=${JSON.stringify(layout.canvasCss)}`);

    // P7 建造交互
    // 软渲染下 main.js 把 dt 钳到 50ms/帧，单位墙钟时间内结算极少，短拖拽看不到整数级扣除。
    // 因此：先把世界速度调到 ×4，分区放置用「失败原因 toast」判定（handleDown 失败会弹原因码文案），
    // 地形笔刷（每帧按 cost*gdt 结算）用长拖拽验证神力确实扣除 —— 覆盖输入管线 + 资源经济。
    const FAIL_MSG = /神力不足|超出地图范围|水面不能划定分区|该地块已有分区|地形过高或过低|不满足放置条件|这里没有可拆除的分区|无法在此操作/;
    const readToast = async () => (await page.textContent('#toast').catch(() => '')) || '';
    const box = await page.locator('#gameCanvas').boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    const drag = async (ms, dx, dy, ox = 0, oy = 0) => {
      const steps = Math.max(6, Math.round(ms / 600));
      const x0 = cx + ox, y0 = cy + oy;
      if (profile.context?.hasTouch) {
        // WebKit 不支持 new TouchEvent()（Illegal constructor），降级为带 touches 属性的普通 Event；
        // 游戏 handler 只读 e.touches[0].clientX/Y，普通 Event 同样能走通触控代码路径。
        await page.evaluate(({ x, y, steps, dx, dy, ms }) => new Promise(res => {
          const c = document.getElementById('gameCanvas');
          const mk = (type, px, py) => {
            const end = type === 'touchend';
            let touch;
            try { touch = new Touch({ identifier: 1, target: c, clientX: px, clientY: py, pageX: px, pageY: py }); }
            catch { touch = { identifier: 1, target: c, clientX: px, clientY: py, pageX: px, pageY: py }; }
            const init = {
              touches: end ? [] : [touch], targetTouches: end ? [] : [touch], changedTouches: [touch],
              bubbles: true, cancelable: true,
            };
            let ev;
            try {
              ev = new TouchEvent(type, init);
            } catch {
              // bubbles/cancelable 是 Event 原型上的只读访问器，Object.assign 会抛
              // "Attempted to assign to readonly property"，只能用 defineProperty 挂触控列表。
              ev = new Event(type, { bubbles: true, cancelable: true });
              Object.defineProperties(ev, {
                touches: { value: init.touches, configurable: true },
                targetTouches: { value: init.targetTouches, configurable: true },
                changedTouches: { value: init.changedTouches, configurable: true },
              });
            }
            c.dispatchEvent(ev);
          };
          mk('touchstart', x, y);
          let i = 0;
          const iv = setInterval(() => {
            i++;
            mk('touchmove', x + dx * i / steps, y + dy * i / steps);
            if (i >= steps) { clearInterval(iv); mk('touchend', x + dx, y + dy); res(); }
          }, ms / steps);
        }), { x: x0, y: y0, steps, dx, dy, ms });
      } else {
        await page.mouse.move(x0, y0);
        await page.mouse.down();
        for (let i = 1; i <= steps; i++) {
          await page.mouse.move(x0 + dx * i / steps, y0 + dy * i / steps);
          await page.waitForTimeout(ms / steps);
        }
        await page.mouse.up();
      }
    };
    const inputMode = profile.context?.hasTouch ? 'touch' : 'mouse';

    await tap('[data-spd="4"]');
    const spdActive = await page.evaluate(() => document.querySelector('.spd.active')?.dataset.spd ?? '?');
    // G-06：只有「落点单击」失败会弹原因 toast，拖拽路径不弹。河道由噪声蜿蜒生成，
    // 画布中心不保证是陆地，因此多候选偏移点重试：每轮先清空 toast 再落点拖拽，无失败 toast 即成功。
    // 候选点避开左列工具栏(|fx|≤0.22)、底部进阶条(|fy|≤0.30 时距底边仍有余量)。
    const clearToast = () => page.evaluate(() => {
      const t = document.getElementById('toast');
      if (t) { t.textContent = ''; t.classList.remove('show'); }
    });
    const zdx = Math.round(Math.min(90, box.width * 0.16));
    const zdy = Math.round(Math.min(24, box.height * 0.05));
    const CAND = [[-0.22, -0.24], [0.22, -0.24], [-0.22, 0.24], [0.22, 0.24], [0, -0.30], [0, 0.30], [-0.18, 0], [0.26, 0], [0, 0]];
    let zoneOk = false, zoneToast = '', tried = 0;
    for (const [fx, fy] of CAND) {
      tried++;
      await tap('[data-tool="z_res"]');
      await clearToast();
      await drag(2400, zdx, zdy, box.width * fx, box.height * fy);
      zoneToast = await readToast();
      if (!FAIL_MSG.test(zoneToast)) { zoneOk = true; break; }
    }
    step('P7a.分区放置(居住)', zoneOk, `${inputMode} speed=×${spdActive} tried=${tried} toast="${zoneToast || '(无失败提示)'}"`);
    await shot(page, '07a-after-zone');

    // 地形笔刷在「无可改变的地块」上 used=0 不扣费，因此依次尝试 抬升/下沉/引水，任一生效即通过
    let powerBefore = Number(await page.textContent('#powerVal'));
    let powerAfter = powerBefore, viaTool = '-';
    for (const tool of ['raise', 'lower', 'water']) {
      await tap(`[data-tool="${tool}"]`);
      powerBefore = Number(await page.textContent('#powerVal'));
      await drag(9000, -120, 30);
      await page.waitForTimeout(800);
      powerAfter = Number(await page.textContent('#powerVal'));
      if (powerAfter < powerBefore) { viaTool = tool; break; }
    }
    step('P7b.地形笔刷扣神力', powerAfter < powerBefore, `${inputMode} via=${viaTool} power ${powerBefore} → ${powerAfter}`);
    await shot(page, '07b-after-raise');

    // P8 暂停/恢复 + 快速存档
    // 顶栏为 overflow-x:auto 单行设计，小屏下右侧按钮默认在视口外；
    // 触控档案无法 tap 视口外坐标，这里先模拟玩家横向滑动顶栏把按钮带进视口
    const reveal = async (sel) => page.evaluate((s) => {
      const el = document.querySelector(s); if (!el) return false;
      const tb = document.getElementById('topBar');
      const r = el.getBoundingClientRect();
      if (r.right > innerWidth || r.left < 0) tb.scrollLeft += r.right - innerWidth + 24;
      return true;
    }, sel);
    await reveal('#pauseBtn');
    await tap('#pauseBtn');
    await page.waitForSelector('#pauseMenu:not(.hidden)', { timeout: 5000 });
    await shot(page, '08-pause');
    await tap('#resumeBtn');
    await page.waitForTimeout(300);
    await reveal('#quickSaveBtn');
    await tap('#quickSaveBtn');
    await page.waitForTimeout(1500);
    const saved = await page.evaluate(() => Object.keys(localStorage).some(k => k.includes('save')));
    step('P8.暂停+快速存档', saved, `saveWritten=${saved}`);

    // P9 性能采样（debug HUD）
    const perfs = [];
    for (let i = 0; i < 4; i++) { const p = await page.evaluate(() => window.__perf || null); if (p) perfs.push(p); await page.waitForTimeout(400); }
    cell.perf = perfs.at(-1) || null;
    step('P9.性能采样', true, perfs.length ? `avgFps=${(perfs.reduce((s, p) => s + p.fps, 0) / perfs.length).toFixed(1)} last=${JSON.stringify(perfs.at(-1))}` : 'no __perf');

    // P10 中途改视口（旋转屏幕模拟）
    const rotated = profile.name === 'mobile' ? { width: 844, height: 390 } : { width: 1024, height: 640 };
    await page.setViewportSize(rotated);
    await page.waitForTimeout(1200);
    const after = await page.evaluate(() => {
      const c = document.getElementById('gameCanvas'); const r = c.getBoundingClientRect();
      return { cssW: Math.round(r.width), winW: innerWidth, alive: !!window.__perf };
    });
    step('P10.视口旋转适配', Math.abs(after.cssW - after.winW) < 4 && after.alive,
      `→${rotated.width}x${rotated.height} canvasW=${after.cssW} winW=${after.winW} alive=${after.alive}`);
    await shot(page, '09-rotated');
  } catch (e) {
    step('EXCEPTION', false, String(e).slice(0, 400));
    await shot(page, '99-error');
  }
  cell.ok = cell.steps.every(s => s.ok);
  await browser.close();
  matrix.push(cell);
}

for (const engine of ENGINES)
  for (const profile of PROFILES_RUN)
    await runCell(engine, profile);

fs.writeFileSync(RESULT_FILE, JSON.stringify(matrix, null, 2));
console.log(`\n结果文件: ${RESULT_FILE}`);
console.log('== 矩阵汇总 ==');
for (const c of matrix) {
  const fails = c.steps.filter(s => !s.ok).map(s => s.name);
  console.log(`${c.skipped ? 'SKIP' : c.ok ? 'PASS' : 'FAIL'}  ${c.engine}/${c.profile}` +
    ` boot=${c.bootMs ?? '-'}ms fps=${c.perf?.fps ?? '-'} consoleErr=${c.consoleErrors.length} pageErr=${c.pageErrors.length}` +
    (fails.length ? ` fails=[${fails}]` : '') + (c.skipReason ? ` reason=${c.skipReason}` : ''));
}
const hardFail = matrix.filter(c => !c.skipped && !c.ok).length;
console.log(`\nPLATFORM MATRIX: ${hardFail === 0 ? '✔ PASS' : `✘ ${hardFail} cell(s) failed`}`);
process.exit(hardFail === 0 ? 0 : 1);
