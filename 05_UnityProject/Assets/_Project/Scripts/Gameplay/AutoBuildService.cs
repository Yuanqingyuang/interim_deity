// 《实习神明》Gameplay 层 · 自动建造执行（选址 + 六步优先级驱动）
//
// 分工（避免复制第二份规则）：
//   · **策略**（该不该建、优先级顺序）→ 已在 Deity.Simulation 的 `AutoBuildPolicy.Decide`，
//     本文件**只调用**，不重新实现。
//   · **执行**（往哪里放）→ 本文件：移植 Web `terrain.js` 的 `findAutoSite` /
//     `placeDistrict` / `placeIndustryBatch`，以及 `autobuild.js` 的六步顺序。
//
// Web findAutoSite 的关键行为（逐条保留，注释里的两个历史修复不能丢）：
//   · 以**居住质心**为采样中心；候选点须在 chunkBounds 内
//   · 种子 PRNG（autoRng，禁用全局随机）采样 **96** 次；半径分档外扩：
//       i < 48 → R0；i < 72 → R0*1.7；否则 R0*2.6      （R0 = 工业 18，其余 14）
//     —— 写死半径会在中心区饱和后永远找不到点位
//   · 硬门槛：非水、未占用、无树、1.0 ≤ h ≤ 5.2、CanPlaceZoneAt 通过
//   · 地形平整度门槛：|t.h − 3×3 均值| > 0.85 → 丢弃
//   · 打分（注意各分区都有"硬约束导致某一项恒为 0"的历史修复）：
//       基础      score = 1.2 + adj*2 − dist*0.28 − flat*2.0
//       住房(1)   住房受「不得与已划区相邻」，adj 恒 0 → 改用 2 格环居住密度：
//                 score += countResNear(2)*1.2 + hash2(x,y,seed+4)*0.3；dist>16 再 −1.5
//       农田(2)   农田受「不得与非农田相邻」，adjRes 恒 0 → 改用 2 格环居住密度：
//                 score += nearRes*2.5；nearRes<1 再 −2；+ adjRes*5 + adjWater*1.5
//                 + hash2(x,y,seed+2)*0.3
//       工业(3)   切比雪夫距离 dRes < LAYOUT.R_ind(6) → 直接丢弃；
//                 score += dRes*0.5 + hash2(x,y,seed+7)*0.4
//       信仰(4)   nearRes<2 → −8；score += nearRes*1.8 + (h−2.2)*0.4 − dist*0.1
//   · **不按 score 阈值过滤**：几何合法性已是硬门槛，score 只用于"合法点位中挑最优"。
//     早期按 score>0.2 过滤会让远处但完全合法的点位被静默丢弃，
//     表现为"自动建造无日志、无原因地停止"。
using System;
using System.Collections.Generic;
using InterimDeity.Core;
using InterimDeity.Simulation;
using InterimDeity.World;

namespace InterimDeity.Gameplay
{
    /// <summary>一处自动选址结果。</summary>
    public struct AutoSite
    {
        public bool Found;
        public int X;
        public int Y;
        public double Score;
    }

    /// <summary>自动建造的选址与执行。</summary>
    public static class AutoBuildService
    {
        /// <summary>采样次数（Web: `const tries = 96`）。</summary>
        public const int FindTries = 96;

        /// <summary>候选点的可建高度区间（Web 比通用规则更严：1.0 ~ 5.2）。</summary>
        public const double SiteMinH = 1.0;
        public const double SiteMaxH = 5.2;

        /// <summary>平整度门槛：与 3×3 均值的偏差超过此值即丢弃。</summary>
        public const double SiteFlatMax = 0.85;

        /// <summary>工业选址的最小切比雪夫距离（= TerrainGenerator.LayoutRInd）。</summary>
        public const int LayoutRInd = TerrainGenerator.LayoutRInd;

        // ─────────────────────────────────────────────────────────────
        // 统计辅助（对应 Web 的 residentialStats / countResNear / countAdjRes）
        // ─────────────────────────────────────────────────────────────

        /// <summary>居住格质心与数量（Web `residentialStats`）。无居住格时返回 n=0。</summary>
        public struct ResidentialStats
        {
            public long N;
            public double Cx;
            public double Cy;
        }

        public static ResidentialStats ResidentialStatsOf(WorldState G)
        {
            var r = new ResidentialStats();
            long sx = 0, sy = 0, n = 0;
            StateQueries.EachTile(G, (t, x, y) =>
            {
                if (t.Zone == 1) { sx += x; sy += y; n++; }
            });
            r.N = n;
            if (n > 0) { r.Cx = (double)sx / n; r.Cy = (double)sy / n; }
            return r;
        }

        /// <summary>指定半径切比雪夫方框内的居住格数（Web `countResNear(G,x,y,r)`，默认 r=2）。</summary>
        public static int CountResNear(WorldState G, int x, int y, int r = 2)
        {
            int n = 0;
            for (int dy = -r; dy <= r; dy++)
            {
                for (int dx = -r; dx <= r; dx++)
                {
                    TileData a = StateQueries.GetTile(G, x + dx, y + dy);
                    if (a != null && a.Zone == 1) n++;
                }
            }
            return n;
        }

        /// <summary>8 邻域内的居住格数（Web `countAdjRes`）。</summary>
        public static int CountAdjRes(WorldState G, int x, int y)
        {
            int n = 0;
            for (int dy = -1; dy <= 1; dy++)
            {
                for (int dx = -1; dx <= 1; dx++)
                {
                    if (dx == 0 && dy == 0) continue;
                    TileData a = StateQueries.GetTile(G, x + dx, y + dy);
                    if (a != null && a.Zone == 1) n++;
                }
            }
            return n;
        }

        /// <summary>全部已生成区块的外接包围盒（Web `chunkBounds`）。</summary>
        public struct Bounds
        {
            public int MinX, MinY, MaxX, MaxY;
        }

        public static Bounds ChunkBounds(WorldState G)
        {
            var b = new Bounds { MinX = int.MaxValue, MinY = int.MaxValue, MaxX = int.MinValue, MaxY = int.MinValue };
            foreach (var kv in G.Chunks)
            {
                ChunkData ch = kv.Value;
                int x0 = ch.Coord.X * ChunkData.Size;
                int y0 = ch.Coord.Y * ChunkData.Size;
                int x1 = x0 + ChunkData.Size - 1;
                int y1 = y0 + ChunkData.Size - 1;
                if (x0 < b.MinX) b.MinX = x0;
                if (y0 < b.MinY) b.MinY = y0;
                if (x1 > b.MaxX) b.MaxX = x1;
                if (y1 > b.MaxY) b.MaxY = y1;
            }
            if (b.MinX > b.MaxX) { b.MinX = b.MinY = -1; b.MaxX = b.MaxY = 1; }
            return b;
        }

        // ─────────────────────────────────────────────────────────────
        // 选址（Web findAutoSite）
        // ─────────────────────────────────────────────────────────────

        /// <summary>
        /// 为指定分区寻找一个自动建造点位。找不到返回 <c>Found = false</c>。
        /// </summary>
        public static AutoSite FindAutoSite(WorldState G, int zoneType, long tickForRng = 0)
        {
            var result = new AutoSite { Found = false, Score = double.NegativeInfinity };
            if (G == null || zoneType < 1 || zoneType > 4) return result;

            int seed = G.Seed;
            ResidentialStats res = ResidentialStatsOf(G);
            double sx = res.Cx, sy = res.Cy;
            Bounds b = ChunkBounds(G);

            Mulberry32 rnd = Mulberry32.AutoRng(seed, tickForRng, zoneType);
            double R0 = zoneType == 3 ? 18.0 : 14.0;

            for (int i = 0; i < FindTries; i++)
            {
                // 近处排满时逐圈外扩
                double R = i < FindTries * 0.5 ? R0
                         : i < FindTries * 0.75 ? R0 * 1.7
                         : R0 * 2.6;
                int x = MathUtil.RoundJs(sx + (rnd.Next() * 2 - 1) * R);
                int y = MathUtil.RoundJs(sy + (rnd.Next() * 2 - 1) * R);
                if (x < b.MinX || x > b.MaxX || y < b.MinY || y > b.MaxY) continue;

                TileData t = StateQueries.GetTile(G, x, y);
                if (t == null || t.IsWater || t.Zone > 0 || t.IsVegetated) continue;
                if (t.Height < SiteMinH || t.Height > SiteMaxH) continue;
                if (!TerrainGenerator.CanPlaceZoneAt(G, x, y, zoneType)) continue;

                // 3×3 邻域统计：已划区数、水格数、平均高度
                int adj = 0, adjWater = 0, n = 0;
                double sumH = 0;
                for (int dy = -1; dy <= 1; dy++)
                {
                    for (int dx = -1; dx <= 1; dx++)
                    {
                        TileData a = StateQueries.GetTile(G, x + dx, y + dy);
                        if (a == null) continue;
                        if (a.Zone > 0) adj++;
                        if (a.IsWater) adjWater++;
                        sumH += a.Height;
                        n++;
                    }
                }
                double flat = n > 0 ? Math.Abs(t.Height - sumH / n) : 0;
                if (flat > SiteFlatMax) continue;

                double dist = Math.Sqrt((x - sx) * (x - sx) + (y - sy) * (y - sy));
                double score = 1.2 + adj * 2 - dist * 0.28 - flat * 2.0;

                if (zoneType == 1)
                {
                    // 住房受「不得与任何已划区相邻」硬约束 → adj 恒 0，
                    // 改用 2 格环居住密度计分（否则只有质心约 4 格内才可能过阈值，那里早被占满）
                    score += CountResNear(G, x, y, 2) * 1.2;
                    score += DeterministicNoise.Hash2(x, y, seed + 4) * 0.3;
                    if (dist > 16) score -= 1.5;
                }
                else if (zoneType == 2)
                {
                    // 农田受「不得与非农田相邻」硬约束 → adjRes 恒 0；
                    // 早期唯一正项 adjRes*5 失效导致 findAutoSite(2) 永久 null
                    // → 食物刚好够吃 → 住房被 foodOk 锁死 → 人口/时代永久停滞
                    int nearRes = CountResNear(G, x, y, 2);
                    int adjRes = CountAdjRes(G, x, y);
                    score += nearRes * 2.5;
                    if (nearRes < 1) score -= 2;
                    score += adjRes * 5;
                    score += adjWater * 1.5 + DeterministicNoise.Hash2(x, y, seed + 2) * 0.3;
                }
                else if (zoneType == 3)
                {
                    double dRes = Math.Max(Math.Abs(x - sx), Math.Abs(y - sy));
                    if (dRes < LayoutRInd) continue;
                    score += dRes * 0.5;
                    score += DeterministicNoise.Hash2(x, y, seed + 7) * 0.4;
                }
                else if (zoneType == 4)
                {
                    int nearRes = CountResNear(G, x, y, 2);
                    if (nearRes < 2) score -= 8;
                    score += nearRes * 1.8;
                    score += (t.Height - 2.2) * 0.4 - dist * 0.1;
                }

                if (score > result.Score)
                {
                    result.Score = score;
                    result.X = x;
                    result.Y = y;
                    result.Found = true;
                }
            }
            // 不按 score 阈值过滤：几何合法性已是硬门槛
            return result;
        }

        /// <summary>单格放置（Web `placeDistrict`，走 auto 校验）。返回 1 成功 / 0 失败。</summary>
        public static int PlaceDistrict(WorldState G, int x, int y, int zoneType)
        {
            PlaceResult r = TerrainGenerator.PlaceAt(G, x, y, zoneType, manual: false);
            return r.Ok ? 1 : 0;
        }

        // ─────────────────────────────────────────────────────────────
        // 工业批量放置（Web placeIndustryBatch）
        // ─────────────────────────────────────────────────────────────

        /// <summary>
        /// 工业专用批量放置：以居住质心为中心做局部环带搜索，一次最多放 2 格（配对）。
        /// 返回实际放置格数与锚点坐标（**禁止写 (0,0)**，Web 曾因此留下错误日志）。
        /// </summary>
        public static int PlaceIndustryBatch(WorldState G, out int outX, out int outY, int maxTiles = 2)
        {
            outX = 0; outY = 0;
            if (G == null) return 0;
            if (maxTiles < 1) maxTiles = 1;
            if (maxTiles > 2) maxTiles = 2;

            ResidentialStats res = ResidentialStatsOf(G);
            if (res.N == 0) return 0;                       // placeIndustryBatch 亦要求 resList 非空

            // 收集工业与其他已划区（用于最小距离约束的快速判定）
            var indList = new List<TileCoord>();
            var otherList = new List<TileCoord>();
            StateQueries.EachTile(G, (t, x, y) =>
            {
                if (t.Zone <= 0) return;
                if (t.Zone == 3) indList.Add(new TileCoord(x, y));
                else otherList.Add(new TileCoord(x, y));
            });

            int sx = MathUtil.RoundJs(res.Cx);
            int sy = MathUtil.RoundJs(res.Cy);
            double Rmin = LayoutRInd;                        // LAYOUT.R_ind
            double Rmax = Rmin + 8;                          // Rmin + LAYOUT.D_max

            Mulberry32 rnd = Mulberry32.AutoRng(G.Seed, 0, 3);
            int[] shapesDx = maxTiles >= 2 ? new[] { 1, 0 } : new[] { 0 };
            int[] shapesDy = maxTiles >= 2 ? new[] { 0, 1 } : new[] { 0 };

            int bestX = 0, bestY = 0, bestDx = 0, bestDy = 0;
            double bestScore = double.NegativeInfinity;
            bool found = false;

            // 环带搜索：半径不写死（写死会在中心环带饱和后永远找不到点位）
            const int Tries = 192;
            for (int i = 0; i < Tries; i++)
            {
                double band = Rmin + (Rmax - Rmin) * ((i % 32) / 31.0);
                double ang = rnd.Next() * Math.PI * 2;
                int x = MathUtil.RoundJs(sx + Math.Cos(ang) * band);
                int y = MathUtil.RoundJs(sy + Math.Sin(ang) * band);

                TileData t = StateQueries.GetTile(G, x, y);
                if (t == null || t.IsWater || t.Zone > 0 || t.IsVegetated) continue;
                if (t.Height < SiteMinH || t.Height > SiteMaxH) continue;
                if (!TerrainGenerator.CanPlaceZoneAt(G, x, y, 3)) continue;

                double dRes = Math.Max(Math.Abs(x - sx), Math.Abs(y - sy));
                if (dRes < LayoutRInd) continue;

                // 邻域工业聚集度（配对放置的风味）
                int adjInd = 0;
                for (int dy = -1; dy <= 1; dy++)
                {
                    for (int dx = -1; dx <= 1; dx++)
                    {
                        if (dx == 0 && dy == 0) continue;
                        TileData a = StateQueries.GetTile(G, x + dx, y + dy);
                        if (a != null && a.Zone == 3) adjInd++;
                    }
                }
                // 打分：贴近环带内缘 + 已有工业聚集 + 确定性扰动
                double score = -(band - Rmin) * 0.4 + adjInd * 1.6
                               + DeterministicNoise.Hash2(x, y, G.Seed + 7) * 0.4;

                if (score > bestScore)
                {
                    bestScore = score;
                    bestX = x; bestY = y;
                    // 配对方向优先取能合法落位的那个
                    for (int s = 0; s < shapesDx.Length; s++)
                    {
                        int nx = x + shapesDx[s], ny = y + shapesDy[s];
                        TileData a = StateQueries.GetTile(G, nx, ny);
                        if (a != null && !a.IsWater && a.Zone == 0 && !a.IsVegetated
                            && a.Height >= SiteMinH && a.Height <= SiteMaxH)
                        {
                            bestDx = shapesDx[s]; bestDy = shapesDy[s];
                            break;
                        }
                    }
                    found = true;
                }
            }
            if (!found) return 0;

            int placed = 0;
            if (TerrainGenerator.PlaceAt(G, bestX, bestY, 3, manual: false).Ok) placed++;
            if (maxTiles >= 2 && (bestDx != 0 || bestDy != 0))
            {
                if (TerrainGenerator.PlaceAt(G, bestX + bestDx, bestY + bestDy, 3, manual: false).Ok) placed++;
            }
            if (placed < maxTiles)
            {
                // 落位兜底：尝试 8 个偏移方向补足
                int[] ox = { 2, -2, 0, 0, 1, -1, 1, -1 };
                int[] oy = { 0, 0, 2, -2, 1, -1, -1, 1 };
                for (int k = 0; k < ox.Length && placed < maxTiles; k++)
                {
                    if (TerrainGenerator.PlaceAt(G, bestX + ox[k], bestY + oy[k], 3, manual: false).Ok) placed++;
                }
            }

            if (placed > 0)
            {
                G.TerrainDirty = true;
                TerrainGenerator.EnsureChunkRing(G, bestX, bestY);
            }
            // 返回真实坐标，供日志使用（禁止写 (0,0)）
            outX = bestX; outY = bestY;
            return placed;
        }

        // ─────────────────────────────────────────────────────────────
        // 六步优先级驱动（组合 AutoBuildPolicy.Decide 与上面的执行）
        // ─────────────────────────────────────────────────────────────

        /// <summary>一次自动建造的执行结果。</summary>
        public sealed class AutoBuildRun
        {
            /// <summary>本轮实际放置的地块数。</summary>
            public int Placed;
            /// <summary>本轮按顺序尝试过的动作（'house'/'farm'/'industry'/'church'）。</summary>
            public List<string> Attempted = new List<string>();
            /// <summary>本轮建成的首个点位（用于表现层粒子/日志）；无则 null。</summary>
            public TileCoord? FirstSite;
            /// <summary>本轮建成的分区（配合 FirstSite）。</summary>
            public int FirstZone;
            /// <summary>策略给出的顺序（便于测试断言优先级）。</summary>
            public List<string> Order = new List<string>();
        }

        /// <summary>
        /// 执行一轮自动建造。等价于 Web `autoBuild()` 的决策 + 放置部分。
        /// </summary>
        /// <param name="G">世界状态。</param>
        /// <param name="tickForRng">确定性随机的 tick（传 <see cref="GameClock.RngTick"/>）。</param>
        public static AutoBuildRun RunOnce(WorldState G, long tickForRng = 0)
        {
            var run = new AutoBuildRun();
            if (G == null) return run;

            int e = EconomyRules.EraIndex(G.CurrentEra);
            StateQueries.RefreshBuiltCache(G);

            // 地块口径计数（need[] 与放置目标都用这一组）
            var cnt = new double[5];
            for (int z = 1; z <= 4; z++) cnt[z] = G.ZoneCache[z];
            var built = new double[5];
            for (int z = 1; z <= 4; z++) built[z] = G.BuiltCache[z];

            double qB = EconomyRules.BuildQ(e);
            double housingCap = EconomyRules.HousingCap(built[1], e, G.Stats.Wonders);

            AutoBuildDecision dec = AutoBuildPolicy.Decide(
                e, cnt, built, G.Stats.Population, housingCap, G.Stats.FaithRate,
                EraConstants.AutoHousingPressure, EraConstants.AutoFaithPressure);

            run.Order = dec.List;

            // 执行：按顺序尝试，受 maxPerTick 限制
            StateQueries.RefreshBuiltCache(G);
            for (int i = 0; i < dec.List.Count && run.Placed < EraConstants.AutoMaxPerTick; i++)
            {
                string act = dec.List[i];
                run.Attempted.Add(act);
                bool ok = false;
                int zone = 0;

                if (act == "industry")
                {
                    // 工业只走专用批量路径；无居住时不狂刷（Web: if(G.pop < 15) return false）
                    if (G.Stats.Population >= 15)
                    {
                        int n = PlaceIndustryBatch(G, out int ix, out int iy, EraConstants.AutoIndustryPerTick);
                        if (n > 0)
                        {
                            ok = true; zone = 3;
                            if (run.FirstSite == null) run.FirstSite = new TileCoord(ix, iy);
                            run.Placed += 1;                 // 一轮算作一次放置（Web placed++）
                            cnt[3] += n;
                        }
                    }
                }
                else
                {
                    zone = act == "house" ? 1 : act == "farm" ? 2 : 4;
                    AutoSite site = FindAutoSite(G, zone, tickForRng);
                    if (site.Found)
                    {
                        int n = PlaceDistrict(G, site.X, site.Y, zone);
                        if (n > 0)
                        {
                            ok = true;
                            if (run.FirstSite == null) run.FirstSite = new TileCoord(site.X, site.Y);
                            run.Placed += n;
                            cnt[zone] += n;
                        }
                    }
                }

                if (ok && run.FirstZone == 0) run.FirstZone = zone;
                StateQueries.RefreshBuiltCache(G);
            }

            // 兜底：本轮什么都没建成且住房仍缺 → 放宽资源门槛再补一次房
            if (run.Placed == 0 && dec.FallbackHouse && run.Attempted.Count < 1)
            {
                AutoSite site = FindAutoSite(G, 1, tickForRng);
                if (site.Found && PlaceDistrict(G, site.X, site.Y, 1) > 0)
                {
                    run.Placed = 1;
                    run.FirstZone = 1;
                    run.FirstSite = new TileCoord(site.X, site.Y);
                }
            }

            if (run.Placed > 0) StateQueries.RefreshBuiltCache(G);
            return run;
        }
    }
}
