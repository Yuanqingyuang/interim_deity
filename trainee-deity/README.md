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
cd trainee-deity
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

```
trainee-deity/
├── index.html
├── styles.css
├── numeric-design.md
├── docs/
│   ├── project-summary.md
│   └── deploy.md
├── vendor/three@0.161.0/
├── test/
└── js/
    ├── main.js  config.js  formulas.js
    ├── state.js  terrain.js  render.js
    ├── ui.js  auth.js  saves.js  log.js
```

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
