// 《实习神明》Gameplay 层 · 经济 tick 编排
//
// 严格按 Web 版 `main.js` 的 `tick(dt)` 顺序移植。**顺序本身是规则的一部分**：
// 例如产出口径必须用「奇迹完工后刷新过的」缓存，否则奇迹的信仰加成会晚一帧生效。
//
// Web tick 的原始顺序（已逐行核对 01_WebDemo/js/main.js）：
//   1. 三个 boost 计时器递减（boostGrow / boostBuild / boostRain）
//   2. ensureBuiltCache()（刷新 zc/bc）
//   3. autoAcc += dt；到 AUTO.interval 触发 autoBuild()
//   4. 计算 pending / pendingW / wonderDraw → buildSpeed（boostBuild 时 ×3）
//   5. 推进待建建筑 prog；完工则 built=true、InvalidateBuiltCache、EnsureChunkRing、
//      ClearTreesNearZones
//   6. 若有建筑完工 → refreshBuiltCache()
//   7. 推进奇迹 prog（速率 = dt / WONDERS[era].time，boostBuild 时 ×2）
//   8. **用刷新后的缓存**重算 churchesL 等 → faithRate = faithPerSec × faithMult × nightBonus
//      faith += faithRate*dt；totalFaith 同增；faith 钳制到 [0, faithCapOf(era)]
//   9. power = min(powerMaxOf(era), power + regen*dt)，regen = powerRegenOf(faithRate)
//  10. cap = popCap(逻辑口径)；nextPop = growPop(...)；boostGrow 时加速；
//      **pop = max(1, nextPop)**  ← 人口下限在此，不在 growPop 内
//  11. checkStarMilestones(E, farms, inds, churches, houses)  ← 用**地块口径**
//
// 说明：本服务只做**数值推进**。自动建造（步骤 3）通过注入的委托调用，
// 从而让 `AutoBuildService` 与 `EconomyTickService` 各自独立、可分别测试。
using System;
using InterimDeity.Core;
using InterimDeity.Simulation;
using InterimDeity.World;

namespace InterimDeity.Gameplay
{
    /// <summary>一次 tick 的观测结果（供 UI/测试断言，不参与状态演进）。</summary>
    public sealed class TickReport
    {
        public double Dt;
        public int Era;
        /// <summary>本 tick 建成的建筑地块数。</summary>
        public int BuildingsCompleted;
        /// <summary>本 tick 建成的奇迹数。</summary>
        public int WondersCompleted;
        /// <summary>信仰产出/秒（本 tick 计算值）。</summary>
        public double FaithRate;
        /// <summary>本 tick 获得的信仰。</summary>
        public double FaithGain;
        /// <summary>本 tick 恢复的神力。</summary>
        public double PowerRegen;
        /// <summary>建造速度（进度/秒）。</summary>
        public double BuildSpeed;
        /// <summary>人口上限（逻辑口径）。</summary>
        public double PopCap;
        /// <summary>人口变化量。</summary>
        public double PopDelta;
        /// <summary>信仰是否被库存上限截断。</summary>
        public bool FaithCapped;
        /// <summary>是否触发了自动建造。</summary>
        public bool AutoBuildRan;
        /// <summary>本 tick 新达成的里程碑标签。</summary>
        public System.Collections.Generic.List<string> NewMilestones = new System.Collections.Generic.List<string>();
    }

    /// <summary>经济 tick 的权威实现。</summary>
    public static class EconomyTickService
    {
        /// <summary>
        /// 推进一个固定步长。
        /// </summary>
        /// <param name="G">世界状态。</param>
        /// <param name="dt">固定步长（秒）——应来自 <see cref="GameClock.FixedDt"/>。</param>
        /// <param name="autoAccumulator">
        /// 自动建造累加器（秒），以 ref 传入并由本方法推进；
        /// 达 <see cref="EraConstants.AutoInterval"/> 时调用 <paramref name="autoBuild"/>。
        /// </param>
        /// <param name="autoBuild">
        /// 自动建造委托；可传 null（此时跳过步骤 3，便于单独测试经济）。
        /// </param>
        /// <param name="pending">待建列表（地块坐标）；为 null 时本 tick 按空列表处理。</param>
        public static TickReport Tick(
            WorldState G,
            double dt,
            ref double autoAccumulator,
            Action autoBuild = null,
            System.Collections.Generic.List<TileCoord> pending = null)
        {
            var rep = new TickReport { Dt = dt };
            if (G == null || dt <= 0) return rep;

            var stats = G.Stats;
            int e = EconomyRules.EraIndex(G.CurrentEra);
            rep.Era = e;

            // ── 1. boost 计时器递减 ──
            if (stats.BoostGrow > 0) stats.BoostGrow = Math.Max(0, stats.BoostGrow - dt);
            if (stats.BoostBuild > 0) stats.BoostBuild = Math.Max(0, stats.BoostBuild - dt);
            if (stats.BoostRain > 0) stats.BoostRain = Math.Max(0, stats.BoostRain - dt);

            // ── 2. 刷新统计缓存 ──
            // RefreshBuiltCache 会同时刷新 BuiltCache 与 ZoneCache，并置两个 valid 标志（已核对实现）
            StateQueries.RefreshBuiltCache(G);

            // 地块口径（放置目标 / 里程碑阈值）
            double houses = G.BuiltCache[1], farms = G.BuiltCache[2];
            double inds = G.BuiltCache[3], churches = G.BuiltCache[4];
            // 逻辑口径（产出、人口上限、奇迹占用）—— 1 地块 = buildQ(E) 栋
            double qB = EconomyRules.BuildQ(e);
            double housesL = houses * qB, farmsL = farms * qB;
            double indsL = inds * qB, churchesL = churches * qB;

            // ── 3. 自动建造 ──
            autoAccumulator += dt;
            if (autoBuild != null && autoAccumulator >= EraConstants.AutoInterval)
            {
                autoAccumulator = 0;
                autoBuild();
                rep.AutoBuildRan = true;
                // 自动建造可能新增划定 → 重新取缓存，后续步骤 4/5 才会看到新划定
                StateQueries.RefreshBuiltCache(G);
                houses = G.BuiltCache[1]; farms = G.BuiltCache[2];
                inds = G.BuiltCache[3]; churches = G.BuiltCache[4];
                housesL = houses * qB; farmsL = farms * qB;
                indsL = inds * qB; churchesL = churches * qB;
            }

            // ── 4. 建造速度 ──
            double pendingW = 0;
            for (int z = 1; z <= 4; z++)
            {
                double zc = G.ZoneCache[z], bc = G.BuiltCache[z];
                double gap = zc - bc;
                if (gap > 0) pendingW += gap * EconomyRules.BUILD_COST[z];
            }
            bool wonderActive = false;
            for (int i = 0; i < stats.WonderList.Count; i++)
            {
                if (!stats.WonderList[i].Done) { wonderActive = true; break; }
            }
            double wonderDraw = wonderActive ? EconomyRules.WonderDrawPerSec(e) : 0;
            // industries 传**逻辑数**（Web 审计修复点：曾误传地块数，E5 内部供给只有 HUD 的 1/20）
            double vBuild = EconomyRules.BuildSpeed(e, indsL, pendingW, wonderDraw);
            if (stats.BoostBuild > 0) vBuild *= 3;
            rep.BuildSpeed = vBuild;

            // ── 5. 推进待建建筑 ──
            bool buildChanged = false;
            if (pending != null && vBuild > 0)
            {
                for (int i = pending.Count - 1; i >= 0; i--)
                {
                    TileCoord c = pending[i];
                    TileData t = StateQueries.GetTile(G, c.X, c.Y);
                    if (t == null || t.Zone <= 0 || t.IsBuilt) { pending.RemoveAt(i); continue; }

                    t.BuildProgress = (float)(t.BuildProgress + vBuild * dt);
                    if (t.BuildProgress >= 1f)
                    {
                        t.BuildProgress = 1f;
                        t.IsBuilt = true;
                        buildChanged = true;
                        rep.BuildingsCompleted++;
                        TerrainGenerator.EnsureChunkRing(G, c.X, c.Y);
                        TerrainGenerator.ClearTreesNearZones(G, 1, c.X, c.Y, 2);
                        StateQueries.InvalidateBuiltCache(G);
                        pending.RemoveAt(i);
                    }
                }
            }

            // ── 6. 有建筑完工 → 刷新缓存（产出口径随之变大）──
            if (buildChanged)
            {
                StateQueries.RefreshBuiltCache(G);
                houses = G.BuiltCache[1]; farms = G.BuiltCache[2];
                inds = G.BuiltCache[3]; churches = G.BuiltCache[4];
                housesL = houses * qB; farmsL = farms * qB;
                indsL = inds * qB; churchesL = churches * qB;
            }

            // ── 7. 推进奇迹 ──
            for (int i = 0; i < stats.WonderList.Count; i++)
            {
                WonderEntry w = stats.WonderList[i];
                if (w.Done) continue;
                int we = EconomyRules.EraIndex(w.Era);
                double rate = dt / EraConstants.WonderTime[we];
                if (stats.BoostBuild > 0) rate *= 2;
                w.Progress = (float)(w.Progress + rate);
                if (w.Progress >= 1f)
                {
                    w.Progress = 1f;
                    w.Done = true;
                    stats.Wonders[we] = true;
                    rep.WondersCompleted++;
                }
            }

            // ── 8. 信仰 ──
            // 夜间加成：Web `(G.dayTime < 0.22 || G.dayTime > 0.78) ? 1.15 : 1.0`
            double nightBonus = (stats.DayTime < 0.22 || stats.DayTime > 0.78) ? 1.15 : 1.0;
            double faithRate = EconomyRules.FaithPerSec(churchesL, stats.Population, e)
                               * EconomyRules.FaithMult(stats.Wonders) * nightBonus;
            stats.FaithRate = faithRate;
            double faithGain = faithRate * dt;
            stats.Faith += faithGain;
            stats.TotalFaith += faithGain;
            if (stats.Faith < 0) stats.Faith = 0;
            double faithCap = EraConstants.FaithCapOf(e);
            if (stats.Faith > faithCap) { stats.Faith = faithCap; rep.FaithCapped = true; }
            rep.FaithRate = faithRate;
            rep.FaithGain = faithGain;

            // ── 9. 神力恢复 ──
            double regen = EraConstants.PowerRegenOf(faithRate);
            stats.Power = Math.Min(EraConstants.PowerMaxOf(e), stats.Power + regen * dt);
            rep.PowerRegen = regen * dt;

            // ── 10. 人口 ──
            // popCap 的三项输入都是**逻辑建筑数**；奇迹人口乘区作用于实际增长上限
            // （Web 2026-10 修复的回归：不能只进 autoBuild 的压力判断）
            double cap = EconomyRules.PopCap(e, housesL, farmsL, indsL, stats.Wonders);
            rep.PopCap = cap;
            double before = stats.Population;
            double nextPop = EconomyRules.GrowPop(stats.Population, cap, e, farmsL, dt);
            if (stats.BoostGrow > 0)
                nextPop = Math.Min(cap, stats.Population + (nextPop - stats.Population) * 2 + 0.6 * dt);
            // **人口下限 1** —— 与 Web `G.pop = Math.max(1, nextPop)` 同式。
            // 注意：纯函数 GrowPop 的下限是 0，钳制必须在编排层做（见 19_核实更正_人口吸收态.md）。
            stats.Population = Math.Max(1, nextPop);
            rep.PopDelta = stats.Population - before;

            // ── 11. 里程碑（**地块口径**，与 config.js 的阈值注释一致）──
            var newly = ProgressionRules.ClaimMilestones(G, farms, inds, churches, houses);
            for (int i = 0; i < newly.Count; i++) rep.NewMilestones.Add(newly[i].Label);

            stats.Time += dt;
            return rep;
        }
    }
}
