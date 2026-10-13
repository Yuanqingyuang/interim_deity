using System.Collections.Generic;

namespace InterimDeity.Save
{
    public static class SaveSchema
    {
        public const int CurrentVersion = 1;
        public const int MaxSaveChunks = 4096;
        public const int MaxChunkCoord = 4096;
        public const int MaxWonderList = 64;
        public const double NumHi = 1e12;
        public const int SpeedDefault = 2;
        public const double PopDefault = 20;
        public const double DayTimeDefault = 0.35;
    }

    public sealed class SaveRoot
    {
        public int SchemaVersion = SaveSchema.CurrentVersion;
        public string GameVersion;
        public int TerrainGeneratorVersion;
        public int Seed;
        public string SavedAtUtc = "";
        public SessionSaveData Session = new SessionSaveData();
        public WorldSaveData World = new WorldSaveData();
        public ProgressionSaveData Progression = new ProgressionSaveData();
        public EconomySaveData Economy = new EconomySaveData();
        public NarrativeSaveData Narrative = new NarrativeSaveData();
    }

    public sealed class SessionSaveData
    {
        public double Time;
        public int Speed = SaveSchema.SpeedDefault;
        public bool Paused;
        public bool Over;
        public double DayTime = SaveSchema.DayTimeDefault;
        public double BoostGrow;
        public double BoostBuild;
        public double BoostRain;
    }

    public sealed class WorldSaveData
    {
        public int Era;
        public List<ChunkSaveData> Chunks = new List<ChunkSaveData>();
    }

    public sealed class ChunkSaveData
    {
        public int Cx;
        public int Cy;
        public int GenerationVersion;
        public List<TileSaveData> Tiles = new List<TileSaveData>();
    }

    public sealed class TileSaveData
    {
        public float Height;
        public bool Water;
        public bool Tree;
        public int Zone;
        public float Prog;
        public bool Built;
        public int Variant;

        public bool IsUndeveloped =>
            !Water && !Tree && Zone == 0 && Variant == 0 && !Built && Prog == 0;
    }

    public sealed class ProgressionSaveData
    {
        public int Stars;
        public List<List<int>> Milestones = new List<List<int>>();
        public List<int> Wonders = new List<int>();
        public List<WonderSaveData> WonderList = new List<WonderSaveData>();
    }

    public sealed class WonderSaveData
    {
        public int Era;
        public int X;
        public int Y;
        public float Prog;
        public bool Done;
    }

    public sealed class EconomySaveData
    {
        public double Power;
        public double Faith;
        public double Pop = SaveSchema.PopDefault;
        public double TotalFaith;
    }

    public sealed class NarrativeSaveData
    {
        public List<StoryFlagEntry> StoryFlags = new List<StoryFlagEntry>();
        public List<string> ArchiveUnlocked = new List<string>();
    }

    public sealed class StoryFlagEntry
    {
        public string Key;
        public bool Value;
    }
}
