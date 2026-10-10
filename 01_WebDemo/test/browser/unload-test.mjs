// 对照实验：旧页面卸载延迟的归因
// A) 注册进游戏 → 立即二次 goto
// B) 注册进游戏 → 停 rAF 循环 → 二次 goto（若明显更快 → 渲染循环是主因）
//
// 注意：这是**归因探针**而非通过/失败门禁 —— 「停 rAF 无显著改善」本身也是一个有效结论，
// 不应判失败。故此处只对**健壮性**设门禁：两个场景都必须跑完、导航不得挂死、
// 不得抛异常。真正的性能红线在 boot-timing 与 stress-test。
import { launchBrowser } from './browser.mjs';

const URL = process.env.GAME_URL || 'http://localhost:8080/?debug=1&seed=12345';
const browser = await launchBrowser();
const out = { runs: [], notes: [] };

async function trial(tag, stopRaf) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.message).slice(0, 160)));
  let navMs = null, bootOk = false, err = null;
  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('#authScreen:not(.hidden)', { timeout: 30000 });
    const U = tag.replace(/[^a-z]/gi, '') + Date.now().toString(36);
    await page.click('#tabReg');
    await page.fill('#authUser', U);
    await page.fill('#authPw', 'pw12345678');
    await page.click('#authBtn');
    await page.waitForSelector('#menuScreen:not(.hidden)', { timeout: 20000 });
    await page.waitForTimeout(2000); // 让渲染循环跑起来
    if (stopRaf) {
      await page.evaluate(() => {
        window.requestAnimationFrame = () => 0;
        window.cancelAnimationFrame = () => {};
      });
      await page.waitForTimeout(2500); // 等当前帧结束、循环断掉
    }
    const t0 = Date.now();
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    navMs = Date.now() - t0;
    // 二次导航后页面必须仍可用（这是卸载路径真正要保证的）
    bootOk = await page.evaluate(() => document.readyState === 'complete' || document.readyState === 'interactive');
    console.log(`[${tag}] 二次导航 DCL 耗时 = ${navMs}ms  页面可用=${bootOk}`);
  } catch (e) {
    err = String(e).slice(0, 220);
    console.log(`[${tag}] EXCEPTION ${err}`);
  }
  await ctx.close();
  const rec = { tag, stopRaf, navMs, bootOk, err, pageErrors: errs };
  out.runs.push(rec);
  return rec;
}

try {
  const a = await trial('A-渲染循环运行', false);
  const b = await trial('B-停掉rAF后', true);
  if (a.navMs != null && b.navMs != null) {
    console.log(`结论: A=${a.navMs}ms B=${b.navMs}ms ${b.navMs < a.navMs / 3 ? '→ rAF渲染循环是卸载延迟主因' : '→ 停rAF无显著改善，延迟来自WebGL上下文销毁或其他'}`);
  }
} catch (e) {
  out.fatal = String(e).slice(0, 300);
  console.log('EXCEPTION', out.fatal);
}

await browser.close();

// ── 健壮性门禁（2026-10 新增）──
// 原实现只打印两次耗时，异常时也退出 0，等于没有拦截力。
// 这里不判定「谁更快」（那是归因结论，不是对错），只判定流程是否可靠完成。
{
  const fails = [];
  const gate = (ok, msg)=>{ console.log((ok ? 'PASS  ' : 'FAIL  ') + '[卸载] ' + msg); if(!ok) fails.push(msg); };
  gate(!out.fatal, '流程无致命异常' + (out.fatal ? '（' + out.fatal + '）' : ''));
  gate(out.runs.length === 2, '两个场景都跑完（实测 ' + out.runs.length + '/2）');
  for(const r of out.runs){
    gate(!r.err, r.tag + '：未抛异常' + (r.err ? '（' + r.err + '）' : ''));
    // 二次导航必须在 30s 内完成：卸载挂死会让玩家"关不掉页面"
    gate(typeof r.navMs === 'number' && r.navMs < 30000, r.tag + '：二次导航 ' + r.navMs + 'ms < 30000');
    gate(r.bootOk === true, r.tag + '：二次导航后页面仍可用');
    gate(r.pageErrors.length === 0, r.tag + '：无 pageError' + (r.pageErrors.length ? '（' + r.pageErrors[0] + '）' : ''));
  }
  if(fails.length){ console.log('\n卸载测试 FAIL：' + fails.length + ' 项未通过'); process.exit(1); }
  console.log('\n卸载测试 PASS');
}
