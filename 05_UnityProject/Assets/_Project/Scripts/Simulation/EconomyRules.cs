using System;
using InterimDeity.Core;

namespace InterimDeity.Simulation
{
    public static class EconomyRules
    {
        public static readonly double[] T = { 200, 2000, 8000, 20000, 60000 };

        public const double C_HOUSE = 4;
        public const double C_FARM = 50;
        public const double R_FOOD = 1;
        public const double R_IND = 0.15;
        public const double R_CHURCH = 0.05;
        public const double K_FAITH_POP = 0.1;
        public const double K_CHURCH = 2;
        public const double K_IND = 1.0;
        public const double K = 1.25;
        public const double V0 = 0.07;
        public const double C0 = 0.5;
        public const double R_INDPOP = 0.01;

        public static readonly double[] R_B = { 0, 0.25, 0.20, 0.15, 0.05 };
        public static readonly double[] GROWTH = { 0.035, 0.04, 0.045, 0.05, 0.058 };
        public static readonly double[] RENDER_MIN = { 10, 50, 100, 165, 250 };
        public static readonly double[] RENDER_MAX = { 60, 120, 200, 300, 400 };
        public static readonly double[] RENDER_Q = { 6.7, 25, 53.33, 80, 250 };
        public static readonly double[] BUILD_Q = { 1, 1, 3, 6, 20 };
        public static readonly double[] BUILD_COST = { 0, 0.6, 0.8, 1.6, 2.0 };

        public static int EraIndex(int era) => MathUtil.ClampInt(era, 0, 4);

        public static double BuildingLow(int e, int zone)
        {
            int E = EraIndex(e);
            return Math.Ceiling(T[E] * R_B[zone]);
        }

        public static double BuildingHigh(int e, int zone)
        {
            int E = EraIndex(e);
            return Math.Ceiling(T[E] * R_B[zone] * K);
        }

        public static int EraClamp(int e) => MathUtil.ClampInt(e, 0, BUILD_Q.Length - 1);

        public static double BuildQ(int e) => BUILD_Q[EraClamp(e)];

        public static double ToTiles(double logicalCount, int e) => Math.Ceiling(logicalCount / BuildQ(e));

        public static double BuildingLowTiles(int e, int zone) => ToTiles(BuildingLow(e, zone), e);

        public static double BuildingHighTiles(int e, int zone) => ToTiles(BuildingHigh(e, zone), e);

        public static double WonderPopMult(bool[] wonders)
        {
            if (wonders == null) return 1;
            double m = 1;
            if (wonders[1]) m *= 1.2;
            if (wonders[3]) m *= 1.5;
            return m;
        }

        public static double PopCap(int e, double houses, double farms, double industries, bool[] wonders)
        {
            double cap;
            if (e <= 1) cap = houses * C_HOUSE;
            else if (e <= 3) cap = Math.Floor(farms * C_FARM / R_FOOD);
            else cap = Math.Floor(industries * K_IND / R_INDPOP);
            return cap * WonderPopMult(wonders);
        }

        public static double FoodPerSec(double farms) => farms * C_FARM;

        public static double FoodNeed(double n) => n * R_FOOD;

        public static double FaithPerSec(double churches, double n, int e = 0)
        {
            int i = MathUtil.ClampInt(e, 0, 4);
            return (churches * K_CHURCH + n * K_FAITH_POP) * EraConstants.FaithEraDamp[i];
        }

        public static double IndustryPerSec(double industries) => industries * K_IND;

        public static double GateOf(int e) => 0.5 * IndustryPerSec(BuildingLow(e, 3));

        public static double GrowPop(double n, double cap, int e, double farms, double dt)
        {
            int E = MathUtil.ClampInt(e, 0, 4);
            double g = GROWTH[E];
            double next = n * (1 + g * dt) + 0.6 * dt;
            if (next > cap) next = cap;
            double food = FoodPerSec(farms);
            if (food < FoodNeed(next))
            {
                double supported = food / R_FOOD;
                double deficit = (FoodNeed(next) - food) / Math.Max(1e-6, FoodNeed(next));
                next = supported - supported * Math.Min(0.5, deficit) * dt;
            }
            return Math.Max(0, next);
        }

        public static double BuildSpeed(int e, double industries, double pending, double wonderDraw = 0)
        {
            if (pending <= 0) return V0;
            double supply = Math.Max(0, IndustryPerSec(industries) - wonderDraw);
            double eW = Math.Pow(1.5, e);
            double demand = Math.Max(1e-6, pending * C0 * eW);
            double ratio = supply / demand;
            double floor = industries > 0 ? 0.2 : 0.5;
            return V0 * Math.Max(floor, Math.Min(2.0, ratio));
        }

        public static double WonderDrawPerSec(int e) => IndustryPerSec(BuildingLow(e, 3));

        public static double HousingCap(double houseTiles, int era, bool[] wonders) =>
            houseTiles * BuildQ(era) * C_HOUSE * WonderPopMult(wonders);

        public static double FoodCap(double farmTiles) => farmTiles * C_FARM;

        public static double FaithMult(bool[] wonders)
        {
            double m = 1;
            if (wonders[0]) m *= 1.1;
            if (wonders[2]) m *= 1.3;
            return m;
        }

        public static double RenderVillagers(double n, int e)
        {
            if (n <= 1) return RENDER_MIN[e];
            double raw = Math.Floor(n / RENDER_Q[e] + 0.5);
            double lo = RENDER_MIN[e];
            double hi = RENDER_MAX[e];
            return Math.Max(lo, Math.Min(hi, raw));
        }
    }
}
