// 浏览器启动器（浏览器端测试共用）
//
// 背景：各测试原先直接 `chromium.launch(...)`，依赖 Playwright **自带的** Chromium 构建。
// 那需要额外执行 `npx playwright install`（数百 MB 下载），在离线或受限环境里直接失败：
//   Executable doesn't exist at ...\ms-playwright\chromium_headless_shell-1243\...
//
// 本模块改为**优先复用系统已装的 Chromium 系浏览器**（Edge / Chrome 在 Windows 上普遍已有），
// 找不到才回落 Playwright 自带构建。可用环境变量覆盖：
//   TD_BROWSER_PATH  指定可执行文件绝对路径（最高优先）
//   TD_BROWSER       指定 channel，如 msedge / chrome
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/microsoft-edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
];

// 软件渲染所需参数：无 GPU 环境下必须有 swiftshader，否则 WebGL 上下文创建失败
export const SWIFTSHADER_ARGS = [
  '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-proxy-server',
];

/** 解析要使用的浏览器可执行文件；返回 null 表示交给 Playwright 自带构建 */
export function resolveBrowserPath(){
  if(process.env.TD_BROWSER_PATH){
    if(!fs.existsSync(process.env.TD_BROWSER_PATH)){
      throw new Error(`TD_BROWSER_PATH 指向的文件不存在: ${process.env.TD_BROWSER_PATH}`);
    }
    return process.env.TD_BROWSER_PATH;
  }
  for(const p of CANDIDATES){ if(fs.existsSync(p)) return p; }
  return null;
}

/**
 * 启动浏览器。默认 headless + swiftshader 软件渲染。
 * @param {object} opts 透传给 chromium.launch；args 会与 SWIFTSHADER_ARGS 合并
 */
export async function launchBrowser(opts = {}){
  const exe = resolveBrowserPath();
  const launchOpts = {
    headless: true,
    args: [...SWIFTSHADER_ARGS, ...(opts.args || [])],
    ...opts,
  };
  if(exe){
    launchOpts.executablePath = exe;
  } else if(process.env.TD_BROWSER){
    launchOpts.channel = process.env.TD_BROWSER;
  }
  try {
    const b = await chromium.launch(launchOpts);
    if(exe) console.log(`[browser] 使用系统浏览器: ${path.basename(exe)}`);
    else console.log('[browser] 使用 Playwright 自带 Chromium');
    return b;
  } catch(e){
    if(!exe){
      console.error(
        '\n[browser] 未找到可用的浏览器。两种解决方式：\n' +
        '  1) 安装系统 Edge/Chrome（本模块会自动优先复用），或\n' +
        '  2) 下载 Playwright 自带构建:  npx playwright install chromium\n' +
        '也可用 TD_BROWSER_PATH 直接指定可执行文件路径。\n'
      );
    }
    throw e;
  }
}

/** 临时目录辅助：各测试的产物根目录 */
export function outDir(name){
  return process.env.TD_OUT || path.join(os.tmpdir(), name);
}
