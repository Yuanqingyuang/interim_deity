namespace InterimDeity.Core
{
    public sealed class ChunkData
    {
        public const int Size = 10;
        public const int TileCount = Size * Size;

        public ChunkCoord Coord;
        public TileData[] Tiles;
        public int GenerationVersion;

        public ChunkData(ChunkCoord coord)
        {
            Coord = coord;
            Tiles = new TileData[TileCount];
            for (int i = 0; i < TileCount; i++) Tiles[i] = new TileData();
        }

        public int Index(int lx, int ly) => ly * Size + lx;

        public TileData Tile(int lx, int ly) => Tiles[Index(lx, ly)];
    }
}
