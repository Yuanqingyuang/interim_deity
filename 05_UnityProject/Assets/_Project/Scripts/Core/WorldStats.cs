using System.Collections.Generic;

namespace InterimDeity.Core
{
    public sealed class WonderEntry
    {
        public int Era;
        public int X;
        public int Y;
        public float Progress;
        public bool Done;
    }

    public sealed class WorldStats
    {
        public double Population = 20;
        public int Stars;
        public double Faith;
        public double TotalFaith;
        public double Power = 100;
        public double FaithRate;
        public double StarProgress;
        public int Speed = 2;
        public bool GameOver;
        public double Time;
        public double DayTime = 0.35;
        public double BoostGrow;
        public double BoostBuild;
        public double BoostRain;

        public readonly bool[] Wonders = new bool[5];
        public readonly bool[][] StarMilestones = new bool[5][];
        public readonly List<WonderEntry> WonderList = new List<WonderEntry>();

        public WorldStats()
        {
            for (int e = 0; e < 5; e++) StarMilestones[e] = new bool[3];
        }
    }
}
