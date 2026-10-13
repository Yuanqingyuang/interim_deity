// 《实习神明》Gameplay 层 · 地形工具与划区指令
//
// 这是 Web 版 `js/terrain.js` 的 `applyTool(G, hx, hy, dt)` 的 C# 移植：
// 玩家每次「按住工具」的一帧都会调用一次 <see cref="TerrainToolService.Apply"/>，
// 由 dt 决定神力消耗与地形改变量（因此是「持续作用」而非「一次性点击」）。
//
// 与 Web 的对应关系（逐条保留，不自行发明规则）：
//   · 前置：`if(G.power < consume*0.5) return 'power'`（注意是 consume 的一半，不是 consume）
//   · 划区：坐标 Math.Round → 走 PlaceAt(manual=true) → 失败时按 water/occupied/height/blocked 归因
//   · 拆除：清 zone/prog/built，**保留地形**；返回 'empty' 表示本来就没有分区
//   · 地形笔刷：reach = R + 0.7；衰减 f = max(0, 1 - d/reach)
//       raise   水面→抬出水面；陆地 → min(MAXH, h + strength*dt*f)
//       lower   max(MINH, h - strength*dt*f)；降到水线以下即变水
//       flatten 目标 = clamp(median*0.75 + centerH*0.25, 1.12, 5.2)，限速逼近，随后钳制到 [1.10, 5.2]
//       water   非水且 h < 2.8 → 变水，h 压到 ≤0.7
//       tree    非水且 0.9 < h < 6.2 且 f > 0.3 → 长树
//   · 收尾：power 扣减（笔刷按是否命中取 used）、TerrainDirty = true
//
// 表现层不在此处：Web 用 `G.onToolHit` / `G.onZonePlaced` / `G.onZoneRemoved` 回调注入，
// C# 侧改为返回结构化结果 + 可选的 <see cref="TerrainToolService.ZonePlaced"/> 等事件，
// 由 Presentation 订阅，避免 Gameplay 依赖渲染。
using System;
using System.Collections.Generic;
using InterimDeity.Core;
using InterimDeity.World;

namespace InterimDeity.Gameplay
{
    /// <summary>工具执行结果的原因码——与 Web 返回的字符串码一一对应，便于 UI 提示与测试断言。</summary>
    public static class ToolResult
    {
        public const string Ok = "ok";
        public const string Power = "power";
        public const string Out = "out";
        public const string Water = "water";
        public const string Occupied = "occupied";
        public const string Height = "height";
        public const string Blocked = "blocked";
        public const string Empty = "empty";
    }

    /// <summary>一次工具调用的完整结果。</summary>
    public sealed class ToolOutcome
    {
        /// <summary>原因码，见 <see cref="ToolResult"/>。</summary>
        public string Code = ToolResult.Ok;
        /// <summary>本次实际扣除的神力。</summary>
        public double PowerSpent;
        /// <summary>被改动的地块数（笔刷命中且满足各自条件的格数）。</summary>
        public int TilesChanged;
        /// <summary>划区/拆除生效的格（未生效为 null）。</summary>
        public TileCoord? Affected;
        /// <summary>划区生效时的分区编号；拆除时为被清除的原分区。</summary>
        public int Zone;
        /// <summary>地形是否被标记为脏（需要重建网格）。</summary>
        public bool TerrainDirty;

        public bool IsOk => Code == ToolResult.Ok;
    }

    /// <summary>地形工具与划区指令的执行入口。</summary>
    public static class TerrainToolService
    {
        /// <summary>划区成功（手动放置）时触发：参数为格坐标与分区编号。</summary>
        public static event Action<int, int, int> ZonePlaced;

        /// <summary>拆除生效时触发：参数为格坐标与被清除的原分区编号。</summary>
        public static event Action<int, int, int> ZoneRemoved;

        /// <summary>地形笔刷命中时触发：参数为笔刷中心与工具 key（供粒子/音效）。</summary>
        public static event Action<int, int, string> ToolHit;

        /// <summary>
        /// 执行一次工具调用。
        /// </summary>
        /// <param name="G">世界状态（权威数据源）。</param>
        /// <param name="toolKey">工具 key，取自 <see cref="ToolTable"/>。</param>
        /// <param name="hx">笔刷/光标的连续世界 X 坐标（<b>不是</b>格整数）。</param>
        /// <param name="hy">笔刷/光标的连续世界 Y 坐标。</param>
        /// <param name="dt">本次作用的时间步长（秒）。</param>
        public static ToolOutcome Apply(WorldState G, string toolKey, double hx, double hy, double dt)
        {
            var outcome = new ToolOutcome();
            ToolDef tool = ToolTable.Get(toolKey);
            if (tool == null || G == null) { outcome.Code = ToolResult.Blocked; return outcome; }

            double consume = tool.Cost * dt;
            // Web: if(G.power < consume*0.5) return 'power';
            // 保留「一半」这个阈值：轻点一下（dt 很小）也允许生效，否则高频调用会被卡死。
            if (G.Stats.Power < consume * 0.5) { outcome.Code = ToolResult.Power; return outcome; }

            if (tool.Kind == ToolKind.Zone) return ApplyZone(G, tool, hx, hy, consume, outcome);
            if (tool.Kind == ToolKind.Demolish) return ApplyDemolish(G, hx, hy, consume, outcome);
            return ApplyTerrainBrush(G, tool, toolKey, hx, hy, dt, consume, outcome);
        }

        // ── 划区（Web: tool.kind === 'zone' 分支）──
        private static ToolOutcome ApplyZone(WorldState G, ToolDef tool, double hx, double hy, double consume, ToolOutcome outcome)
        {
            int tx = MathUtil.RoundJs(hx);
            int ty = MathUtil.RoundJs(hy);
            if (!StateQueries.TileLive(G, tx, ty)) { outcome.Code = ToolResult.Out; return outcome; }

            PlaceResult pr = TerrainGenerator.PlaceAt(G, tx, ty, tool.Zone, manual: true);
            if (pr.Ok)
            {
                G.Stats.Power = Math.Max(0, G.Stats.Power - consume);
                outcome.Code = ToolResult.Ok;
                outcome.PowerSpent = consume;
                outcome.Affected = new TileCoord(tx, ty);
                outcome.Zone = tool.Zone;
                outcome.TilesChanged = 1;
                outcome.TerrainDirty = G.TerrainDirty;
                ZonePlaced?.Invoke(tx, ty, tool.Zone);
                return outcome;
            }

            // 失败归因——顺序与 Web 一致：water → occupied → height → blocked
            TileData t = StateQueries.GetTile(G, tx, ty);
            if (t != null && t.IsWater) outcome.Code = ToolResult.Water;
            else if (t != null && t.Zone > 0) outcome.Code = ToolResult.Occupied;
            else if (t != null && (t.Height < 0.95f || t.Height > 5.4f)) outcome.Code = ToolResult.Height;
            else outcome.Code = ToolResult.Blocked;
            return outcome;
        }

        // ── 拆除（Web: tool.kind === 'demolish' 分支；R6 —— 保留地形）──
        private static ToolOutcome ApplyDemolish(WorldState G, double hx, double hy, double consume, ToolOutcome outcome)
        {
            int tx = MathUtil.RoundJs(hx);
            int ty = MathUtil.RoundJs(hy);
            if (!StateQueries.TileLive(G, tx, ty)) { outcome.Code = ToolResult.Out; return outcome; }

            TileData t = StateQueries.GetTile(G, tx, ty);
            if (t == null || t.Zone <= 0) { outcome.Code = ToolResult.Empty; return outcome; }

            int oldZone = t.Zone;
            t.Zone = 0;
            t.BuildProgress = 0;
            t.IsBuilt = false;
            // 关键：**不改地形高度**（Web R6 明确保留地形）
            TerrainGenerator.EnsureChunkRing(G, tx, ty);
            G.TerrainDirty = true;
            StateQueries.InvalidateBuiltCache(G);

            G.Stats.Power = Math.Max(0, G.Stats.Power - consume);
            outcome.Code = ToolResult.Ok;
            outcome.PowerSpent = consume;
            outcome.Affected = new TileCoord(tx, ty);
            outcome.Zone = oldZone;
            outcome.TilesChanged = 1;
            outcome.TerrainDirty = true;
            // 只触发移除回调，禁止触发 ZonePlaced（否则会误写「建起」日志）
            ZoneRemoved?.Invoke(tx, ty, oldZone);
            return outcome;
        }

        // ── 地形笔刷（Web: tool.kind === 'terrain' 分支）──
        private static ToolOutcome ApplyTerrainBrush(
            WorldState G, ToolDef tool, string toolKey, double hx, double hy, double dt, double consume, ToolOutcome outcome)
        {
            double R = tool.Radius;
            double reach = R + ToolTable.ReachMargin;
            int x0 = (int)Math.Floor(hx - reach);
            int x1 = (int)Math.Ceiling(hx + reach);
            int y0 = (int)Math.Floor(hy - reach);
            int y1 = (int)Math.Ceiling(hy + reach);

            int cx = MathUtil.RoundJs(hx);
            int cy = MathUtil.RoundJs(hy);

            // 平整目标：笔刷内**非水**地块高度中位数，再向中心高度靠 25%，并钳制。
            // 抗离群点（避免被水坑/尖峰拽跑），与 Web 同式。
            double flattenTarget = 0;
            if (toolKey == "flatten") flattenTarget = ComputeFlattenTarget(G, cx, cy, R);

            int changed = 0;
            for (int y = y0; y <= y1; y++)
            {
                for (int x = x0; x <= x1; x++)
                {
                    TileData t = StateQueries.GetTile(G, x, y);
                    if (t == null) continue;

                    double dx = x - hx;
                    double dy = y - hy;
                    double d = Math.Sqrt(dx * dx + dy * dy);
                    if (d > reach) continue;
                    double f = Math.Max(0, 1 - d / reach);

                    bool hit = ApplyBrushToTile(G, tool, toolKey, t, dt, f, flattenTarget);
                    if (hit)
                    {
                        changed++;
                        // 水格不变量（与 TerrainGenerator.FillTileFromNoise 同一约束）：
                        // 凡被判为水的格，高度必须低于水面平面，否则会「水面穿出地形」。
                        if (t.IsWater && t.Height > TerrainGenerator.WaterPlaneY)
                            t.Height = (float)TerrainGenerator.WaterPlaneY;
                    }
                }
            }

            // Web: `used = Math.max(used, consume)` —— 只要笔刷扫到任意一格就按一份消耗计
            double used = changed > 0 ? consume : 0;
            G.Stats.Power = Math.Max(0, G.Stats.Power - used);
            G.TerrainDirty = true;

            outcome.Code = ToolResult.Ok;
            outcome.PowerSpent = used;
            outcome.TilesChanged = changed;
            outcome.TerrainDirty = true;

            if (changed > 0) ToolHit?.Invoke(cx, cy, toolKey);
            return outcome;
        }

        /// <summary>
        /// 平整工具的目标高度：笔刷内非水格的中位数 × 0.75 + 中心高度 × 0.25，钳制到 [1.12, 5.2]。
        /// 中心为水或不存在时，中心项退化为中位数（与 Web 的三元判断一致）。
        /// </summary>
        private static double ComputeFlattenTarget(WorldState G, int cx, int cy, double R)
        {
            int pr = Math.Max(1, (int)Math.Round(R));
            var samples = new List<double>((2 * pr + 1) * (2 * pr + 1));
            for (int dy = -pr; dy <= pr; dy++)
            {
                for (int dx = -pr; dx <= pr; dx++)
                {
                    if (dx * dx + dy * dy > pr * pr) continue;
                    TileData a = StateQueries.GetTile(G, cx + dx, cy + dy);
                    if (a == null || a.IsWater) continue;
                    samples.Add(a.Height);
                }
            }
            samples.Sort();

            double median;
            if (samples.Count > 0) median = samples[samples.Count >> 1];
            else
            {
                TileData c0 = StateQueries.GetTile(G, cx, cy);
                median = c0 != null ? c0.Height : 2.0;
            }

            TileData center = StateQueries.GetTile(G, cx, cy);
            double centerH = (center != null && !center.IsWater) ? center.Height : median;

            double target = median * 0.75 + centerH * 0.25;
            return MathUtil.Clamp(target, ToolTable.FlattenMinH, ToolTable.FlattenMaxH);
        }

        /// <summary>把笔刷作用于单个地块；返回是否真的改动了它。</summary>
        private static bool ApplyBrushToTile(
            WorldState G, ToolDef tool, string toolKey, TileData t, double dt, double f, double flattenTarget)
        {
            switch (toolKey)
            {
                case "raise":
                    if (t.IsWater)
                    {
                        // 抬升可以把水格抬成陆地
                        t.IsWater = false;
                        t.Height = (float)Math.Max(1.0, TerrainGenerator.WaterLevel + 0.05);
                        return true;
                    }
                    {
                        double nh = Math.Min(TerrainGenerator.MaxH, t.Height + tool.Strength * dt * f);
                        if (nh == t.Height) return false;
                        t.Height = (float)nh;
                        return true;
                    }

                case "lower":
                    {
                        double nh = Math.Max(TerrainGenerator.MinH, t.Height - tool.Strength * dt * f);
                        bool changed = false;
                        if (nh != t.Height) { t.Height = (float)nh; changed = true; }
                        if (t.Height <= TerrainGenerator.WaterLevel)
                        {
                            if (!t.IsWater) { t.IsWater = true; changed = true; }
                            if (t.IsVegetated) { t.IsVegetated = false; changed = true; }
                        }
                        return changed;
                    }

                case "flatten":
                    {
                        // 限速逼近：单次最大位移 = 0.55 * dt * 60 * f
                        double k = Math.Min(1, tool.Strength * dt * (0.35 + 0.65 * f));
                        double next = t.Height + (flattenTarget - t.Height) * k;
                        double maxStep = ToolTable.FlattenMaxStepPerSec * dt * f;
                        double delta = next - t.Height;
                        if (delta > maxStep) delta = maxStep;
                        else if (delta < -maxStep) delta = -maxStep;

                        double h = t.Height + delta;
                        // Web: if(t.h < 1.10) t.h = 1.10;  if(t.h > 5.2) t.h = 5.2;
                        if (h < 1.10) h = 1.10;
                        if (h > 5.2) h = 5.2;

                        bool changed = false;
                        if (h != t.Height) { t.Height = (float)h; changed = true; }
                        // Web: if(t.water && t.h > WATER_LEVEL + 0.02) t.water = 0;
                        if (t.IsWater && t.Height > TerrainGenerator.WaterLevel + 0.02)
                        {
                            t.IsWater = false; changed = true;
                        }
                        // Web: if(t.tree && f > 0.2) t.tree = 0;
                        if (t.IsVegetated && f > 0.2)
                        {
                            t.IsVegetated = false; changed = true;
                        }
                        return changed;
                    }

                case "water":
                    // Web: if(!t.water && t.h < 2.8){ t.water=1; t.tree=0; t.h = min(t.h, 0.7); }
                    if (!t.IsWater && t.Height < ToolTable.WaterToolMaxH)
                    {
                        t.IsWater = true;
                        t.IsVegetated = false;
                        t.Height = (float)Math.Min(t.Height, 0.7);
                        return true;
                    }
                    return false;

                case "tree":
                    // Web: if(!t.water && t.h>0.9 && t.h<6.2 && f>0.3) t.tree = 1;
                    if (!t.IsWater && t.Height > ToolTable.TreeMinH && t.Height < ToolTable.TreeMaxH
                        && f > ToolTable.TreeFalloffGate)
                    {
                        if (t.IsVegetated) return false;
                        t.IsVegetated = true;
                        return true;
                    }
                    return false;
            }
            return false;
        }
    }
}
