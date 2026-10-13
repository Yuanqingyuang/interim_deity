using System;

namespace InterimDeity.Core
{
    public static class MathUtil
    {
        public static double Clamp01(double v) => v < 0 ? 0 : (v > 1 ? 1 : v);

        public static double Clamp(double v, double lo, double hi) => v < lo ? lo : (v > hi ? hi : v);

        public static int ClampInt(int v, int lo, int hi) => v < lo ? lo : (v > hi ? hi : v);

        public static double Mix(double a, double b, double t) => a + (b - a) * t;

        public static double Smstep(double a, double b, double x)
        {
            double d = b - a;
            double t = d == 0 ? (x < a ? 0 : 1) : (x - a) / d;
            t = Clamp01(t);
            return t * t * (3 - 2 * t);
        }

        public static double Smooth(double t) => t * t * (3 - 2 * t);

        public static int RoundJs(double x) => (int)Math.Floor(x + 0.5);

        public static int Trunc(double x) => (int)x;

        public static int FloorDiv(int a, int b)
        {
            int q = a / b;
            if ((a % b != 0) && ((a < 0) != (b < 0))) q--;
            return q;
        }
    }
}
