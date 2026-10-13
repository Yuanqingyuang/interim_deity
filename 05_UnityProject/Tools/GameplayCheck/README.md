# Gameplay 层离线编译与行为验证

> 本目录**不属于 Unity 工程**（在 `Assets/` 之外，Unity 不会编译它）。
> 它用 **Unity 自带的 Roslyn + netstandard2.1 引用程序集**独立编译
> `Core` / `Simulation` / `World` / `Gameplay` 四层，并运行行为断言。
>
> 用途：在没有 Editor 许可证、不启动 Unity 的情况下，对 **noEngineReferences** 的层
> 做真实的 `COMPILED` + `TESTED` 验证。比"等待 Unity 打开"快得多，也适合 CI。

## 为什么这可行

`Core` / `Simulation` / `World` 三个 asmdef 都是 `noEngineReferences: true`，
源码中**零 `UnityEngine` 引用**；`Gameplay` 目前也**不引用 UnityEngine**。
因此这四层是纯 C#，可以用任何 C# 编译器独立编译验证。

> ⚠️ 一旦 `Gameplay` 开始引用 `UnityEngine`（例如接 MonoBehaviour 桥接层），
> 本验证方式对该层的覆盖就会失效 —— 那时应改为：
> 把 MonoBehaviour 桥接单独放一个程序集，纯逻辑仍留在可离线编译的层里。

## 用法

```powershell
pwsh -File Tools/GameplayCheck/run.ps1
```

可用 `UNITY_ROOT` 环境变量指定 Unity 编辑器根目录（默认 `E:\Unity\Editor`）。

## 覆盖内容（154 项断言）

### A 组 · 回归（地形工具 / 时钟 / 自动建造 / 经济 tick）

| 组 | 断言要点 |
|---|---|
| A1 工具表 | 10 个工具与 Web `TOOLS` 数值一致；未知 key 返回 null |
| A2 神力门槛 | `power < consume*0.5` → `'power'`（含边界 0.05 > 0.048 放行） |
| A3 抬升笔刷 | 中心涨幅 = 0.9（f=1）；边缘 0.18（距离衰减）；神力按一份扣 |
| A4 划区/拆除 | 重复划区 → `'occupied'`；拆除**地形高度一字不动**（Web R6）；空格 → `'empty'` |
| A5 引水 | 变水且 h ≤ 0.7；**水格高度 < 水面平面**（不变量） |
| A6 固定步长时钟 | 60fps 与 15fps 在同样 1 秒内推进**同样 30 步**（帧率解耦）；暂停不推进；2 倍速 60 步 |
| A7 自动建造 | 开局播种 5 住房；12 轮放置 48 格；**8 邻域空置约束零违反** |
| A8 经济 tick | 缺粮 100 秒人口停在 **1**（下限，非吸收态）；信仰恒 ≤ 时代上限 |

### B 组 · 本批新增（Miracle / Wonder / Era Progression / Tick 集成）

| 组 | 断言要点 |
|---|---|
| B1–B8 Miracle | 3 神迹数值对齐 `MIRACLES`；神力不足**无部分副作用**；**重复施放是重置非叠加**（连施 3 次仍 = 15）；时长递减与钳制；`build` 的即时效果（建筑 +0.35 / 奇迹 +0.12，钳到 1.0）；非 build 神迹无即时副作用 |
| B9–B17 Wonder | 成本/时长直接取自 `EraConstants`（未重定义）；信仰不足不扣不填；水格/已划区校验；**全局只允许一个在建**；进度速率 `dt/time`、`boostBuild` 时 ×2；**完工只结算一次**（连调 3 次仅首次计数）；E5 通关只触发一次 |
| B18–B23 Era Progression | 条件不足时**状态一字不动**；成功时 era+1 / 扣 3 星 / StarProgress 归零 / 事件仅一次；**连续调用不重复领取**；新时代配置在后续 tick 真实生效（口径在 E3 切换）；终局时代不可再进阶；放置态被清理 |
| B24–B29 Tick 集成 | 增益递减在 tick 内发生；**同一 tick 不重复推进奇迹**（单 tick 推进量 = `dt/time`）；60 tick 累计只完成 1 个；`FinalWin` 只在 1 个 tick 上为 true；与自动建造/人口经济无意外副作用；**加成真实生效**（grow 让人口更快、build 让建造速度 ×3） |

## 已知的验证边界（不要误读为"全部通过"）

- **不含** `MonoBehaviour` / 场景 / Prefab / 序列化 —— 这些必须用 Unity Test Framework 跑。
- **不含** `Deity.Save`（它 `noEngineReferences: false`，本方式不编译它）。
- **不含** `Presentation` / `UI` 层。
- 断言基于**当前** Web 行为；Web 侧若改动数值，需同步更新 `ToolTable` 与本验证。

---

## 过程中抓到的真实缺陷（值得记录，避免重犯）

### 1. ⭐ `boostGrow` 在 `pop > cap` 时**反向**，把人口打到下限（本次修复）

Web 原式：

```js
if(G.boostGrow>0) nextPop = Math.min(cap, G.pop + (nextPop-G.pop)*2 + 0.6*dt);
```

- `GrowPop` 在超载时**把返回值钳到 `cap`**（源码 `if (next > cap) next = cap;`）
- 于是 `nextPop - G.pop` 是个大负数，`×2` **把衰减加倍**
- 实测 `pop=50 / cap=12`：`min(12, 50 + (12-50)*2 + 0.02) = -25.98` → `max(1,·) = 1`
- 即：**施放「丰收祝福」反而让人口崩到下限**

Web 侧该状态不可达（人口自然涨到 `cap` 即停住），所以原式在 Web 里看不出问题；
移植到固定步长 + 可注入状态后它可复现。

**修复要点（这里有个陷阱）**：第一次尝试写成
`rawNext = EconomyRules.GrowPop(...)` 再据此算增益 —— 这是 **no-op**，
因为 `GrowPop` 返回的**已经是钳过的值**，未钳制的增长量无法从中恢复。
正确做法是在 Gameplay 层**复刻 `GrowPop` 的源码但去掉那一行钳制**
（见 `EconomyTickService.GrowPopUnclamped`）。测试 B29 同时覆盖
「pop ≤ cap 时两者一致」与「pop > cap 时不再反向」。

### 2. `maxFrameDt` 默认值不能太小（上一批修复）

初版照搬 Web 的 0.05s，但 15fps 的帧时间是 0.0667s，每帧被截掉 0.0167s，
1 秒只推进 **22 步**而非 30 步 —— 与"帧率解耦"的承诺直接矛盾。
现取 0.25s，卡顿防护交给 `MaxCatchUpSteps`（本来就是它的职责）。

### 3. `PlaceAt` 只做划区、不做建成（调用契约）

它置 `Zone` 但 `IsBuilt=false`、`prog=0`；产出与人口上限走**已建成**口径，
故新划定必须交给 tick 的待建列表推进，否则永远停在 `prog=0`。
这不违反 Web 设计（划定 ≠ 建成），但调用方必须维护待建列表。

### 4. 写测试时踩到的两个坑（测试自身的错误，非产品缺陷）

- **`EvaluateReadiness` 内部会 `RefreshBuiltCache()`**，所以"直接注入 `BuiltCache` 再评估"
  必然被重算清零 —— 必须放**真实地块**。
- **对照实验的起点不能落在退化区**。B29 初版用 `pop=50 / cap=12`（超载态），
  两边都被钳到同一个值，对照失去意义 —— 虽然正是它顺带暴露了上面的缺陷 #1。
