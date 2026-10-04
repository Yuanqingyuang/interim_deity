// 测试套件运行器（原 test/run-all.mjs，2026-10 迁入 test/support/）
//
// 目录约定（见 README「工程约定」）：
//   test/support/  测试脚手架与工具 —— 支持测试的代码，本身不是测试
//   test/*.test.mjs  自动化测试
//   test/browser/    需真实浏览器的测试（Node 侧无法运行，见各文件头部说明）
//
// 默认只跑「纯 Node 测试」。浏览器测试需要额外前置条件（真实浏览器 + 已启动的静态服务器），
// 它们不以 .test.mjs 结尾，天然不在本运行器的发现范围内 —— 避免干净检出上 npm test 整体失败，
// 掩盖真实的回归信号。
import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const testDir = join(dir, '..');          // test/（.test.mjs 所在层）

// 需要外部资源（浏览器 / 服务器）的测试，默认不纳入
const BROWSER_TESTS = new Set();
const withBrowser = process.env.TD_BROWSER === '1';

const all = (await readdir(testDir)).filter(f => f.endsWith('.test.mjs')).sort();
const files = withBrowser ? all : all.filter(f => !BROWSER_TESTS.has(f));

let fail = 0;
const results = [];
for (const f of files) {
  const code = await new Promise((resolve) => {
    const p = spawn(process.execPath, [join(testDir, f)], { stdio: 'inherit' });
    p.on('exit', (c) => resolve(c ?? 1));
  });
  results.push([f, code === 0]);
  console.log(`--- ${f} => ${code === 0 ? 'PASS' : 'FAIL'} ---`);
  if (code !== 0) fail++;
}

console.log('');
console.log(`SUITE fail=${fail} / ${files.length}`);
if (fail) console.log('失败项: ' + results.filter(r => !r[1]).map(r => r[0]).join(', '));
process.exit(fail ? 1 : 0);
