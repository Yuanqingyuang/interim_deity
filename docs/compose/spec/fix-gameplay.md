---
feature: fix-gameplay
status: delivered
updated: 2026-09-15
branch: feature/fix-gameplay
commits: 22aebb3..HEAD
---

# Trainee Deity · 修复与玩法补齐

## Report

**What was built** — 在原型上完成 P0–P2 主路径修复：存档计时与日志上限、`placeAt` 幂等落位、工业统一打分路径与真实坐标日志、种子 PRNG 自动建造、地形强度减半、信仰差额 UI、里程碑出星与五时代闭环（E5 太空电梯通关）、拆除与导航/视角工具、周期与离开自动保存、按建成数产出、UI 疏密与树木降密、首局引导。

**Verification** — `node test/*.mjs` 全部 PASS：R1 存读×10、R2 幂等/工业距离、R3 PRNG 可复现与地形强度、R5 里程碑防重复、R6 拆除保地形、R8/R9 工具与树密度冒烟。

**Journey log** — 路径含特殊引号，用 `C:\td-work` junction 编辑；`placeIndustryBatch` 早期返回曾为 `0`，已统一 `{n,x,y}`；星星 `starCost` 与 3 里程碑对齐为每时代 3。

## [S1] Problem

存档卡死、同格重复建筑、工厂日志坐标错误、自动建造不可复现、地形过快、星星纯时间累积、E1 进阶强制结束、缺拆除/自动保存、UI 过密、树木过密。

## [S2] Design

- 轮次 R0–R10 已实现；R11 可选项未做（Three vendor / PBKDF2 / 导入导出）。
- 落位 `placeAt`；工业只走 `placeIndustryBatch`。
- PRNG：`mulberry32` / `autoRng(G, salt)`。
- 存档 v3 + `starMilestones` 位图；日志写入 cap 400。
- 星星：每时代 3 里程碑；E1 进阶无需奇迹；E5 太空电梯通关。
- 产出按 built；地形 `strength` 1.7；树 `m>0.58 * 1.1`。
- 自动保存 180s + beforeunload/pagehide。

### R0 定位摘要

| 项 | 位置 |
|----|------|
| 存档 | `state.js` serialize / `saves.js` writeSave / `main.js` doSave |
| 落位 | `terrain.js` placeAt / placeDistrict / placeIndustryBatch |
| 自动建造 | `main.js` autoBuild + config AUTO |
| 星星/进阶 | `main.js` checkStarMilestones / eraReady / advanceEra |

## [S3] Out of Scope

- 无打包器/框架；不重写 render 建模大样。
- 未迁移 IndexedDB。
- P3：Three 本地 vendor、PBKDF2、存档导入导出、公式单测框架、建筑代理比。

## Tasks

- [x] T0: 工作区与基线 (covers: S2)
- [x] T0.1: R0 审计 (covers: S2)
- [x] T1: R1 存档卡死 (covers: S2)
- [x] T2: R2 同格幂等+工厂 (covers: S2)
- [x] T3: R3 自动建造 PRNG (covers: S2)
- [x] T4: R4 地形速度+信仰 UI (covers: S2)
- [x] T5: R5 星星里程碑+五时代 (covers: S2)
- [x] T6: R6 拆除+粒子 (covers: S2)
- [x] T7: R7 时代建筑差分+视角/导航 (covers: S2)
- [x] T8: R8 自动保存+产出口径 (covers: S2)
- [x] T9: R9 UI/绿化 (covers: S2)
- [x] T10: R10 端手+引导 (covers: S2)
- [x] T11: R11 P3 — vendor three、PBKDF2、导入导出、pending 列表、死代码、公式断言 (covers: S2)
