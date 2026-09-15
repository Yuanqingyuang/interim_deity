// 一键跑全部 Node 自测
import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const files = (await readdir(dir)).filter(f => f.endsWith('.test.mjs')).sort();
let fail = 0;
for (const f of files) {
  const code = await new Promise((resolve) => {
    const p = spawn(process.execPath, [join(dir, f)], { stdio: 'inherit' });
    p.on('exit', (c) => resolve(c ?? 1));
  });
  console.log(`--- ${f} => ${code === 0 ? 'PASS' : 'FAIL'} ---`);
  if (code !== 0) fail++;
}
console.log(`\nSUITE fail=${fail} / ${files.length}`);
process.exit(fail ? 1 : 0);
