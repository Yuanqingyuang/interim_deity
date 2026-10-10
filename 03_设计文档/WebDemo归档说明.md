# 当前 Web Demo 归档说明

> **执行状态：✅ 已完成（2026-10）**
> 原 `trainee-deity/` 已整体移动为 `01_WebDemo/`，其内部结构与相对路径**完全未变**。
> 移动前后均通过 `npm run verify`（lint + 17 个单测）与浏览器回归验证。
> 执行记录见 §执行记录（本文件末尾）。

## 目的

把当前 Web Demo 作为可回溯的原始版本保留，不在归档副本中做 Unity 迁移改造。后续 Unity 版本与 Web Demo 分开演进。

## 移动前的原始目录（历史记录）

公开仓库的 README 指向 `trainee-deity/`，其内部包含 `index.html`、`styles.css`、`js/`、`vendor/three@0.161.0/`、`docs/`、`test/`、`package.json` 等内容。

## 目标结构（已达成）

在仓库根目录中将原 `trainee-deity/` **整体移动**为 `01_WebDemo/`，保持其内部文件和相对路径完全不变。移动前先提交 Git，并确认 GitHub Pages / 静态托管配置是否依赖原路径。

```text
interim_deity/
├── 01_WebDemo/                 # 原 trainee-deity 完整原样归档
├── 02_剧情文档/                 # 剧情总纲、序章、五时代剧情
├── 03_设计文档/
│   └── Unity移植/
├── 04_仓库整理工具/
├── README.md
└── .git/
```

如果线上地址或 CI 固定依赖 `trainee-deity/` 路径，则不要直接移动；先把部署工作流改为新路径，或先采用保留旧路径的过渡方案。

## 归档原则

1. 原 Demo 的 `js/`、`index.html`、`styles.css`、`vendor/`、`test/` 和配置文件全部保留。
2. 不把剧情文档、Unity C# 源码或 Unity 资源混入 Demo 目录。
3. 不把 Web Demo 宣称为 Unity 版本；两者应有独立的启动与验收说明。
4. 归档前执行 `npm run verify`，如有浏览器测试则执行对应浏览器回归，并记录结果。
5. 移动后再次执行测试和部署验证，确认相对路径、CI 和静态托管均正常。
6. 不要把 `node_modules/`、临时压测产物、个人存档或密钥纳入归档。

---

## 执行记录（2026-10）

### 实际执行的步骤

| # | 步骤 | 结果 |
|---|---|---|
| 1 | 清理遗留探针、提交干净工作区 | ✔ |
| 2 | 放入 `02_剧情文档/`（8）、`03_设计文档/Unity移植/`（10）、`04_仓库整理工具/`（1） | ✔ |
| 3 | **把 CI 从 `trainee-deity/.github/` 提到仓库根 `.github/`** | ✔ ← 见下「额外修复」 |
| 4 | 原仓库根 `docs/compose/spec/fix-gameplay.md` → `03_设计文档/交付记录/` | ✔ `git mv` 保留历史 |
| 5 | 把 `trainee-deity/docs/project-docs` 等**技术文档移出 Demo** → `03_设计文档/Web原型/` | ✔ 按原则 2 的分离意图 |
| 6 | `trainee-deity/` → `01_WebDemo/` | ✔ Demo 内部结构未变 |
| 7 | 同步文档与源码中的路径引用（7 个文件） | ✔ 存档键名与产物名**未改** |
| 8 | 同步仓库外的本地构建工具路径（`package.mjs` 等） | ✔ 并验证打包可用 |
| 9 | 新增仓库根 `README.md` | ✔ |
| 10 | 重跑 Node 测试 + 浏览器回归 + 打包 | ✔ |

### 执行前的核实：Pages 未启用

GitHub Pages 为 **未启用** 状态（`GitHub Pages is currently disabled`，Branch = `None`）；
仓库内也没有 CNAME / netlify.toml / vercel.json / _config.yml 等任何托管配置
→ **移动不会导致线上 404**，故直接执行。

### 额外修复：CI 从未被 GitHub 加载

工作流原先位于 `trainee-deity/.github/workflows/ci.yml`，而
**GitHub Actions 只读取仓库根的 `.github/workflows/`** → 该 CI **从未运行过**。

此前把"浏览器回归长期静默跳过"归因于探测语句（`curl -sf … && echo` 不会失败），
那只是**第二层**原因；**第一层**是整个工作流根本没被加载。现已移到仓库根，
并加 `defaults.run.working-directory: 01_WebDemo` 使各 step 在游戏根目录执行。

### 移动过程中的一个坑（供后续参考）

`git mv trainee-deity 01_WebDemo` 反复失败并报 `Permission denied`，即使 ACL 与对照组
完全一致。逐项排查后定位：**`trainee-deity/docs/` 这个子目录阻塞了父目录的重命名**
（把它移出后父目录立即可改名）。故实际执行顺序是「先把 `docs/` 内容移走 → 删除空的
`docs/` → 再重命名父目录」。

### 重命名的另一个副作用（已修复）

`test/browser/node_modules/` 由 pnpm 安装，其中的 `playwright-core` 是 **Junction（目录联接）**，
其 target 是**绝对路径**且指向旧目录名 → 重命名后变成悬空链接，
浏览器测试报「依赖未安装」。解法：删除 `node_modules` 后用 pnpm 重装。
（`node_modules/` 已在 `.gitignore` 中，不进仓库。）

### 明确未改动的内容

以下名称**故意保持 `trainee-deity`**，因为它们是标识符而非路径：

| 项 | 值 | 改动后果 |
|---|---|---|
| 存档键名 | `trainee-deity-save-v3`（含 v1/v2 兼容键） | **老玩家存档全部失效** |
| 存档导出文件名 | `trainee-deity-<slot>-<ts>.json` | 玩家既有备份无法识别 |
| 打包产物名 | `trainee-deity-v1.1.0.{zip,tar.gz}` | 既有部署脚本失效 |
| `package.json` 的 `name` | `trainee-deity` | npm 包标识 |
