using System;
using InterimDeity.Core;

namespace InterimDeity.World
{
    public struct PlaceResult
    {
        public bool Ok;
        public int X;
        public int Y;
        public int Zone;
    }

    public static class TerrainGenerator
    {
        public const double MaxH = 9;
        public const double MinH = 0.2;
        public const double WaterLevel = 0.75;
        public const int Chunk = ChunkData.Size;
        public const int StartChunks = 4;

        public const double LandRatio = 0.56;
        public const double RidgeStrength = 0.75;
        public const double ElevPct = 0.98;
        public const double SeaLevel = 0.42;

        public const double WaterPlaneY = WaterLevel - 0.04;
        public const double RiverThreshold = 0.50;
        public const double RiverMargin = 0.10;
        public const double RiverBedMax = WaterPlaneY - 0.02;

        public const int LayoutRInd = 6;

        public static double ContinentField(double x, double y, int seed, double d)
        {
            double b = DeterministicNoise.Fbm(x * 0.065, y * 0.065, 4, seed + 7);
            double b2 = DeterministicNoise.Fbm(x * 0.15, y * 0.15, 3, seed + 31);
            double cont = MathUtil.Clamp01((b * 0.8 + b2 * 0.2 - 0.5) * 1.9 + 0.5);
            double dw = MathUtil.Clamp01(d + (DeterministicNoise.Fbm(x * 0.09, y * 0.09, 3, seed + 404) - 0.5) * 0.35);
            return cont * (1 - MathUtil.Smstep(0.55, 1.05, dw));
        }

        public static double LandElevation(double x, double y, int seed, double land)
        {
            double inland = MathUtil.Smstep(0.05, 0.55, land);
            double ridge = DeterministicNoise.RidgedNoise(x * 0.10, y * 0.10, 6, seed + 77);
            double hill = DeterministicNoise.Fbm(x * 0.20, y * 0.20, 4, seed + 123) - 0.5;
            return Math.Max(0, land * 0.30 + inland * 0.25 + ridge * inland * RidgeStrength + hill * 0.10);
        }

        public static double HeightAt(double wx, double wy, int seed)
        {
            Vec2d p = DeterministicNoise.Warp2(wx, wy, seed);
            double d = Math.Sqrt(wx * wx + wy * wy) / 90;
            double cont = ContinentField(p.X, p.Y, seed, d);

            if (cont < SeaLevel)
            {
                double t = MathUtil.Clamp01(cont / Math.Max(1e-6, SeaLevel));
                return MathUtil.Mix(MinH, WaterLevel - 0.06, t);
            }

            double land = MathUtil.Clamp01((cont - SeaLevel) / (1 - SeaLevel));
            double elev = LandElevation(p.X, p.Y, seed, land);
            double eNorm = MathUtil.Clamp01(elev / 1.15);
            return MathUtil.Mix(WaterLevel, MaxH, Math.Pow(eNorm, 1.15));
        }

        public static double RiverAltitudeEnvelope(double h)
        {
            double rise = MathUtil.Smstep(WaterLevel + 0.10, WaterLevel + 0.55, h);
            double fall = 1 - MathUtil.Smstep(2.6, 4.6, h);
            return rise * fall;
        }

        public static double RiverMask(double wx, double wy, int seed)
        {
            Vec2d p = DeterministicNoise.Warp2(wx, wy, seed, 8, 0.05);
            double a = DeterministicNoise.RidgedNoise(p.X * 0.09, p.Y * 0.09, 4, seed + 301);
            double b = DeterministicNoise.Fbm(p.X * 0.04, p.Y * 0.04, 3, seed + 307);
            double env = RiverAltitudeEnvelope(HeightAt(wx, wy, seed));
            if (env <= 0) return 0;
            double line = 1 - Math.Abs(a * 2 - 1);
            double r = Math.Pow(MathUtil.Clamp01(line), 2.2) * (0.35 + b * 0.65) * env;
            double main = 1 - Math.Abs(DeterministicNoise.Fbm(p.X * 0.03, p.Y * 0.03, 3, seed + 41) * 2 - 1);
            r = Math.Max(r, Math.Pow(MathUtil.Clamp01(main), 3.5) * 0.85 * env);
            return MathUtil.Clamp01(r);
        }

        public static double SampleHeight(double wx, double wy, int seed)
        {
            double h = HeightAt(wx, wy, seed);
            double rm = RiverMask(wx, wy, seed);
            if (rm > RiverThreshold && h > WaterLevel - 0.05)
            {
                double k = MathUtil.Clamp01((rm - RiverThreshold) / RiverMargin);
                double bed = WaterLevel - 0.12;
                double mixTo = 0.78 + 0.22 * k;
                h = h * (1 - mixTo) + bed * mixTo;
                if (k >= 1) h = Math.Min(h, RiverBedMax);
            }
            return Math.Min(Math.Max(h, MinH), MaxH);
        }

        public static string TerrainClass(double h)
        {
            if (h <= WaterLevel) return "water";
            if (h < 1.15) return "sand";
            if (h < 2.6) return "plain";
            if (h < 4.6) return "hill";
            if (h < 6.5) return "mountain";
            return "peak";
        }

        public static double MoistureAt(double x, double y, int seed)
        {
            return DeterministicNoise.Fbm(x * 0.07, y * 0.07, 4, seed + 555);
        }

        public static void FillTileFromNoise(TileData t, int x, int y, int seed)
        {
            double h = SampleHeight(x, y, seed);

            double dist = Math.Sqrt((double)x * x + (double)y * y);
            double w = 1 - MathUtil.Smstep(3.2, 5.0, dist);
            if (w > 0 && h > WaterLevel + 0.05)
                h = MathUtil.Mix(h, WaterLevel + 0.95, w * 0.88);

            double hh = Math.Min(Math.Max(h, MinH), MaxH);
            t.IsWater = hh <= WaterLevel;
            if (t.IsWater && hh > WaterPlaneY) hh = WaterPlaneY;
            t.Height = (float)hh;

            t.IsVegetated = false;
            t.Zone = 0; t.BuildProgress = 0; t.IsBuilt = false;
            t.Variant = (byte)((int)(DeterministicNoise.Hash2(x, y, seed + 13) * 3));

            if (!t.IsWater && t.Height > 1.2f && t.Height < 6.0f)
            {
                double m = MoistureAt(x, y, seed);
                if (m > 0.55 && DeterministicNoise.Hash2(x, y, seed + 9) < (m - 0.55) * 1.35)
                    t.IsVegetated = true;
            }
        }

        public static bool EnsureChunk(WorldState G, int cx, int cy)
        {
            var coord = new ChunkCoord(cx, cy);
            if (G.Chunks.ContainsKey(coord)) return false;
            var ch = new ChunkData(coord);
            int seed = G.Seed;
            int x0 = cx * Chunk, y0 = cy * Chunk;
            for (int ly = 0; ly < Chunk; ly++)
                for (int lx = 0; lx < Chunk; lx++)
                    FillTileFromNoise(ch.Tile(lx, ly), x0 + lx, y0 + ly, seed);
            G.Chunks[coord] = ch;
            G.TerrainDirty = true;
            return true;
        }

        public static int EnsureChunkRing(WorldState G, int wx, int wy)
        {
            ChunkCoord c = StateQueries.WorldToChunk(wx, wy);
            int n = 0;
            for (int dy = -1; dy <= 1; dy++)
                for (int dx = -1; dx <= 1; dx++)
                    if (EnsureChunk(G, c.X + dx, c.Y + dy)) n++;
            if (n != 0) G.TerrainDirty = true;
            return n;
        }

        public static void GenWorld(WorldState G)
        {
            int seed = G.Seed;
            foreach (var ch in G.Chunks.Values)
            {
                int x0 = ch.Coord.X * Chunk, y0 = ch.Coord.Y * Chunk;
                for (int ly = 0; ly < Chunk; ly++)
                    for (int lx = 0; lx < Chunk; lx++)
                        FillTileFromNoise(ch.Tile(lx, ly), x0 + lx, y0 + ly, seed);
            }

            for (int y = -3; y <= 3; y++)
                for (int x = -3; x <= 3; x++)
                {
                    TileData t = StateQueries.GetTile(G, x, y);
                    if (t != null) t.IsVegetated = false;
                }

            SeedVillage(G);
            G.TerrainDirty = true;
        }

        private static bool LandNear(WorldState G, int x, int y, out int rx, out int ry)
        {
            for (int r = 0; r <= 6; r++)
                for (int dy = -r; dy <= r; dy++)
                    for (int dx = -r; dx <= r; dx++)
                    {
                        TileData t = StateQueries.GetTile(G, x + dx, y + dy);
                        if (t != null && !t.IsWater && t.Height >= 0.95f && t.Height <= 5.4f)
                        {
                            rx = x + dx; ry = y + dy; return true;
                        }
                    }
            rx = 0; ry = 0; return false;
        }

        public static void SeedVillage(WorldState G)
        {
            int[][] spots =
            {
                new[] { 0, 0, 1 }, new[] { 2, 1, 1 }, new[] { -2, 1, 1 },
                new[] { 1, -2, 1 }, new[] { -1, -2, 1 }, new[] { 0, 2, 2 },
            };
            foreach (int[] s in spots)
            {
                int x = s[0], y = s[1], z = s[2];
                int px, py;
                TileData t0 = StateQueries.GetTile(G, x, y);
                if (t0 != null && !t0.IsWater && t0.Height >= 0.95f && t0.Height <= 5.4f)
                {
                    px = x; py = y;
                }
                else
                {
                    if (!LandNear(G, x, y, out px, out py)) continue;
                }
                TileData t = StateQueries.GetTile(G, px, py);
                if (t == null || t.Zone > 0) continue;
                t.Zone = (byte)z; t.IsBuilt = true; t.BuildProgress = 1; t.IsVegetated = false;
                EnsureChunkRing(G, px, py);
            }
        }

        public static PlaceResult PlaceAt(WorldState G, int x, int y, int zoneType, bool manual)
        {
            PlaceResult fail = default(PlaceResult);
            if (!(zoneType >= 1 && zoneType <= 4)) return fail;
            TileData t = StateQueries.GetTile(G, x, y);
            if (t == null) return fail;
            if (t.IsWater || t.Zone > 0) return fail;
            if (t.Height < 0.95f || t.Height > 5.4f) return fail;
            if (manual)
            {
                if (!CanPlaceZoneManual(G, x, y, zoneType)) return fail;
            }
            else
            {
                if (!CanPlaceZoneAt(G, x, y, zoneType)) return fail;
            }
            t.Zone = (byte)zoneType;
            t.BuildProgress = 0;
            t.IsBuilt = false;
            t.IsVegetated = false;
            EnsureChunkRing(G, x, y);
            ClearTreesNearZones(G, 1, x, y, 2);
            G.TerrainDirty = true;
            StateQueries.InvalidateBuiltCache(G);
            return new PlaceResult { Ok = true, X = x, Y = y, Zone = zoneType };
        }

        public static bool ZoneNeedsGap(int zoneType) => zoneType != 2;

        public static bool CanPlaceZoneManual(WorldState G, int x, int y, int zoneType)
        {
            TileData t = StateQueries.GetTile(G, x, y);
            if (t == null) return false;
            if (t.IsWater || t.Zone > 0) return false;
            if (t.Height < 0.95f || t.Height > 5.4f) return false;
            return true;
        }

        public static bool CanPlaceZoneAt(WorldState G, int x, int y, int zoneType)
        {
            TileData t = StateQueries.GetTile(G, x, y);
            if (t == null) return false;
            if (t.IsWater || t.Zone > 0) return false;
            if (t.Height < 0.95f || t.Height > 5.4f) return false;

            if (zoneType == 2)
            {
                int neighRes = 0, orthRes = 0;
                for (int dy = -1; dy <= 1; dy++)
                    for (int dx = -1; dx <= 1; dx++)
                    {
                        if (dx == 0 && dy == 0) continue;
                        TileData a = StateQueries.GetTile(G, x + dx, y + dy);
                        if (a != null && a.Zone == 1)
                        {
                            neighRes++;
                            if (dx == 0 || dy == 0) orthRes++;
                        }
                    }
                if (neighRes >= 5 || orthRes >= 3) return false;
            }

            if (zoneType == 3)
            {
                int dMin = int.MaxValue;
                for (int dy = -6; dy <= 6; dy++)
                    for (int dx = -6; dx <= 6; dx++)
                    {
                        TileData a = StateQueries.GetTile(G, x + dx, y + dy);
                        if (a != null && a.Zone == 1)
                        {
                            int d = Math.Max(Math.Abs(dx), Math.Abs(dy));
                            if (d < dMin) dMin = d;
                        }
                    }
                if (dMin < LayoutRInd) return false;
            }

            for (int dy = -1; dy <= 1; dy++)
                for (int dx = -1; dx <= 1; dx++)
                {
                    if (dx == 0 && dy == 0) continue;
                    TileData a = StateQueries.GetTile(G, x + dx, y + dy);
                    if (a == null || a.Zone <= 0) continue;
                    if (zoneType == 2 && a.Zone == 2) continue;
                    return false;
                }
            return true;
        }

        public static void ClearTreesNearZones(WorldState G, int radius, int cx, int cy, int span)
        {
            int x0 = cx - span, x1 = cx + span, y0 = cy - span, y1 = cy + span;
            for (int y = y0; y <= y1; y++)
                for (int x = x0; x <= x1; x++)
                {
                    TileData t = StateQueries.GetTile(G, x, y);
                    if (t == null || !t.IsVegetated) continue;
                    bool near = false;
                    for (int dy = -radius; dy <= radius && !near; dy++)
                        for (int dx = -radius; dx <= radius; dx++)
                        {
                            TileData a = StateQueries.GetTile(G, x + dx, y + dy);
                            if (a != null && a.Zone > 0) { near = true; break; }
                        }
                    if (near) { t.IsVegetated = false; G.TerrainDirty = true; }
                }
        }

        public static void ClearTreesNearZones(WorldState G, int radius)
        {
            StateQueries.EachTile(G, (t, x, y) =>
            {
                if (!t.IsVegetated) return;
                bool near = false;
                for (int dy = -radius; dy <= radius && !near; dy++)
                    for (int dx = -radius; dx <= radius; dx++)
                    {
                        TileData a = StateQueries.GetTile(G, x + dx, y + dy);
                        if (a != null && a.Zone > 0) { near = true; break; }
                    }
                if (near) { t.IsVegetated = false; G.TerrainDirty = true; }
            });
        }

        public static double CornerHeightAt(WorldState G, int x, int y)
        {
            TileData t = StateQueries.GetTile(G, x, y);
            return t != null ? t.Height : 0;
        }
    }
}
