// 《实习神明》Gameplay 层 · 神迹（Miracle）
//
// 移植 Web `main.js` 的 `castMiracle(key)` 与 `config.js` 的 `MIRACLES`。
//
// Web 原始实现（逐行语义，不得改写）：
//     function castMiracle(key){
//       const m = MIRACLES[key];
//       if(!m) return;                                   // 未知 key：静默返回
//       if(G.power < m.cost){ toast('神力不足'); return; } // 前置校验，**不扣任何东西**
//       G.power -= m.cost;                               // ① 扣神力
//       G[m.field] = m.dur;                              // ② **赋值**（不是 +=）→ 重复施放重置
//       logPush(...);                                     // ③ 日志
//       ... 粒子表现 ...                                   // ④ 表现（不在本层）
//       if(key==='build'){                                // ⑤ 仅「加速建造」有即时效果
//         for pending: t.prog = min(1, t.prog + 0.35)      //    在建建筑 +0.35
//         for wonders: w.prog = min(1, w.prog + 0.12)      //    在建奇迹 +0.12
//       }
//     }
//
// 三条关键契约（测试逐条覆盖）：
//   ① **重复施放是重置而非叠加**：`G[m.field] = m.dur` 是赋值，同类神迹不会叠加时长。
//   ② **失败不产生部分副作用**：神力不足时在扣减之前就 return，状态一字不动。
//   ③ **三个增益可共存**：它们写的是三个不同的 boost 字段（boostGrow/boostBuild/boostRain），
//      互不覆盖；不存在互斥规则。
//
// 状态只有一处权威来源：`WorldStats.BoostGrow / BoostBuild / BoostRain`。
// 本服务不另建一份增益表，避免经济系统与 UI 各维护一套。
using System;
using System.Collections.Generic;
using InterimDeity.Core;

namespace InterimDeity.Gameplay
{
    /// <summary>三种神迹增益（与 Web `MIRACLES` 的 key 一一对应）。</summary>
    public enum MiracleKind
    {
        Grow,
        Build,
        Rain,
    }

    /// <summary>单个神迹的静态定义（不可变）。数值取自 Web `config.js` 的 MIRACLES。</summary>
    public sealed class MiracleDef
    {
        public readonly MiracleKind Kind;
        /// <summary>Web 侧的 key（'grow' / 'build' / 'rain'）。</summary>
        public readonly string Key;
        /// <summary>神力消耗。</summary>
        public readonly double Cost;
        /// <summary>持续时间（秒）。</summary>
        public readonly double Duration;
        public readonly string Label;

        public MiracleDef(MiracleKind kind, string key, double cost, double duration, string label)
        {
            Kind = kind;
            Key = key;
            Cost = cost;
            Duration = duration;
            Label = label;
        }
    }

    /// <summary>神迹表：与 Web `config.js` 的 `MIRACLES` 逐项对齐。</summary>
    public static class MiracleTable
    {
        public static readonly MiracleDef Grow = new MiracleDef(MiracleKind.Grow, "grow", 30, 15, "丰收祝福");
        public static readonly MiracleDef Build = new MiracleDef(MiracleKind.Build, "build", 40, 8, "加速建造");
        public static readonly MiracleDef Rain = new MiracleDef(MiracleKind.Rain, "rain", 25, 12, "天降甘霖");

        public static readonly MiracleDef[] All = { Grow, Build, Rain };

        /// <summary>「加速建造」的即时进度增量（Web: `t.prog += 0.35`）。</summary>
        public const double BuildInstantBuildingProgress = 0.35;
        /// <summary>「加速建造」对在建奇迹的即时进度增量（Web: `w.prog += 0.12`）。</summary>
        public const double BuildInstantWonderProgress = 0.12;

        /// <summary>按 key 取定义；未知返回 null（Web `MIRACLES[key]` 同语义）。</summary>
        public static MiracleDef Get(string key)
        {
            if (string.IsNullOrEmpty(key)) return null;
            for (int i = 0; i < All.Length; i++)
                if (All[i].Key == key) return All[i];
            return null;
        }

        public static MiracleDef Get(MiracleKind kind)
        {
            for (int i = 0; i < All.Length; i++)
                if (All[i].Kind == kind) return All[i];
            return null;
        }
    }

    /// <summary>施放结果（成功/失败、消耗、以及是否触发了即时效果）。</summary>
    public sealed class MiracleResult
    {
        public bool Ok;
        /// <summary>失败原因（供 UI 提示）；成功时为 null。</summary>
        public string Reason;
        public MiracleKind Kind;
        public string Label;
        /// <summary>实际扣除的神力（失败恒为 0）。</summary>
        public double PowerSpent;
        /// <summary>施放后该增益的剩余时长（= Duration，因为施放是重置）。</summary>
        public double BoostRemaining;
        /// <summary>是否处于「已经生效中」时再次施放（用于 UI 提示"已重置"）。</summary>
        public bool WasRefreshed;
        /// <summary>本服务不新增资源，但把计量放在这里 → 调用方不应再自行计算。</summary>
        public int BuildingsBumped;
        public int WondersBumped;

        public static MiracleResult Fail(string reason) => new MiracleResult { Ok = false, Reason = reason };
    }

    /// <summary>神迹施放与增益计时。</summary>
    public static class MiracleService
    {
        /// <summary>神力不足的原因文案（与 Web `toast('神力不足')` 一致）。</summary>
        public const string ReasonNotEnoughPower = "神力不足";
        public const string ReasonUnknownMiracle = "未知的神迹";

        /// <summary>施放成功时触发（供表现层播粒子/音效/提示）。</summary>
        public static event Action<MiracleResult> Cast;

        /// <summary>
        /// 只做校验，不改状态。供 UI 预先置灰按钮。
        /// </summary>
        public static bool CanCast(WorldState G, MiracleKind kind)
        {
            if (G == null) return false;
            MiracleDef def = MiracleTable.Get(kind);
            if (def == null) return false;
            return G.Stats.Power >= def.Cost;
        }

        /// <summary>按 Web key（'grow' / 'build' / 'rain'）施放。</summary>
        public static MiracleResult CastByKey(WorldState G, string key,
            List<TileCoord> pendingBuilds = null)
        {
            MiracleDef def = MiracleTable.Get(key);
            if (def == null) return MiracleResult.Fail(ReasonUnknownMiracle);
            return CastMiracle(G, def, pendingBuilds);
        }

        /// <summary>
        /// 施放神迹。
        /// </summary>
        /// <param name="G">世界状态（权威数据源）。</param>
        /// <param name="kind">神迹类型。</param>
        /// <param name="pendingBuilds">
        /// 待建列表；仅「加速建造」会用到（Web 会对 pending 里每格 +0.35 进度）。
        /// 传 null 时跳过对建筑的即时加速，但仍会加速在建奇迹。
        /// </param>
        public static MiracleResult CastMiracle(WorldState G, MiracleDef def,
            List<TileCoord> pendingBuilds = null)
        {
            if (G == null || def == null) return MiracleResult.Fail(ReasonUnknownMiracle);

            WorldStats stats = G.Stats;

            // ── 前置校验：必须在任何写操作之前 ──
            // Web: `if(G.power < m.cost){ toast('神力不足'); return; }`
            if (stats.Power < def.Cost) return MiracleResult.Fail(ReasonNotEnoughPower);

            // 记录"是否本来就在生效中"，用于回报 WasRefreshed（重复施放 = 重置）
            double before = RemainingOf(stats, def.Kind);

            // ── ① 扣神力 ──
            stats.Power -= def.Cost;

            // ── ② 赋值（重置而非叠加）──
            // Web: `G[m.field] = m.dur` —— 是 `=` 不是 `+=`
            SetRemaining(stats, def.Kind, def.Duration);

            var result = new MiracleResult
            {
                Ok = true,
                Kind = def.Kind,
                Label = def.Label,
                PowerSpent = def.Cost,
                BoostRemaining = def.Duration,
                WasRefreshed = before > 0,
            };

            // ── ③ 仅「加速建造」有即时进度效果 ──
            if (def.Kind == MiracleKind.Build)
            {
                if (pendingBuilds != null)
                {
                    for (int i = 0; i < pendingBuilds.Count; i++)
                    {
                        TileCoord c = pendingBuilds[i];
                        TileData t = World.StateQueries.GetTile(G, c.X, c.Y);
                        if (t == null || t.Zone <= 0 || t.IsBuilt) continue;
                        double np = t.BuildProgress + MiracleTable.BuildInstantBuildingProgress;
                        t.BuildProgress = (float)(np > 1 ? 1 : np);
                        result.BuildingsBumped++;
                    }
                }
                // Web 会遍历全部在建奇迹（不限于 pending 列表）
                for (int i = 0; i < stats.WonderList.Count; i++)
                {
                    WonderEntry w = stats.WonderList[i];
                    if (w.Done) continue;
                    double np = w.Progress + MiracleTable.BuildInstantWonderProgress;
                    w.Progress = (float)(np > 1 ? 1 : np);
                    result.WondersBumped++;
                }
            }

            Cast?.Invoke(result);
            return result;
        }

        /// <summary>
        /// 增益计时递减。**由 tick 调用**（对应 Web tick 开头的三个 `Math.max(0, x - dt)`）。
        /// 返回值 = 本次递减后仍生效的增益数（便于测试断言）。
        /// </summary>
        public static int TickBoosts(WorldState G, double dt)
        {
            if (G == null || dt <= 0) return 0;
            WorldStats s = G.Stats;
            if (s.BoostGrow > 0) s.BoostGrow = Math.Max(0, s.BoostGrow - dt);
            if (s.BoostBuild > 0) s.BoostBuild = Math.Max(0, s.BoostBuild - dt);
            if (s.BoostRain > 0) s.BoostRain = Math.Max(0, s.BoostRain - dt);

            int alive = 0;
            if (s.BoostGrow > 0) alive++;
            if (s.BoostBuild > 0) alive++;
            if (s.BoostRain > 0) alive++;
            return alive;
        }

        /// <summary>读取某增益的剩余时长（唯一权威来源：WorldStats 的三个 boost 字段）。</summary>
        public static double RemainingOf(WorldStats stats, MiracleKind kind)
        {
            switch (kind)
            {
                case MiracleKind.Grow: return stats.BoostGrow;
                case MiracleKind.Build: return stats.BoostBuild;
                case MiracleKind.Rain: return stats.BoostRain;
            }
            return 0;
        }

        /// <summary>设置某增益的剩余时长。</summary>
        public static void SetRemaining(WorldStats stats, MiracleKind kind, double seconds)
        {
            double v = seconds < 0 ? 0 : seconds;
            switch (kind)
            {
                case MiracleKind.Grow: stats.BoostGrow = v; break;
                case MiracleKind.Build: stats.BoostBuild = v; break;
                case MiracleKind.Rain: stats.BoostRain = v; break;
            }
        }

        /// <summary>该增益是否正在生效。</summary>
        public static bool IsActive(WorldState G, MiracleKind kind)
            => G != null && RemainingOf(G.Stats, kind) > 0;
    }
}
