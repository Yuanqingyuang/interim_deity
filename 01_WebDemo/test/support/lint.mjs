// 测试支持：静态检查器（原 test/lint.mjs，2026-10 迁入 test/support/）
//
// 定位：这是**支持测试的工具**，不是测试本身 —— 因此放在 test/support/，
// 且不参与 `npm test` 的测试发现（只匹配 *.test.mjs）。
// 设计取舍：本项目刻意保持「无 npm 运行时依赖」（three.js 走 vendor），
// 因此不引入 ESLint，而用本脚本承担 lint 职责，保证 CI 与本地离线均可运行。
// 用法：node test/support/lint.mjs   （npm run lint 即调用此脚本）
// 退出码：0=通过，1=存在问题
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const rel = (p) => relative(ROOT, p);

// 递归收集 .js/.mjs，排除 vendor 与 node_modules 及隐藏目录
function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'vendor' || name.startsWith('.')) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (/\.(js|mjs)$/.test(name)) acc.push(p);
  }
  return acc;
}

const allFiles = [];
for (const d of ['js', 'test']) {
  try { walk(join(ROOT, d), allFiles); } catch { /* 目录缺失则跳过 */ }
}
// 安全模式扫描只针对随产品发布的 js/ 面（测试脚本可能合法携带 XSS payload 字符串）
const shippedFiles = allFiles.filter((f) => rel(f).startsWith('js'));

let errors = 0;
const fail = (tag, loc, msg, extra) => {
  errors++;
  console.error(`${tag}  ${loc}  ${msg}${extra ? `\n  > ${extra}` : ''}`);
};

// ── 1) 语法检查：对每个源文件跑 node --check ──
for (const f of allFiles) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    const firstLine = String(e.stderr || e.message).split('\n').find((l) => l.trim()) || 'syntax error';
    fail('SYNTAX', rel(f), firstLine.trim());
  }
}

// ── 2) 安全危险模式扫描（仅 js/）──
// 说明：innerHTML/outerHTML 允许「清空」写法（= '' / = "" / = ``），其余赋值一律视为 XSS 注入面。
const RULES = [
  { id: 'no-eval', re: /\beval\s*\(/, msg: '禁止 eval()' },
  { id: 'no-new-function', re: /\bnew\s+Function\s*\(/, msg: '禁止 new Function()' },
  { id: 'no-document-write', re: /\bdocument\s*\.\s*write\s*\(/, msg: '禁止 document.write()' },
  { id: 'no-js-url', re: /['"`]\s*javascript:/i, msg: '禁止 javascript: 协议 URL' },
];
// innerHTML/outerHTML 赋值单独处理：捕获右值，仅放行「清空」字面量，避免正则回溯误判
const INNER_RE = /\.(innerHTML|outerHTML)\s*=\s*(.*)$/;
const EMPTY_LITERAL = /^(''|""|``)/;

for (const f of shippedFiles) {
  const lines = readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    // 跳过注释行，避免说明文字误报
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
    for (const rule of RULES) {
      if (rule.re.test(line)) fail('LINT', `${rel(f)}:${i + 1}`, `[${rule.id}] ${rule.msg}`, trimmed.slice(0, 140));
    }
    const m = line.match(INNER_RE);
    if (m && !EMPTY_LITERAL.test(m[2].trim())) {
      fail('LINT', `${rel(f)}:${i + 1}`, '[no-dangerous-innerhtml] 禁止向 innerHTML/outerHTML 赋非空值（XSS 面）；请改用 textContent 或 DOM 构建', trimmed.slice(0, 140));
    }
  });
}

if (errors) {
  console.error(`\n✖ lint 失败：共 ${errors} 处问题（扫描 ${allFiles.length} 个文件，安全规则覆盖 ${shippedFiles.length} 个 js/ 文件）`);
  process.exit(1);
} else {
  console.log(`✔ lint 通过：${allFiles.length} 个文件语法正确，${shippedFiles.length} 个 js/ 文件未命中危险模式`);
}
