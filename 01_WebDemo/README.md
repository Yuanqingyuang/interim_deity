# 实习神明 · Trainee Deity

> 作为一个新上任的**实习神明**，你要引导一个文明从**茹毛饮血**走向**星辰大海**。

《实习神明》是**轻量沙盒 + 放置建造**的网页原型：塑造地形、规划区域、降下神迹，引导文明跨越五大时代（蛮荒 → 城邦 → 封建 → 工业 → 星际）。

> 📌 全局速览见 **[docs/project-summary.md](docs/project-summary.md)**；数值公式见 **[numeric-design.md](numeric-design.md)**。

---

## 当前版本能力

| 模块 | 说明 |
|------|------|
| **无边界区块** | 10×10 区块，开局 4×4 块；有建筑时自动补 8 邻域 |
| **自然地形** | 种子驱动：域扭曲 + 大陆度 + 脊状山脉 + 丘陵 + 河谷 |
| **分区建筑** | 居住民宅 / 教堂 / 工业厂房 / 农田，独立建模 |
| **渲染** | 低多边形 Three.js；昼夜光照 + 实时投影阴影；高空云层；水面波动 |
| **数值体系** | 对齐 `numeric-design.md`：人口、粮、产能、建造速度 |
| **账号** | 本地多用户 + 密码（仅存浏览器） |
| **存档** | 3 槽位 + 快速存/读 + 导出/导入 JSON；自动存档失败会提示 |
| **界面** | 六大分类（地形/区域/操作/视角/神迹/奇迹）可点击收起；顶栏固定单行 |
| **日志** | 压缩代号存储，面板可查历史 |
| **菜单** | 登录 → 主菜单 → 暂停（Esc / ⏸） |

---

## 🚀 快速开始

**必须用 HTTP 打开**（不能双击 `index.html`）。

```bash
cd 01_WebDemo          # 仓库重组后的路径
python3 -m http.server 8080
# 或 npx serve .
```

浏览器打开 `http://localhost:8080/` → **注册** → **新游戏** → **开始试炼**。

### 操作

| 操作 | 说明 |
|------|------|
| 左键 / 拖动 | 施加工具；单击 1 格，拖动连续 |
| 右键拖动 | 旋转视角 |
| 中键拖动 | 平移 |
| 滚轮 | 缩放 |
| Esc | 暂停菜单 |
| 导航工具 | 单指/左键旋转（触控） |
| 拆除工具 | 清除分区，保留地形 |

### 调试

URL 追加 `?debug=1` 会在右上角显示性能面板（FPS / 帧时间 / 峰值 / DrawCall / 三角面），并写入 `window.__perf`：

```
http://localhost:8080/?seed=123&debug=1
```

不带该参数时面板不显示，也不产生任何开销。

---

## 📂 项目结构

> **仓库重组说明（2026-10）**：本 Demo 原先位于仓库根的 `trainee-deity/`，
> 现整体移动为 `01_WebDemo/`（内部结构与相对路径**完全未变**）。
> 原 `docs/` 下的开发文档已移至仓库的 `03_设计文档/Web原型/`（按「原型 / 剧情 / 设计」分离原则）。
> 存档键名与打包产物名仍为 `trainee-deity-*`，**未改动**（改动会导致老玩家存档失效）。

**发布内容与测试内容严格分离**——部署包只含下面标「发布」的部分。

```
01_WebDemo/                      ← 仓库重组后的路径（原 trainee-deity/）
├── index.html                 ← 发布
├── styles.css                 ← 发布
├── numeric-design.md          ← 发布（数值规范，随包附带）
├── README.md                  ← 发布
├── js/                        ← 发布：游戏源码（唯一的 src 目录，全部 ES Module）
│   ├── main.js  config.js  formulas.js
│   ├── state.js  terrain.js  render.js
│   ├── ui.js  auth.js  saves.js  log.js
│   └── audio.js
├── vendor/three@0.161.0/      ← 发布：Three.js 本地化（离线可玩，无 CDN）
├── docs/                      ← 开发文档（不进部署包）
│   ├── project-summary.md  project-plan.md  deploy.md
├── test/                      ← 测试（不进部署包）
│   ├── *.test.mjs                自动化测试（npm test 自动发现）
│   ├── browser/                  需真实浏览器的回归（Node 侧无法运行）
│   └── support/                  测试脚手架与工具（本身不是测试）
│       ├── run-all.mjs               测试运行器
│       ├── lint.mjs                  静态检查器（语法 + 安全危险模式）
│       └── ensure-three-shim.mjs     Node 侧 three 解析垫片（按需生成）
├── .github/workflows/ci.yml   ← CI（不进部署包）
└── package.json               开发脚本（不进部署包）
```

### 工程约定

| 约定 | 说明 |
|---|---|
| **生产代码位置** | 只有 `js/`。部署包 = `index.html` + `styles.css` + `js/` + `vendor/` + `README.md` + `numeric-design.md` |
| **测试位置** | 只有 `test/`。测试发现规则：`test/*.test.mjs`（`test/support/` 与 `test/browser/` 不参与自动发现） |
| **不要在 `js/` 里放测试代码或调试脚本** | 会随部署包上线。历史遗留的 `main.js __tdPan/__tdDbg` 压测探针是已知例外，仅 `?debug=1` 下暴露 |
| **无 npm 运行时依赖** | 游戏零依赖，Three.js 走 `vendor/`；`node_modules/` 只可能由测试期垫片产生，已被 `.gitignore` 忽略 |
| **每次改动后** | `npm run verify`（= lint + 全部测试）。CI 同样跑这两步 |

### 测试与开发脚本

```bash
npm run verify        # lint + 全部自动化测试（提交前必跑）
npm test              # 只跑测试
npm run lint          # 只跑静态检查（语法 + eval/innerHTML 等危险模式）
npm run shim          # 生成 Node 侧 three 解析垫片（一般不需要手动跑，测试会自动调用）

# 浏览器回归（需真实浏览器 + 静态服务器，Node 侧跑不了）
npm run serve:test    # 另开一个终端保持运行（:8765）
npm run test:browser
```

> **关于浏览器**：`test/browser/browser.mjs` 是共用的启动器，**优先复用系统已装的
> Chromium 系浏览器**（Windows 上的 Edge/Chrome、Linux 的 chromium/chrome、macOS 的
> Chrome/Edge），找不到才回落 Playwright 自带构建。这样无需 `npx playwright install`
> 下载数百 MB。可用环境变量覆盖：
>
> | 变量 | 作用 |
> |---|---|
> | `TD_BROWSER_PATH` | 直接指定浏览器可执行文件绝对路径（最高优先） |
> | `TD_BROWSER` | 指定 channel，如 `msedge` / `chrome` |
> | `TD_OUT` | 测试产物（截图、结果 JSON）输出目录 |
>
> `platform-test.mjs` 是三引擎 × 两设备档案的矩阵测试；Firefox/WebKit 需各自构建，
> 未安装时该单元格记为 `SKIP`（不影响 chromium 单元格的 PASS 判定）。

> **关于 `three` 解析垫片**：游戏在浏览器里通过 `index.html` 的 importmap 解析裸模块 `three`，
> 因此**生产代码零依赖**。Node 不读 importmap，故 import 了 `render.js` 的测试在 Node 下会
> 解析失败。`test/support/ensure-three-shim.mjs` 会在需要时把 `vendor/` 的内容复制到
> `node_modules/three/`（**不改 vendor 原件、不联网、不装 npm 包**），供 Node 侧测试使用；
> 干净检出后第一次跑测试会自动生成，无需人工步骤。

---

## ☁️ 部署

见 [docs/deploy.md](docs/deploy.md)。要点：纯静态站、根目录直接是 `index.html`、HTTPS；Three.js 已本地 vendor。因源码直出、无构建哈希，`.js` / `.css` 建议设 `Cache-Control: no-cache`，否则改版后老用户会继续跑旧代码。

---

## 📄 文档

| 文件 | 内容 |
|------|------|
| [numeric-design.md](numeric-design.md) | 数值公式与参数 |
| [docs/project-summary.md](docs/project-summary.md) | 实现总览与待办 |
| [docs/deploy.md](docs/deploy.md) | 宝塔 / 静态托管部署 |

*Web 原型 · Three.js + ES Modules*
