# 04 · Unity 技术架构方案

> 第一阶段交付物 4/9。基于 `01_项目现状与差距分析.md` 的实测事实提出。
> **原则：不为使用设计模式而增加复杂度。** 每个决策给出理由与取舍；**未确认的标记为【待决策】，不写成既定事实。**

---

## 1. 版本与目标平台

| 项 | 建议 | 理由 | 状态 |
|---|---|---|---|
| Unity 编辑器 | **Unity 6 LTS（6000.x LTS）** | 用户已裁决。长期支持；URP/UI Toolkit 成熟。**不得同时用第二个版本**（Library 不兼容，会互相污染） | ✅ **已定（2026-10-10）** |
| 目标平台 | **PC（Windows）优先**，移动端作为**后续**目标 | Web 版移动端适配本就不完整；性能数据来自软渲染，真机未验证。先在一个平台做扎实 | 【待决策】 |
| 最低配置 | **需实测后回填**，不要先写死 | `Unity移植/09` 明确：不能把 Web 软渲染 FPS 当指标 | 【待决策】 |
| 渲染管线 | **URP（Universal Render Pipeline）** | 见 §2 | ✅ **已定（2026-10-10）** |

> ⚠️ **本沙箱未安装 Unity / dotnet**，无法验证编译与运行。

### 1.1 已裁决记录（2026-10-10）

| 决策 | 结论 | 理由 |
|---|---|---|
| D-1 Unity 版本 | **Unity 6 LTS（6000.x）** | 用户指定 |
| D-2 渲染管线 | **URP** | 用户指定 |
| D-3 工程目录名 | **`Assets/_Project/`**（沿用既有 `Unity移植/02` 约定，**废弃任务书原案的 `_Game`**） | 避免设计文档/任务书/实际工程三套目录规范并存 |
| D-4 工程位置 | **单仓 `05_UnityProject/`** | 见 `09` |
| D-13 Git LFS | **启用**；但 **`.blend` 等大型源文件是否入 LFS 延后决定** | 待首批建筑通过 Unity 导入与验证后再定（用户裁决） |

> ⚠️ **本沙箱未安装 Unity / dotnet**，无法验证编译与运行。以上为**建议 + 已裁决项**。

---

## 2. 渲染管线：建议 URP（附取舍）

| 管线 | 适配度 | 取舍 |
|---|---|---|
| **URP** ✅ 建议 | 高 | 跨平台、可裁剪、对"低多边形 + 大量实例化 + 昼夜光照"友好；支持自定义 Shader Graph、Volume 后处理。**代价**：URP 下自定义阴影/多光源需注意每相机光源数，正交阴影设置与内置管线不同 |
| HDRP | 低 | 面向高端 PC/主机写实；本项目是低多边形风格，不需要 HDRP 的重型特性，且性能开销与移动端适配都不利 |
| Built-in（内置） | 中 | 最稳、文档多，但已进入维护模式，URP 是官方未来的主推；新项目不建议 |
| 自定义 SRP | 低 | 成本远超收益 |

**结论**：**建议 URP**。理由：目标美术风格是"低多边形 + 明确剪影"，不需要 HDRP 的重度光照/材质；URP 对大规模 GPU Instancing（对应 Web 侧 4172 栋 → 约 230 DrawCall 的合批需求）与移动端裁剪更友好。

> ⚠️ **渲染管线必须在阶段 A 前定死**：管线切换会导致材质、Shader、光照配置全部返工。此项属**阻塞性决策**。

---

## 3. 场景结构与世界初始化

### 3.1 场景划分

| 场景 | 职责 | 备注 |
|---|---|---|
| `Boot` | 引导：初始化服务、加载配置、校验 `ScriptableObject`、创建 `GameClock` | 不放置任何游戏内容 |
| `MainMenu` | 主菜单 / 账号（可选）/ 读档入口 | |
| `World` | 游戏主体：世界容器、相机、UI 根、各渲染器 | **唯一**承载玩法的场景 |

**世界初始化方式**：`Boot` 完成后**异步加载** `World`，由 `WorldBootstrap` 按 `WorldState`（数据）**生成**场景对象。**绝不做成"场景里的对象就是真实状态"**。

### 3.2 为什么不用"场景即状态"

`Unity移植/01` §3 与任务书 §五-6 均要求：**核心状态不能只依赖场景中 GameObject 的当前状态**。若以场景为真：

- 存档需从场景反推数据 → 脆弱、易漏字段；
- 无法脱离渲染做单元测试；
- 无法支持"同一状态渲染成不同表现"（如换模型、代理比抽样）。

**因此**：数据 → 场景（单向生成）；存档只序列化数据。

---

## 4. 世界数据结构

> 全部为**纯 C#**，位于 `Simulation` / `World` 程序集，**不引用 `UnityEngine`**（除 `Vector2Int` 这类纯值类型如无替代，可用自定义 `int2`）。

```csharp
// 世界坐标 / 区块坐标（均可能为负；负坐标必须用数学 floor）
public readonly struct TileCoord  { public readonly int X; public readonly int Y; }
public readonly struct ChunkCoord { public readonly int X; public readonly int Y; }

// 地块逻辑数据（存档单位）
public sealed class TileData {
    public float Height;        // 地表高度
    public bool  IsWater;
    public bool  IsVegetated;
    public byte  Zone;          // 0 空 / 1 居住 / 2 农田 / 3 工业 / 4 信仰
    public float BuildProgress; // 0..1
    public bool  IsBuilt;
    public byte  Variant;       // 0..2，确定性哈希决定
}

// 区块（10x10 = 100 格，线性数组）
public sealed class ChunkData {
    public ChunkCoord Coord;
    public TileData[] Tiles;    // 长度 100
    public int GenerationVersion;
}

// 世界状态（逻辑真源）
public sealed class WorldState {
    public int Seed;
    public int TerrainGeneratorVersion;
    public int CurrentEra;                       // 0..4
    public Dictionary<ChunkCoord, ChunkData> Chunks;
    public WorldStats Stats;                     // 缓存：已划定数 / 已建成数
}
```

### 4.1 与 Web 数据模型的差异（有意为之）

| Web 字段 | Unity 处理 | 原因 |
|---|---|---|
| `live`（全仓无读取方） | **不带入** | 死字段（`15` §4 R-11） |
| `starProg`（仅被置 0） | **不带入** | 死字段 |
| `_wx/_wy/_wz`（渲染期临时） | 由渲染层持有，**不入数据模型** | 已是 Web 的做法 |
| `variant` 0–2 | 保留 | 用于外观微差异，确定性 |

---

## 5. 建筑定义 与 游戏状态的分离

**核心原则**（任务书 §五-4 / `Unity移植/02` §3）：

```
BuildingDefinition (static, SO)          TileData (dynamic, save)
  ├─ id / 名称                             ├─ Zone
  ├─ Zone 类型                             ├─ BuildProgress
  ├─ 人均系数 r_b                          ├─ IsBuilt
  ├─ 造价权重                              ├─ Variant
  ├─ 产出（粮/产/信仰/住房）
  ├─ 可建高度区间
  ├─ 视觉集（按时代 → Prefab）
  └─ 解锁时代
```

- **静态**：`BuildingDefinition`、`EraDefinition`、`WonderDefinition`、`MiracleDefinition`、`DialogueSequence`、`ArchiveEntry`（`ScriptableObject`）。
- **动态**：`TileData` / `WorldState` / 资源与人口 / `storyFlags` / 里程碑位图（纯 C#，入存档）。
- **表现**：Prefab / 材质 / 动画（**不入存档**）。

> **换模型不破坏存档**：因为存档只记录 `Zone` + `Variant`（以及时代），外观由解析器按"（分区, 时代, 变体）"映射到 Prefab。**这是"更换住宅模型不破坏建筑数据/建造流程/存档兼容性"这一验收项的技术保障。**

---

## 6. ScriptableObject / 运行时状态 / 存档数据 三者的职责

| 类别 | 载体 | 生命周期 | 是否入存档 | 示例 |
|---|---|---|---|---|
| **配置（Config）** | `ScriptableObject` 资产 | 编辑器固定，运行期只读 | ❌ | `EraDefinition`、`BuildingDefinition`、`WONDERS` 数据 |
| **运行时状态（Runtime）** | 纯 C# 对象 + 少量 MonoBehaviour | 单局 | ✅（逻辑部分） | `WorldState`、资源、人口、`storyFlags` |
| **存档数据（Save DTO）** | 可序列化 DTO | 磁盘 | ✅ | `SaveRoot`（见 §10） |
| **表现（Presentation）** | GameObject / Prefab / Mesh / 材质 | 场景 | ❌ | 建筑实例、地形网格、村民实例 |

**三条铁律**：

1. `ScriptableObject` **不存运行时可变状态**（否则编辑器里会被改脏）。
2. 存档 DTO **不引用** GameObject / Mesh / 场景对象 / instanceID。
3. 表现层**订阅**逻辑变化，不反向写逻辑。

---

## 7. 五时代数据与建筑配置的扩展方式

**要求**（任务书 §五-5）：五时代通过**配置与数据扩展**，不为每时代复制一套系统代码。

| 层 | 扩展方式 |
|---|---|
| 数值 | `EraDefinition` SO ×5：目标人口 `T(E)`、starCost、门槛、主导约束 |
| 建筑配置 | `BuildingDefinition` SO ×4（分区）× 每时代外观集（`EraVisualSet`） |
| 外观 | `EraVisualSet`：`era → { meshPrefab, materialSet, variant[] }`；**新增时代只加资产，不加代码** |
| 里程碑 | 数据资产（C# 谓词 + label），**校验：奇迹里程碑必须引用本时代奇迹** |
| 奇迹 | `WonderDefinition` SO ×5，含加成引用（人口乘区/信仰乘区，**单一实现点**） |
| 配色 | 可迁移 `PALETTES` 作参考（用户已明确"配色先保留，待评估"） |

> **反例（禁止）**：为 E3 单独写一个 `Era3System`；把时代判断散落在 UI/建筑/时代脚本里（任务书 §五-3：数值公式必须统一管理）。

---

## 8. 模型、材质与 Prefab 组织规范（概要，详见 `05`）

```text
Assets/_Project/Art/Models/Buildings/
├── Primitive/      E1 蛮荒
├── CityState/      E2 城邦
├── Feudal/         E3 封建
├── Industrial/     E4 工业
└── Interstellar/   E5 星际
Assets/_Project/Prefabs/Buildings/<Era>/<Zone>/<Variant>.prefab
Assets/_Project/Materials/…   （共享材质，控制材质数量）
```

- 命名：`SM_<Zone>_<Era>_<Variant>`（静态网格）/ `M_<材质语义>` / `PF_<Zone>_<Era>_<Variant>`。
- 原点/轴向/比例规范见 `05` 文档（**住宅必须先通过 7 项验收再批量建模**）。
- **不把 Web 的低多边形几何当最终模型**。

---

## 9. UI 与游戏逻辑的通信

| 方向 | 机制 |
|---|---|
| UI → 逻辑 | UI **发出 `GameCommand`**（如 `PaintZoneCommand` / `RaiseTerrainCommand` / `CastMiracleCommand`），**不直接改数据结构** |
| 逻辑 → UI | 逻辑发 `GameEvent`（`BuildingCompletedEvent` / `EraAdvancedEvent` / `WonderCompletedEvent` / `SaveFailedEvent`…），UI **订阅**并刷新 |
| 频率 | 模拟 tick 固定步长；UI 刷新按帧节流（Web 侧为 0.1s 节流，可沿用该量级） |
| 输入仲裁 | UI 接收指针时不把同一次输入传给世界工具；跨边界行为**单一确定**（`M9-04`） |

**实现选择**：UI Toolkit 或 uGUI 二者皆可。

| 方案 | 优点 | 代价 |
|---|---|---|
| **UI Toolkit** | 数据绑定、样式化、适合"读数据多、写命令少"的 HUD/面板 | 3D 世界空间 UI（世界坐标标签/高亮）较麻烦 |
| uGUI | 生态成熟、世界空间 UI 直观 | 大规模列表需自己优化 |

> **【待决策】**：建议 HUD/面板用 UI Toolkit；若需要频繁的世界坐标跟随标签，混用少量 uGUI 或自绘。**先做阶段 C 的朴素 HUD，样式后置**（`Unity移植/05` §5：不要同时重写输入/地形/经济/UI）。

---

## 10. 随机种子与程序化地形的一致性

**要求**：相同 seed + 相同生成器版本 → 相同地形。

| 措施 | 说明 |
|---|---|
| 独立 RNG 流 | 地形用 `RngStream(seed)`；**禁止使用 `UnityEngine.Random` 全局态**（Web 版已证明：特效/UI 消耗随机数会改变地图） |
| 哈希函数重写 | 移植 `hash2` 时用 **32 位整数运算**（等价 `Math.imul` 语义）。Web 的 `hash2` 乘法超 2^53 有损（R-8），**重写应修正而非复刻** |
| 生成器版本号 | 保存 `TerrainGeneratorVersion`；算法变更时决定"兼容加载 / 提示重开" |
| 修复帧率耦合 | Web 的 `autoRng(G, salt)` 依赖 `G.time`（R-5）→ Unity **必须**改为固定步长 tick，使**城市演化也可复现**（这是修复，不是复制缺陷） |
| 负坐标 | 数学 floor，禁止向零截断 |

**逐格一致性期望**：若要求与 Web **逐格完全相同**，必须移植**同一 RNG 与同一算法**；否则只比较**可观察规则与分布**（`Unity移植/09` §2 已给出该口径）。

> **【待决策】**：Unity 是否需要与 Web 逐格一致？建议**只在测试中**做分布/结构比对，不追求逐格一致（成本高、收益低）。但**必须**保证 Unity 自身"同 seed 可复现"。

---

## 11. 存档结构、版本号与迁移策略

### 11.1 结构（建议）

```json
{
  "schemaVersion": 1,
  "gameVersion": "0.1.0",
  "terrainGeneratorVersion": 1,
  "seed": 20260921,
  "savedAtUtc": "2026-01-01T00:00:00Z",
  "session":     { "time": 0, "speed": 1, "paused": false, "over": false },
  "world":       { "era": 0, "chunks": [ /* List<ChunkSaveData> */ ] },
  "progression": { "stars": 0, "milestones": [[0,0,0]], "wonders": [0,0,0,0,0] },
  "economy":     { "power": 100, "faith": 0, "pop": 20, "totalFaith": 0 },
  "narrative":   { "storyFlags": {}, "archiveUnlocked": [] }
}
```

> **注意**：`Dictionary` 序列化受限 → 区块用 `List<ChunkSaveData>`（`Unity移植/03` §2 已提示）。

### 11.2 关键策略

| 项 | 策略 |
|---|---|
| 写入 | 临时文件 → 完整写入并校验 → 原子替换；失败保留上一有效档并**提示玩家** |
| 自动存档 | 统一走同一序列化/校验流程；周期 180 游戏秒（可调） |
| 三条路径 | 周期 / 离场同步 / 转后台异步；**统一互斥判据**；"忙而跳过"**不清零累加器** |
| 导入 | 先反序列化到临时 DTO → 校验 schema 与全部区块 → 才提交到当前会话（**失败不改当前世界**） |
| 禁止入档 | GameObject instanceID、Mesh 引用、场景对象引用 |
| 版本 | `schemaVersion` 独立于 `gameVersion`；迁移器链 `v1→v2→…` |
| 未知版本/缺字段/超大文件/NaN/重复区块坐标 | 明确错误处理，**整体拒绝**（不做部分加载） |

### 11.3 Web v3 存档兼容

| 选项 | 说明 |
|---|---|
| A. 不兼容 | Unity 用全新格式；Web 存档与 Unity 存档各自独立 | **【待决策，建议起点】** |
| B. 提供导入器 | 实现 Web v3 → Unity DTO 的一次性导入（`M11-06`） |
| C. 运行时双向 | 成本高，不建议 |

> 任务书 §五-9 要求"保持 Web Demo 可独立运行"——无论选哪个，**都不得改 Web 侧存档格式**。

---

## 12. 测试策略、性能预算与调试工具

### 12.1 测试分层

| 层 | 范围 | 工具 |
|---|---|---|
| EditMode | 纯公式 / 进阶条件 / 地形采样 / 放置合法性 / 存档 DTO / 配置校验 | Unity Test Framework（**CI 可跑**） |
| PlayMode | 输入与 UI / 建筑完成 / 奇迹触发 / 暂停与倍速 / 场景加载与保存恢复 / 重复读档资源计数 | Unity Test Framework（需图形环境） |
| 与 Web 对照 | 固定 seed + 相同操作序列，对照地形/放置/每 tick 资源/进阶/通关 | 自定义对照工具（可与 EditMode 结合） |
| 长时运行 | 区块扩张、建筑增多、反复存读、暂停恢复 | 压测场景 |

### 12.2 必须迁移的"有牙齿"的断言（来自 Web 的教训）

| 断言 | 来源 |
|---|---|
| 里程碑必须引用本时代奇迹（注入错误引用必失败） | Web 最贵的一次回归 |
| `starCost == 里程碑数`（零冗余护栏） | `config.js` |
| 划定≠建成（未建成不产出） | `numeric-design` §3 |
| 自动建造达标归零（S-04 棘轮） | `rev-6-autobuild.test.mjs` |
| 住房置顶不被资源门槛剔除 | 同上 |
| 三条存档路径统一互斥（双向验证） | `rev-5-save-policy.test.mjs` |
| 逻辑数 / 地块数 双口径不混用 | `09_2` §3.6 |
| 奇迹加成"单一实现点" | `wonderPopMult` 回归 |
| 暂停时资源与进度不变 | `Unity移植/04` §5 |

> **反向验证要求**：每个关键修复必须有"注入缺陷 → 确认断言失败"的记录（`15` §3.4 明确这是本项目最重要的工程实践）。

### 12.3 性能预算（**先测量，后定值**）

Web 侧实测（**不可直接套用到 Unity**）：

| 指标 | Web 实测 | Unity 要求 |
|---|---|---|
| era IV 满城 DrawCall | 6352 → 约 230（合批后） | 重新测量，**不沿用该数字** |
| 渲染环境 | SwiftShader 软渲染（无 GPU），1–12 FPS | **必须真 GPU / 构建版测量** |

**建议记录的指标**：主线程/渲染线程耗时、每帧 GC Alloc、活跃区块数、逻辑建筑数、渲染实例数、Mesh 重建次数、存档耗时与大小、帧率 1% low、不同地图规模的内存增长。

**目标（暂定，需实测校准）**：

- 无持续 GC 分配导致的周期性卡顿；
- 远离原点无精度问题；
- 区块增多时无每帧全世界扫描；
- 暂停后模拟状态稳定。

> ⚠️ **不要把 `MAX_BUILD_MESH=420` / `MAX_TREE_MESH=800` / `MAX_NPC_INST=400` 直接当成 Unity 的渲染上限**：这些是 **Web 的视觉抽样上限**，Unity 的实例上限应在阶段 E/F 实测后重新标定。

### 12.4 调试工具

| 工具 | 用途 |
|---|---|
| 世界状态查看器（Editor Window） | 查看区块/地块/缓存版本号 |
| tick 步进与确定性回放 | 固定 seed + 操作序列重放 |
| 性能 HUD | FPS / GC Alloc / DrawCall / 活跃区块 / 渲染实例数 |
| 存档快照 diff | 比较两次存档差异，定位口径错误 |

---

## 13. 决策汇总（阻塞项加粗）

| # | 决策 | 建议 | 状态 |
|---|---|---|---|
| **D-1** | **Unity 版本** | **Unity 6 LTS（6000.x）** | ✅ **已定（2026-10-10）** |
| **D-2** | **渲染管线** | **URP** | ✅ **已定（2026-10-10）** |
| **D-3** | **Unity 工程目录名** | **`Assets/_Project/`**（沿用既有 `Unity移植/02`，废弃 `_Game`） | ✅ **已定（2026-10-10）** |
| **D-4** | **工程在仓库中的位置/子模块策略** | 单仓 `05_UnityProject/`（见 `09`） | ✅ **已定（2026-10-10）** |
| D-5 | 目标平台 | PC 优先，移动端后续 | 【待决策】 |
| D-6 | 是否兼容 Web v3 存档 | 建议起点：不兼容（各自独立） | 【待决策】 |
| D-7 | 是否新增建筑升级系统 | 项目当前**无等级制**；若新增属设计变更 | **【待决策】** |
| D-8 | 评分维度命名/阈值 | 冻结后再实现 | **【待决策】** |
| D-9 | 通关后是否冻结经济 | Web 会冻结；建议 Unity 提供"沙盒续玩"开关 | 【待决策】 |
| D-10 | UI 框架 | UI Toolkit 为主（必要时少量 uGUI） | 【待决策】 |
| D-11 | 是否与 Web 逐格一致 | 建议只比分布/结构，不比逐格 | 【待决策】 |
| D-12 | 是否需要账号系统 | Unity 首版用本地档案，不照搬密码系统 | 【待决策】 |
| D-13 | 是否使用 Git LFS 管理模型/贴图 | **启用 LFS**；`.blend` 等大型源文件是否入 LFS **延后至首批建筑通过 Unity 验证后再定** | ✅ **已定（2026-10-10）** |
