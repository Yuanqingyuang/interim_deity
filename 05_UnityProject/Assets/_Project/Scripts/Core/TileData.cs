namespace InterimDeity.Core
{
    public sealed class TileData
    {
        public const float MinHeight = 0.2f;
        public const float MaxHeight = 9f;

        public float Height = MinHeight;
        public bool IsWater;
        public bool IsVegetated;
        public byte Zone;
        public float BuildProgress;
        public bool IsBuilt;
        public byte Variant;
    }
}
