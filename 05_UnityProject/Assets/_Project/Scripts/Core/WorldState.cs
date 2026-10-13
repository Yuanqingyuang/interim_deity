using System.Collections.Generic;

namespace InterimDeity.Core
{
    public sealed class WorldState
    {
        public int Seed;
        public int TerrainGeneratorVersion;
        public int CurrentEra;
        public Dictionary<ChunkCoord, ChunkData> Chunks;
        public WorldStats Stats;
        public bool TerrainDirty = true;
        public int ScanRevision;

        public readonly long[] BuiltCache = new long[5];
        public readonly long[] ZoneCache = new long[5];
        public bool BuiltCacheValid;
        public bool ZoneCacheValid;

        public WorldState(int seed)
        {
            Seed = seed;
            Chunks = new Dictionary<ChunkCoord, ChunkData>();
            Stats = new WorldStats();
        }
    }
}
