// 测试支持：为 Node 侧测试按需生成 `three` 模块解析垫片（2026-10）
//
// 背景：游戏在浏览器里通过 index.html 的 importmap 把裸模块 `three` 与 `three/addons/*`
// 指向仓库内的 vendor，因此**生产代码不需要任何 npm 依赖**。但 Node 不读 importmap，
// 于是任何 import 了 render.js 的测试（render.js 顶层 `import * as THREE from 'three'`）
// 在 Node 下都会 ERR_MODULE_NOT_FOUND。
//
// 本脚本按需在 `<项目>/node_modules/three/` 生成一个指向 vendor 的垫片，使 Node 能解析：
//   · `three`              → vendor/three@0.161.0/three.module.js
//   · `three/addons/<p>`   → vendor/three@0.161.0/examples/jsm/<p>
// 垫片内容全部来自仓库内 vendor 的**副本**（不修改 vendor 原件、不联外网、不装 npm 包），
// 且 node_modules/ 已被 .gitignore 忽略 —— 它是测试期产物，不进仓库。
//
// 用法（测试文件自动调用，也可单独运行）：
//   node test/support/ensure-three-shim.mjs        # 生成/刷新
//   node test/support/ensure-three-shim.mjs --check # 只检查，缺失则退出码 1
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..', '..');
const vendorThree = path.join(projectRoot, 'vendor', 'three@0.161.0');
const shimDir = path.join(projectRoot, 'node_modules', 'three');

const SHIM_PKG = {
  name: 'three',
  version: '0.161.0',
  private: true,
  type: 'module',
  main: './three.module.js',
  exports: { '.': './three.module.js', './addons/*': './examples/jsm/*' },
};

/** 垫片是否已就绪且未过期（源文件比垫片副本新则视为过期） */
export function shimStatus(){
  const core = path.join(shimDir, 'three.module.js');
  const pkg = path.join(shimDir, 'package.json');
  const addons = path.join(shimDir, 'examples', 'jsm', 'controls', 'OrbitControls.js');
  if(!fs.existsSync(core) || !fs.existsSync(pkg) || !fs.existsSync(addons)) return { ok:false, reason:'缺失' };
  const srcMtime = fs.statSync(path.join(vendorThree, 'three.module.js')).mtimeMs;
  const shimMtime = fs.statSync(core).mtimeMs;
  if(shimMtime < srcMtime) return { ok:false, reason:'vendor 已更新，垫片过期' };
  return { ok:true };
}

/** 按需生成垫片；已就绪则直接返回（幂等） */
export function ensureThreeShim({ quiet = false } = {}){
  const st = shimStatus();
  if(st.ok){ if(!quiet) console.log('[three-shim] 已就绪，跳过'); return true; }
  if(!fs.existsSync(vendorThree)){
    console.error(`[three-shim] 找不到 vendor：${vendorThree}`);
    return false;
  }
  if(!quiet) console.log(`[three-shim] ${st.reason} → 生成 ${path.relative(projectRoot, shimDir)}`);
  fs.mkdirSync(path.join(shimDir, 'examples'), { recursive:true });
  fs.writeFileSync(path.join(shimDir, 'package.json'), JSON.stringify(SHIM_PKG, null, 2) + '\n', 'utf8');
  fs.copyFileSync(path.join(vendorThree, 'three.module.js'), path.join(shimDir, 'three.module.js'));
  fs.cpSync(path.join(vendorThree, 'examples', 'jsm'), path.join(shimDir, 'examples', 'jsm'), { recursive:true });
  const after = shimStatus();
  if(!after.ok){ console.error(`[three-shim] 生成后自检失败：${after.reason}`); return false; }
  if(!quiet) console.log('[three-shim] 完成');
  return true;
}

// CLI
if(process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)){
  if(process.argv.includes('--check')){
    const st = shimStatus();
    console.log(st.ok ? '[three-shim] OK' : `[three-shim] 需要生成：${st.reason}`);
    process.exit(st.ok ? 0 : 1);
  }
  process.exit(ensureThreeShim() ? 0 : 1);
}
