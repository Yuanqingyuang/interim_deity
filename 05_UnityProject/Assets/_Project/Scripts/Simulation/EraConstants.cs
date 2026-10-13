using System;

namespace InterimDeity.Simulation
{
    public enum MilestoneKind
    {
        Population,
        Farms,
        Industries,
        Churches,
        Wonder
    }

    public sealed class MilestoneDef
    {
        public string Id;
        public string Label;
        public MilestoneKind Kind;
        public double Threshold;
        public int WonderIndex;
    }

    public static class EraConstants
    {
        public const string AppVersion = "1.1.0";
        public const int EraCount = 5;
        public const int EraStarCost = 3;
        public const double DayLength = 150;

        public static readonly string[] EraNames =
        {
            "蛮荒时代", "城邦时代", "封建时代", "工业时代", "星际时代"
        };

        public static readonly string[] EraRoman = { "I", "II", "III", "IV", "V" };

        public static readonly double[] EraPopTarget = { 200, 2000, 8000, 20000, 60000 };
        public static readonly double[] EraPopGoal = { 200, 2000, 8000, 20000, 60000 };

        public static readonly double[] FaithEraBase = { 15, 150, 1500, 15000, 150000 };
        public const double FaithFillSec = 100;
        public const double FaithCapMult = 2;

        public static readonly double[] FaithEraDamp = BuildFaithEraDamp();

        public static readonly string[] WonderNames =
        {
            "巨石阵", "金字塔", "大教堂", "摩天塔", "太空电梯"
        };

        public static readonly double[] WonderTime = { 18, 24, 30, 36, 45 };
        public static readonly double[] WonderFaithCost = BuildWonderFaithCost();

        public static readonly MilestoneDef[][] Milestones = BuildMilestones();

        public const double AutoInterval = 20;
        public const double AutoHousingPressure = 0.85;
        public const double AutoFaithPressure = 0.4;
        public const int AutoMaxPerTick = 4;
        public const int AutoIndustryPerTick = 2;

        private static double[] BuildFaithEraDamp()
        {
            var arr = new double[EraCount];
            for (int i = 0; i < EraCount; i++) arr[i] = FaithEraBase[i] / (0.2 * EraPopGoal[i]);
            return arr;
        }

        private static double[] BuildWonderFaithCost()
        {
            var arr = new double[EraCount];
            for (int i = 0; i < EraCount; i++) arr[i] = FaithCostOf(i);
            return arr;
        }

        public static double FaithCostOf(int era)
        {
            int i = MathUtil_ClampInt(era, 0, FaithEraBase.Length - 1);
            return FaithEraBase[i] * FaithFillSec;
        }

        public static double FaithCapOf(int era)
        {
            int i = MathUtil_ClampInt(era, 0, FaithEraBase.Length - 1);
            return FaithCostOf(i) * FaithCapMult;
        }

        public static double PowerMaxOf(int era) => 100 + era * 60;

        public static double PowerRegenOf(double faithRate) => 2.5 + Math.Min(10, faithRate * 0.02);

        private static int MathUtil_ClampInt(int v, int lo, int hi) => v < lo ? lo : (v > hi ? hi : v);

        private static MilestoneDef[][] BuildMilestones()
        {
            MilestoneDef Pop(string id, string label, double t) =>
                new MilestoneDef { Id = id, Label = label, Kind = MilestoneKind.Population, Threshold = t };
            MilestoneDef Farm(string id, string label, double t) =>
                new MilestoneDef { Id = id, Label = label, Kind = MilestoneKind.Farms, Threshold = t };
            MilestoneDef Ind(string id, string label, double t) =>
                new MilestoneDef { Id = id, Label = label, Kind = MilestoneKind.Industries, Threshold = t };
            MilestoneDef Chr(string id, string label, double t) =>
                new MilestoneDef { Id = id, Label = label, Kind = MilestoneKind.Churches, Threshold = t };
            MilestoneDef Won(string id, string label, int idx) =>
                new MilestoneDef { Id = id, Label = label, Kind = MilestoneKind.Wonder, WonderIndex = idx };

            return new[]
            {
                new[] { Pop("e1pop", "人口≥50", 50), Farm("e1farm", "农田≥10", 10), Chr("e1chr", "教堂≥1", 1) },
                new[] { Pop("e2pop", "人口≥400", 400), Ind("e2ind", "工业≥8", 8), Won("e2won", "金字塔完成", 1) },
                new[] { Pop("e3pop", "人口≥5000", 5000), Farm("e3farm", "农田≥80", 80), Won("e3won", "大教堂完成", 2) },
                new[] { Pop("e4pop", "人口≥1万", 10000), Ind("e4ind", "工业≥200", 200), Won("e4won", "摩天塔完成", 3) },
                new[] { Pop("e5pop", "人口≥5万", 50000), Ind("e5ind", "工业≥500", 500), Won("e5won", "太空电梯完成", 4) },
            };
        }
    }
}
