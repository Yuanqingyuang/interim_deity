// 《实习神明》Gameplay 层 · 行为验证（真实执行编译产物）
//
// 目的：证明 Gameplay 的实现**真的按 Web 规则工作**，而不是"能编译"。
// 断言直接对应 Web `terrain.js` / `main.js` / `config.js` / `progression.js` 的可观察行为。
//
// 分组：
//   A 组（回归，42 项）工具表 / 神力门槛 / 笔刷衰减 / 划区 / 拆除 / 引水 / 时钟 / 自动建造 / tick / 信仰上限
//   B 组（本批新增）Miracle / Wonder / Era Progression / Tick 集成
using System;
using System.Collections.Generic;
using InterimDeity.Core;
using InterimDeity.Gameplay;
using InterimDeity.Simulation;
using InterimDeity.World;

internal static class GameplayCheck
{
    private static int _pass, _fail;

    private static void Check(string name, bool ok, string detail = "")
    {
        if (ok) { _pass++; Console.WriteLine("  ok   " + name + (detail.Length > 0 ? "   [" + detail + "]" : "")); }
        else { _fail++; Console.WriteLine("  FAIL " + name + (detail.Length > 0 ? "   [" + detail + "]" : "")); }
    }

    private static void Section(string title) => Console.WriteLine("\n" + title);

    private static WorldState NewWorld(int seed)
    {
        WorldState G = StateQueries.CreateState(seed);
        TerrainGenerator.GenWorld(G);
        return G;
    }

    /// <summary>找一块可手动划区的平地。</summary>
    private static bool FindBuildableTile(WorldState G, out int cx, out int cy, int zone = 1, double lo = 1.0, double hi = 5.2)
    {
        for (int y = -40; y < 40; y++)
            for (int x = -40; x < 40; x++)
            {
                TileData t = StateQueries.GetTile(G, x, y);
                if (t == null || t.IsWater || t.Zone != 0) continue;
                if (t.Height < lo || t.Height > hi) continue;
                if (!TerrainGenerator.CanPlaceZoneManual(G, x, y, zone)) continue;
                cx = x; cy = y; return true;
            }
        cx = cy = 0; return false;
    }


    /// <summary>播种村庄并补一批**已建成**农田，使 popCap > 0（人口才有增长空间）。</summary>
    private static void SeedVillageWithFarms(WorldState G, int farms)
    {
        TerrainGenerator.SeedVillage(G);
        int made = 0;
        for (int y = -30; y < 30 && made < farms; y++)
            for (int x = -30; x < 30 && made < farms; x++)
            {
                TileData t = StateQueries.GetTile(G, x, y);
                if (t == null || t.IsWater || t.Zone != 0) continue;
                if (t.Height < 1.0 || t.Height > 5.2) continue;
                if (!TerrainGenerator.CanPlaceZoneAt(G, x, y, 2)) continue;
                if (TerrainGenerator.PlaceAt(G, x, y, 2, manual: false).Ok) made++;
            }
        StateQueries.EachTile(G, (t, x, y) => { if (t.Zone == 2) t.IsBuilt = true; });
        StateQueries.RefreshBuiltCache(G);
    }

    /// <summary>
    /// 满足 E1 产能门槛所需的工业地块数（由 GateOf 反推，留 20% 余量）。
    /// </summary>
    private static int IndustriesNeededForGate(int era)
    {
        double q = EconomyRules.BuildQ(era);
        double logical = EconomyRules.GateOf(era) / EconomyRules.K_IND;
        return (int)Math.Ceiling(logical / q * 1.2);
    }

    /// <summary>
    /// 放置并建成指定数量的工业地块。
    /// ⚠️ 必须用**真实地块**：`EraProgressionService.EvaluateReadiness` 内部会调用
    /// `RefreshBuiltCache()`，直接注入 BuiltCache 会被立刻重算清零（首次尝试即因此失败）。
    /// </summary>
    private static void PlaceAndBuildIndustries(WorldState G, int want)
    {
        int made = 0;
        for (int y = -30; y < 30 && made < want; y++)
            for (int x = -30; x < 30 && made < want; x++)
            {
                TileData t = StateQueries.GetTile(G, x, y);
                if (t == null || t.IsWater || t.Zone != 0 || t.IsVegetated) continue;
                if (t.Height < 1.0 || t.Height > 5.2) continue;
                if (!TerrainGenerator.CanPlaceZoneAt(G, x, y, 3)) continue;
                if (TerrainGenerator.PlaceAt(G, x, y, 3, manual: false).Ok) made++;
            }
        StateQueries.EachTile(G, (t, x, y) => { if (t.Zone == 3) t.IsBuilt = true; });
        StateQueries.RefreshBuiltCache(G);
    }

    /// <summary>给定时代与住房地块数时的 popul 上限（转调权威 EconomyRules.PopCap，不自己算）。</summary>
    private static double PopCapWithHouses(int era, double houseTiles)
    {
        double q = EconomyRules.BuildQ(era);
        bool[] noWonders = new bool[5];
        return EconomyRules.PopCap(era, houseTiles * q, 0, 0, noWonders);
    }

    private static int Main()
    {
        Console.WriteLine("=== Gameplay 层行为验证 ===");
        Regression();
        MiracleTests();
        WonderTests();
        EraProgressionTests();
        TickIntegrationTests();

        Console.WriteLine("\n=== 结果: pass=" + _pass + " fail=" + _fail + " ===");
        return _fail == 0 ? 0 : 1;
    }

    // ══════════════════════════════════════════════════════════════
    // A 组：既有回归（上一批已通过的检查，不得回归）
    // ══════════════════════════════════════════════════════════════
    private static void Regression()
    {
        Section("[A1] 工具表（回归）");
        Check("工具总数 = 10", ToolTable.Count == 10, "实际 " + ToolTable.Count);
        Check("raise 强度 0.9 / 半径 1.8", Math.Abs(ToolTable.Raise.Strength - 0.9) < 1e-9 && Math.Abs(ToolTable.Raise.Radius - 1.8) < 1e-9);
        Check("flatten 强度 1.1 / 半径 2.2", Math.Abs(ToolTable.Flatten.Strength - 1.1) < 1e-9 && Math.Abs(ToolTable.Flatten.Radius - 2.2) < 1e-9);
        Check("拆除 cost=1（最低）", Math.Abs(ToolTable.Demolish.Cost - 1) < 1e-9);
        Check("不存在的 key 返回 null", ToolTable.Get("nope") == null);

        Section("[A2] 神力门槛（回归）");
        {
            WorldState G = NewWorld(12345);
            G.Stats.Power = 0;
            Check("神力 0 时返回 'power'", TerrainToolService.Apply(G, "raise", 0, 0, 0.016).Code == ToolResult.Power);
            G.Stats.Power = 0.05;
            Check("神力 0.05 > 阈值 0.048 → 允许执行", TerrainToolService.Apply(G, "raise", 0, 0, 0.016).Code == ToolResult.Ok);
        }

        Section("[A3] 抬升笔刷与距离衰减（回归）");
        {
            WorldState G = NewWorld(777);
            if (FindBuildableTile(G, out int cx, out int cy, 1, 1.5, 4.0))
            {
                float h0 = StateQueries.GetTile(G, cx, cy).Height;
                float he0 = StateQueries.GetTile(G, cx + 2, cy).Height;
                G.Stats.Power = 1000;
                ToolOutcome o = TerrainToolService.Apply(G, "raise", cx, cy, 1.0);
                double center = StateQueries.GetTile(G, cx, cy).Height - h0;
                double edge = StateQueries.GetTile(G, cx + 2, cy).Height - he0;
                Check("中心涨幅 ≈ 0.9（f=1）", Math.Abs(center - 0.9) < 0.05, center.ToString("F4"));
                Check("边缘涨幅明显更小（衰减生效）", edge < center * 0.5, "edge=" + edge.ToString("F4"));
                Check("神力按一份扣减", Math.Abs(o.PowerSpent - 6.0) < 1e-6);
            }
        }

        Section("[A4] 划区与拆除（回归）");
        {
            WorldState G = NewWorld(4242);
            if (FindBuildableTile(G, out int cx, out int cy))
            {
                G.Stats.Power = 1000;
                Check("划区成功", TerrainToolService.Apply(G, "z_res", cx, cy, 0.1).Code == ToolResult.Ok);
                Check("重复划区 → 'occupied'", TerrainToolService.Apply(G, "z_res", cx, cy, 0.1).Code == ToolResult.Occupied);

                TileData t = StateQueries.GetTile(G, cx, cy);
                t.BuildProgress = 0.5f;
                float hBefore = t.Height;
                Check("拆除成功", TerrainToolService.Apply(G, "demolish", cx, cy, 0.1).Code == ToolResult.Ok);
                Check("★ 拆除保留地形（R6）", Math.Abs(StateQueries.GetTile(G, cx, cy).Height - hBefore) < 1e-6);
                Check("拆除空格 → 'empty'", TerrainToolService.Apply(G, "demolish", cx, cy, 0.1).Code == ToolResult.Empty);
            }
        }

        Section("[A5] 引水不变量（回归）");
        {
            WorldState G = NewWorld(999);
            if (FindBuildableTile(G, out int cx, out int cy, 1, 1.2, 2.7))
            {
                G.Stats.Power = 1000;
                ToolOutcome o = TerrainToolService.Apply(G, "water", cx, cy, 1.0);
                TileData t = StateQueries.GetTile(G, cx, cy);
                Check("引水成功且变水", o.Code == ToolResult.Ok && t.IsWater);
                Check("★ 水格高度 < 水面平面", t.Height < TerrainGenerator.WaterPlaneY + 1e-6,
                    t.Height.ToString("F4") + " < " + TerrainGenerator.WaterPlaneY.ToString("F4"));
            }
        }

        Section("[A6] 固定步长时钟（回归）");
        {
            var c1 = new GameClock(1.0 / 30.0); c1.Speed = 1;
            int s1 = 0; for (int i = 0; i < 60; i++) s1 += c1.Advance(1.0 / 60.0).Steps;
            Check("60fps 1 秒 → 30 步", s1 == 30, "实际 " + s1);

            var c2 = new GameClock(1.0 / 30.0); c2.Speed = 1;
            int s2 = 0; for (int i = 0; i < 15; i++) s2 += c2.Advance(1.0 / 15.0).Steps;
            Check("★ 15fps 1 秒 → 同样 30 步（帧率解耦）", s2 == 30, "实际 " + s2);

            var c3 = new GameClock(1.0 / 30.0); c3.SetPaused(true);
            ClockAdvance a = c3.Advance(1.0);
            Check("暂停不推进模拟", a.Steps == 0 && a.FrameDt > 0);

            var c4 = new GameClock(1.0 / 30.0); c4.Speed = 2;
            int s4 = 0; for (int i = 0; i < 30; i++) s4 += c4.Advance(1.0 / 30.0).Steps;
            Check("2 倍速 1 秒 → 60 步", s4 == 60, "实际 " + s4);
        }

        Section("[A7] 自动建造（回归）");
        {
            WorldState G = NewWorld(20260921);
            TerrainGenerator.SeedVillage(G);
            StateQueries.RefreshBuiltCache(G);
            Check("开局播种 5 住房", G.ZoneCache[1] >= 1, "houses=" + G.ZoneCache[1]);

            int placed = 0;
            for (int i = 0; i < 12; i++) placed += AutoBuildService.RunOnce(G, i).Placed;
            Check("12 轮放置了地块", placed > 0, "共 " + placed);

            int violations = 0;
            StateQueries.EachTile(G, (t, x, y) =>
            {
                if (t.Zone <= 0 || t.Zone == 2) return;
                for (int dy = -1; dy <= 1; dy++)
                    for (int dx = -1; dx <= 1; dx++)
                    {
                        if (dx == 0 && dy == 0) continue;
                        TileData a = StateQueries.GetTile(G, x + dx, y + dy);
                        if (a != null && a.Zone > 0) violations++;
                    }
            });
            Check("★ 8 邻域空置约束零违反", violations == 0, "违反 " + violations);
        }

        Section("[A8] tick 人口下限与信仰上限（回归）");
        {
            WorldState G = NewWorld(31337);
            TerrainGenerator.SeedVillage(G);
            var pending = new List<TileCoord>();
            double acc = 0;
            StateQueries.EachTile(G, (t, x, y) => { if (t.Zone == 2) t.Zone = 0; });
            StateQueries.RefreshBuiltCache(G);
            G.Stats.Population = 5;
            for (int i = 0; i < 3000; i++) EconomyTickService.Tick(G, 1.0 / 30.0, ref acc, null, pending);
            Check("★ 缺粮 100 秒人口停在 1（非归零）", Math.Abs(G.Stats.Population - 1.0) < 1e-6, "pop=" + G.Stats.Population.ToString("F4"));

            WorldState G2 = NewWorld(555);
            G2.ZoneCache[4] = 40; G2.BuiltCache[4] = 40;
            var pe2 = new List<TileCoord>(); double ac2 = 0;
            for (int i = 0; i < 6000; i++) EconomyTickService.Tick(G2, 1.0 / 30.0, ref ac2, null, pe2);
            Check("★ 信仰不超时代上限", G2.Stats.Faith <= EraConstants.FaithCapOf(0) + 1e-6,
                G2.Stats.Faith.ToString("F2") + " ≤ " + EraConstants.FaithCapOf(0).ToString("F2"));
        }
    }

    // ══════════════════════════════════════════════════════════════
    // B1：Miracle
    // ══════════════════════════════════════════════════════════════
    private static void MiracleTests()
    {
        Section("[B1] 神迹：表与数值对齐 Web MIRACLES");
        Check("3 个神迹", MiracleTable.All.Length == 3, "实际 " + MiracleTable.All.Length);
        Check("grow  cost=30 dur=15", MiracleTable.Grow.Cost == 30 && MiracleTable.Grow.Duration == 15);
        Check("build cost=40 dur=8", MiracleTable.Build.Cost == 40 && MiracleTable.Build.Duration == 8);
        Check("rain  cost=25 dur=12", MiracleTable.Rain.Cost == 25 && MiracleTable.Rain.Duration == 12);
        Check("按 key 取定义", MiracleTable.Get("build") != null && MiracleTable.Get("build").Kind == MiracleKind.Build);
        Check("未知 key → null", MiracleTable.Get("bogus") == null);

        Section("[B2] 神迹：资源不足不能施放（且无部分副作用）");
        {
            WorldState G = NewWorld(1001);
            G.Stats.Power = 29.999;   // grow 需要 30
            double powerBefore = G.Stats.Power;
            MiracleResult r = MiracleService.CastMiracle(G, MiracleTable.Grow);
            Check("神力不足 → Ok=false", !r.Ok, r.Reason ?? "");
            Check("原因 = 神力不足", r.Reason == MiracleService.ReasonNotEnoughPower);
            Check("★ 神力未被扣除", Math.Abs(G.Stats.Power - powerBefore) < 1e-9, G.Stats.Power.ToString("F4"));
            Check("★ 增益未被置位（无部分副作用）", G.Stats.BoostGrow == 0, "boostGrow=" + G.Stats.BoostGrow);
            Check("PowerSpent 恒为 0", r.PowerSpent == 0);
        }

        Section("[B3] 神迹：施放成功时资源变化正确");
        {
            WorldState G = NewWorld(1002);
            G.Stats.Power = 100;
            MiracleResult r = MiracleService.CastMiracle(G, MiracleTable.Grow);
            Check("施放成功", r.Ok);
            Check("★ 神力 100 - 30 = 70", Math.Abs(G.Stats.Power - 70) < 1e-9, G.Stats.Power.ToString("F4"));
            Check("★ boostGrow = 15", Math.Abs(G.Stats.BoostGrow - 15) < 1e-9, G.Stats.BoostGrow.ToString("F4"));
            Check("回报 PowerSpent = 30", Math.Abs(r.PowerSpent - 30) < 1e-9);
            Check("首次施放 WasRefreshed=false", !r.WasRefreshed);
        }

        Section("[B4] 神迹：三种增益分别生效");
        {
            WorldState G = NewWorld(1003);
            G.Stats.Power = 1000;
            MiracleService.CastMiracle(G, MiracleTable.Grow);
            MiracleService.CastMiracle(G, MiracleTable.Build);
            MiracleService.CastMiracle(G, MiracleTable.Rain);
            Check("boostGrow 生效", Math.Abs(G.Stats.BoostGrow - 15) < 1e-9);
            Check("boostBuild 生效", Math.Abs(G.Stats.BoostBuild - 8) < 1e-9);
            Check("boostRain 生效", Math.Abs(G.Stats.BoostRain - 12) < 1e-9);
            Check("★ 三个增益共存（写不同字段，无互斥）",
                MiracleService.IsActive(G, MiracleKind.Grow)
                && MiracleService.IsActive(G, MiracleKind.Build)
                && MiracleService.IsActive(G, MiracleKind.Rain));
            Check("神力共扣 30+40+25 = 95", Math.Abs(G.Stats.Power - 905) < 1e-9, G.Stats.Power.ToString("F4"));
        }

        Section("[B5] 神迹：★ 同类重复施放是重置而非叠加");
        {
            WorldState G = NewWorld(1004);
            G.Stats.Power = 1000;
            MiracleService.CastMiracle(G, MiracleTable.Grow);
            MiracleService.TickBoosts(G, 10.0);
            double mid = G.Stats.BoostGrow;
            Check("10 秒后剩余 5 秒", Math.Abs(mid - 5) < 1e-6, mid.ToString("F4"));

            MiracleResult r2 = MiracleService.CastMiracle(G, MiracleTable.Grow);
            Check("★ 再次施放 → 重置回 15（不是 5+15=20）", Math.Abs(G.Stats.BoostGrow - 15) < 1e-9,
                G.Stats.BoostGrow.ToString("F4"));
            Check("回报 WasRefreshed=true", r2.WasRefreshed);
            Check("神力再扣一次 30", Math.Abs(G.Stats.Power - 940) < 1e-9, G.Stats.Power.ToString("F4"));

            MiracleService.CastMiracle(G, MiracleTable.Grow);
            MiracleService.CastMiracle(G, MiracleTable.Grow);
            Check("★ 连施 3 次仍 = 15（严格重置，不叠加）", Math.Abs(G.Stats.BoostGrow - 15) < 1e-9,
                G.Stats.BoostGrow.ToString("F4"));
        }

        Section("[B6] 神迹：持续时间正确递减");
        {
            WorldState G = NewWorld(1005);
            G.Stats.Power = 1000;
            MiracleService.CastMiracle(G, MiracleTable.Build);   // 8 秒
            MiracleService.TickBoosts(G, 3.0);
            Check("递减 3 秒 → 5", Math.Abs(G.Stats.BoostBuild - 5) < 1e-6, G.Stats.BoostBuild.ToString("F4"));
            MiracleService.TickBoosts(G, 10.0);
            Check("★ 递减到 0 后不为负（钳制）", Math.Abs(G.Stats.BoostBuild) < 1e-9, G.Stats.BoostBuild.ToString("F4"));
            Check("归零后 IsActive=false", !MiracleService.IsActive(G, MiracleKind.Build));
            Check("无增益时 TickBoosts 返回 0", MiracleService.TickBoosts(G, 1.0) == 0);
        }

        Section("[B7] 神迹：加速建造的即时效果（Web: 建筑+0.35 / 奇迹+0.12）");
        {
            WorldState G = NewWorld(1006);
            G.Stats.Power = 1000;
            if (FindBuildableTile(G, out int cx, out int cy))
            {
                TerrainGenerator.PlaceAt(G, cx, cy, 1, true);
                var pending = new List<TileCoord> { new TileCoord(cx, cy) };
                G.Stats.WonderList.Add(new WonderEntry { Era = 0, X = cx, Y = cy, Progress = 0.10f, Done = false });

                MiracleResult r = MiracleService.CastMiracle(G, MiracleTable.Build, pending);
                Check("★ 在建建筑 +0.35", Math.Abs(StateQueries.GetTile(G, cx, cy).BuildProgress - 0.35f) < 1e-5,
                    StateQueries.GetTile(G, cx, cy).BuildProgress.ToString("F4"));
                Check("★ 在建奇迹 +0.12", Math.Abs(G.Stats.WonderList[0].Progress - 0.22f) < 1e-5,
                    G.Stats.WonderList[0].Progress.ToString("F4"));
                Check("回报 BuildingsBumped=1", r.BuildingsBumped == 1);
                Check("回报 WondersBumped=1", r.WondersBumped == 1);

                for (int i = 0; i < 5; i++) MiracleService.CastMiracle(G, MiracleTable.Build, pending);
                Check("★ 进度钳制在 1.0（不溢出）",
                    StateQueries.GetTile(G, cx, cy).BuildProgress <= 1f + 1e-6
                    && G.Stats.WonderList[0].Progress <= 1f + 1e-6,
                    "bld=" + StateQueries.GetTile(G, cx, cy).BuildProgress.ToString("F4")
                    + " wonder=" + G.Stats.WonderList[0].Progress.ToString("F4"));
            }
        }

        Section("[B8] 神迹：非 build 神迹不产生即时进度副作用");
        {
            WorldState G = NewWorld(1007);
            G.Stats.Power = 1000;
            if (FindBuildableTile(G, out int cx, out int cy))
            {
                TerrainGenerator.PlaceAt(G, cx, cy, 1, true);
                var pending = new List<TileCoord> { new TileCoord(cx, cy) };
                MiracleResult r = MiracleService.CastMiracle(G, MiracleTable.Grow, pending);
                Check("★ grow 不改建造进度", Math.Abs(StateQueries.GetTile(G, cx, cy).BuildProgress) < 1e-6);
                Check("回报 BuildingsBumped=0", r.BuildingsBumped == 0);
            }
        }
    }

    // ══════════════════════════════════════════════════════════════
    // B2：Wonder
    // ══════════════════════════════════════════════════════════════
    private static void WonderTests()
    {
        Section("[B9] 奇迹：数值来自既有规则（不得重定义）");
        for (int e = 0; e < 5; e++)
        {
            Check("E" + (e + 1) + " 信仰成本 = EraConstants.FaithCostOf",
                Math.Abs(WonderService.FaithCostOf(e) - EraConstants.FaithCostOf(e)) < 1e-9,
                WonderService.FaithCostOf(e).ToString("F0"));
            Check("E" + (e + 1) + " 时长 = EraConstants.WonderTime",
                Math.Abs(WonderService.BuildTimeOf(e) - EraConstants.WonderTime[e]) < 1e-9,
                WonderService.BuildTimeOf(e) + "s");
        }
        Check("时间表 = Web WONDERS[].time {18,24,30,36,45}",
            EraConstants.WonderTime[0] == 18 && EraConstants.WonderTime[1] == 24
            && EraConstants.WonderTime[2] == 30 && EraConstants.WonderTime[3] == 36
            && EraConstants.WonderTime[4] == 45);

        Section("[B10] 奇迹：信仰不足无法开始/落地");
        {
            WorldState G = NewWorld(2001);
            G.CurrentEra = 0;
            G.Stats.Faith = WonderService.FaithCostOf(0) - 1;
            Check("CanStartPlacement=false", !WonderService.CanStartPlacement(G, out string r1));
            Check("原因 = 信仰不足", r1 == WonderReason.NotEnoughFaith, r1);

            if (FindBuildableTile(G, out int cx, out int cy))
            {
                double faithBefore = G.Stats.Faith;
                WonderResult pr = WonderService.Place(G, cx, cy);
                Check("落地失败", !pr.Ok, pr.Reason);
                Check("★ 信仰未被扣除", Math.Abs(G.Stats.Faith - faithBefore) < 1e-9);
                Check("★ 未加入 wonderList", G.Stats.WonderList.Count == 0, "count=" + G.Stats.WonderList.Count);
            }
        }

        Section("[B11] 奇迹：地块校验（水/已划区）");
        {
            WorldState G = NewWorld(2002);
            G.Stats.Faith = 1e9;

            int wx = 0, wy = 0; bool hasWater = false;
            for (int y = -60; y < 60 && !hasWater; y++)
                for (int x = -60; x < 60 && !hasWater; x++)
                {
                    TileData t = StateQueries.GetTile(G, x, y);
                    if (t != null && t.IsWater) { wx = x; wy = y; hasWater = true; }
                }
            if (hasWater)
            {
                Check("水格 → CanPlaceAt=false", !WonderService.CanPlaceAt(G, wx, wy, out string rw));
                Check("水格原因 = 不能在水面放置奇迹", rw == WonderReason.TileIsWater, rw);
            }

            if (FindBuildableTile(G, out int cx, out int cy))
            {
                TerrainGenerator.PlaceAt(G, cx, cy, 1, true);
                Check("已划区地块 → false", !WonderService.CanPlaceAt(G, cx, cy, out string rz));
                Check("已划区原因 = 该地块已有分区", rz == WonderReason.TileOccupied, rz);
            }
        }

        Section("[B12] 奇迹：落地成功扣除信仰并入列");
        {
            WorldState G = NewWorld(2003);
            G.CurrentEra = 0;
            double cost = WonderService.FaithCostOf(0);
            G.Stats.Faith = cost + 500;
            if (FindBuildableTile(G, out int cx, out int cy, 1, 1.0, 5.5))
            {
                WonderResult r = WonderService.Place(G, cx, cy);
                Check("落地成功", r.Ok, r.Reason ?? "");
                Check("★ 信仰精确扣 cost", Math.Abs(G.Stats.Faith - 500) < 1e-6, G.Stats.Faith.ToString("F2"));
                Check("★ 入列 1 个在建奇迹", G.Stats.WonderList.Count == 1);
                Check("条目 era=0 / prog=0 / done=false",
                    G.Stats.WonderList[0].Era == 0 && G.Stats.WonderList[0].Progress == 0 && !G.Stats.WonderList[0].Done);
                Check("坐标正确", G.Stats.WonderList[0].X == cx && G.Stats.WonderList[0].Y == cy);
                Check("HasActiveWonder=true", WonderService.HasActiveWonder(G));
            }
        }

        Section("[B13] 奇迹：全局只允许一个在建");
        {
            WorldState G = NewWorld(2004);
            G.CurrentEra = 0;
            G.Stats.Faith = 1e9;
            if (FindBuildableTile(G, out int cx, out int cy))
            {
                WonderService.Place(G, cx, cy);
                Check("已有在建 → CanStartPlacement=false", !WonderService.CanStartPlacement(G, out string r));
                Check("原因 = 已有奇迹在建", r == WonderReason.AlreadyBuilding, r);
                WonderResult r2 = WonderService.Place(G, cx, cy);
                Check("★ 重复落地被拒", !r2.Ok && r2.Reason == WonderReason.AlreadyBuilding);
                Check("wonderList 仍只有 1 个", G.Stats.WonderList.Count == 1);
            }
        }

        Section("[B14] 奇迹：进度推进与倍速（Web: dt/time，boostBuild ×2）");
        {
            WorldState G = NewWorld(2005);
            G.CurrentEra = 0;
            G.Stats.Faith = 1e9;
            if (FindBuildableTile(G, out int cx, out int cy))
            {
                WonderService.Place(G, cx, cy);
                WonderService.AdvanceActive(G, 9.0);          // 9/18 = 0.5
                Check("★ 9/18 秒 → prog=0.5", Math.Abs(G.Stats.WonderList[0].Progress - 0.5f) < 1e-5,
                    G.Stats.WonderList[0].Progress.ToString("F4"));

                G.Stats.BoostBuild = 5;
                WonderService.AdvanceActive(G, 4.5);          // 4.5/18 × 2 = 0.5
                Check("★ boostBuild 下速率 ×2（0.5 → 1.0）",
                    Math.Abs(G.Stats.WonderList[0].Progress - 1.0f) < 1e-4,
                    G.Stats.WonderList[0].Progress.ToString("F4"));
            }
        }

        Section("[B15] 奇迹：完工只结算一次（幂等）");
        {
            WorldState G = NewWorld(2006);
            G.CurrentEra = 1;
            G.Stats.Faith = 1e9;
            if (FindBuildableTile(G, out int cx, out int cy))
            {
                WonderService.Place(G, cx, cy);
                G.Stats.WonderList[0].Progress = 1f;

                int events = 0;
                Action<WonderResult> h = delegate (WonderResult _) { events++; };
                WonderService.Completed += h;
                int c1 = WonderService.TryComplete(G, out bool w1);
                int c2 = WonderService.TryComplete(G, out bool w2);
                int c3 = WonderService.TryComplete(G, out bool w3);
                WonderService.Completed -= h;

                Check("★ 首次调用结算 1 个", c1 == 1, "c1=" + c1);
                Check("★ 重复调用结算 0 个（幂等）", c2 == 0 && c3 == 0, "c2=" + c2 + " c3=" + c3);
                Check("★ 完成事件只触发 1 次", events == 1, "events=" + events);
                Check("Done=true", G.Stats.WonderList[0].Done);
                // 放置时 CurrentEra=1 → 条目 Era=1 → 置位的是 Wonders[1]（原断言误写 Wonders[0]）
                Check("★ Wonders[1] 置位", G.Stats.Wonders[1]);
                Check("未误置位其它时代", !G.Stats.Wonders[0] && !G.Stats.Wonders[2]);
                Check("非 E5 不触发通关", !w1 && !w2 && !w3);
            }
        }

        Section("[B16] 奇迹：E5 太空电梯完工 → 通关只触发一次");
        {
            WorldState G = NewWorld(2007);
            G.CurrentEra = 4;
            G.Stats.WonderList.Add(new WonderEntry { Era = 4, X = 0, Y = 0, Progress = 1f, Done = false });

            int winEvents = 0;
            Action h = delegate () { winEvents++; };
            WonderService.FinalWin += h;

            int c1 = WonderService.TryComplete(G, out bool w1);
            Check("★ 首次通关判定成立", c1 == 1 && w1, "c1=" + c1 + " w1=" + w1);
            Check("★ GameOver 置位", G.Stats.GameOver);

            int c2 = WonderService.TryComplete(G, out bool w2);
            WonderService.FinalWin -= h;
            Check("★ 再次调用不再通关（Web checkFinalWin 的幂等保护）", c2 == 0 && !w2);
            Check("★ 通关事件只触发 1 次", winEvents == 1, "events=" + winEvents);
        }

        Section("[B17] 奇迹：未完成时不结算");
        {
            WorldState G = NewWorld(2008);
            G.Stats.WonderList.Add(new WonderEntry { Era = 0, X = 0, Y = 0, Progress = 0.99f, Done = false });
            int c = WonderService.TryComplete(G, out bool w);
            Check("prog 0.99 → 不结算", c == 0 && !w);
            Check("Done 仍为 false", !G.Stats.WonderList[0].Done);
            Check("Wonders[0] 未置位", !G.Stats.Wonders[0]);
        }
    }

    // ══════════════════════════════════════════════════════════════
    // B3：Era Progression
    // ══════════════════════════════════════════════════════════════
    private static void EraProgressionTests()
    {
        Section("[B18] 进阶：条件不足时失败且状态一字不动");
        {
            WorldState G = NewWorld(3001);
            G.CurrentEra = 0;
            G.Stats.Population = 1;
            G.Stats.Stars = 0;
            int eraBefore = G.CurrentEra;
            int starsBefore = G.Stats.Stars;

            EraAdvanceOutcome o = EraProgressionService.Advance(G);
            Check("进阶失败", !o.Ok);
            Check("给出了具体缺项", o.Reasons.Count > 0, o.ReasonText);
            Check("★ era 未变", G.CurrentEra == eraBefore, "era=" + G.CurrentEra);
            Check("★ stars 未变", G.Stats.Stars == starsBefore);
            Check("From == To（无迁移）", o.To == o.From);
        }

        Section("[B19] 进阶：条件满足时成功，且只扣一次星");
        {
            WorldState G = NewWorld(3002);
            G.CurrentEra = 0;
            G.Stats.Population = EraConstants.EraPopGoal[0] + 1000;
            G.Stats.Stars = 5;
            // 用**真实地块**满足产能门槛：EvaluateReadiness 内部会 RefreshBuiltCache，
            // 注入的缓存会被重算清零（首次尝试即因此失败）。门槛由 GateOf 反推，不写死数字。
            PlaceAndBuildIndustries(G, IndustriesNeededForGate(0));
            Check("工业地块已满足 gate", EconomyRules.IndustryPerSec(G.BuiltCache[3] * EconomyRules.BuildQ(0)) >= EconomyRules.GateOf(0),
                "tiles=" + G.BuiltCache[3] + " gate=" + EconomyRules.GateOf(0).ToString("F2"));

            EraReadinessResult ready = EraProgressionService.EvaluateReadiness(G);
            Check("E1 就绪（人口/星/产能齐备，E1 无需奇迹）", ready.Ok,
                ready.Reasons.Count > 0 ? string.Join("、", ready.Reasons) : "ok");

            if (ready.Ok)
            {
                int events = 0;
                Action<EraAdvanceOutcome> h = delegate (EraAdvanceOutcome _) { events++; };
                EraProgressionService.Advanced += h;
                EraAdvanceOutcome o = EraProgressionService.Advance(G);
                EraProgressionService.Advanced -= h;

                Check("进阶成功", o.Ok);
                Check("★ era 0 → 1", G.CurrentEra == 1, "era=" + G.CurrentEra);
                Check("★ 扣 3 星：5 - 3 = 2", G.Stats.Stars == 2, "stars=" + G.Stats.Stars);
                Check("★ StarsSpent 回报 = 3", o.StarsSpent == 3);
                Check("StarProgress 归零", Math.Abs(G.Stats.StarProgress) < 1e-9);
                Check("TerrainDirty 置位", G.TerrainDirty);
                Check("★ 成功事件触发 1 次", events == 1, "events=" + events);
                Check("From/To/Name 正确", o.From == 0 && o.To == 1 && o.Name == EraConstants.EraNames[1], o.Name);

                Section("[B20] 进阶：连续调用不会重复领取");
                int starsAfter = G.Stats.Stars;
                int eraAfter = G.CurrentEra;
                EraAdvanceOutcome o2 = EraProgressionService.Advance(G);
                Check("★ 第二次调用失败（E2 条件未满足）", !o2.Ok, o2.ReasonText ?? "(no reason)");
                Check("★ era 未再前移", G.CurrentEra == eraAfter, "era=" + G.CurrentEra);
                Check("★ stars 未被再扣", G.Stats.Stars == starsAfter, "stars=" + G.Stats.Stars);

                Section("[B21] 进阶：新时代配置在后续 tick 中真实生效（非仅 UI）");
                var pending = new List<TileCoord>();
                double acc = 0;
                TickReport rep = EconomyTickService.Tick(G, 1.0 / 30.0, ref acc, null, pending);
                Check("★ tick 报告的 Era 已是 1（新时代生效）", rep.Era == 1, "rep.Era=" + rep.Era);
                Check("★ 人口上限按 E2 口径重算（> 0）", rep.PopCap > 0, "cap=" + rep.PopCap.ToString("F1"));

                // popCap 分阶段主导：**E≤2 用住房，E≥3 用粮食/产能**（见 numeric-design 人口上限表）。
                // 因此口径切换点在 E2→E3，而不是 E1→E2 —— E1/E2 相同建筑必然得到同一上限
                // （首次写成 E1 vs E2 对照是测试选错了时代）。
                double capE2 = PopCapWithHouses(1, 10);
                double capE3 = PopCapWithHouses(2, 10);
                Check("E1 与 E2 同栏（均由住房主导）", Math.Abs(PopCapWithHouses(0, 10) - capE2) < 1e-6,
                    "E1=" + PopCapWithHouses(0, 10).ToString("F1") + " E2=" + capE2.ToString("F1"));
                Check("★ 相同建筑在 E2/E3 得到不同上限（口径在 E3 切换）",
                    Math.Abs(capE2 - capE3) > 1e-6,
                    "E2=" + capE2.ToString("F1") + " / E3=" + capE3.ToString("F1"));
            }
        }

        Section("[B22] 进阶：终局时代不可再进阶");
        {
            WorldState G5 = NewWorld(3004);
            G5.CurrentEra = 4;
            G5.Stats.Population = 1e9;
            G5.Stats.Stars = 99;
            EraReadinessResult r5 = EraProgressionService.EvaluateReadiness(G5);
            Check("★ E5 判定为不可进阶", !r5.Ok);
            bool hasLastEraReason = false;
            for (int i = 0; i < r5.Reasons.Count; i++)
                if (r5.Reasons[i].IndexOf("最终时代", StringComparison.Ordinal) >= 0) hasLastEraReason = true;
            Check("原因含『已是最终时代』", hasLastEraReason, string.Join("、", r5.Reasons));
            EraAdvanceOutcome o5 = EraProgressionService.Advance(G5);
            Check("★ E5 进阶失败且 era 不变", !o5.Ok && G5.CurrentEra == 4, "era=" + G5.CurrentEra);
        }

        Section("[B23] 进阶：放置态被清理（Web applyEraAdvance 清 placingWonder）");
        {
            WorldState G = NewWorld(3005);
            EraProgressionService.SetPlacingWonder(true);
            Check("放置态已置位", EraProgressionService.IsPlacingWonder);
            G.CurrentEra = 0;
            G.Stats.Population = EraConstants.EraPopGoal[0] + 1000;
            G.Stats.Stars = 5;
            PlaceAndBuildIndustries(G, IndustriesNeededForGate(0));
            if (EraProgressionService.EvaluateReadiness(G).Ok)
            {
                EraProgressionService.Advance(G);
                Check("★ 进阶后放置态被清理", !EraProgressionService.IsPlacingWonder);
            }
            EraProgressionService.SetPlacingWonder(false);
        }
    }

    // ══════════════════════════════════════════════════════════════
    // B4：Tick 集成
    // ══════════════════════════════════════════════════════════════
    private static void TickIntegrationTests()
    {
        Section("[B24] Tick 集成：增益递减在 tick 内真实发生");
        {
            WorldState G = NewWorld(4001);
            G.Stats.Power = 1000;
            MiracleService.CastMiracle(G, MiracleTable.Grow);
            double before = G.Stats.BoostGrow;
            var pending = new List<TileCoord>();
            double acc = 0;
            for (int i = 0; i < 30; i++) EconomyTickService.Tick(G, 1.0 / 30.0, ref acc, null, pending);
            Check("★ 30 步（1 秒）后 boostGrow 减 1", Math.Abs(G.Stats.BoostGrow - (before - 1.0)) < 1e-6,
                G.Stats.BoostGrow.ToString("F4"));
        }

        Section("[B25] Tick 集成：★ 同一 tick 不重复推进奇迹");
        {
            WorldState G = NewWorld(4002);
            G.CurrentEra = 0;
            G.Stats.Faith = 1e9;
            if (FindBuildableTile(G, out int cx, out int cy))
            {
                WonderService.Place(G, cx, cy);
                var pending = new List<TileCoord>();
                double acc = 0;
                double dt = 1.0 / 30.0;
                EconomyTickService.Tick(G, dt, ref acc, null, pending);
                double expected = dt / WonderService.BuildTimeOf(0);
                Check("★ 单 tick 推进量 = dt/time（未重复推进）",
                    Math.Abs(G.Stats.WonderList[0].Progress - expected) < 1e-6,
                    G.Stats.WonderList[0].Progress.ToString("F6") + " vs " + expected.ToString("F6"));
            }
        }

        Section("[B26] Tick 集成：★ 奇迹完工只结算一次（跨多个 tick 累计）");
        {
            WorldState G = NewWorld(4003);
            G.CurrentEra = 1;
            G.Stats.Faith = 1e9;
            if (FindBuildableTile(G, out int cx, out int cy))
            {
                WonderService.Place(G, cx, cy);
                G.Stats.WonderList[0].Progress = 0.999f;
                var pending = new List<TileCoord>();
                double acc = 0;
                int completions = 0;
                for (int i = 0; i < 60; i++)
                {
                    TickReport rep = EconomyTickService.Tick(G, 1.0 / 30.0, ref acc, null, pending);
                    completions += rep.WondersCompleted;
                }
                Check("★ 60 个 tick 累计只完成 1 个", completions == 1, "completions=" + completions);
                Check("Wonders[1] 置位（效果接入的唯一开关）", G.Stats.Wonders[1]);
            }
        }

        Section("[B27] Tick 集成：★ 终局通关经 tick 路径只触发一次");
        {
            WorldState G = NewWorld(4004);
            G.CurrentEra = 4;
            G.Stats.WonderList.Add(new WonderEntry { Era = 4, X = 0, Y = 0, Progress = 0.999f, Done = false });
            var pending = new List<TileCoord>();
            double acc = 0;
            int wins = 0;
            for (int i = 0; i < 60; i++)
            {
                TickReport rep = EconomyTickService.Tick(G, 1.0 / 30.0, ref acc, null, pending);
                if (rep.FinalWin) wins++;
            }
            Check("★ FinalWin 只在 1 个 tick 上为 true", wins == 1, "wins=" + wins);
            Check("GameOver 置位", G.Stats.GameOver);
            Check("太空电梯 Done", G.Stats.WonderList[0].Done);
        }

        Section("[B28] Tick 集成：奇迹与自动建造/人口经济无意外副作用");
        {
            WorldState G = NewWorld(4005);
            TerrainGenerator.SeedVillage(G);
            StateQueries.RefreshBuiltCache(G);
            G.Stats.Power = 1000;
            G.Stats.Faith = 1e9;
            G.CurrentEra = 0;

            var pending = new List<TileCoord>();
            double acc = 0;
            StateQueries.EachTile(G, (t, x, y) => { if (t.Zone > 0 && !t.IsBuilt) pending.Add(new TileCoord(x, y)); });

            if (FindBuildableTile(G, out int wx, out int wy))
                WonderService.Place(G, wx, wy);

            double popBefore = G.Stats.Population;
            MiracleService.CastMiracle(G, MiracleTable.Grow);
            MiracleService.CastMiracle(G, MiracleTable.Build, pending);
            MiracleService.CastMiracle(G, MiracleTable.Rain);
            for (int i = 0; i < 60; i++) EconomyTickService.Tick(G, 1.0 / 30.0, ref acc, null, pending);

            Check("人口在 grow 增益下增长", G.Stats.Population >= popBefore, "pop=" + G.Stats.Population.ToString("F2"));
            Check("★ 增益仍在计时（未被 tick 误清）", G.Stats.BoostGrow > 0 && G.Stats.BoostRain > 0,
                "grow=" + G.Stats.BoostGrow.ToString("F2") + " rain=" + G.Stats.BoostRain.ToString("F2"));
            Check("★ 奇迹进度在推进", G.Stats.WonderList.Count == 1 && G.Stats.WonderList[0].Progress > 0,
                "prog=" + G.Stats.WonderList[0].Progress.ToString("F4"));
            Check("信仰未越界", G.Stats.Faith <= EraConstants.FaithCapOf(0) + 1e-6, G.Stats.Faith.ToString("F2"));
            Check("神力未越界", G.Stats.Power <= EraConstants.PowerMaxOf(0) + 1e-6, G.Stats.Power.ToString("F2"));
            Check("★ 未误触发通关", !G.Stats.GameOver);
        }

        Section("[B29] Tick 集成：神迹加成在 tick 中真实生效（非仅字段）");
        {
            // ⚠️ 必须给农田：SeedVillage 只播 5 住房、0 农田 → foodCap=0 → popCap=0
            // → tick 的 Math.Max(1, nextPop) 把两个分支都钳到人口下限 1，对照失去意义
            // （这正是首次运行时该断言两边都是 1.000 的原因，是测试设计的疏漏）。
            // 起点必须在 cap 之下，否则两边都会被钳到同一个值，对照失去意义。
            // 首次用 pop=50 / cap=12（pop > cap 的**超载态**）既导致对照失效，
            // 又恰好触发了"增益反向压低人口"的真实缺陷。
            const double startPop = 5;
            double popNoBoost, popBoost;
            {
                WorldState baseW = NewWorld(4006);
                SeedVillageWithFarms(baseW, 12);
                baseW.Stats.Population = startPop;
                var pb = new List<TileCoord>(); double ab = 0;
                for (int i = 0; i < 60; i++) EconomyTickService.Tick(baseW, 1.0 / 30.0, ref ab, null, pb);
                popNoBoost = baseW.Stats.Population;
            }
            {
                WorldState boostW = NewWorld(4006);
                SeedVillageWithFarms(boostW, 12);
                boostW.Stats.Population = startPop;
                boostW.Stats.Power = 1000;
                MiracleService.CastMiracle(boostW, MiracleTable.Grow);
                Check("对照前确认增益已生效", boostW.Stats.BoostGrow > 0, boostW.Stats.BoostGrow.ToString("F2"));
                var pbo = new List<TileCoord>(); double abo = 0;
                for (int i = 0; i < 60; i++) EconomyTickService.Tick(boostW, 1.0 / 30.0, ref abo, null, pbo);
                popBoost = boostW.Stats.Population;
            }

            Check("★ 丰收祝福确实让人口增长更快（加成真实生效）", popBoost > popNoBoost,
                "无增益=" + popNoBoost.ToString("F3") + " 有增益=" + popBoost.ToString("F3"));
            Check("★ 增益不会反向压低人口（pop>cap 时不再崩到下限）", popBoost >= 1.0,
                "有增益=" + popBoost.ToString("F4"));

            // 显式回归：超载态（pop=50 > cap=12）下施放增益，人口应回落到 cap 而不是崩到 1
            {
                WorldState over = NewWorld(4008);
                SeedVillageWithFarms(over, 12);
                over.Stats.Population = 50;
                over.Stats.Power = 1000;
                MiracleService.CastMiracle(over, MiracleTable.Grow);
                var po = new List<TileCoord>(); double ao = 0;
                EconomyTickService.Tick(over, 1.0 / 30.0, ref ao, null, po);
                Check("★ 超载态下增益让人口回落到 cap 而非崩塌", over.Stats.Population > 10,
                    "pop=" + over.Stats.Population.ToString("F4") + "（修复前为 1）");
            }

            WorldState s1 = NewWorld(4007);
            s1.CurrentEra = 0;
            s1.ZoneCache[1] = 1; s1.BuiltCache[1] = 0;
            var q1 = new List<TileCoord>(); double c1 = 0;
            double vNo = EconomyTickService.Tick(s1, 1.0 / 30.0, ref c1, null, q1).BuildSpeed;

            WorldState s2 = NewWorld(4007);
            s2.CurrentEra = 0;
            s2.ZoneCache[1] = 1; s2.BuiltCache[1] = 0;
            s2.Stats.BoostBuild = 8;
            var q2 = new List<TileCoord>(); double c2 = 0;
            double vYes = EconomyTickService.Tick(s2, 1.0 / 30.0, ref c2, null, q2).BuildSpeed;

            Check("★ 加速建造让建造速度为 3 倍（Web: vBuild *= 3）",
                Math.Abs(vYes - vNo * 3) < 1e-6,
                "无=" + vNo.ToString("F5") + " 有=" + vYes.ToString("F5"));
        }
    }
}
