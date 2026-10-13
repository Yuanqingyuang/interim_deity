// 《实习神明》Gameplay 层 · 奇迹（Wonder）
//
// 移植 Web `main.js` 的三个函数：
//   ① `startWonderPlacement()` —— 进入放置模式前的校验（不改状态）
//   ② `placeWonder(x, y)`      —— 真正落地：校验地块 → 扣信仰 → 入列
//   ③ 完成判定（在 tick 内）    —— 由 <see cref="TryComplete"/> 统一负责
//
// Web 原始校验（逐条保留，顺序也是规则的一部分）：
//   startWonderPlacement:
//     if(G.wonderList.some(x=>!x.done)) → '已有奇迹在建'      // **全局**只能有一个在建
//     if(G.wonders[era])               → '本时代奇迹已建成'
//     if(G.faith < w.faithCost)        → '信仰不足'
//   placeWonder:
//     !t                              → '这里还不能放置奇迹'
//     t.water                         → '不能在水面放置奇迹'
//     t.zone > 0                      → '该地块已有分区'
//     t.h < 1.0 || t.h > 5.5          → '地形不适合放置奇迹'
//     G.faith < w.faithCost           → '信仰不足'（**落地时再查一次**，与进入放置模式时的检查独立）
//     然后：G.faith = max(0, faith - cost)；wonderList.push({era,x,y,prog:0,done:false})
//
// 必须对照既有数值规则，**不得在此重新定义**成本/时长：
//   信仰成本 → `EraConstants.FaithCostOf(era)`（= Web `faithCostOf`）
//   建造时长 → `EraConstants.WonderTime[era]`（= Web `WONDERS[].time`）
//   人口乘区 → `EconomyRules.WonderPopMult` / `FaithMult`（由经济层消费，本层不重复应用）
//
// ⚠️ 加倍风险点（重要）：奇迹的**进度推进**在 `EconomyTickService` 步骤 7 内
// （对应 Web tick 的另一段代码，不是 `placeWonder`）。
// 因此本服务**不做逐 tick 进度推进**，只提供 <see cref="TryComplete"/> 供 tick 在推进后调用 ——
// 避免同一个 tick 里推进两次、或结算两次加成。
using System;
using System.Collections.Generic;
using InterimDeity.Core;
using InterimDeity.Simulation;
using InterimDeity.World;

namespace InterimDeity.Gameplay
{
    /// <summary>奇迹操作的失败原因（与 Web toast 文案一致，便于 UI 直出）。</summary>
    public static class WonderReason
    {
        public const string AlreadyBuilding = "已有奇迹在建";
        public const string EraWonderBuilt = "本时代奇迹已建成";
        public const string NotEnoughFaith = "信仰不足";
        public const string TileUnavailable = "这里还不能放置奇迹";
        public const string TileIsWater = "不能在水面放置奇迹";
        public const string TileOccupied = "该地块已有分区";
        public const string TileBadHeight = "地形不适合放置奇迹";
        public const string Unknown = "未知错误";
    }

    /// <summary>奇迹操作结果。</summary>
    public sealed class WonderResult
    {
        public bool Ok;
        public string Reason;
        public int Era;
        public string Name;
        /// <summary>实际扣除的信仰（失败恒为 0）。</summary>
        public double FaithSpent;
        /// <summary>本次是否新完成了一个奇迹（<see cref="WonderService.TryComplete"/> 用）。</summary>
        public bool Completed;
        /// <summary>完成的是否为终局奇迹（E5 太空电梯）→ 触发通关。</summary>
        public bool FinalWin;
        public int X;
        public int Y;

        public static WonderResult Fail(string reason) => new WonderResult { Ok = false, Reason = reason };
    }

    /// <summary>奇迹的放置校验、落地与完成判定。</summary>
    public static class WonderService
    {
        /// <summary>奇迹放置的可建高度区间（Web: `t.h < 1.0 || t.h > 5.5`）。</summary>
        public const double MinPlaceHeight = 1.0;
        public const double MaxPlaceHeight = 5.5;

        /// <summary>奇迹落地成功时触发（表现层订阅：改地形脏标记、播粒子、刷新 UI）。</summary>
        public static event Action<WonderResult> Started;

        /// <summary>奇迹完成时触发。**同一奇迹只会触发一次**（由 Done 标志保证）。</summary>
        public static event Action<WonderResult> Completed;

        /// <summary>终局通关时触发（E5 太空电梯完成）。</summary>
        public static event Action FinalWin;

        // ─────────────────────────────────────────────────────────────
        // 查询
        // ─────────────────────────────────────────────────────────────

        /// <summary>本时代奇迹的配置（成本/时长/名称）。</summary>
        public static double FaithCostOf(int era) => EraConstants.FaithCostOf(EconomyRules.EraIndex(era));
        public static double BuildTimeOf(int era) => EraConstants.WonderTime[EconomyRules.EraIndex(era)];
        public static string NameOf(int era) => EraConstants.WonderNames[EconomyRules.EraIndex(era)];

        /// <summary>是否已有奇迹在建（Web: `wonderList.some(x=>!x.done)`）—— 全局仅允许一个。</summary>
        public static bool HasActiveWonder(WorldState G)
        {
            if (G == null) return false;
            var list = G.Stats.WonderList;
            for (int i = 0; i < list.Count; i++)
                if (!list[i].Done) return true;
            return false;
        }

        /// <summary>本时代奇迹是否已建成（Web: `G.wonders[era]`）。</summary>
        public static bool EraWonderDone(WorldState G)
            => G != null && G.Stats.Wonders[EconomyRules.EraIndex(G.CurrentEra)];

        /// <summary>正在建造的那一个奇迹条目；没有则 null。</summary>
        public static WonderEntry ActiveWonder(WorldState G)
        {
            if (G == null) return null;
            var list = G.Stats.WonderList;
            for (int i = 0; i < list.Count; i++)
                if (!list[i].Done) return list[i];
            return null;
        }

        /// <summary>
        /// 是否可以开始放置（不改状态）。对应 Web `startWonderPlacement` 的三项校验。
        /// </summary>
        public static bool CanStartPlacement(WorldState G, out string reason)
        {
            reason = null;
            if (G == null) { reason = WonderReason.Unknown; return false; }
            if (HasActiveWonder(G)) { reason = WonderReason.AlreadyBuilding; return false; }
            if (EraWonderDone(G)) { reason = WonderReason.EraWonderBuilt; return false; }
            double cost = FaithCostOf(G.CurrentEra);
            if (G.Stats.Faith < cost)
            {
                reason = WonderReason.NotEnoughFaith;
                return false;
            }
            return true;
        }

        /// <summary>能否在该地块放置（仅地块校验，不含信仰）。对应 Web `placeWonder` 的前四项。</summary>
        public static bool CanPlaceAt(WorldState G, int x, int y, out string reason)
        {
            reason = null;
            if (G == null) { reason = WonderReason.Unknown; return false; }
            TileData t = StateQueries.GetTile(G, x, y);
            if (t == null) { reason = WonderReason.TileUnavailable; return false; }
            if (t.IsWater) { reason = WonderReason.TileIsWater; return false; }
            if (t.Zone > 0) { reason = WonderReason.TileOccupied; return false; }
            if (t.Height < MinPlaceHeight || t.Height > MaxPlaceHeight) { reason = WonderReason.TileBadHeight; return false; }
            return true;
        }

        // ─────────────────────────────────────────────────────────────
        // 落地（Web placeWonder）
        // ─────────────────────────────────────────────────────────────

        /// <summary>
        /// 在指定地块开始建造本时代奇迹。
        /// **校验全部通过后才扣信仰**，失败时状态一字不动。
        /// </summary>
        public static WonderResult Place(WorldState G, int x, int y)
        {
            if (G == null) return WonderResult.Fail(WonderReason.Unknown);

            // Web 的 placeWonder 会重复检查「已有在建 / 本时代已建成」，这里保持一致
            if (HasActiveWonder(G)) return WonderResult.Fail(WonderReason.AlreadyBuilding);
            if (EraWonderDone(G)) return WonderResult.Fail(WonderReason.EraWonderBuilt);

            if (!CanPlaceAt(G, x, y, out string tileReason))
                return WonderResult.Fail(tileReason);

            int era = EconomyRules.EraIndex(G.CurrentEra);
            double cost = FaithCostOf(era);
            // 落地时再查一次信仰（与进入放置模式时的检查独立，Web 亦如此）
            if (G.Stats.Faith < cost) return WonderResult.Fail(WonderReason.NotEnoughFaith);

            // ── 全部校验通过，开始写状态 ──
            // Web: `G.faith = Math.max(0, G.faith - w.faithCost)`
            G.Stats.Faith = Math.Max(0, G.Stats.Faith - cost);
            G.Stats.WonderList.Add(new WonderEntry
            {
                Era = era,
                X = x,
                Y = y,
                Progress = 0f,
                Done = false,
            });
            TerrainGenerator.EnsureChunkRing(G, x, y);
            G.TerrainDirty = true;

            var res = new WonderResult
            {
                Ok = true,
                Era = era,
                Name = NameOf(era),
                FaithSpent = cost,
                X = x,
                Y = y,
            };
            Started?.Invoke(res);
            return res;
        }

        // ─────────────────────────────────────────────────────────────
        // 完成判定（供 tick 在**推进进度之后**调用一次）
        // ─────────────────────────────────────────────────────────────

        /// <summary>
        /// 检查并结算已完工的奇迹。
        /// 幂等：完工的条目会被置 `Done=true` 且置位 `Wonders[era]`，重复调用不会再结算。
        /// </summary>
        /// <param name="G">世界状态。</param>
        /// <param name="outWinner">
        /// 本次调用**新判定**出的终局通关（E5 太空电梯），没有则为 false。
        /// 内部同时置 `Stats.GameOver`，与 Web `checkFinalWin` 一致（含 `if(G.over) return` 的幂等保护）。
        /// </param>
        /// <returns>本次新完成的奇迹数。</returns>
        public static int TryComplete(WorldState G, out bool outWinner)
        {
            outWinner = false;
            if (G == null) return 0;

            WorldStats stats = G.Stats;
            int completedCount = 0;

            var list = stats.WonderList;
            for (int i = 0; i < list.Count; i++)
            {
                WonderEntry w = list[i];
                if (w.Done) continue;                       // ← 幂等：已完成的跳过
                if (w.Progress < 1f) continue;

                w.Progress = 1f;
                w.Done = true;
                int e = EconomyRules.EraIndex(w.Era);
                // Wonders[era] 是"效果接入"的唯一开关；经济层读它给人口/信仰加成，
                // 因此**不得**在别处再发放一次加成。
                stats.Wonders[e] = true;
                completedCount++;

                var res = new WonderResult
                {
                    Ok = true,
                    Era = e,
                    Name = NameOf(e),
                    Completed = true,
                    X = w.X,
                    Y = w.Y,
                };
                Completed?.Invoke(res);
            }

            if (completedCount > 0)
            {
                // Web checkFinalWin: `if(G.over) return; if(G.era>=4 && G.wonders[4]) G.over = true;`
                if (!stats.GameOver && G.CurrentEra >= 4 && stats.Wonders[4])
                {
                    stats.GameOver = true;
                    outWinner = true;
                    FinalWin?.Invoke();
                }
            }
            return completedCount;
        }

        /// <summary>
        /// 推进在建奇迹的进度。**只应由 <see cref="EconomyTickService"/> 调用一次**。
        /// 单独抽出是为了让"同一 tick 不重复推进"这件事可被测试直接断言。
        /// </summary>
        public static int AdvanceActive(WorldState G, double dt)
        {
            if (G == null || dt <= 0) return 0;
            WorldStats stats = G.Stats;
            var list = stats.WonderList;
            int advanced = 0;
            for (int i = 0; i < list.Count; i++)
            {
                WonderEntry w = list[i];
                if (w.Done) continue;
                int e = EconomyRules.EraIndex(w.Era);
                double rate = dt / EraConstants.WonderTime[e];
                if (stats.BoostBuild > 0) rate *= 2;         // Web: `(G.boostBuild>0?2:1)`
                w.Progress = (float)(w.Progress + rate);
                advanced++;
            }
            return advanced;
        }
    }
}
