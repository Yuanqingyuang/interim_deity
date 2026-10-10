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

// ── 门禁（2026-10 新增）──
// 原实现只打印 navMs / longTasks / 慢资源，从不判定，于是永远退出 0。
// 阈值刻意宽松：本测试在软件渲染（SwiftShader）与 CI 低配机上跑，绝对值会漂移，
// 故只拦截「数量级异常」——例如某次改动让启动退化数倍、或渲染循环根本没跑起来。
{
  const fails = [];
  const gate = (ok, msg)=>{ console.log((ok ? 'PASS  ' : 'FAIL  ') + '[启动] ' + msg); if(!ok) fails.push(msg); };
  gate(!out.error, '流程无异常' + (out.error ? '（' + out.error + '）' : ''));
  const runs = out.runs || [];
  gate(runs.length === 2, '两个场景都跑完（实测 ' + runs.length + '/2）');
  for(const r of runs){
    const tag = r.tag || '?';
    gate(r.selOk !== false, tag + '：启动后出现了预期界面');
    gate(!r.err, tag + '：未出现页面内采集错误');
    // boot 必须在 8s 内让界面可见（本机实测约 0.9s；CI 放宽 8 倍余量）
    gate(typeof r.navMs === 'number' && r.navMs < 8000, tag + '：navMs=' + r.navMs + ' < 8000');
    // DCL 与 loaderHidden 打点必须存在（说明 JS 真的执行到了 boot）
    const dcl = r.marks?.find(m => m.n === 'DCL' || m.n === 'DCL(already)')?.at;
    gate(typeof dcl === 'number', tag + '：DCL 打点存在（' + dcl + '）');
    const hidden = r.marks?.find(m => m.n === 'loaderHidden')?.at;
    gate(typeof hidden === 'number' && hidden < 8000, tag + '：loader 在 8s 内隐藏（' + hidden + '）');
    // longTask 总量不得异常（实测约 0.5–1.1s；>6s 说明主线程被长期阻塞）
    gate(r.longTaskTotalMs < 6000, tag + '：longTask 总量 ' + r.longTaskTotalMs + 'ms < 6000');
  }
  if(fails.length){ console.log('\n启动计时 FAIL：' + fails.length + ' 项未通过'); process.exit(1); }
  console.log('\n启动计时 PASS');
}
