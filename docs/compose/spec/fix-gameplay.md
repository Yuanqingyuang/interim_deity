---
feature: fix-gameplay
status: in-progress
updated: 2026-09-15
branch: feature/fix-gameplay
commits: 22aebb3..22aebb3
---

# Trainee Deity · 修复与玩法补齐

## Report

R0 基线审计完成。项目已从原路径复制到本会话工作区 `trainee-deity/`，基线提交 `22aebb3`。按任务书逐轮实施，本轮仅定位不改玩法。

## [S1] Problem

原型方向正确，但存在阻断游玩的缺陷：存档可能卡死、同格重复建筑、工厂/自动建造逻辑错误、地形过快、星星纯时间累积、E1 进阶后强制结束、UI 过密、缺拆除/自动保存等。数值文档 `numeric-design.md` 与实现部分不一致。

## [S2] Design

- 轮次制：R0–R11，每轮完成后停止等待确认。
- 落位统一幂等入口；自动决策用 `mulberry32(G.seed + tick + salt)`。
- 存档保持 v3 chunks 兼容；新字段默认回填。
- 星星改为每时代 3 个里程碑，存档记 completed 位图。
- 信仰仅奇观消耗且不为负；奇观造价沿用 `WONDERS.faithCost`。
- 五时代可玩，仅 E5 太空电梯通关。
- 地形强度降至原 40%–60%；树木阈值 0.52→0.62、密度约 0.5。
- 产出口径：UI 用 built（或 prog≥1），公式输入保持除非文档同步。
- 禁止 `Math.random` 用于自动建造决策。

### R0 基线定位（只读）

| 项 | 关键位置 |
|----|---------|
| A 存档 | `state.js:147-264` serialize/deserialize；`saves.js:29-46` writeSave+setItem；`main.js:171-210` doSave/doLoad |
| B 重复 | 三处直写 zone：`terrain.js:249` 手动、`612` 工业、`703` placeDistrict；无统一 placeAt |
| C 工厂 | `terrain.js:565-632` placeIndustryBatch；`main.js:451` 调用；日志 `main.js:455` 坐标 (0,0) |
| D 自动建造 | `main.js:398-487`；`AUTO.maxPerTick=4` 已存在；选址用 Math.random |
| E 地形速度 | `terrain.js:294-296` `3.4*dt*f`；TOOLS 无 strength 字段 |
| F 信仰 | 产出 `main.js:371-373`；扣费 `528`；顶栏无差额 |
| G 星星 | `main.js:383-386` faithRate 时间累积；`STAR_FAITH` config:25 |
| H 闭环 | `main.js:554-558` era>=1 强制 over |
| 树木 | `terrain.js:169` `m>0.52` + `*1.8` |
| 死代码 | `seedVal` main:77 ui:37,242（HTML 无此元素）；`G.powerMax` state:77 main:546（读用 powerMaxOf） |

## [S3] Out of Scope

- 不引入打包器/框架。
- 不大重写 render.js 建模。
- 本轮不迁移 IndexedDB。
- P3（vendor/PBKDF2/导入导出等）视时间另做。

## Tasks

- [x] T0: 复制项目到会话工作区并 git 基线 — acceptance: worktree 内可打开 index.html (covers: S2)
- [x] T0.1: R0 基线审计定位 — acceptance: 本表列出各 P0 关键 file:line (covers: S2)
- [x] T1: R1 存档卡死 — acceptance: 计时日志+失败 toast+连续存读 10 次无异常 (covers: S2; depends: T0)
- [ ] T2: R2 同格幂等+工厂 — acceptance: 同坐标不重复；工业坐标日志正确 (covers: S2; depends: T1)
- [ ] T3: R3 自动建造 PRNG — acceptance: 同种子序列可复现；每 tick ≤ maxPerTick (covers: S2; depends: T2)
- [ ] T4: R4 地形速度+信仰 UI — acceptance: 抬升 1s ≤ 原 60%；信仰不为负；顶栏有速率/差额 (covers: S2)
- [ ] T5: R5 星星里程碑+五时代 — acceptance: 非时间出星；E1 可进 E2+；仅 E5 通关 (covers: S2)
- [ ] T6: R6 拆除+粒子 — acceptance: 可拆且 mesh 消失；点击有粒子 (covers: S2)
- [ ] T7: R7 时代建模差分+视角 — acceptance: 五时代可区分；回城/俯视可用 (covers: S2)
- [ ] T8: R8 自动保存+产出口径 — acceptance: 180s 与 beforeunload；UI 按 built (covers: S2)
- [ ] T9: R9 UI/绿化/地图 — acceptance: 布局疏朗；树降 ≥40%；开局可建 (covers: S2)
- [ ] T10: R10 端手+引导 — acceptance: 390px 可用；首局引导 (covers: S2)
- [ ] T11: R11 P3 可选 — acceptance: 按剩余项 (covers: S2)
