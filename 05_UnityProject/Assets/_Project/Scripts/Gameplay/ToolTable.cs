// 《实习神明》Gameplay 层 · 玩家工具表
//
// 对应 Web 版 `js/config.js` 的 TOOLS 与 `js/terrain.js` 的 applyTool 分派。
// 数值逐项对齐 Web（cost / radius / strength / kind / zone），改动必须同步 Web 侧。
//
// 语义要点（Web → C# 保持一致）：
//   · cost 是**每秒**消耗，实际扣减 = cost × dt（applyTool 内 `tool.cost * dt`）
//   · kind 决定分派：terrain（地形笔刷）/ zone（划区）/ demolish（拆除）
//   · strength 仅地形工具有效，作用于「强度 × dt × 距离衰减」
using System.Collections.Generic;

namespace InterimDeity.Gameplay
{
    /// <summary>工具的作用类型——决定 <see cref="TerrainToolService"/> 的分派路径。</summary>
    public enum ToolKind
    {
        Terrain,
        Zone,
        Demolish,
    }

    /// <summary>单个玩家工具的定义（不可变）。</summary>
    public sealed class ToolDef
    {
        public readonly string Key;
        public readonly ToolKind Kind;
        /// <summary>神力消耗速率（点/秒）。</summary>
        public readonly double Cost;
        /// <summary>作用半径（格）。</summary>
        public readonly double Radius;
        /// <summary>地形改造强度；仅 Kind == Terrain 有意义。</summary>
        public readonly double Strength;
        /// <summary>目标分区编号；仅 Kind == Zone 有意义（1 居住 / 2 农田 / 3 工业 / 4 信仰）。</summary>
        public readonly int Zone;

        public ToolDef(string key, ToolKind kind, double cost, double radius, double strength, int zone)
        {
            Key = key;
            Kind = kind;
            Cost = cost;
            Radius = radius;
            Strength = strength;
            Zone = zone;
        }
    }

    /// <summary>工具表：与 Web `config.js` 的 TOOLS 逐项对齐。</summary>
    public static class ToolTable
    {
        /// <summary>笔刷在作用半径外额外扫描的余量（Web: `reach = R + 0.7`）。</summary>
        public const double ReachMargin = 0.7;

        /// <summary>平整工具的目标高度钳制区间（Web: `clamp(..., 1.12, 5.2)`）。</summary>
        public const double FlattenMinH = 1.12;
        public const double FlattenMaxH = 5.2;

        /// <summary>平整工具的限速上限（Web: `0.55 * dt * 60 * f`，即 f=1 时约 0.55/秒）。</summary>
        public const double FlattenMaxStepPerSec = 0.55 * 60.0;

        /// <summary>B-03 · 引水工具的高度上限（Web: `if(!t.water && t.h &lt; 2.8)`）。</summary>
        public const double WaterToolMaxH = 2.8;

        /// <summary>B-04 · 绿化工具的可植区间与衰减门槛（Web: `h&gt;0.9 &amp;&amp; h&lt;6.2 &amp;&amp; f&gt;0.3`）。</summary>
        public const double TreeMinH = 0.9;
        public const double TreeMaxH = 6.2;
        public const double TreeFalloffGate = 0.3;

        public static readonly ToolDef Raise = new ToolDef("raise", ToolKind.Terrain, 6, 1.8, 0.9, 0);
        public static readonly ToolDef Lower = new ToolDef("lower", ToolKind.Terrain, 6, 1.8, 0.9, 0);
        public static readonly ToolDef Flatten = new ToolDef("flatten", ToolKind.Terrain, 8, 2.2, 1.1, 0);
        public static readonly ToolDef Water = new ToolDef("water", ToolKind.Terrain, 8, 1.8, 0, 0);
        public static readonly ToolDef Tree = new ToolDef("tree", ToolKind.Terrain, 5, 1.8, 0, 0);

        public static readonly ToolDef ZoneResidential = new ToolDef("z_res", ToolKind.Zone, 4, 1.3, 0, 1);
        public static readonly ToolDef ZoneAgriculture = new ToolDef("z_agr", ToolKind.Zone, 4, 1.3, 0, 2);
        public static readonly ToolDef ZoneIndustrial = new ToolDef("z_ind", ToolKind.Zone, 4, 1.3, 0, 3);
        public static readonly ToolDef ZoneFaith = new ToolDef("z_fai", ToolKind.Zone, 4, 1.3, 0, 4);

        public static readonly ToolDef Demolish = new ToolDef("demolish", ToolKind.Demolish, 1, 1.2, 0, 0);

        private static readonly Dictionary<string, ToolDef> ByKey = Build();

        private static Dictionary<string, ToolDef> Build()
        {
            var all = new[]
            {
                Raise, Lower, Flatten, Water, Tree,
                ZoneResidential, ZoneAgriculture, ZoneIndustrial, ZoneFaith,
                Demolish,
            };
            var map = new Dictionary<string, ToolDef>(all.Length);
            foreach (var t in all) map[t.Key] = t;
            return map;
        }

        /// <summary>按 key 取工具；不存在返回 null（与 Web `TOOLS[G.tool]` 同语义）。</summary>
        public static ToolDef Get(string key)
        {
            if (string.IsNullOrEmpty(key)) return null;
            return ByKey.TryGetValue(key, out var t) ? t : null;
        }

        /// <summary>工具总数（供测试断言与 UI 枚举）。</summary>
        public static int Count => ByKey.Count;
    }
}
