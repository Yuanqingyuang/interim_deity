// 对照实验：旧页面卸载延迟的归因
// A) 注册进游戏 → 立即二次 goto（预期慢 ~13s）
// B) 注册进游戏 → 停 rAF 循环 → 二次 goto（若快 → 渲染循环是主因）
import { launchBrowser } from './browser.mjs';

const URL = 'http://localhost:8080/?debug=1&seed=12345';
const browser = await launchBrowser();

async function trial(tag, stopRaf) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
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
  const navMs = Date.now() - t0;
  console.log(`[${tag}] 二次导航 DCL 耗时 = ${navMs}ms`);
  await ctx.close();
  return navMs;
}

const a = await trial('A-渲染循环运行', false);
const b = await trial('B-停掉rAF后', true);
console.log(`结论: A=${a}ms B=${b}ms ${b < a / 3 ? '→ rAF渲染循环是卸载延迟主因' : '→ 停rAF无显著改善，延迟来自WebGL上下文销毁或其他'}`);
await browser.close();
