// 浏览器回归的**统一入口**（7 个测试，全部有退出码门禁）
//
// 为什么需要它：`package.json` 与 CI 原先各自手写一串 `node test/browser/xxx.mjs && …`，
// 结果是两处都漏了 stress-test 与 platform-test（断言最强的两个），而 CI 里那串还是
// 顺序执行、任一失败不中断。集中到本文件后，「跑哪些测试」只有一处定义。
//
// 用法：node test/support/run-browser.mjs [--only=game,leak] [--list]
//   前置：已安装 test/browser 的依赖（playwright-core），且静态服务已在本机 8080 运行。
//   可用 GAME_URL 覆盖服务地址。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const BROWSER_DIR = path.resolve(__dir, '..', 'browser');

// 顺序有意如此：先验证能跑起来（game），再验证安全与资源（security/leak），
// 然后是规模压测（stress）与平台矩阵（platform），最后是启动/卸载时序。
const SUITE = [
  { file: 'game-test.mjs',     name: '主流程回归',   need: '必须有门禁' },
  { file: 'security-test.mjs', name: '安全（XSS/KDF）' },
  { file: 'leak-test.mjs',     name: '资源泄漏' },
  { file: 'stress-test.mjs',   name: '大城压力' },
  { file: 'platform-test.mjs', name: '平台矩阵' },
  { file: 'boot-timing.mjs',   name: '启动时序' },
  { file: 'unload-test.mjs',   name: '卸载健壮性' },
];

const args = process.argv.slice(2);
if(args.includes('--list')){ for(const t of SUITE) console.log(`${t.file}  ${t.name}`); process.exit(0); }
const onlyArg = args.find(a => a.startsWith('--only='));
const only = onlyArg ? onlyArg.slice(7).split(',').map(s => s.trim()).filter(Boolean) : null;
const picked = only ? SUITE.filter(t => only.some(o => t.file.startsWith(o))) : SUITE;

if(!fs.existsSync(path.join(BROWSER_DIR, 'node_modules', 'playwright-core'))){
  console.error('✖ test/browser 的依赖未安装。请先运行：npm --prefix test/browser install');
  process.exit(1);
}

const URL = process.env.GAME_URL || 'http://127.0.0.1:8080/';

/** 探测静态服务是否就绪——服务没起时逐个测试都会以同样方式失败，先报清楚更有用 */
async function serverUp(){
  try {
    const res = await fetch(URL, { method: 'HEAD' });
    return res.ok || res.status === 405;      // 部分静态服务器不支持 HEAD
  } catch { return false; }
}

if(!(await serverUp())){
  console.error(`✖ 静态服务不可达：${URL}`);
  console.error('  请先另开终端运行：npm run serve   （或 node test/support/serve.mjs 8080）');
  console.error('  根目录必须是**游戏根目录**（含 index.html / js/ / vendor/），否则 /index.html 会 404');
  process.exit(1);
}
console.log(`静态服务就绪：${URL}\n`);

const run = (file)=> new Promise((resolve)=>{
  const t0 = Date.now();
  const child = spawn(process.execPath, [file], { cwd: BROWSER_DIR, stdio: 'inherit' });
  child.on('error', e => resolve({ file, code: 1, ms: Date.now()-t0, err: String(e.message) }));
  child.on('exit', (code, signal) => resolve({ file, code: code ?? 1, ms: Date.now()-t0, signal }));
});

const results = [];
for(const t of picked){
  console.log('='.repeat(64));
  console.log(`▶ ${t.file}   ${t.name}`);
  console.log('='.repeat(64));
  const r = await run(t.file);
  r.name = t.name;
  results.push(r);
  console.log(`\n◀ ${t.file} ${r.code === 0 ? 'PASS' : 'FAIL'}  (${(r.ms/1000).toFixed(1)}s)\n`);
}

console.log('='.repeat(64));
console.log('浏览器回归汇总');
console.log('='.repeat(64));
for(const r of results){
  console.log(`  ${r.code === 0 ? 'PASS' : 'FAIL'}  ${r.file.padEnd(22)} ${r.name.padEnd(18)} ${(r.ms/1000).toFixed(1)}s`);
}
const bad = results.filter(r => r.code !== 0);
console.log(`\n共 ${results.length} 个测试，失败 ${bad.length} 个`);
if(bad.length){
  console.log('失败项：' + bad.map(r => r.file).join(', '));
  process.exit(1);
}
console.log('浏览器回归全部通过');
