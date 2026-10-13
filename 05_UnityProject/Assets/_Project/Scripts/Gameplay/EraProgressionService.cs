// 《实习神明》Gameplay 层 · 时代进阶编排
//
// 移植 Web `main.js` 的 `eraReady()` + `advanceEra()`。
//
// Web 原始实现：
//     function eraReady(){ ensureBuiltCache(); return eraReadyOf(G); }        // 纯查询
//     function advanceEra(){
//       const ready = eraReadiness(G);
//       if(!ready.ok){ toast('进阶条件未满足：' + ready.reasons.join('、')); return; }  // 失败 → 状态不动
//       const { name } = applyEraAdvance(G);        // 状态迁移（在 progression.js）
//       R.applyEraVisuals(G); R.syncWorld(G); syncNpc(); ...粒子/音效/toast   // 表现层
//     }
//
// 权威来源：门槛判定与状态迁移**一律复用** `Simulation.ProgressionRules`
// （`EvaluateReadiness` / `ApplyEraAdvance`），本服务**不复制第二套门槛计算**。
//
// ── 关于「时代进阶是否由 tick 驱动」──
// Web 侧 `advanceEra` 是**玩家点击触发**的（UI 按钮），不在 tick 循环内；tick 只做
// `checkStarMilestones`（里程碑领星，已由 `EconomyTickService` 步骤 11 覆盖）。
// 因此本服务**不接入 tick 自动触发**，只提供「玩家请求进阶」这一入口 ——
// 若擅自让 tick 自动进阶，会与 Web 的玩法节奏不符（玩家失去"何时进阶"的决策权）。
//
// ── 关于「最小必要补足」──
// Web `applyEraAdvance` 除了 `stars/era/starProg/terrainDirty` 之外，还额外清了四个
// **输入态**残留：`placingWonder / painting / panning / hover`，理由是
// "进阶前若点过奇迹按钮或正卡着 painting，新时代表格会继续被雕刻，且奇迹按钮会永久停留在放置中样式"。
//
// C# 的 `ProgressionRules.ApplyEraAdvance` **没有**这些清理（也不该有：那是表现层的输入态，
// 不属于权威世界数据）。因此这里**不修改上层 API**，而是：
//   ① 清理 Gameplay 自己拥有的逻辑输入态（`IsPlacingWonder`）；
//   ② 通过 <see cref="Advanced"/> 事件通知表现层清理 painting/panning/hover 与刷新渲染。
// 这正是 Web 注释里"状态迁移在 progression.js，表现层留在 main.js"的分工。
using System;
using InterimDeity.Core;
using InterimDeity.Simulation;
using InterimDeity.World;

namespace InterimDeity.Gameplay
{
    /// <summary>进阶结果。</summary>
    public sealed class EraAdvanceOutcome
    {
        public bool Ok;
        /// <summary>未满足的条件文案（复用 `ProgressionRules` 的 reasons，未满足时非空）。</summary>
        public System.Collections.Generic.List<string> Reasons = new System.Collections.Generic.List<string>();
        public int From;
        public int To;
        public string Name;
        /// <summary>本次实际扣除的星星（= `EraConstants.EraStarCost`）。</summary>
        public int StarsSpent;
        /// <summary>供 UI 显示的"缺项"摘要。</summary>
        public string ReasonText => Reasons.Count == 0 ? null : string.Join("、", Reasons);
    }

    /// <summary>时代进阶编排。</summary>
    public static class EraProgressionService
    {
        /// <summary>
        /// 是否有奇迹正处于"放置中"（Gameplay 拥有的逻辑输入态）。
        /// 表现层（painting/panning/hover）由各自模块自行维护。
        /// </summary>
        public static bool IsPlacingWonder { get; private set; }

        /// <summary>进入/退出奇迹放置模式。对应 Web `G.placingWonder = true/false`。</summary>
        public static void SetPlacingWonder(bool placing) => IsPlacingWonder = placing;

        /// <summary>进阶成功时触发。表现层在此做：清 painting/panning/hover、刷渲染、播音效、弹提示。</summary>
        public static event Action<EraAdvanceOutcome> Advanced;

        /// <summary>
        /// 只做查询：当前是否满足进阶条件。会先刷新统计缓存（对应 Web `eraReady()` 的 `ensureBuiltCache()`）。
        /// </summary>
        public static EraReadinessResult EvaluateReadiness(WorldState G)
        {
            if (G == null) return null;
            StateQueries.RefreshBuiltCache(G);
            return ProgressionRules.EvaluateReadiness(G);
        }

        /// <summary>当前是否可进阶（不改状态）。</summary>
        public static bool CanAdvance(WorldState G) => EvaluateReadiness(G)?.Ok ?? false;

        /// <summary>
        /// 执行一次时代进阶（玩家请求）。
        /// **幂等**：条件不满足时状态一字不动；连续调用在条件仍满足时才会再次进阶，
        /// 而进阶后 `CurrentEra` 已前移、星星已扣减，故不会重复领取同一时代的奖励。
        /// </summary>
        public static EraAdvanceOutcome Advance(WorldState G)
        {
            var outcome = new EraAdvanceOutcome();
            if (G == null) return outcome;

            EraReadinessResult ready = EvaluateReadiness(G);
            if (ready == null || !ready.Ok)
            {
                // 失败路径：**不写任何状态**
                if (ready != null) outcome.Reasons.AddRange(ready.Reasons);
                outcome.From = G.CurrentEra;
                outcome.To = G.CurrentEra;
                return outcome;
            }

            int before = G.CurrentEra;
            int starsBefore = G.Stats.Stars;

            // 复用权威迁移（扣星 / era+1 / starProg=0 / terrainDirty）
            EraAdvanceResult adv = ProgressionRules.ApplyEraAdvance(G);

            // 清理 Gameplay 自己拥有的逻辑输入态
            // （Web applyEraAdvance 会清 placingWonder；不清会让奇迹按钮永久停在"放置中"）
            IsPlacingWonder = false;

            outcome.Ok = true;
            outcome.From = before;
            outcome.To = adv.To;
            outcome.Name = adv.Name;
            outcome.StarsSpent = Math.Max(0, starsBefore - G.Stats.Stars);

            // 表现层清理 + 渲染刷新交给订阅方（对应 Web 的 R.applyEraVisuals / syncNpc / 粒子 / 音效）
            Advanced?.Invoke(outcome);
            return outcome;
        }

        /// <summary>
        /// 供 UI 显示的条件摘要（人口 / 奇迹 / 星星 / 产能），复用 `ProgressionRules.MilestoneSummary` 之外的同一口径。
        /// </summary>
        public static string ReadinessSummary(WorldState G)
        {
            EraReadinessResult r = EvaluateReadiness(G);
            if (r == null) return string.Empty;
            if (r.Ok) return "可以进阶";
            return "进阶条件未满足：" + string.Join("、", r.Reasons);
        }

        /// <summary>里程碑进度摘要（转调 `ProgressionRules.MilestoneSummary`，保持单一实现）。</summary>
        public static string MilestoneSummary(WorldState G)
        {
            if (G == null) return string.Empty;
            StateQueries.RefreshBuiltCache(G);
            return ProgressionRules.MilestoneSummary(G,
                G.BuiltCache[2], G.BuiltCache[3], G.BuiltCache[4], G.BuiltCache[1]);
        }
    }
}
