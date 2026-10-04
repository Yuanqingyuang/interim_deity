// 安全专项（回归版）：①导入存档 meta 存储型 XSS —— 修复后预期被消毒、不执行
//                     ②非安全上下文（crypto.subtle 缺失）—— 修复后预期 kdf 标签为 'FNV-1a-weak'
// 运行前置：仓库根目录起静态服务（python3 -m http.server 8080），且本目录已 npm install
import { launchBrowser } from './browser.mjs';
import fs from 'fs';
import os from 'os';
import path from 'path';

const OUT = process.env.TD_OUT || path.join(os.tmpdir(), 'td-browser-out');
fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });
const out = {};
const browser = await launchBrowser();

async function waitBoot(page, ms = 40000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const s = await page.evaluate(() => ({
        hasLoader: !!document.getElementById('loader'),
        loader: document.getElementById('loader')?.classList.contains('hidden'),
        screens: ['authScreen', 'startScreen', 'menuScreen', 'topBar']
          .filter(id => document.getElementById(id) && !document.getElementById(id).classList.contains('hidden')),
      }));
      if (s.hasLoader && (s.loader === true || s.screens.length)) return s;
    } catch { return 'page-gone'; }
    await page.waitForTimeout(400);
  }
  return 'timeout';
}

// ══ 测试 1：模拟非安全上下文（crypto.subtle 缺失）下的密码哈希强度 ══
// 事实链：①http://localhost:8080 为非安全上下文时 isSecureContext=false、crypto.subtle=undefined
//         ②auth.js 无 subtle → FNV-1a 32位弱哈希兜底，但 kdf 必须诚实标注 'FNV-1a-weak'
//         ③本测试注入屏蔽 subtle，实证注册后 localStorage 中的哈希格式
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(() => {
    Object.defineProperty(Crypto.prototype, 'subtle', { get: () => undefined, configurable: true });
  });
  const page = await ctx.newPage();
  const url = `http://localhost:8080/?seed=777`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitBoot(page);
  const sec = await page.evaluate(() => ({
    isSecureContext: window.isSecureContext,
    subtle: typeof (globalThis.crypto && crypto.subtle),
    getRandomValues: typeof (globalThis.crypto && crypto.getRandomValues),
    origin: location.origin,
  }));
  out.secureContext = sec;
  console.log('[安全上下文]', JSON.stringify(sec));

  const U = 'sec_probe_' + Date.now().toString(36);
  await page.click('#tabReg');
  await page.fill('#authUser', U);
  await page.fill('#authPw', 'pw12345678');
  await page.click('#authBtn');
  await page.waitForTimeout(2500);
  const users = await page.evaluate((u) => {
    const all = JSON.parse(localStorage.getItem('td/users') || '{}');
    const rec = Object.values(all).find(x => x.username === u);
    return rec ? { kdf: rec.kdf, salt: rec.salt, saltLen: rec.salt.length,
                   hashPrefix: String(rec.hash).slice(0, 12), hashLen: String(rec.hash).length } : null;
  }, U);
  out.userRecord = users;
  console.log('[注册后存储的密码记录]', JSON.stringify(users));
  // C-02 修复后断言：subtle 缺失时仍走 FNV-1a 兜底，但 kdf 必须诚实标注 'FNV-1a-weak'
  //（旧版会伪装成 'PBKDF2-SHA256'），且必须带非空 salt。
  out.kdfLabel = users?.kdf ?? null;
  out.weakHashHonestlyLabeled = users?.kdf === 'FNV-1a-weak' && (users?.saltLen ?? 0) > 0;
  out.kdfSpoofed = users?.kdf === 'PBKDF2-SHA256' && (users?.hashLen ?? 99) < 40;
  await ctx.close();
}

// ══ 测试 2：导入存档 meta → XSS ══
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const url = `http://localhost:8080/?seed=12345`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitBoot(page);
  const U = 'xss_probe_' + Date.now().toString(36);
  await page.click('#tabReg');
  await page.fill('#authUser', U);
  await page.fill('#authPw', PW_());
  await page.click('#authBtn');
  await page.waitForSelector('#menuScreen:not(.hidden)', { timeout: 15000 });

  // 注入探针：payload 自身写 window.__xssFired，无需预置（预置会被后续导航清掉）
  // 构造恶意存档：meta.seed / meta.pop 携带 payload（saves.js:229-238 不做任何字段消毒）
  const payload = `<img src=x onerror="window.__xssFired=(window.__xssFired||0)+1">`;
  const evil = {
    meta: { era: 0, pop: `</div><div id="xssProof">${payload}`, seed: payload, savedAt: Date.now() },
    body: { v: 3, seed: 12345, era: 0, chunks: [] },
  };
  const evilPath = path.join(OUT, 'evil-save.json');
  fs.writeFileSync(evilPath, JSON.stringify(evil));

  // 新开一局以便使用存档对话框
  await page.evaluate(() => sessionStorage.setItem('td_boot', 'new'));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitBoot(page);
  await page.waitForSelector('#startScreen:not(.hidden)', { timeout: 20000 });
  await page.click('#startBtn');
  await page.waitForSelector('#topBar:not(.hidden)', { timeout: 30000 });

  // 打开存档对话框 → 导入恶意文件
  await page.click('#pauseBtn');
  await page.waitForSelector('#pauseMenu:not(.hidden)', { timeout: 8000 });
  await page.click('#pauseSaveBtn');
  await page.waitForSelector('#saveDialog:not(.hidden)', { timeout: 8000 });
  const fileInput = page.locator('#saveImportFile');
  await fileInput.setInputFiles(evilPath);
  await page.waitForTimeout(2500);

  // 关闭存档对话框；确认导入是否写入 localStorage
  await page.click('#saveDialogClose').catch(() => {});
  await page.waitForTimeout(600);
  out.storageAfterImport = await page.evaluate(() => {
    const keys = Object.keys(localStorage).filter(k => k.startsWith('td/'));
    const dump = {};
    for (const k of keys) dump[k] = String(localStorage.getItem(k)).slice(0, 160);
    return dump;
  });
  console.log('[导入后 localStorage]', JSON.stringify(out.storageAfterImport, null, 1));

  // 重新打开暂停菜单 → 读档对话框，触发 renderSaveSlots 用被污染的 meta 渲染
  const pauseVisible = await page.evaluate(() => !document.getElementById('pauseMenu')?.classList.contains('hidden'));
  if (!pauseVisible) { await page.click('#pauseBtn').catch(() => {}); await page.waitForTimeout(400); }
  await page.click('#pauseLoadBtn');
  await page.waitForSelector('#saveDialog:not(.hidden)', { timeout: 8000 });
  await page.waitForTimeout(1200);

  const proof = await page.evaluate(() => {
    const list = document.getElementById('saveSlotList');
    return {
      xssFired: window.__xssFired || 0,
      injectedImgCount: list ? list.querySelectorAll('img').length : -1,
      injectedProofDiv: !!document.getElementById('xssProof'),
      slotMetaHTML: list ? String(list.querySelectorAll('.slot-meta')[3]?.innerHTML || '').slice(0, 300) : null,
      slotHTML: list ? String(list.innerHTML).slice(0, 1600) : null,
    };
  });
  out.xss = proof;
  console.log('[XSS 实证]', JSON.stringify(proof, null, 1));
  await page.screenshot({ path: path.join(OUT, 'shots', '11-xss-import.png') }).catch(() => {});
  await ctx.close();
}

function PW_() { return 'pw12345678'; }
fs.writeFileSync(path.join(OUT, 'security-results.json'), JSON.stringify(out, null, 2));
await browser.close();
