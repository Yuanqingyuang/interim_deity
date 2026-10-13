using System;
using InterimDeity.Core;

namespace InterimDeity.World
{
    public static class StateQueries
    {
        public static ChunkCoord WorldToChunk(int x, int y)
        {
            return new ChunkCoord(MathUtil.FloorDiv(x, ChunkData.Size), MathUtil.FloorDiv(y, ChunkData.Size));
        }

        public static TileData GetTile(WorldState G, int x, int y)
        {
            ChunkCoord c = WorldToChunk(x, y);
            ChunkData ch;
            if (!G.Chunks.TryGetValue(c, out ch)) return null;
            int lx = x - c.X * ChunkData.Size;
            int ly = y - c.Y * ChunkData.Size;
            return ch.Tile(lx, ly);
        }

        public static bool TileLive(WorldState G, int x, int y) => GetTile(G, x, y) != null;

        public static void EachTile(WorldState G, Action<TileData, int, int> fn)
        {
            foreach (var ch in G.Chunks.Values)
            {
                int x0 = ch.Coord.X * ChunkData.Size, y0 = ch.Coord.Y * ChunkData.Size;
                for (int ly = 0; ly < ChunkData.Size; ly++)
                    for (int lx = 0; lx < ChunkData.Size; lx++)
                        fn(ch.Tile(lx, ly), x0 + lx, y0 + ly);
            }
        }

        public static long CountBuilt(WorldState G, int zoneType)
        {
            if (G.BuiltCacheValid) return G.BuiltCache[zoneType];
            long n = 0;
            EachTile(G, (t, x, y) => { if (t.Zone == zoneType && t.IsBuilt) n++; });
            return n;
        }

        public static long CountZone(WorldState G, int zoneType)
        {
            if (G.ZoneCacheValid) return G.ZoneCache[zoneType];
            long n = 0;
            EachTile(G, (t, x, y) => { if (t.Zone == zoneType) n++; });
            return n;
        }

        public static void RefreshBuiltCache(WorldState G)
        {
            for (int i = 0; i < 5; i++) { G.BuiltCache[i] = 0; G.ZoneCache[i] = 0; }
            EachTile(G, (t, x, y) =>
            {
                int z = t.Zone;
                if (z <= 0) return;
                G.ZoneCache[z]++;
                if (t.IsBuilt) G.BuiltCache[z]++;
            });
            G.BuiltCacheValid = true;
            G.ZoneCacheValid = true;
        }

        public static void InvalidateBuiltCache(WorldState G)
        {
            G.BuiltCacheValid = false;
            G.ZoneCacheValid = false;
            G.ScanRevision = unchecked(G.ScanRevision + 1);
        }

        public static WorldState CreateState(int seed)
        {
            var G = new WorldState(seed);
            int half = TerrainGenerator.StartChunks / 2;
            for (int cy = -half; cy < half; cy++)
                for (int cx = -half; cx < half; cx++)
                {
                    var coord = new ChunkCoord(cx, cy);
                    G.Chunks[coord] = new ChunkData(coord);
                }
            G.CurrentEra = 0;
            G.TerrainDirty = true;
            return G;
        }
    }
}
