using System;
using System.Collections.Generic;
using System.Text;
using InterimDeity.Core;

namespace InterimDeity.Simulation
{
    public sealed class EraReadinessResult
    {
        public bool Ok;
        public List<string> Reasons = new List<string>();
        public int Era;
        public double Pop;
        public double PopGoal;
        public int Stars;
        public int StarCost;
        public bool NeedWonder;
        public bool WonderOk;
        public double IndTiles;
        public double IndLogical;
        public double IndPerSec;
        public double Gate;
    }

    public sealed class MilestoneResult
    {
        public int Index;
        public string Label;
    }

    public sealed class EraAdvanceResult
    {
        public int From;
        public int To;
        public string Name;
    }

    public static class ProgressionRules
    {
        public static EraReadinessResult EvaluateReadiness(WorldState ready)
        {
            int era = EconomyRules.EraIndex(ready.CurrentEra);
            double popGoal = EraConstants.EraPopGoal[era];
            int starCost = EraConstants.EraStarCost;
            bool isLastEra = era >= 4;
            bool needWonder = era >= 1;
            bool wonderOk = !needWonder || ready.Stats.Wonders[era];
            double indTiles = ready.BuiltCache[3];
            double indLogical = indTiles * EconomyRules.BuildQ(era);
            double indPerSec = EconomyRules.IndustryPerSec(indLogical);
            double gate = EconomyRules.GateOf(era);

            var res = new EraReadinessResult
            {
                Era = era,
                Pop = ready.Stats.Population,
                PopGoal = popGoal,
                Stars = ready.Stats.Stars,
                StarCost = starCost,
                NeedWonder = needWonder,
                WonderOk = wonderOk,
                IndTiles = indTiles,
                IndLogical = indLogical,
                IndPerSec = indPerSec,
                Gate = gate
            };

            if (isLastEra) res.Reasons.Add("已是最终时代");
            else
            {
                if (!(ready.Stats.Population >= popGoal)) res.Reasons.Add("人口不足");
                if (!wonderOk) res.Reasons.Add("本时代奇迹未建成");
                if (!(ready.Stats.Stars >= starCost)) res.Reasons.Add("星星不足");
                if (!(indPerSec >= gate)) res.Reasons.Add("产能不足");
            }
            res.Ok = res.Reasons.Count == 0;
            return res;
        }

        public static bool EraReady(WorldState ready) => EvaluateReadiness(ready).Ok;

        private static bool CheckMilestone(MilestoneDef m, WorldState ready,
            double farms, double inds, double churches, double houses)
        {
            switch (m.Kind)
            {
                case MilestoneKind.Population: return ready.Stats.Population >= m.Threshold;
                case MilestoneKind.Farms: return farms >= m.Threshold;
                case MilestoneKind.Industries: return inds >= m.Threshold;
                case MilestoneKind.Churches: return churches >= m.Threshold;
                case MilestoneKind.Wonder:
                    return m.WonderIndex >= 0 && m.WonderIndex < ready.Stats.Wonders.Length
                        && ready.Stats.Wonders[m.WonderIndex];
                default: return false;
            }
        }

        public static List<MilestoneResult> ClaimMilestones(WorldState ready,
            double farms = 0, double inds = 0, double churches = 0, double houses = 0)
        {
            int era = EconomyRules.EraIndex(ready.CurrentEra);
            bool[] flags = ready.Stats.StarMilestones[era];
            var list = EraConstants.Milestones[era];
            double qm = EconomyRules.BuildQ(era);
            double cf = farms * qm, ci = inds * qm, cc = churches * qm, ch = houses * qm;

            var newly = new List<MilestoneResult>();
            for (int i = 0; i < list.Length; i++)
            {
                if (flags[i]) continue;
                if (CheckMilestone(list[i], ready, cf, ci, cc, ch))
                {
                    flags[i] = true;
                    ready.Stats.Stars += 1;
                    newly.Add(new MilestoneResult { Index = i, Label = list[i].Label });
                }
            }
            return newly;
        }

        public static string MilestoneSummary(WorldState ready,
            double farms, double inds, double churches, double houses = 0)
        {
            int era = EconomyRules.EraIndex(ready.CurrentEra);
            var list = EraConstants.Milestones[era];
            bool[] flags = ready.Stats.StarMilestones[era];
            double qm = EconomyRules.BuildQ(era);
            double cf = farms * qm, ci = inds * qm, cc = churches * qm, ch = houses * qm;

            var sb = new StringBuilder();
            for (int i = 0; i < list.Length; i++)
            {
                if (i > 0) sb.Append(" · ");
                bool done = flags[i];
                bool ok = done || CheckMilestone(list[i], ready, cf, ci, cc, ch);
                sb.Append(ok ? "✓ " : "○ ").Append(list[i].Label);
            }
            return sb.ToString();
        }

        public static EraAdvanceResult ApplyEraAdvance(WorldState ready)
        {
            int from = ready.CurrentEra;
            ready.Stats.Stars = Math.Max(0, ready.Stats.Stars - EraConstants.EraStarCost);
            ready.CurrentEra = from + 1;
            ready.Stats.StarProgress = 0;
            ready.TerrainDirty = true;
            return new EraAdvanceResult { From = from, To = ready.CurrentEra, Name = EraConstants.EraNames[ready.CurrentEra] };
        }
    }
}
