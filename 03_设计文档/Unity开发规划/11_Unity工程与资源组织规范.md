# 11 · Unity 工程与资源组织规范

> 交付物（阶段 A 的 `M1-04`/`M1-06` 规格部分）。
> 目录树以用户已裁决方案为准；本文件的**子结构**标注为"建议"，属实现细节，不改变顶层约定。
> ⚠️ 本环境无 Unity，**本文件是规范，不是已落地的工程**。

---

## 一、目录规范（顶层已裁决）

```text
interim_deity/
└── 05_UnityProject/                 ← Unity 工程根（必须保留 Packages/ 与 ProjectSettings/）
    ├── Assets/
    │   └── _Project/                ← 业务资源根（**不是** Assets 根，也不是工程根）
    │       ├── Scripts/
    │       ├── Data/
    │       ├── Prefabs/
    │       ├── Scenes/
    │       ├── UI/
    │       ├── Art/
    │       │   └── Models/
    │       │       └── Buildings/
    │       │           ├── Primitive/      E1 蛮荒
    │       │           ├── CityState/      E2 城邦
    │       │           ├── Feudal/         E3 封建
    │       │           ├── Industrial/     E4 工业
    │       │           └── Interstellar/   E5 星际
    │       └── Materials/
    ├── Packages/                    ← Unity 必需
    ├── ProjectSettings/             ← Unity 必需
    └── README.md
```

**两条硬约束**（用户明确）：
1. `05_UnityProject/` 是**工程根**，`Packages/`、`ProjectSettings/` 必须在工程根；**不得把整个工程塞进 `Assets/`**。
2. 业务资源统一在 `Assets/_Project/`，**不得**把脚本/数据散落到 `Assets/` 根。

### 1.1 建议子结构（实现细节，可调整）

| 目录 | 建议子结构 | 说明 |
|---|---|---|
| `Scripts/` | 按 asmdef 分层（见 §二）；**每层一个文件夹** | 每层放一个 `.asmdef` |
| `Data/` | `Eras/` `Buildings/` `Wonders/` `Terrain/` `Narrative/` | `ScriptableObject` 资产 |
| `Prefabs/` | `Buildings/<Era>/<Zone>/` `Wonders/` `UI/` `Environment/` | Prefab |
| `Scenes/` | `Boot.unity` `MainMenu.unity` `World.unity` | 仅 3 个 |
| `UI/` | `Styles/` `Templates/` `Icons/` | UI Toolkit 资产或 uGUI 资源 |
| `Art/Models/` | `Buildings/<Era>/`（已固定）+ `Props/` `VFX/` | 静态网格 |
| `Materials/` | `Shared/` `Buildings/` | **共享材质优先**，控制材质球数量 |
| （后续按需） | `Tests/`（EditMode/PlayMode）、`Audio/`、`Settings/` | **阶段 A 建测试工程时再新增**，当前不预建 |

---

## 二、程序集（asmdef）分层与依赖方向

> 目的：让"逻辑不依赖场景对象"成为**编译期约束**，而不是靠自觉（`04` §3.2、`M1-04`）。

| 层 | 建议程序集名 | 职责 | 允许引用 |
|---|---|---|---|
| 0 | `Deity.Core` | 纯数据、契约、事件、命令、工具（无 `UnityEngine` 场景类型） | 无 |
| 1 | `Deity.Simulation` | 数值公式、人口/资源、建造速度、时代进阶、自动建造决策（**纯函数，可单测**） | Core |
| 2 | `Deity.World` | 世界数据、地形生成、放置合法性、区块管理 | Core、Simulation |
| 3 | `Deity.Gameplay` | 命令处理、游戏时钟、奇迹/神迹流程编排 | Core、Simulation、World |
| 4 | `Deity.Save` | 存档 DTO、序列化、迁移、策略 | Core、Simulation、World |
| 5 | `Deity.Presentation` | 地形网格、建筑/村民渲染、环境（昼夜/水/云）、相机、拾取 | Core、Simulation、World、（Gameplay 只读事件） |
| 6 | `Deity.UI` | HUD/面板/工具栏；**只读状态、只发命令** | Core、Simulation、（Presentation 仅取展示数据） |
| 7 | `Deity.Narrative` | 剧情导演、对话、档案 | Core、（Gameplay/Save 仅事件） |
| 8 | `Deity.Tests.EditMode` / `Deity.Tests.PlayMode` | 测试 | 上述（按需） |

**依赖方向铁律**：

- 依赖**单向向下**（编号小的被编号大的引用）；**禁止反向**。
- `Core` **不得引用 `UnityEngine` 场景类型**（若必须用 `Vector2Int`，优先自定义 `int2`）。
- `Simulation` **不得引用 `Presentation` / `UI`**。
- `UI` **不得直接修改数据结构**，只能发 `GameCommand`。

**验证方式（须在 Unity 中执行）**：故意在 `Simulation` 中 `using UnityEngine;` 并引用 `GameObject` → **必须编译失败**（注入验证，`M1-04` 验收）。本环境无法执行此验证。

---

## 三、命名规范

| 类别 | 规则 | 示例 |
|---|---|---|
| 程序集 | `Deity.<Layer>` | `Deity.Simulation.asmdef` |
| 命名空间 | `InterimDeity.<Layer>[.<Feature>]` | `InterimDeity.Simulation.Economy` |
| C# 类/方法/属性 | PascalCase | `EconomyRules.BuildSpeed()` |
| 私有字段 | `_camelCase` | `_terrainVersion` |
| 纯数据类 | 名词，无后缀歧义 | `TileData`、`ChunkData`、`WorldState` |
| 规则类 | `...Rules` / `...Policy` | `EconomyRules`、`AutoBuildPolicy` |
| 服务类 | `...Service` | `SaveService`、`WonderService` |
| ScriptableObject 类型 | 名词（Definition 后缀） | `EraDefinition`、`BuildingDefinition` |
| SO 资产文件 | `SO_<含义>` | `SO_Era_Feudal.asset` |
| Prefab | `PF_<Zone>_<Era>_<Variant>` | `PF_House_Feudal_A.prefab` |
| 静态网格（来自 Blender） | `SM_<Zone>_<Era>_<Variant>[_<Part>]` | `SM_House_Feudal_A_Wall` |
| 材质 | `M_<语义>_<Era>` | `M_Wall_Plaster_Feudal` |
| 贴图 | `T_<语义>_<用途>` | `T_Building_Atlas_01` |
| 场景 | PascalCase | `World.unity` |
| 测试 | `<被测单元>Tests` | `EconomyRulesTests` |

**规则**：全英文、无空格、`_` 分隔、**同一含义在 Blender/FBX/Unity/文档中保持同名**（便于自动校验，且 `05` §1.4 已规定）。

---

## 四、资源组织

### 4.1 配置（`Data/`，ScriptableObject）

| 资产 | 数量 | 说明 |
|---|---|---|
| `EraDefinition` | 5 | 名称/罗马数字/目标人口/starCost/门槛/主导约束/配色/外观集 |
| `BuildingDefinition` | 4 | 4 类分区；含人均系数 `r_b`、造价权重、产出、可建高度 |
| `WonderDefinition` | 5 | 5 座奇迹；含加成引用（人口乘区/信仰乘区，**单一实现点**） |
| `MiracleDefinition` | 3 | 丰收祝福/加速建造/天降甘霖 |
| 地形参数资产 | 1 | 大陆/山脊/河谷/阈值等可调参数 |
| 叙事资产 | 待内容 | `DialogueSequence` / `ArchiveEntry` / `StoryFlagDefinition` |

**规则**：SO **只存静态配置**，**不存运行时可变状态**（否则编辑器会被改脏）。

### 4.2 外观（`Art/Models/Buildings/<Era>/` + `Prefabs/Buildings/<Era>/<Zone>/`）

- 五时代目录名固定：`Primitive` / `CityState` / `Feudal` / `Industrial` / `Interstellar`。
- `Prefabs/` 下的 `<Era>/<Zone>/` 为**建议子结构**（不改变顶层 `Prefabs/`）。
- 逻辑建筑只持有 `definitionId` + `era` + `variant`；外观由 `BuildingPrefabProvider` 按 `(Zone, Era, Variant)` 解析 → **换模型不破坏存档**（`M4-06`/`M5-01`）。

### 4.3 材质（`Materials/`）

- **共享材质优先**；单建筑 ≤2 个材质；**禁止每栋一个独有材质**。
- 评估**顶点色 + 少量共享材质**方案（D-14）以减少材质球、利于 GPU Instancing。
- 透明材质严控（破坏合批、引入排序开销）。

---

## 五、资源导入规范

| 项 | 规范 |
|---|---|
| FBX 导入 | Scale Factor = 1；Z-up→Y-up；`Apply Transform` 已在 Blender 侧完成；不导入摄像机/灯光 |
| Mesh | 关闭 `Read/Write`（除非运行期需读顶点）；`Optimize Mesh` 开启；**不启用复杂 Mesh Collider** |
| 材质映射 | 导入后统一映射到 `Materials/` 下的共享材质（用 Material Variant 或 Remap） |
| 贴图 | 类型正确（BaseColor = sRGB）；共享图集；**不允许每栋独有贴图** |
| 碰撞体 | **建筑默认不加 Collider**；放置占用由格子数据提供；拾取走格子坐标（`04` §12、`05` §3） |
| Prefab | 由 Prefab 手动/脚本生成后**登记到 `BuildingPrefabProvider` 映射表**；缺失时回落占位体并告警 |

---

## 六、版本控制（与 `09` 一致）

### 6.1 `.gitignore`（阶段 A 增补）

```gitignore
05_UnityProject/[Ll]ibrary/
05_UnityProject/[Tt]emp/
05_UnityProject/[Oo]bj/
05_UnityProject/[Bb]uild/
05_UnityProject/[Bb]uilds/
05_UnityProject/[Ll]ogs/
05_UnityProject/[Uu]serSettings/
05_UnityProject/.vs/
05_UnityProject/*.csproj
05_UnityProject/*.sln
05_UnityProject/*.user
*.blend1
*.blend2
```

### 6.2 Git LFS（阶段 A 立即启用）

```gitattributes
*.fbx  filter=lfs diff=lfs merge=lfs -text
*.glb  filter=lfs diff=lfs merge=lfs -text
*.gltf filter=lfs diff=lfs merge=lfs -text
*.psd  filter=lfs diff=lfs merge=lfs -text
*.png  filter=lfs diff=lfs merge=lfs -text
*.tga  filter=lfs diff=lfs merge=lfs -text
*.exr  filter=lfs diff=lfs merge=lfs -text
*.wav  filter=lfs diff=lfs merge=lfs -text
*.mp3  filter=lfs diff=lfs merge=lfs -text
```

**`.blend` 暂缓**（待首批建筑通过 Unity 导入与验证后再决定，D-13）。

> ⚠️ LFS 规则必须置于现有 `* text=auto eol=lf` **之后**。本仓库当前无图片/音频资源（`15` §2.6 已核实），故不影响现有内容。

---

## 七、验证方式（区分"本环境"与"需 Unity"）

| 检查 | 本环境 | 需 Unity |
|---|---|---|
| 目录树与顶层约定一致 | ✅ 文本对照 | — |
| 命名规范（文档/文件） | ✅ 文本检查 | — |
| 程序集反向引用会被拦截 | ❌ | ✅ 注入验证（`M1-04`） |
| `Simulation` 不引用 `UnityEngine` | ❌（无法编译） | ✅ 编译 + 分析器（`M1-06`） |
| Prefab 可解析、比例/原点合规 | ❌ | ✅ 资源校验测试（`M15-07`） |
| 换模型不破坏存档 | ❌ | ✅ 同一存档替换前后读入（`M4-06` 验收） |
| `.gitignore`/LFS 生效 | ⚠️ 可写规则，但需在有工程后验证 | ✅ |
