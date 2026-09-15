# 实习神明 · 项目现状总览

> 与当前 Web 原型同步（无边界区块 + 账号存档日志 + 公式化数值）。

## 1. 一句话

网页端「实习神明」：种子地形 + 分区自动建造 + 五大时代；本地多用户存档与压缩日志。

## 2. 架构

```
index.html (登录/菜单/HUD)
    ↓
js/main.js     主循环 · 自动建造 · 暂停 · 存档接线
js/state.js    G.chunks Map（10×10 区块）· 序列化
js/terrain.js  heightAt/riverMask/sampleHeight · 工具 · 选址
js/render.js   Three 地形/建筑/村民 · OrbitControls
js/formulas.js T(E) · 人口/粮/产能 · LAYOUT
js/auth.js     本地用户 + 密码哈希
js/saves.js    slot1/2/3 + quick
js/log.js      代号编码 → 中文展开
```

## 3. 世界与地形

- **区块**：`CHUNK=10`，开局 `START_CHUNKS=4`
- **扩展**：有建筑的区块 `ensureChunkRing` 补 8 邻域
- **高度**：域扭曲 → 大陆度 → ridged 山脉 + 丘陵
- **河流**：`riverMask` 冲刷河床
- **工具**：抬升 / 下沉 / **平整**（局部均值 + 羽化）/ 引水 / 绿化

## 4. 建筑与自动建造

| 类型 | 规则摘要 |
|------|----------|
| 居住 | 粮、产能有余且住房缺口时优先 |
| 农田 | 粮不够时建；田–田可密铺 |
| 工业 | `D_res≥6`、1×2 批次、区块容量 |
| 教堂 | 跟随公式 low |

- 手工：单击 1 格，拖动连续
- 选址：围绕居住质心随机采样

## 5. 数值

见 [numeric-design.md](../numeric-design.md)。

- 人口：E1–2 住房，E3–4 粮食，E5 产能
- 产出按已划定格；住房容量按已建成格
- 村民渲染：`clamp(round(50*log10(N)-85), min(E), max(E))`

## 6. 账号 / 存档 / 日志

- 登录：昵称 + 密码（SHA-256），`localStorage`
- 存档：3 槽 + 快速档
- 日志：`[code,t,x,y]` 压缩
- 暂停：冻结 tick 与 `G.time`

## 7. 操作

右键旋转 · 中键平移 · 左键施法 · Esc 暂停

流程：登录 → 主菜单 → 新游戏 → 开始试炼

## 8. 部署

见 [deploy.md](deploy.md)。

## 9. 已知约束

- 存档仅本机
- 无限图为点采样，非全图 D8 水文
- 大地图需避免全图扫描

## 10. 待办

- [ ] Three.js 本地 vendor
- [ ] 存档导入导出
- [ ] 移动端适配加深
- [ ] 奇迹 GATE(E) 接入
