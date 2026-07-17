// Phase 3 CostDashboard (plan §16). Project-wide cost breakdown reusing
// existing endpoints — /summary/aggregate for totals, /compare for the
// per-(model, skill) breakdown — rather than adding a dedicated cost route.
import { type Component, createMemo, createResource } from "solid-js"
import { For, Show } from "solid-js"
import { useSDK } from "@/context/sdk"
import { unwrap } from "@/utils/sdk-unwrap"
import { useLanguage } from "@/context/language"

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000

function formatCost(nano: number) {
  return `$${(nano / 1_000_000_000).toFixed(4)}`
}

export const SettingsObservabilityCost: Component<{ refreshKey?: number; scope: "project" | "all" }> = (props) => {
  const language = useLanguage()
  const sdk = useSDK()
  const [summary] = createResource(() => [props.refreshKey, props.scope] as const, () => unwrap(sdk.client.observability.summaryAggregate({ sinceMs: Date.now() - WINDOW_MS, scope: props.scope })))
  const [comparison] = createResource(() => [props.refreshKey, props.scope] as const, () => unwrap(sdk.client.observability.compare({ timeWindowMs: WINDOW_MS, scope: props.scope })))

  const cohorts = createMemo(() => {
    const list = comparison()?.cohorts ?? []
    return [...list].sort((a, b) => b.costPerTurnNanoUsd * b.traceCount - a.costPerTurnNanoUsd * a.traceCount)
  })
  const maxCostPerTurn = createMemo(() => Math.max(1, ...cohorts().map((c) => c.costPerTurnNanoUsd)))

  return (
    <div class="flex flex-col gap-6">
      <div>
        <h3 class="pb-2 text-14-medium text-text-strong">{language.t("settings.fork.observability.costLast7Days")}</h3>
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div class="rounded-lg bg-surface-base px-3 py-3">
            <span class="text-11-regular text-text-weak">{language.t("settings.fork.observability.totalCost")}</span>
            <div class="text-16-medium text-text-strong">{formatCost(summary()?.totalCostNanoUsd ?? 0)}</div>
          </div>
          <div class="rounded-lg bg-surface-base px-3 py-3">
            <span class="text-11-regular text-text-weak">{language.t("settings.fork.observability.totalEvents")}</span>
            <div class="text-16-medium text-text-strong">{summary()?.totalEvents ?? 0}</div>
          </div>
          <div class="rounded-lg bg-surface-base px-3 py-3">
            <span class="text-11-regular text-text-weak">{language.t("settings.fork.observability.failed")}</span>
            <div class="text-16-medium text-text-strong">{summary()?.byStatus?.failed ?? 0}</div>
          </div>
          <div class="rounded-lg bg-surface-base px-3 py-3">
            <span class="text-11-regular text-text-weak">{language.t("settings.fork.observability.aborted")}</span>
            <div class="text-16-medium text-text-strong">{summary()?.byStatus?.aborted ?? 0}</div>
          </div>
        </div>
      </div>

      <div>
        <h3 class="pb-2 text-14-medium text-text-strong">{language.t("settings.fork.observability.costPerTurn")}</h3>
        <div class="flex flex-col gap-2">
          <For each={cohorts()} fallback={<div class="px-2 py-4 text-12-regular text-text-weak">{language.t("settings.fork.observability.noCohortData")}</div>}>
            {(cohort) => (
              <div class="flex flex-col gap-1">
                <div class="flex items-center justify-between text-12-regular">
                  <span class="text-text-strong">{cohort.modelProvider ?? language.t("settings.fork.observability.unknown")} / {cohort.modelId ?? language.t("settings.fork.observability.unknown")}</span>
                  <span class="text-text-weak">{language.t("settings.fork.observability.costPerTurnSummary", { cost: formatCost(cohort.costPerTurnNanoUsd), count: cohort.traceCount })}</span>
                </div>
                <div class="h-2 w-full rounded bg-surface-inset">
                  <div class="h-2 rounded bg-icon-info-base" style={{ width: `${Math.max(1, (cohort.costPerTurnNanoUsd / maxCostPerTurn()) * 100)}%` }} />
                </div>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  )
}
