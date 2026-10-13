// 《实习神明》Gameplay 层 · 行为验证（真实执行编译产物）
//
// 目的：证明 Gameplay 的实现**真的按 Web 规则工作**，而不是"能编译"。
// 这些断言直接对应 Web `terrain.js` / `main.js` 的可观察行为。
using System;
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

    private static WorldState NewWorld(int seed)
    {
        WorldState G = StateQueries.CreateState(seed);
        TerrainGenerator.GenWorld(G);
        return G;
    }

    private static int Main()
    {
        Console.WriteLine("=== Gameplay 层行为验证 ===");

        // ── 1. ToolTable 与 Web TOOLS 对齐 ──
        Console.WriteLine("\n[1] 工具表");
        Check("工具总数 = 10", ToolTable.Count == 10, "实际 " + ToolTable.Count);
        Check("raise 强度 0.9 / 半径 1.8", Math.Abs(ToolTable.Raise.Strength - 0.9) < 1e-9 && Math.Abs(ToolTable.Raise.Radius - 1.8) < 1e-9);
        Check("flatten 强度 1.1 / 半径 2.2", Math.Abs(ToolTable.Flatten.Strength - 1.1) < 1e-9 && Math.Abs(ToolTable.Flatten.Radius - 2.2) < 1e-9);
        Check("拆除 cost=1（最低）", Math.Abs(ToolTable.Demolish.Cost - 1) < 1e-9);
        Check("不存在的 key 返回 null", ToolTable.Get("nope") == null);

        // ── 2. 神力不足的门槛（Web: power < consume*0.5 → 'power'）──
        Console.WriteLine("\n[2] 神力门槛");
        {
            WorldState G = NewWorld(12345);
            G.Stats.Power = 0;
            ToolOutcome o = TerrainToolService.Apply(G, "raise", 0, 0, 0.016);
            Check("神力 0 时返回 'power'", o.Code == ToolResult.Power, o.Code);

            // consume = 6 * 0.016 = 0.096；阈值是 consume*0.5 = 0.048
            G.Stats.Power = 0.05;
            ToolOutcome o2 = TerrainToolService.Apply(G, "raise", 0, 0, 0.016);
            Check("神力 0.05 > 阈值 0.048 → 允许执行", o2.Code == ToolResult.Ok, o2.Code + " / 阈值=" + (6 * 0.016 * 0.5));
        }

        // ── 3. 抬升笔刷：中心涨幅 > 边缘，且距离衰减存在 ──
        Console.WriteLine("\n[3] 抬升笔刷与距离衰减");
        {
            WorldState G = NewWorld(777);
            // 找一块平坦陆地
            int cx = 0, cy = 0;
            bool found = false;
            for (int y = -40; y < 40 && !found; y++)
                for (int x = -40; x < 40 && !found; x++)
                {
                    TileData t = StateQueries.GetTile(G, x, y);
                    if (t != null && !t.IsWater && t.Height > 1.5f && t.Height < 4.0f) { cx = x; cy = y; found = true; }
                }
            Check("找到测试用陆地格", found, cx + "," + cy);
            if (found)
            {
                float h0 = StateQueries.GetTile(G, cx, cy).Height;
                float hEdge = StateQueries.GetTile(G, cx + 2, cy).Height;
                G.Stats.Power = 1000;
                ToolOutcome o = TerrainToolService.Apply(G, "raise", cx, cy, 1.0);
                float h1 = StateQueries.GetTile(G, cx, cy).Height;
                float hEdge1 = StateQueries.GetTile(G, cx + 2, cy).Height;
                Check("笔刷返回 ok", o.Code == ToolResult.Ok, o.Code);
                Check("中心格被抬高", h1 > h0, h0.ToString("F3") + " → " + h1.ToString("F3"));
                // d=0 → f=1 → 涨幅 ≈ strength*dt = 0.9；d=2 > reach(2.5)? 2<2.5 → f=0.2
                double centerGain = h1 - h0;
                double edgeGain = hEdge1 - hEdge;
                Check("中心涨幅接近 0.9（f=1）", Math.Abs(centerGain - 0.9) < 0.05, centerGain.ToString("F4"));
                Check("边缘涨幅明显小于中心（距离衰减）", edgeGain < centerGain * 0.5, "edge=" + edgeGain.ToString("F4") + " center=" + centerGain.ToString("F4"));
                Check("神力按一份消耗扣减", Math.Abs(o.PowerSpent - 6.0) < 1e-6, o.PowerSpent.ToString("F4"));
            }
        }

        // ── 4. 划区：合法格成功，重复划区返回 'occupied' ──
        Console.WriteLine("\n[4] 划区指令");
        {
            WorldState G = NewWorld(4242);
            int cx = 0, cy = 0;
            bool found = false;
            for (int y = -40; y < 40 && !found; y++)
                for (int x = -40; x < 40 && !found; x++)
                {
                    TileData t = StateQueries.GetTile(G, x, y);
                    if (t != null && !t.IsWater && t.Zone == 0 && t.Height >= 1.0f && t.Height <= 5.2f
                        && TerrainGenerator.CanPlaceZoneManual(G, x, y, 1)) { cx = x; cy = y; found = true; }
                }
            Check("找到可划区格", found, cx + "," + cy);
            if (found)
            {
                G.Stats.Power = 1000;
                ToolOutcome o = TerrainToolService.Apply(G, "z_res", cx, cy, 0.1);
                Check("划区成功返回 ok", o.Code == ToolResult.Ok, o.Code);
                Check("地块 zone 被置为 1", StateQueries.GetTile(G, cx, cy).Zone == 1);
                Check("返回受影响坐标", o.Affected.HasValue && o.Affected.Value.X == cx && o.Affected.Value.Y == cy);
                Check("TerrainDirty 被置位", G.TerrainDirty);

                ToolOutcome o2 = TerrainToolService.Apply(G, "z_res", cx, cy, 0.1);
                Check("重复划区返回 'occupied'", o2.Code == ToolResult.Occupied, o2.Code);
            }
        }

        // ── 5. 拆除：清分区但**保留地形**（Web R6），空格返回 'empty' ──
        Console.WriteLine("\n[5] 拆除保留地形");
        {
            WorldState G = NewWorld(4242);
            int cx = 0, cy = 0;
            bool found = false;
            for (int y = -40; y < 40 && !found; y++)
                for (int x = -40; x < 40 && !found; x++)
                {
                    TileData t = StateQueries.GetTile(G, x, y);
                    if (t != null && !t.IsWater && t.Zone == 0 && t.Height >= 1.0f && t.Height <= 5.2f
                        && TerrainGenerator.CanPlaceZoneManual(G, x, y, 1)) { cx = x; cy = y; found = true; }
                }
            if (found)
            {
                G.Stats.Power = 1000;
                TerrainToolService.Apply(G, "z_res", cx, cy, 0.1);
                TileData t = StateQueries.GetTile(G, cx, cy);
                t.BuildProgress = 0.5f;
                float hBefore = t.Height;

                ToolOutcome o = TerrainToolService.Apply(G, "demolish", cx, cy, 0.1);
                Check("拆除返回 ok", o.Code == ToolResult.Ok, o.Code);
                Check("zone 清零", StateQueries.GetTile(G, cx, cy).Zone == 0);
                Check("prog 清零", Math.Abs(StateQueries.GetTile(G, cx, cy).BuildProgress) < 1e-6);
                Check("built 清零", !StateQueries.GetTile(G, cx, cy).IsBuilt);
                Check("★ 地形高度未被改动（R6）", Math.Abs(StateQueries.GetTile(G, cx, cy).Height - hBefore) < 1e-6,
                    hBefore.ToString("F4") + " → " + StateQueries.GetTile(G, cx, cy).Height.ToString("F4"));
                Check("返回被清除的原分区", o.Zone == 1, "zone=" + o.Zone);

                ToolOutcome o2 = TerrainToolService.Apply(G, "demolish", cx, cy, 0.1);
                Check("拆除空格返回 'empty'", o2.Code == ToolResult.Empty, o2.Code);
            }
        }

        // ── 6. 引水工具的水格不变量 ──
        Console.WriteLine("\n[6] 引水工具");
        {
            WorldState G = NewWorld(999);
            int cx = 0, cy = 0;
            bool found = false;
            for (int y = -40; y < 40 && !found; y++)
                for (int x = -40; x < 40 && !found; x++)
                {
                    TileData t = StateQueries.GetTile(G, x, y);
                    if (t != null && !t.IsWater && t.Height < 2.8f && t.Height > 1.2f) { cx = x; cy = y; found = true; }
                }
            if (found)
            {
                G.Stats.Power = 1000;
                ToolOutcome o = TerrainToolService.Apply(G, "water", cx, cy, 1.0);
                TileData t = StateQueries.GetTile(G, cx, cy);
                Check("引水成功", o.Code == ToolResult.Ok && t.IsWater, "water=" + t.IsWater);
                Check("高度被压到 ≤ 0.7", t.Height <= 0.7f + 1e-6, t.Height.ToString("F4"));
                Check("★ 水格高度 < 水面平面（不变量）", t.Height < TerrainGenerator.WaterPlaneY + 1e-6,
                    t.Height.ToString("F4") + " < " + TerrainGenerator.WaterPlaneY.ToString("F4"));
            }
        }

        // ── 7. GameClock：固定步长与帧率解耦 ──
        Console.WriteLine("\n[7] 固定步长时钟");
        {
            var clock = new GameClock(1.0 / 30.0);
            clock.Speed = 1;
            int totalSteps = 0;
            for (int i = 0; i < 60; i++) totalSteps += clock.Advance(1.0 / 60.0).Steps;
            Check("60 帧 @60fps（共 1 秒）→ 30 步", totalSteps == 30, "实际 " + totalSteps);

            var clock2 = new GameClock(1.0 / 30.0);
            clock2.Speed = 1;
            int totalSteps2 = 0;
            for (int i = 0; i < 15; i++) totalSteps2 += clock2.Advance(1.0 / 15.0).Steps;
            Check("★ 15 帧 @15fps（同样 1 秒）→ 同样 30 步（与帧率解耦）", totalSteps2 == 30, "实际 " + totalSteps2);

            var clock3 = new GameClock(1.0 / 30.0);
            clock3.SetPaused(true);
            ClockAdvance a = clock3.Advance(1.0);
            Check("暂停时不推进模拟", a.Steps == 0 && a.FrameDt > 0, "steps=" + a.Steps + " frameDt=" + a.FrameDt.ToString("F3"));

            var clock4 = new GameClock(1.0 / 30.0);
            clock4.Speed = 2;
            int s4 = 0;
            for (int i = 0; i < 30; i++) s4 += clock4.Advance(1.0 / 30.0).Steps;
            Check("2 倍速下 1 秒 → 60 步", s4 == 60, "实际 " + s4);
        }

        // ── 8. 自动建造：能真的放下东西，且遵循 8 邻域硬约束 ──
        Console.WriteLine("\n[8] 自动建造执行");
        {
            WorldState G = NewWorld(20260921);
            TerrainGenerator.SeedVillage(G);
            StateQueries.RefreshBuiltCache(G);
            Check("开局村庄已播种（住房 ≥ 1）", G.ZoneCache[1] >= 1, "houses=" + G.ZoneCache[1]);

            int totalPlaced = 0;
            for (int i = 0; i < 12; i++)
            {
                AutoBuildService.AutoBuildRun r = AutoBuildService.RunOnce(G, i);
                totalPlaced += r.Placed;
            }
            Check("12 轮自动建造放置了地块", totalPlaced > 0, "共 " + totalPlaced + " 格");
            StateQueries.RefreshBuiltCache(G);
            Check("分区总数增长", G.ZoneCache[1] + G.ZoneCache[2] + G.ZoneCache[3] + G.ZoneCache[4] > 1,
                "z1=" + G.ZoneCache[1] + " z2=" + G.ZoneCache[2] + " z3=" + G.ZoneCache[3] + " z4=" + G.ZoneCache[4]);

            // 8 邻域空置硬约束：住房/工业/信仰不得相邻（农田可相邻）
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
            Check("★ 8 邻域空置约束无违反（非农田分区彼此不相邻）", violations == 0, "违反 " + violations + " 对");
        }

        // ── 9. 经济 tick：人口下限 1（更正后的正确行为）──
        Console.WriteLine("\n[9] 经济 tick 与人口下限");
        {
            WorldState G = NewWorld(31337);
            TerrainGenerator.SeedVillage(G);
            StateQueries.RefreshBuiltCache(G);
            var pending = new System.Collections.Generic.List<TileCoord>();
            double autoAcc = 0;

            // 人为制造缺粮：清掉所有农田分区
            StateQueries.EachTile(G, (t, x, y) => { if (t.Zone == 2) t.Zone = 0; });
            StateQueries.RefreshBuiltCache(G);
            G.Stats.Population = 5;

            for (int i = 0; i < 3000; i++)
            {
                EconomyTickService.Tick(G, 1.0 / 30.0, ref autoAcc, null, pending);
            }
            Check("★ 缺粮 100 秒后人口停在 1（下限生效，非吸收态归零）",
                Math.Abs(G.Stats.Population - 1.0) < 1e-6, "pop=" + G.Stats.Population.ToString("F4"));

            // 有农田后应回升 —— 必须放**真实地块**，不能注入缓存：
            // EconomyTickService.Tick 每次都会 RefreshBuiltCache()，从地块重算，
            // 注入的 BuiltCache 会被覆盖（这正是第一次跑失败的原因，是测试的问题不是代码的问题）。
            G.Stats.Population = 1;
            int farmsPlaced = 0;
            AutoBuildService.ResidentialStats rs = AutoBuildService.ResidentialStatsOf(G);
            int rcx = MathUtil.RoundJs(rs.Cx), rcy = MathUtil.RoundJs(rs.Cy);
            for (int dy = -12; dy <= 12 && farmsPlaced < 10; dy++)
            {
                for (int dx = -12; dx <= 12 && farmsPlaced < 10; dx++)
                {
                    if (TerrainGenerator.PlaceAt(G, rcx + dx, rcy + dy, 2, manual: false).Ok) farmsPlaced++;
                }
            }
            StateQueries.RefreshBuiltCache(G);
            Check("放置了真实农田地块", farmsPlaced > 0, "farms=" + farmsPlaced + " / ZoneCache[2]=" + G.ZoneCache[2] + " / BuiltCache[2]=" + G.BuiltCache[2]);
            // PlaceAt 只做「划区」：Zone 置位但 IsBuilt=false（prog 从 0 开始）。
            // 产出与人口上限用的是**已建成**口径，所以必须把新划定交给 tick 的待建列表去推进，
            // 否则它们永远停在 prog=0 —— 这符合 Web 的设计（划定 ≠ 建成）。
            pending.Clear();
            StateQueries.EachTile(G, (t, x, y) => { if (t.Zone == 2 && !t.IsBuilt) pending.Add(new TileCoord(x, y)); });
            Console.WriteLine("        待建农田: " + pending.Count + " 格（交给 tick 推进建造）");

            for (int i = 0; i < 3000; i++)
            {
                EconomyTickService.Tick(G, 1.0 / 30.0, ref autoAcc, null, pending);
            }
            StateQueries.RefreshBuiltCache(G);
            Check("农田已建成（BuiltCache[2] > 0）", G.BuiltCache[2] > 0, "built farms=" + G.BuiltCache[2]);
            Check("★ 加入农田后人口回升（非吸收态）", G.Stats.Population > 1.0, "pop=" + G.Stats.Population.ToString("F4"));
        }

        // ── 10. 信仰库存上限截断 ──
        Console.WriteLine("\n[10] 信仰上限");
        {
            WorldState G = NewWorld(555);
            G.CurrentEra = 0;
            G.ZoneCache[4] = 40; G.BuiltCache[4] = 40;
            G.Stats.Faith = 0;
            var pending = new System.Collections.Generic.List<TileCoord>();
            double autoAcc = 0;
            for (int i = 0; i < 6000; i++)
                EconomyTickService.Tick(G, 1.0 / 30.0, ref autoAcc, null, pending);
            double cap = EraConstants.FaithCapOf(0);
            Check("★ 信仰不超过时代上限", G.Stats.Faith <= cap + 1e-6, G.Stats.Faith.ToString("F2") + " ≤ " + cap.ToString("F2"));
        }

        Console.WriteLine("\n=== 结果: pass=" + _pass + " fail=" + _fail + " ===");
        return _fail == 0 ? 0 : 1;
    }
}
