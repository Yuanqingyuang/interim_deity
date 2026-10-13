using System;

namespace InterimDeity.Core
{
    public readonly struct TileCoord : IEquatable<TileCoord>
    {
        public readonly int X;
        public readonly int Y;

        public TileCoord(int x, int y)
        {
            X = x;
            Y = y;
        }

        public bool Equals(TileCoord other) => X == other.X && Y == other.Y;

        public override bool Equals(object obj) => obj is TileCoord other && Equals(other);

        public override int GetHashCode() => unchecked(X * 73856093 ^ Y * 19349663);

        public override string ToString() => X + "," + Y;
    }
}
