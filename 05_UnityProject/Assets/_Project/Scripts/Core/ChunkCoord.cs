using System;

namespace InterimDeity.Core
{
    public readonly struct ChunkCoord : IEquatable<ChunkCoord>
    {
        public readonly int X;
        public readonly int Y;

        public ChunkCoord(int x, int y)
        {
            X = x;
            Y = y;
        }

        public bool Equals(ChunkCoord other) => X == other.X && Y == other.Y;

        public override bool Equals(object obj) => obj is ChunkCoord other && Equals(other);

        public override int GetHashCode() => unchecked(X * 73856093 ^ Y * 19349663);

        public override string ToString() => X + "," + Y;
    }
}
