// 《实习神明》Gameplay 层 · 固定步长时钟
//
// 为什么需要固定步长（对应任务清单 M6-04）：
//   Web 版把 `dt` 直接喂给 tick，虽然钳制到 ≤0.05s，但**仍与帧率耦合** ——
//   已知后果是 `autoRng(G, salt)` 依赖 `G.time`（dt 累加），使**城市演化在不同帧率下不可复现**
//   （Web 侧已登记为缺陷 R-5）。
//   Unity 侧改用**固定步长累加器**：模拟只以 fixedDt 的整数倍推进，
//   于是「同样的墙钟时长 → 同样的模拟步数 → 同样的演化序列」，与帧率彻底解耦。
//
// 语义（与 Web 对齐并明确化）：
//   · 暂停：不推进模拟，但返回的 frameDt 仍可用于表现层（昼夜/云在 Web 里暂停时**仍变化**）
//   · 倍速：`Speed` 缩放**经济时间**（gdt），不缩放昼夜时间（wdt）—— Web 侧 `loop()` 即如此
//   · 追赶上限：单帧最多补 MaxCatchUpSteps 步，避免卡顿后「追帧雪崩」
using System.Collections.Generic;

namespace InterimDeity.Gameplay
{
    /// <summary>一次 Advance 的结果：本帧应当推进多少模拟步、表现时间走了多少。</summary>
    public struct ClockAdvance
    {
        /// <summary>本帧要执行的固定步数（0 表示无需推进）。</summary>
        public int Steps;
        /// <summary>固定步长（秒）。</summary>
        public double FixedDt;
        /// <summary>表现层用的帧时间（秒）——**不受暂停影响**，用于昼夜/云/水面。</summary>
        public double FrameDt;
        /// <summary>本帧因追赶上限而丢弃的步数（>0 说明模拟落后于墙钟）。</summary>
        public int DroppedSteps;
    }

    /// <summary>
    /// 固定步长时钟。调用方每帧传入墙钟增量，取回应当执行的固定步数。
    /// </summary>
    public sealed class GameClock
    {
        /// <summary>默认固定步长：1/30 秒（与 Web 的 `Math.floor(G.time*2)` 采样粒度相容）。</summary>
        public const double DefaultFixedDt = 1.0 / 30.0;

        /// <summary>单帧最多补的步数（防止长时间卡顿后一次补上千步）。</summary>
        public const int DefaultMaxCatchUpSteps = 6;

        /// <summary>
        /// 单帧墙钟上限（秒）。取 0.25s（≈4fps 的帧时间）以覆盖低帧率与偶发卡顿；
        /// 见 <see cref="Advance"/> 的说明——上限过小会静默丢时间。
        /// </summary>
        public const double DefaultMaxFrameDt = 0.25;

        private double _accumulator;

        public double FixedDt { get; }
        public int MaxCatchUpSteps { get; }
        public bool Paused { get; private set; }

        /// <summary>倍速（1/2/4 …）。Web 侧 `G.speed` 默认 2。</summary>
        public int Speed { get; set; } = 2;

        /// <summary>累计的**模拟时间**（秒）——即 Web 的 `G.time`，用于 autoRng 等确定性采样。</summary>
        public double SimTime { get; private set; }

        /// <summary>累计步数（确定性且与帧率无关，可作为演化序列的权威计数）。</summary>
        public long StepCount { get; private set; }

        public GameClock(double fixedDt = DefaultFixedDt, int maxCatchUpSteps = DefaultMaxCatchUpSteps)
        {
            FixedDt = fixedDt > 0 ? fixedDt : DefaultFixedDt;
            MaxCatchUpSteps = maxCatchUpSteps > 0 ? maxCatchUpSteps : DefaultMaxCatchUpSteps;
        }

        public void SetPaused(bool paused) => Paused = paused;
        public void TogglePause() => Paused = !Paused;

        /// <summary>把时钟重置到指定模拟时间（读档后调用，保证 `SimTime` 与存档一致）。</summary>
        public void ResetTo(double simTime, long stepCount = 0)
        {
            SimTime = simTime < 0 ? 0 : simTime;
            StepCount = stepCount < 0 ? 0 : stepCount;
            _accumulator = 0;
        }

        /// <summary>
        /// 推进一帧。
        /// </summary>
        /// <param name="frameDt">墙钟增量（秒）。内部先钳制到 [0, MaxFrameDt]。</param>
        /// <param name="maxFrameDt">
        /// 单帧墙钟上限，默认 <see cref="DefaultMaxFrameDt"/>（0.25s）。
        /// **此值必须大于预期的最差帧时间**，否则会静默丢弃时间、破坏与帧率的解耦：
        /// 实测 15fps（frameDt = 1/15 ≈ 0.0667s）配 0.05 上限时，每帧丢 0.0167s，
        /// 1 秒下来只推进 22 步而非 30 步。
        /// 取 0.25s 而非 Web 的 0.05s：0.05 只够 20fps，低于此的合法帧率都会被削；
        /// 而"切回窗口后一次性补算巨量时间"的防护由 <see cref="MaxCatchUpSteps"/> 承担，
        /// 不需要靠压低 frameDt 上限来实现。
        /// </param>
        public ClockAdvance Advance(double frameDt, double maxFrameDt = DefaultMaxFrameDt)
        {
            var result = new ClockAdvance();
            double clamped = frameDt;
            if (clamped < 0) clamped = 0;
            if (clamped > maxFrameDt) clamped = maxFrameDt;

            // 表现层时间：**不受暂停与倍速影响**
            result.FrameDt = clamped;
            result.FixedDt = FixedDt;

            if (Paused || clamped <= 0)
            {
                result.Steps = 0;
                return result;
            }

            // 经济时间 = 墙钟 × 倍速
            int speed = Speed < 0 ? 0 : Speed;
            _accumulator += clamped * speed;

            int steps = 0;
            while (_accumulator >= FixedDt && steps < MaxCatchUpSteps)
            {
                _accumulator -= FixedDt;
                steps++;
            }

            // 追赶上限触发：丢弃剩余累积，避免"欠账"无限增长
            if (_accumulator >= FixedDt)
            {
                result.DroppedSteps = (int)(_accumulator / FixedDt);
                _accumulator = 0;
            }

            result.Steps = steps;
            SimTime += steps * FixedDt;
            StepCount += steps;
            return result;
        }

        /// <summary>
        /// 取用于确定性随机的时间刻度 —— 与 Web `autoRng` 的 `Math.floor(G.time * 2)` 同式。
        /// Unity 侧应优先用 <see cref="StepCount"/>（分辨率更高且与帧率无关）。
        /// </summary>
        public long AutoRngTick => (long)System.Math.Floor(SimTime * 2.0);
    }
}
