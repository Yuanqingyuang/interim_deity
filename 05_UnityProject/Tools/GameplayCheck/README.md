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

## 覆盖内容（42 项断言）

| 组 | 断言要点 |
|---|---|
| 工具表 | 10 个工具与 Web `TOOLS` 数值一致；未知 key 返回 null |
| 神力门槛 | `power < consume*0.5` → `'power'`（含边界：0.05 > 0.048 放行） |
| 抬升笔刷 | 中心涨幅 = 0.9（f=1）；边缘 0.18（距离衰减）；神力按一份扣 |
| 划区 | 成功置 zone；重复划区 → `'occupied'`；TerrainDirty 置位 |
| 拆除 | zone/prog/built 清零，**地形高度一字不动**（Web R6）；空格 → `'empty'` |
| 引水 | 变水且 h ≤ 0.7；**水格高度 < 水面平面**（不变量） |
| 固定步长时钟 | 60fps 与 15fps 在同样 1 秒内推进**同样 30 步**（与帧率解耦）；暂停不推进；2 倍速 60 步 |
| 自动建造 | 开局播种 5 住房；12 轮放置 48 格；**8 邻域空置约束零违反** |
| 经济 tick | 缺粮 100 秒人口停在 **1**（下限，非吸收态）；建 10 块农田后回升到 20 |
| 信仰上限 | 恒 ≤ `FaithCapOf(era)` |

## 已知的验证边界（不要误读为"全部通过"）

- **不含** `MonoBehaviour` / 场景 / Prefab / 序列化 —— 这些必须用 Unity Test Framework 跑。
- **不含** `Deity.Save`（它 `noEngineReferences: false`，本方式不编译它）。
- **不含** `Presentation` / `UI` 层。
- 断言基于**当前** Web 行为；Web 侧若改动数值，需同步更新 `ToolTable` 与本验证。

## 首次运行时踩到的两个坑（已修，记录以免重犯）

1. **`maxFrameDt` 默认值不能太小。** 初版照搬 Web 的 0.05s，结果 15fps
   （帧时间 0.0667s）每帧被截掉 0.0167s，1 秒只推进 22 步而非 30 步 ——
   与"帧率解耦"的承诺直接矛盾。现取 0.25s，卡顿防护交给 `MaxCatchUpSteps`。
2. **`PlaceAt` 只做划区，不做建成。** 它置 `Zone` 但 `IsBuilt=false`、`prog=0`；
   产出与人口上限用**已建成**口径，故新划定必须交给 tick 的待建列表推进建造，
   否则永远停在 `prog=0`。这不违反 Web 设计（划定 ≠ 建成），但调用方必须维护待建列表。
