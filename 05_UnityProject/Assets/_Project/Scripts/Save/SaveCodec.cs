using System;
using System.Collections.Generic;
using InterimDeity.Core;
using InterimDeity.Simulation;

namespace InterimDeity.Save
{
    public static class SaveCodec
    {
        public static SaveRoot Capture(WorldState G, bool paused)
        {
            var root = new SaveRoot
            {
                SchemaVersion = SaveSchema.CurrentVersion,
                GameVersion = EraConstants.AppVersion,
                TerrainGeneratorVersion = G.TerrainGeneratorVersion,
                Seed = G.Seed,
                SavedAtUtc = DateTime.UtcNow.ToString("o")
            };

            root.Session.Time = G.Stats.Time;
            root.Session.Speed = G.Stats.Speed;
            root.Session.Paused = paused;
            root.Session.Over = G.Stats.GameOver;
            root.Session.DayTime = G.Stats.DayTime;
            root.Session.BoostGrow = G.Stats.BoostGrow;
            root.Session.BoostBuild = G.Stats.BoostBuild;
            root.Session.BoostRain = G.Stats.BoostRain;

            root.World.Era = G.CurrentEra;
            var ordered = new List<ChunkData>(G.Chunks.Values);
            ordered.Sort((a, b) => a.Coord.Y != b.Coord.Y ? a.Coord.Y - b.Coord.Y : a.Coord.X - b.Coord.X);
            foreach (var ch in ordered)
            {
                var cs = new ChunkSaveData
                {
                    Cx = ch.Coord.X,
                    Cy = ch.Coord.Y,
                    GenerationVersion = ch.GenerationVersion
                };
                for (int ly = 0; ly < ChunkData.Size; ly++)
                    for (int lx = 0; lx < ChunkData.Size; lx++)
                    {
                        var t = ch.Tile(lx, ly);
                        cs.Tiles.Add(new TileSaveData
                        {
                            Height = t.Height,
                            Water = t.IsWater,
                            Tree = t.IsVegetated,
                            Zone = t.Zone,
                            Prog = t.BuildProgress,
                            Built = t.IsBuilt,
                            Variant = t.Variant
                        });
                    }
                root.World.Chunks.Add(cs);
            }

            var st = G.Stats;
            root.Progression.Stars = st.Stars;
            for (int e = 0; e < EraConstants.EraCount; e++)
            {
                var row = new List<int>(3);
                for (int m = 0; m < 3; m++) row.Add(st.StarMilestones[e][m] ? 1 : 0);
                root.Progression.Milestones.Add(row);
            }
            for (int e = 0; e < EraConstants.EraCount; e++) root.Progression.Wonders.Add(st.Wonders[e] ? 1 : 0);
            foreach (var w in st.WonderList)
                root.Progression.WonderList.Add(new WonderSaveData
                {
                    Era = w.Era, X = w.X, Y = w.Y, Prog = w.Progress, Done = w.Done
                });

            root.Economy.Power = st.Power;
            root.Economy.Faith = st.Faith;
            root.Economy.Pop = st.Population;
            root.Economy.TotalFaith = st.TotalFaith;

            return root;
        }

        public static bool TryRestore(SaveRoot root, out WorldState G, out bool paused, out string error)
        {
            G = null;
            paused = false;
            error = null;
            if (root == null) { error = "存档对象为空"; return false; }

            if (root.World == null || root.World.Chunks == null || root.World.Chunks.Count == 0)
            {
                error = "存档缺少区块数据";
                return false;
            }
            if (root.World.Chunks.Count > SaveSchema.MaxSaveChunks)
            {
                error = "区块数量超出上限";
                return false;
            }

            var world = new WorldState(root.Seed)
            {
                TerrainGeneratorVersion = root.TerrainGeneratorVersion,
                CurrentEra = MathUtil.ClampInt(root.World.Era, 0, EraConstants.EraCount - 1)
            };

            var seen = new HashSet<ChunkCoord>();
            foreach (var cs in root.World.Chunks)
            {
                if (cs == null) { error = "区块为空"; return false; }
                if (cs.Cx < -SaveSchema.MaxChunkCoord || cs.Cx > SaveSchema.MaxChunkCoord ||
                    cs.Cy < -SaveSchema.MaxChunkCoord || cs.Cy > SaveSchema.MaxChunkCoord)
                {
                    error = "区块坐标超出范围";
                    return false;
                }
                var coord = new ChunkCoord(cs.Cx, cs.Cy);
                if (!seen.Add(coord)) { error = "重复区块坐标 " + coord; return false; }
                if (cs.Tiles == null || cs.Tiles.Count != ChunkData.TileCount)
                {
                    error = "区块 " + coord + " 地块数量非法";
                    return false;
                }

                var chunk = new ChunkData(coord) { GenerationVersion = cs.GenerationVersion };
                for (int i = 0; i < ChunkData.TileCount; i++)
                {
                    var src = cs.Tiles[i];
                    if (src == null) { error = "地块为空"; return false; }
                    var t = chunk.Tiles[i];
                    t.Height = ClampHeight(src.Height);
                    t.IsWater = src.Water;
                    t.IsVegetated = src.Tree;
                    t.Zone = (byte)MathUtil.ClampInt(src.Zone, 0, 4);
                    t.BuildProgress = (float)MathUtil.Clamp(src.Prog, 0, 1);
                    t.IsBuilt = src.Built;
                    t.Variant = (byte)MathUtil.ClampInt(src.Variant, 0, 255);
                }
                world.Chunks[coord] = chunk;
            }

            var st = world.Stats;
            var s = root.Session ?? new SessionSaveData();
            st.Time = NonNeg(s.Time);
            st.Speed = NormalizeSpeed(s.Speed);
            st.DayTime = Wrap01(s.DayTime);
            st.BoostGrow = NonNeg(s.BoostGrow);
            st.BoostBuild = NonNeg(s.BoostBuild);
            st.BoostRain = NonNeg(s.BoostRain);
            st.GameOver = s.Over;
            paused = s.Paused;

            var p = root.Progression ?? new ProgressionSaveData();
            st.Stars = MathUtil.ClampInt(p.Stars, 0, 1000000);
            for (int e = 0; e < EraConstants.EraCount; e++)
            {
                var row = p.Milestones != null && e < p.Milestones.Count ? p.Milestones[e] : null;
                for (int m = 0; m < 3; m++)
                    st.StarMilestones[e][m] = row != null && m < row.Count && row[m] != 0;
            }
            for (int e = 0; e < EraConstants.EraCount; e++)
                st.Wonders[e] = p.Wonders != null && e < p.Wonders.Count && p.Wonders[e] != 0;
            st.WonderList.Clear();
            if (p.WonderList != null)
            {
                int n = Math.Min(p.WonderList.Count, SaveSchema.MaxWonderList);
                for (int i = 0; i < n; i++)
                {
                    var w = p.WonderList[i];
                    if (w == null) continue;
                    st.WonderList.Add(new WonderEntry
                    {
                        Era = MathUtil.ClampInt(w.Era, 0, EraConstants.EraCount - 1),
                        X = MathUtil.ClampInt(w.X, -100000, 100000),
                        Y = MathUtil.ClampInt(w.Y, -100000, 100000),
                        Progress = (float)MathUtil.Clamp(w.Prog, 0, 1),
                        Done = w.Done
                    });
                }
            }

            var ec = root.Economy ?? new EconomySaveData();
            st.Power = MathUtil.Clamp(NonNeg(ec.Power), 0, SaveSchema.NumHi);
            st.Faith = MathUtil.Clamp(NonNeg(ec.Faith), 0, SaveSchema.NumHi);
            double fcap = EraConstants.FaithCapOf(world.CurrentEra);
            if (st.Faith > fcap) st.Faith = fcap;
            st.TotalFaith = MathUtil.Clamp(NonNeg(ec.TotalFaith), 0, SaveSchema.NumHi);
            st.Population = MathUtil.Clamp(NonNeg(ec.Pop), 0, SaveSchema.NumHi);

            world.TerrainDirty = true;
            world.BuiltCacheValid = false;
            world.ZoneCacheValid = false;

            G = world;
            return true;
        }

        public static string Serialize(SaveRoot root)
        {
            if (root == null) throw new JsonException("null save root");
            var b = new JsonBuilder();
            WriteRoot(b, root);
            return b.ToString();
        }

        public static SaveRoot Deserialize(string json)
        {
            JsonValue v = JsonParser.Parse(json);
            return FromJsonValue(v);
        }

        public static bool TryLoadWorld(string json, out WorldState G, out bool paused, out string error)
        {
            G = null;
            paused = false;
            error = null;
            SaveRoot root;
            try
            {
                root = Deserialize(json);
            }
            catch (Exception ex)
            {
                error = ex.Message;
                return false;
            }
            return TryRestore(root, out G, out paused, out error);
        }

        private static void WriteRoot(JsonBuilder b, SaveRoot r)
        {
            b.ObjectStart();
            b.Key("schemaVersion").Number(r.SchemaVersion);
            b.Key("gameVersion").String(r.GameVersion ?? "");
            b.Key("terrainGeneratorVersion").Number(r.TerrainGeneratorVersion);
            b.Key("seed").Number(r.Seed);
            b.Key("savedAtUtc").String(r.SavedAtUtc ?? "");

            b.Key("session").ObjectStart();
            b.Key("time").Number(r.Session.Time);
            b.Key("speed").Number(r.Session.Speed);
            b.Key("paused").Bool(r.Session.Paused);
            b.Key("over").Bool(r.Session.Over);
            b.Key("dayTime").Number(r.Session.DayTime);
            b.Key("boostGrow").Number(r.Session.BoostGrow);
            b.Key("boostBuild").Number(r.Session.BoostBuild);
            b.Key("boostRain").Number(r.Session.BoostRain);
            b.ObjectEnd();

            b.Key("world").ObjectStart();
            b.Key("era").Number(r.World.Era);
            b.Key("chunks").ArrayStart();
            foreach (var c in r.World.Chunks)
            {
                b.ObjectStart();
                b.Key("cx").Number(c.Cx);
                b.Key("cy").Number(c.Cy);
                b.Key("generationVersion").Number(c.GenerationVersion);
                b.Key("tiles").ArrayStart();
                foreach (var t in c.Tiles)
                {
                    if (t.IsUndeveloped) b.Number(ClampHeight(t.Height));
                    else
                    {
                        b.ArrayStart();
                        b.Number(ClampHeight(t.Height));
                        b.Number(t.Water ? 1 : 0);
                        b.Number(t.Tree ? 1 : 0);
                        b.Number(MathUtil.ClampInt(t.Zone, 0, 4));
                        b.Number((float)MathUtil.Clamp(t.Prog, 0, 1));
                        b.Number(t.Built ? 1 : 0);
                        b.Number(MathUtil.ClampInt(t.Variant, 0, 255));
                        b.ArrayEnd();
                    }
                }
                b.ArrayEnd();
                b.ObjectEnd();
            }
            b.ArrayEnd();
            b.ObjectEnd();

            b.Key("progression").ObjectStart();
            b.Key("stars").Number(r.Progression.Stars);
            b.Key("milestones").ArrayStart();
            foreach (var row in r.Progression.Milestones)
            {
                b.ArrayStart();
                foreach (var m in row) b.Number(m != 0 ? 1 : 0);
                b.ArrayEnd();
            }
            b.ArrayEnd();
            b.Key("wonders").ArrayStart();
            foreach (var w in r.Progression.Wonders) b.Number(w != 0 ? 1 : 0);
            b.ArrayEnd();
            b.Key("wonderList").ArrayStart();
            foreach (var w in r.Progression.WonderList)
            {
                b.ObjectStart();
                b.Key("era").Number(w.Era);
                b.Key("x").Number(w.X);
                b.Key("y").Number(w.Y);
                b.Key("prog").Number((float)MathUtil.Clamp(w.Prog, 0, 1));
                b.Key("done").Bool(w.Done);
                b.ObjectEnd();
            }
            b.ArrayEnd();
            b.ObjectEnd();

            b.Key("economy").ObjectStart();
            b.Key("power").Number(r.Economy.Power);
            b.Key("faith").Number(r.Economy.Faith);
            b.Key("pop").Number(r.Economy.Pop);
            b.Key("totalFaith").Number(r.Economy.TotalFaith);
            b.ObjectEnd();

            b.Key("narrative").ObjectStart();
            b.Key("storyFlags").ObjectStart();
            foreach (var f in r.Narrative.StoryFlags)
                if (f != null) b.Key(f.Key ?? "").Bool(f.Value);
            b.ObjectEnd();
            b.Key("archiveUnlocked").ArrayStart();
            foreach (var a in r.Narrative.ArchiveUnlocked) b.String(a ?? "");
            b.ArrayEnd();
            b.ObjectEnd();

            b.ObjectEnd();
        }

        private static SaveRoot FromJsonValue(JsonValue root)
        {
            if (root == null || root.Kind != JsonKind.Object)
                throw new JsonException("存档根必须是对象");

            JsonValue sv;
            if (!root.TryGet("schemaVersion", out sv) || sv.Kind != JsonKind.Number)
                throw new JsonException("缺少 schemaVersion");
            int schema = (int)sv.NumberValue;
            if (schema != SaveSchema.CurrentVersion)
                throw new JsonException("不支持的存档版本 " + schema);

            var r = new SaveRoot { SchemaVersion = schema };
            r.GameVersion = Str(root, "gameVersion", "");
            r.TerrainGeneratorVersion = IntV(root, "terrainGeneratorVersion", 0);
            r.Seed = IntV(root, "seed", 0);
            r.SavedAtUtc = Str(root, "savedAtUtc", "");

            JsonValue v;
            if (root.TryGet("session", out v) && v.Kind == JsonKind.Object)
            {
                r.Session.Time = MathUtil.Clamp(Num(v, "time", 0), 0, SaveSchema.NumHi);
                r.Session.Speed = IntV(v, "speed", SaveSchema.SpeedDefault);
                r.Session.Paused = BoolV(v, "paused", false);
                r.Session.Over = BoolV(v, "over", false);
                r.Session.DayTime = Num(v, "dayTime", SaveSchema.DayTimeDefault);
                r.Session.BoostGrow = Num(v, "boostGrow", 0);
                r.Session.BoostBuild = Num(v, "boostBuild", 0);
                r.Session.BoostRain = Num(v, "boostRain", 0);
            }

            JsonValue worldV;
            if (!root.TryGet("world", out worldV) || worldV.Kind != JsonKind.Object)
                throw new JsonException("缺少 world 段");
            r.World.Era = IntV(worldV, "era", 0);
            JsonValue chunksV;
            if (!worldV.TryGet("chunks", out chunksV) || chunksV.Kind != JsonKind.Array)
                throw new JsonException("缺少 world.chunks");
            if (chunksV.ArrayValue.Count == 0)
                throw new JsonException("world.chunks 为空");
            if (chunksV.ArrayValue.Count > SaveSchema.MaxSaveChunks)
                throw new JsonException("区块数量超出上限");

            var coords = new HashSet<ChunkCoord>();
            foreach (var cv in chunksV.ArrayValue)
            {
                if (cv == null || cv.Kind != JsonKind.Object) throw new JsonException("区块项非法");
                int cx = IntV(cv, "cx", int.MinValue);
                int cy = IntV(cv, "cy", int.MinValue);
                if (cx == int.MinValue || cy == int.MinValue) throw new JsonException("区块缺少坐标");
                if (cx < -SaveSchema.MaxChunkCoord || cx > SaveSchema.MaxChunkCoord ||
                    cy < -SaveSchema.MaxChunkCoord || cy > SaveSchema.MaxChunkCoord)
                    throw new JsonException("区块坐标超出范围");
                if (!coords.Add(new ChunkCoord(cx, cy))) throw new JsonException("重复区块坐标 " + cx + "," + cy);

                var cs = new ChunkSaveData { Cx = cx, Cy = cy, GenerationVersion = IntV(cv, "generationVersion", 0) };
                JsonValue tilesV;
                if (!cv.TryGet("tiles", out tilesV) || tilesV.Kind != JsonKind.Array)
                    throw new JsonException("区块缺少 tiles");
                if (tilesV.ArrayValue.Count != ChunkData.TileCount)
                    throw new JsonException("区块 tiles 数量非法");
                foreach (var tv in tilesV.ArrayValue) cs.Tiles.Add(ReadTile(tv));
                r.World.Chunks.Add(cs);
            }

            if (root.TryGet("progression", out v) && v.Kind == JsonKind.Object)
            {
                r.Progression.Stars = IntV(v, "stars", 0);
                JsonValue msV;
                if (v.TryGet("milestones", out msV) && msV.Kind == JsonKind.Array)
                {
                    foreach (var rowV in msV.ArrayValue)
                    {
                        var row = new List<int>(3);
                        if (rowV != null && rowV.Kind == JsonKind.Array)
                            foreach (var mv in rowV.ArrayValue) row.Add(RoundInt(mv));
                        r.Progression.Milestones.Add(row);
                    }
                }
                JsonValue wV;
                if (v.TryGet("wonders", out wV) && wV.Kind == JsonKind.Array)
                    foreach (var wv in wV.ArrayValue) r.Progression.Wonders.Add(RoundInt(wv));
                JsonValue wlV;
                if (v.TryGet("wonderList", out wlV) && wlV.Kind == JsonKind.Array)
                {
                    foreach (var itemV in wlV.ArrayValue)
                    {
                        if (itemV == null || itemV.Kind != JsonKind.Object) continue;
                        r.Progression.WonderList.Add(new WonderSaveData
                        {
                            Era = IntV(itemV, "era", 0),
                            X = IntV(itemV, "x", 0),
                            Y = IntV(itemV, "y", 0),
                            Prog = (float)Num(itemV, "prog", 0),
                            Done = BoolV(itemV, "done", false)
                        });
                    }
                }
            }

            if (root.TryGet("economy", out v) && v.Kind == JsonKind.Object)
            {
                r.Economy.Power = Num(v, "power", 0);
                r.Economy.Faith = Num(v, "faith", 0);
                r.Economy.Pop = Num(v, "pop", SaveSchema.PopDefault);
                r.Economy.TotalFaith = Num(v, "totalFaith", 0);
            }

            if (root.TryGet("narrative", out v) && v.Kind == JsonKind.Object)
            {
                JsonValue sfV;
                if (v.TryGet("storyFlags", out sfV) && sfV.Kind == JsonKind.Object)
                    foreach (var kv in sfV.ObjectValue)
                        r.Narrative.StoryFlags.Add(new StoryFlagEntry { Key = kv.Key, Value = kv.Value != null && kv.Value.Kind == JsonKind.Bool && kv.Value.BoolValue });
                JsonValue auV;
                if (v.TryGet("archiveUnlocked", out auV) && auV.Kind == JsonKind.Array)
                    foreach (var av in auV.ArrayValue)
                        if (av != null && av.Kind == JsonKind.String) r.Narrative.ArchiveUnlocked.Add(av.StringValue);
            }

            return r;
        }

        private static TileSaveData ReadTile(JsonValue v)
        {
            var t = new TileSaveData();
            if (v == null || v.Kind == JsonKind.Null) { t.Height = TileData.MinHeight; return t; }
            if (v.Kind == JsonKind.Number)
            {
                t.Height = ClampHeight((float)v.NumberValue);
                return t;
            }
            if (v.Kind == JsonKind.Array)
            {
                var a = v.ArrayValue;
                if (a.Count != 7) throw new JsonException("地块元组必须为 7 元素");
                t.Height = ClampHeight((float)NumAt(a, 0, TileData.MinHeight));
                t.Water = BoolAt(a, 1, false);
                t.Tree = BoolAt(a, 2, false);
                t.Zone = (int)MathUtil.Clamp(NumAt(a, 3, 0), 0, 4);
                t.Prog = (float)MathUtil.Clamp(NumAt(a, 4, 0), 0, 1);
                t.Built = BoolAt(a, 5, false);
                t.Variant = (int)MathUtil.Clamp(NumAt(a, 6, 0), 0, 255);
                return t;
            }
            throw new JsonException("非法地块值");
        }

        private static double NumAt(List<JsonValue> a, int i, double def)
        {
            if (a == null || i >= a.Count) return def;
            var v = a[i];
            if (v == null || v.Kind != JsonKind.Number) return def;
            double d = v.NumberValue;
            return double.IsNaN(d) || double.IsInfinity(d) ? def : d;
        }

        private static bool BoolAt(List<JsonValue> a, int i, bool def)
        {
            if (a == null || i >= a.Count) return def;
            var v = a[i];
            if (v == null) return def;
            if (v.Kind == JsonKind.Bool) return v.BoolValue;
            if (v.Kind == JsonKind.Number) return v.NumberValue != 0;
            return def;
        }

        private static int RoundInt(JsonValue v)
        {
            if (v == null || v.Kind != JsonKind.Number) return 0;
            double d = v.NumberValue;
            if (double.IsNaN(d) || double.IsInfinity(d)) return 0;
            return MathUtil.RoundJs(d);
        }

        private static double Num(JsonValue obj, string key, double def)
        {
            JsonValue v;
            if (!obj.TryGet(key, out v) || v == null || v.Kind != JsonKind.Number) return def;
            double d = v.NumberValue;
            return double.IsNaN(d) || double.IsInfinity(d) ? def : d;
        }

        private static int IntV(JsonValue obj, string key, int def)
        {
            return (int)Num(obj, key, def);
        }

        private static bool BoolV(JsonValue obj, string key, bool def)
        {
            JsonValue v;
            if (!obj.TryGet(key, out v) || v == null) return def;
            if (v.Kind == JsonKind.Bool) return v.BoolValue;
            if (v.Kind == JsonKind.Number) return v.NumberValue != 0;
            return def;
        }

        private static string Str(JsonValue obj, string key, string def)
        {
            JsonValue v;
            if (!obj.TryGet(key, out v) || v == null || v.Kind != JsonKind.String) return def;
            return v.StringValue;
        }

        private static float ClampHeight(float h)
        {
            if (float.IsNaN(h) || float.IsInfinity(h)) return TileData.MinHeight;
            if (h < TileData.MinHeight) return TileData.MinHeight;
            if (h > TileData.MaxHeight) return TileData.MaxHeight;
            return h;
        }

        private static int NormalizeSpeed(int s) => s == 1 || s == 2 || s == 4 ? s : SaveSchema.SpeedDefault;

        private static double NonNeg(double v) => double.IsNaN(v) || double.IsInfinity(v) ? 0 : (v < 0 ? 0 : v);

        private static double Wrap01(double v)
        {
            if (double.IsNaN(v) || double.IsInfinity(v)) return SaveSchema.DayTimeDefault;
            double m = v % 1;
            if (m < 0) m += 1;
            return m;
        }
    }
}
