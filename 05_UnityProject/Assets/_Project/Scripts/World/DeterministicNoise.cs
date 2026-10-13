using System;
using InterimDeity.Core;

namespace InterimDeity.World
{
    public struct Vec2d
    {
        public double X;
        public double Y;
        public Vec2d(double x, double y) { X = x; Y = y; }
    }

    public static class DeterministicNoise
    {
        public static double Hash2(int x, int y, int seed = 0)
        {
            unchecked
            {
                int h = x * 374761393 + y * 668265263 + seed * 1274126177;
                h = (h ^ (int)((uint)h >> 13)) * 1274126177;
                h = h ^ (int)((uint)h >> 16);
                return (double)((uint)h & 0xffffff) / 16777215.0;
            }
        }

        public static double ValueNoise(double x, double y, int seed = 0)
        {
            int xi = (int)Math.Floor(x);
            int yi = (int)Math.Floor(y);
            double xf = x - xi;
            double yf = y - yi;
            double a = Hash2(xi, yi, seed);
            double b = Hash2(xi + 1, yi, seed);
            double c = Hash2(xi, yi + 1, seed);
            double d = Hash2(xi + 1, yi + 1, seed);
            double u = MathUtil.Smooth(xf);
            double v = MathUtil.Smooth(yf);
            return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
        }

        public static double Fbm(double x, double y, int octaves = 4, int seed = 0)
        {
            double v = 0, amp = 1, freq = 1, max = 0;
            for (int i = 0; i < octaves; i++)
            {
                v += amp * ValueNoise(x * freq, y * freq, seed + i * 17);
                max += amp;
                amp *= 0.5;
                freq *= 2;
            }
            return v / max;
        }

        public static double RidgedNoise(double x, double y, int oct = 5, int seed = 0, double lac = 2.0, double gain = 0.5)
        {
            double v = 0, amp = 1, f = 1, n = 0, prev = 1;
            for (int i = 0; i < oct; i++)
            {
                double q = ValueNoise(x * f, y * f, seed + i * 197);
                q = 1 - Math.Abs(q * 2 - 1);
                q *= q;
                q *= prev;
                prev = Math.Max(q, 0.15);
                v += amp * q; n += amp; amp *= gain; f *= lac;
            }
            return v / n;
        }

        public static Vec2d Warp2(double x, double y, int seed, double strength = 6, double freq = 0.06)
        {
            double wx = Fbm(x * freq + 13.7, y * freq + 5.1, 4, seed + 911);
            double wy = Fbm(x * freq + 47.3, y * freq + 19.6, 4, seed + 1237);
            return new Vec2d(x + (wx - 0.5) * 2 * strength, y + (wy - 0.5) * 2 * strength);
        }
    }

    public sealed class Mulberry32
    {
        private uint _a;

        public Mulberry32(int seed)
        {
            _a = unchecked((uint)seed);
        }

        private static int Imul(int x, int y) => unchecked(x * y);

        public double Next()
        {
            unchecked
            {
                _a = _a + 0x6D2B79F5u;
                int ai = (int)_a;
                int t = Imul(ai ^ (int)((uint)ai >> 15), 1 | ai);
                t = (t + Imul(t ^ (int)((uint)t >> 7), 61 | t)) ^ t;
                return (double)((uint)(t ^ (int)((uint)t >> 14))) / 4294967296.0;
            }
        }

        public static Mulberry32 AutoRng(int seed, long tick, int salt = 0)
        {
            unchecked
            {
                int s = (int)(seed + tick * 9973 + salt);
                return new Mulberry32(s);
            }
        }
    }
}
