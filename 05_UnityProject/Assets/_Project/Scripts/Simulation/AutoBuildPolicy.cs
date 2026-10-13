using System;
using System.Collections.Generic;

namespace InterimDeity.Simulation
{
    public sealed class BuildGates
    {
        public double FoodOut;
        public double FoodNeed;
        public double IndOut;
        public double BuildDemand;
        public bool FoodOk;
        public bool IndOk;
        public double Hc;
        public bool HouseShort;
        public bool FarmShort;
        public bool IndShort;
        public bool ChurchShort;
    }

    public sealed class BuildOrderResult
    {
        public List<string> List = new List<string>();
        public bool ForceHouse;
        public bool HousingCritical;
        public bool FallbackHouse;
    }

    public sealed class AutoBuildDecision
    {
        public double[] Need;
        public BuildGates Gates;
        public List<string> List;
        public bool ForceHouse;
        public bool HousingCritical;
        public bool FallbackHouse;
    }

    public static class AutoBuildPolicy
    {
        private static double At(double[] arr, int z) =>
            arr != null && z >= 0 && z < arr.Length ? arr[z] : 0;

        private static double CostOf(int z) =>
            z >= 1 && z <= 4 ? EconomyRules.BUILD_COST[z] : 1;

        public static double[] BuildNeeds(int e, double[] cnt)
        {
            var need = new double[5];
            for (int z = 1; z <= 4; z++)
            {
                double c = At(cnt, z);
                double lo = EconomyRules.BuildingLowTiles(e, z);
                double hi = EconomyRules.BuildingHighTiles(e, z);
                need[z] = c < lo ? lo : Math.Min(hi, c);
            }
            return need;
        }

        public static double PendingWeight(int e, double[] cnt, double[] built)
        {
            double w = 0;
            for (int z = 1; z <= 4; z++)
                w += Math.Max(0, At(cnt, z) - At(built, z)) * CostOf(z);
            return w;
        }

        public static BuildGates BuildGatesFor(int e, double[] cnt, double[] built, double[] need,
            double pop, double housingCap, double faithRate, double faithPressure, double housingPressure)
        {
            double qB = EconomyRules.BuildQ(e);
            double farmsBuilt = At(built, 2);
            double indsBuilt = At(built, 3);
            double foodOut = EconomyRules.FoodPerSec(farmsBuilt * qB);
            double foodNeed = EconomyRules.FoodNeed(pop);
            double indOut = EconomyRules.IndustryPerSec(indsBuilt * qB);
            double buildDemand = PendingWeight(e, cnt, built) * EconomyRules.C0 * Math.Pow(1.5, e);

            bool foodOk = foodOut >= foodNeed * 1.05 && foodOut >= (pop + 4) * EconomyRules.R_FOOD;
            double indBase = EconomyRules.IndustryPerSec(Math.Max(1, EconomyRules.BuildingLow(e, 3) * 0.2));
            bool indOk = indOut >= Math.Max(indBase, buildDemand * 1.05);

            double hc = housingCap;
            bool popPress = hc > 0 && pop / hc > housingPressure;
            bool houseShort = At(cnt, 1) < At(need, 1) || popPress || hc <= 0;

            bool farmShort = At(cnt, 2) < At(need, 2) || foodOut < foodNeed;
            bool indShort = At(cnt, 3) < At(need, 3) || indOut < buildDemand;
            bool churchShort = At(cnt, 4) < At(need, 4) || !(faithRate > 0) || faithRate < faithPressure;

            return new BuildGates
            {
                FoodOut = foodOut,
                FoodNeed = foodNeed,
                IndOut = indOut,
                BuildDemand = buildDemand,
                FoodOk = foodOk,
                IndOk = indOk,
                Hc = hc,
                HouseShort = houseShort,
                FarmShort = farmShort,
                IndShort = indShort,
                ChurchShort = churchShort
            };
        }

        public static BuildOrderResult BuildOrder(double[] cnt, double[] need, BuildGates gates, double pop)
        {
            bool noHousing = At(cnt, 1) <= 0;
            bool housingCritical = gates.HouseShort && (gates.Hc <= 0 || pop >= gates.Hc - 0.5);
            bool forceHouse = noHousing || housingCritical;

            var list = new List<string>();
            if (forceHouse) list.Add("house");
            if (gates.FarmShort) list.Add("farm");
            if (gates.IndShort) list.Add("industry");
            if (!forceHouse && gates.FoodOk && gates.IndOk && gates.HouseShort) list.Add("house");
            if (gates.ChurchShort) list.Add("church");

            bool fallbackHouse = gates.HouseShort && (At(cnt, 2) > 0 || gates.FoodOut > 0);

            return new BuildOrderResult
            {
                List = list,
                ForceHouse = forceHouse,
                HousingCritical = housingCritical,
                FallbackHouse = fallbackHouse
            };
        }

        public static AutoBuildDecision Decide(int e, double[] cnt, double[] built, double pop,
            double housingCap, double faithRate, double housingPressure, double faithPressure)
        {
            var need = BuildNeeds(e, cnt);
            var gates = BuildGatesFor(e, cnt, built, need, pop, housingCap, faithRate, faithPressure, housingPressure);
            var order = BuildOrder(cnt, need, gates, pop);
            return new AutoBuildDecision
            {
                Need = need,
                Gates = gates,
                List = order.List,
                ForceHouse = order.ForceHouse,
                HousingCritical = order.HousingCritical,
                FallbackHouse = order.FallbackHouse
            };
        }
    }
}
