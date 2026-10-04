// 精确测量 boot 耗时与主线程阻塞：全部在页面内计时，避免 evaluate 往返调度污染数据。
// 场景对照：①无会话(auth) ②td_boot=new(start) ③带存档读取
import { launchBrowser } from './browser.mjs';
import fs from 'fs';
import os from 'os';
import path from 'path';

const OUT = process.env.TD_OUT || path.join(os.tmpdir(), 'td-browser-out');
fs.mkdirSync(OUT, { recursive: true });
const URL = 'http://localhost:8080/?debug=1&seed=12345';
const out = { runs: [] };

const browser = await launchBrowser();

const INIT = () => {
  window.__boot = { marks: [], longTasks: [], resources: [] };
  const B = window.__boot;
  const t0 = performance.timeOrigin;
  const mark = (n, t) => B.marks.push({ n, at: +((t ?? performance.now())).toFixed(1) });
  mark('scriptStart', performance.now());
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) B.longTasks.push(+e.duration.toFixed(1));
    }).observe({ entryTypes: ['longtask'] });
  } catch (e) { B.longTaskErr = String(e).slice(0, 80); }
  const startObs = () => {
    const seen = new Set();
    new MutationObserver(() => {
      const now = performance.now();
      const l = document.getElementById('loader');
      if (l && l.classList.contains('hidden') && !seen.has('loader')) { seen.add('loader'); mark('loaderHidden', now); }
      for (const id of ['authScreen', 'startScreen', 'menuScreen', 'topBar', 'gameCanvas']) {
        const el = document.getElementById(id);
        if (!el) continue;
        const vis = id === 'gameCanvas' ? true : !el.classList.contains('hidden');
        if (vis && !seen.has(id)) { seen.add(id); mark('shown:' + id, now); }
      }
    }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { mark('DCL', performance.now()); startObs(); });
  else { mark('DCL(already)', performance.now()); startObs(); }
  window.addEventListener('load', () => mark('windowLoad', performance.now()));
};

async function run(tag, { fresh, wantNew, needRegister }) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  page.on('pageerror', e => out.runs.push({ tag, pageerror: String(e).slice(0, 200) }));

  if (needRegister) {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#authScreen:not(.hidden)', { timeout: 30000 });
    const U = 'boot_' + Date.now().toString(36);
    await page.click('#tabReg');
    await page.fill('#authUser', U);
    await page.fill('#authPw', 'pw12345678');
    await page.click('#authBtn');
    await page.waitForSelector('#menuScreen:not(.hidden)', { timeout: 20000 });
  }
  if (wantNew) await page.evaluate(() => sessionStorage.setItem('td_boot', 'new'));

  const navStart = Date.now();
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // 等 boot 结束：loaderHidden 或 任一屏幕出现
  const target = wantNew ? '#startScreen:not(.hidden)' : '#authScreen:not(.hidden), #menuScreen:not(.hidden)';
  let selOk = true;
  try { await page.waitForSelector(target, { timeout: 60000 }); } catch { selOk = false; }
  const navMs = Date.now() - navStart;
  await page.waitForTimeout(1500);

  const boot = await page.evaluate(() => {
    const B = window.__boot || {};
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const res = performance.getEntriesByType('resource')
      .map(r => ({ n: r.name.split('/').pop(), ms: +r.duration.toFixed(1), kb: +((r.transferSize || 0) / 1024).toFixed(1) }))
      .sort((a, b) => b.ms - a.ms).slice(0, 6);
    return {
      marks: B.marks, longTasks: (B.longTasks || []).slice(0, 25),
      longTaskCount: (B.longTasks || []).length,
      longTaskTotalMs: +((B.longTasks || []).reduce((s, x) => s + x, 0)).toFixed(1),
      longTaskMaxMs: Math.max(0, ...(B.longTasks || [0])),
      domContentLoadedMs: +((nav.domContentLoadedEventEnd || 0)).toFixed(1),
      loadEventMs: +((nav.loadEventEnd || 0)).toFixed(1),
      resources: res,
    };
  }).catch(e => ({ err: String(e).slice(0, 200) }));

  const rec = { tag, fresh, wantNew, selOk, navMs, ...boot };
  out.runs.push(rec);
  const find = n => boot.marks?.find(m => m.n === n)?.at ?? null;
  console.log(`\n[${tag}] 外部观测 navMs=${navMs} 页面内: DCL=${find('DCL') ?? find('DCL(already)')} loaderHidden=${find('loaderHidden')} shown=${JSON.stringify(boot.marks?.filter(m => m.n.startsWith('shown:')).map(m => [m.n, m.at]))}`);
  console.log(`  longTasks: count=${boot.longTaskCount} total=${boot.longTaskTotalMs}ms max=${boot.longTaskMaxMs}ms  首批=${JSON.stringify((boot.longTasks || []).slice(0, 8))}`);
  console.log(`  慢资源: ${JSON.stringify(boot.resources)}`);
  await ctx.close();
  return rec;
}

try {
  await run('①无会话首启', { fresh: true, wantNew: false, needRegister: false });
  await run('②注册后新游戏(td_boot=new)', { fresh: true, wantNew: true, needRegister: true });
} catch (e) {
  out.error = String(e).slice(0, 400);
  console.log('EXCEPTION', String(e).slice(0, 300));
}

fs.writeFileSync(path.join(OUT, 'boot-results.json'), JSON.stringify(out, null, 2));
await browser.close();
