// 静态服务器（开发 / 测试共用；等价于 `python -m http.server`，但不依赖 Python）
//
// 为什么需要它：`index.html`、`styles.css`、`js/`、`vendor/` 都在 `trainee-deity/` 子目录里，
// 而仓库根还有 `docs/`、`test/`、`README`。若从**仓库根**起服务，`/index.html` 会 404 ——
// CI 的浏览器 job 曾因此长期静默跳过（`python3 -m http.server 8080 &` 从仓库根起，
// 随后的 `curl -sf .../index.html && echo "server up"` 失败但不影响 job 结论）。
//
// 用法：node test/support/serve.mjs [port] [root]
//   port  默认 8080（可用 PORT 环境变量覆盖）
//   root  默认为本脚本上两级的 trainee-deity/（即游戏根目录）

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(__dir, '..', '..');
const ROOT = path.resolve(process.argv[3] || DEFAULT_ROOT);
const PORT = Number(process.argv[2] || process.env.PORT || 8080);

if(!fs.existsSync(path.join(ROOT, 'index.html'))){
  console.error(`✖ 服务根目录下没有 index.html: ${ROOT}`);
  console.error('  请把 root 指向游戏根目录（含 index.html / js/ / vendor/）');
  process.exit(1);
}

// 显式 MIME：ES Module 必须带 JS MIME 才能被 import，否则浏览器拒绝执行
const MIME = {
  '.html':'text/html; charset=utf-8',
  '.js':'application/javascript; charset=utf-8',
  '.mjs':'application/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.svg':'image/svg+xml',
  '.md':'text/markdown; charset=utf-8',
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.webp':'image/webp', '.ico':'image/x-icon', '.woff2':'font/woff2',
};

const server = http.createServer((req, res)=>{
  let urlPath;
  try { urlPath = decodeURIComponent((req.url || '/').split('?')[0]); }
  catch { res.writeHead(400); return res.end('400'); }

  // 目录穿越防护必须在**任何规范化之前**做。
  // 注意：`new URL('/../x', base)` 与 Node 的 req.url 处理都可能已把 `..` 消解掉，
  // 只靠「解析后路径是否仍在 ROOT 内」会失效 —— 实测 `/../.gitignore` 曾返回 200。
  // 故这里直接拒绝含 `..` 段或反斜杠的请求。
  if(urlPath.includes('\\') || urlPath.split('/').some(seg => seg === '..')){
    res.writeHead(403, { 'Content-Type':'text/plain; charset=utf-8' });
    return res.end('403');
  }

  let file = path.resolve(ROOT, '.' + (urlPath === '/' ? '/index.html' : urlPath));
  // 双保险：解析后的路径必须仍在 ROOT 之内
  if(file !== ROOT && !file.startsWith(ROOT + path.sep)){
    res.writeHead(403, { 'Content-Type':'text/plain; charset=utf-8' });
    return res.end('403');
  }

  if(fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');

  fs.readFile(file, (err, data)=>{
    if(err){ res.writeHead(404, { 'Content-Type':'text/plain; charset=utf-8' }); return res.end('404 ' + urlPath); }
    // 本项目是源码直出、无构建哈希：默认 no-cache，避免改版后客户端仍跑旧代码
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
});

server.listen(PORT, '127.0.0.1', ()=>{
  console.log(`serving ${ROOT}`);
  console.log(`  → http://127.0.0.1:${PORT}/`);
});
