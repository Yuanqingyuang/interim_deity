# 14 · Baseline（Web Demo 基线冻结记录）

> 交付物（对应 `M1-01` 冻结 Web 基线）。
> **本基线不标记为"全部通过"。** 单元测试**通过**、浏览器回归**失败**，两者分别记录（用户明确要求）。
> 记录时间：2026-10-10 ｜ 记录方式：本地实跑 + GitHub Actions 记录读取

---

## 一、基线标识

| 项 | 值 | 获取方式 |
|---|---|---|
| **Unity 开发规划提交（仓库 HEAD）** | **`3e274c8`** 《feat: 实习神明 Unity 版本开发规划》 | `git rev-parse HEAD` |
| 当前分支 | `trae/agent-3nfFG6` | `git rev-parse --abbrev-ref HEAD` |
| 远端同名分支 | `origin/trae/agent-3nfFG6` = `6bf2b18`（同题提交，早一个） | `git log --oneline -3` |
| **Web Demo 代码基线** | **`9cad171`**（`origin/main` / `origin/HEAD`，也是**浅克隆的 graft 边界**） | `git log --oneline -3`、`.git/shallow` |
| 克隆深度 | **浅克隆**（`.git/shallow` 内容为 `9cad1716e2a…`），本地可见 3 个提交 | `cat .git/shallow` |
| 技术文档声称的代码基准 | `b8f0a66` | `03_设计文档/Web原型/project-docs/README.md` |
| 应用版本号 | `APP_VERSION = '1.1.0'` | `01_WebDemo/js/config.js:5` |

> ⚠️ **注意**：`3e274c8` 只新增/修改 `03_设计文档/Unity开发规划/` 下的文档（7 个文件），**未改动任何 Web Demo 代码**。
> 因此 **Web Demo 的代码基线仍为 `9cad171`**；Unity 移植的数值对照必须以 `9cad171` 的 `js/` 为准。

### 1.1 本提交实际包含的变更

| 提交 | 内容 |
|---|---|
| `6bf2b18` | 新增 `03_设计文档/Unity开发规划/01`–`09`（规划交付物 1–9） |
| `3e274c8` | 修改 `02`/`03`/`07`；新增 `10`–`13`（共 7 文件，+776/−10） |

> `10`/`11`/`12`/`13` 与本文档 `14` 之后的提交将包含 `14`/`15`。

---

## 二、工作区状态（记录时）

```
$ git status --short
（空 —— 工作区干净，无未提交改动）
```

**结论**：记录时工作区**干净**，无脏文件，无未跟踪文件。

---

## 三、执行环境（记录时）

| 项 | 值 |
|---|---|
| Node.js | `v24.1.0`（CI 使用 **20**，与本地不同） |
| npm | `11.4.2` |
| git-lfs | `3.4.1` |
| Unity / .NET / Blender | **均未安装**（`which` 全部 NOT FOUND） |
| 系统浏览器（chromium/chrome/msedge） | **均未安装** |
| OS | linux（沙箱，`CI=true`，无 TTY） |

---

## 四、测试记录 A：静态检查（lint）—— ✅ **通过**

| 项 | 内容 |
|---|---|
| 命令 | `cd 01_WebDemo && npm run lint`（= `node test/support/lint.mjs`） |
| 退出码 | **0** |
| 完整输出 | `✔ lint 通过：44 个文件语法正确，14 个 js/ 文件未命中危险模式` |
| 结论 | **通过** |

---

## 五、测试记录 B：单元测试（Node）—— ✅ **通过**

| 项 | 内容 |
|---|---|
| 命令 | `cd 01_WebDemo && npm run verify`（= lint + 全部单元测试） |
| 退出码 | **0** |
| 汇总 | **`SUITE fail=0 / 17`** |

**逐文件结果（完整）**

| # | 测试 | 结果 |
|---:|---|---|
| 1 | `p0-review.test.mjs` | PASS |
| 2 | `p3-gate.test.mjs` | PASS |
| 3 | `r1-save.test.mjs` | PASS |
| 4 | `r11-p3.test.mjs` | PASS |
| 5 | `r15-wonder-pop-cap.test.mjs` | PASS |
| 6 | `r16-build-q.test.mjs` | PASS |
| 7 | `r2-place.test.mjs` | PASS |
| 8 | `r3-r4.test.mjs` | PASS |
| 9 | `r5-stars.test.mjs` | PASS |
| 10 | `r6-demolish.test.mjs` | PASS |
| 11 | `r8-r9-smoke.test.mjs` | PASS |
| 12 | `rev-1-builders.test.mjs` | PASS |
| 13 | `rev-2-progression.test.mjs` | PASS |
| 14 | `rev-3-terrain-color.test.mjs` | PASS |
| 15 | `rev-4-tile-index.test.mjs` | PASS |
| 16 | `rev-5-save-policy.test.mjs` | PASS |
| 17 | `rev-6-autobuild.test.mjs` | PASS |

> 断言条数约 **386**（见 `12_Unity最小测试方案.md` §二）。CI 的 `Lint + Unit Tests` job 亦为 **success**（3 次运行全部如此）。

---

## 六、测试记录 C：浏览器回归（Playwright）—— ❌ **失败**

### 6.1 本地状态：**未能运行**（如实记录，不冒充结果）

| 项 | 情况 |
|---|---|
| 命令 | `cd 01_WebDemo && npm run test:browser` |
| 依赖安装 | ✅ `npm --prefix test/browser install` → `added 1 package`（playwright-core 就位） |
| 静态服务 | ❌ 未就绪：`✖ 静态服务不可达：http://127.0.0.1:8080/`（需另开终端 `npm run serve`） |
| 浏览器 | ❌ **无系统 Chromium**；尝试 `npx playwright@1.63.0 install chromium`（需下载 **186.8 MiB**），**在沙箱代理下未在预算内完成**（缓存目录仅生成 `__dirlock`，无 chromium） |
| **结论** | **本地未复现**。因此浏览器回归结果**以 CI 权威记录为准**（§6.2） |

> 复现前提（供后续在有浏览器的环境执行）：
> ```bash
> cd 01_WebDemo
> npm run serve:test &          # 另开终端保持运行（:8765 或 8080）
> npx playwright@1.63.0 install chromium
> npm run test:browser
> ```

### 6.2 CI 权威记录（GitHub Actions）

**仓库 `Yuanqingyuang/interim_deity` 最近 3 次运行（均针对 `main`，push 触发，结论均为 failure）**

| Run ID | 创建时间（UTC） | head | 结论 | 链接 |
|---|---|---|---|---|
| 38038781405 | 2026-10-10 08:41:55 | main | **failure** | https://github.com/Yuanqingyuang/interim_deity/actions/runs/38038781405 |
| 38039648937 | 2026-10-10 08:56:56 | main | **failure** | https://github.com/Yuanqingyuang/interim_deity/actions/runs/38039648937 |
| **38051649067** | 2026-10-10 12:21:22 | main | **failure** | https://github.com/Yuanqingyuang/interim_deity/actions/runs/38051649067 |

**最新 Run `38051649067` 的 Job 分解**

| Job | 结论 | Job ID |
|---|---|---|
| `Lint + Unit Tests` | ✅ **success** | 114211825336 |
| `Browser Regression (Playwright)` | ❌ **failure** | 114211871929 |

**浏览器 Job 的逐步结果**

| 步骤 | 结论 |
|---|---|
| 安装浏览器测试依赖 | success |
| 下载 Chromium（与 playwright-core 1.63.0 同版本） | success |
| 启动静态服务（游戏根目录 :8080） | success |
| **运行浏览器回归（7 个测试）** | ❌ **failure** |
| 上传测试产物 | success |

**7 个浏览器测试的逐项结果（CI 汇总）**

| 测试 | 主题 | 结果 | 耗时 |
|---|---|---|---|
| `game-test.mjs` | 主流程回归 | ✅ PASS | 135.8s |
| `security-test.mjs` | 安全（XSS/KDF） | ✅ PASS | 29.8s |
| **`leak-test.mjs`** | **资源泄漏** | ❌ **FAIL** | 59.9s |
| `stress-test.mjs` | 大城压力（16 阶段 fail=0） | ✅ PASS | 410.5s |
| `platform-test.mjs` | 平台矩阵（chromium desktop/mobile） | ✅ PASS | 148.9s |
| `boot-timing.mjs` | 启动时序 | ✅ PASS | 16.1s |
| `unload-test.mjs` | 卸载健壮性 | ✅ PASS | 26.9s |

### 6.3 失败根因（已定位到断言，非推测）

```
FAIL  [泄漏] 纹理无泄漏（texLeak=1 ≤ 0）
FAIL  [泄漏] 着色器程序无泄漏（progLeak=3 ≤ 0）
泄漏测试 FAIL：2 项门禁未通过
```

即：**连续 6 次读档后，WebGL 纹理净增 1、着色器程序净增 3**（`leak-test.mjs` 门禁阈值为 `≤0`）。
其余泄漏门禁（缓冲 ≤16、堆 ≤8MB、无 console.error、流程无中断）**均通过**。

**明确纠正（避免误判）**：
- 该失败**不是** Node.js 版本弃用警告导致 —— 日志中的 `npx playwright install` 警告为**提示信息**，与 job 结论无关。
- 该失败由 `leak-test.mjs` 的 `process.exit(1)` 触发，属**真实的 GPU 资源释放问题**（读档路径 `doLoad → buildTerrain + buildWater + syncWorld` 未完全释放）。
- 影响面：**仅 Web 端**。Unity 版有自己的资源生命周期，**不继承**此缺陷；但 Unity 侧需建立**等价回归**（`12` 的 `T-P1-10` / `M15-09`）。

### 6.4 独立登记（不混入 Unity 移植）

| 项 | 内容 |
|---|---|
| 问题标题 | Web Demo 连续读档后 WebGL 纹理/着色器程序泄漏 |
| 证据 | CI run `38051649067`，job `114211871929`，步骤"运行浏览器回归" |
| **归属** | **Web Demo 独立缺陷** |
| 处理约定 | **后续以独立修复提交处理，不混入 Unity 移植提交**（用户明确要求） |
| Unity 侧动作 | 仅建立等价回归测试；**不修改 Web 代码** |

---

## 七、基线结论（务必分清）

| 类别 | 结论 |
|---|---|
| 静态检查（lint） | ✅ **通过** |
| 单元测试（17 个 / ≈386 断言） | ✅ **通过**（本地实跑复现；CI 亦通过） |
| 浏览器回归（Playwright 7 个） | ❌ **失败**（6 通过 / 1 失败；根因为 `leak-test.mjs` 的 GPU 资源泄漏） |
| **整条基线** | ⚠️ **不是"全部通过"**。任何后续陈述都必须以上表分别表述 |

---

## 八、与基线绑定的其他基线（引用）

| 基线 | 位置 |
|---|---|
| Web 核心数值（`T`/`NUM`/`BUILD_Q`/`RENDER_Q`/`FAITH_*`/`WONDERS`/`MILESTONES`） | `01` §3；E1 明细见 `13` §一（已用 `node` 实算核对） |
| Web v3 存档结构 | `10` §三；迁移规则见 `15` |
| 任务 ID 全集（100 个）与依赖 | `02`；一致性检查见 `07` §五 |
| 已知"文档 vs 代码"偏差 | `07` §5.4（Z-1：零工业单栋耗时文档写 14s、代码为 28.6s，**以代码为准**） |

---

## 九、复现命令清单（一键核对基线）

```bash
# 提交与工作区
git rev-parse HEAD                      # 期望 3e274c88…（记录时）
git status --short                      # 期望：空

# Web 静态检查
cd 01_WebDemo && npm run lint            # 期望：✔ lint 通过（44 文件 / 14 js）

# Web 单元测试（可达成的通过项）
cd 01_WebDemo && npm run verify          # 期望：SUITE fail=0 / 17

# 浏览器回归（本沙箱不可运行；需浏览器 + 静态服务）
cd 01_WebDemo && npm run serve:test &    # 另开终端
npx playwright@1.63.0 install chromium   # 约 187 MiB
cd 01_WebDemo && npm run test:browser    # 期望：leak-test.mjs FAIL（已知）
```

---

## 十、待办与遗留

| # | 项 | 状态 |
|---|---|---|
| 1 | 在具备浏览器的环境**本地复现** `leak-test.mjs` 失败 | ⏳ 未完成（本沙箱无浏览器） |
| 2 | 修复 `leak-test.mjs` 泄漏 | ⏳ 独立提交，**不混入 Unity 移植** |
| 3 | 补充 Web 侧 `Baseline.md` 的截图/产物（若有归档需求） | ⏳ 可选 |
| 4 | 冻结 Unity 目标平台与性能目标（Windows x64 / 1080p / 30–60 FPS）→ 见 `07` D-5 | ✅ 已定（2026-10-10） |
| 5 | 硬件最低规格 | ⏳ **待 MVP 实测后冻结** |

---

## 十一、变更记录

| 日期 | 变更 | 说明 |
|---|---|---|
| 2026-10-10 | 首次建立 | HEAD `3e274c8`；Web 代码基线 `9cad171`；单元测试通过、浏览器回归失败分别记录 |
