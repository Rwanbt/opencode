import { type Component, createEffect, createResource, createSignal, For, Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Select } from "@opencode-ai/ui/select"
import { Switch as SwitchComponent } from "@opencode-ai/ui/switch"
import { TextField } from "@opencode-ai/ui/text-field"
import { Icon } from "@opencode-ai/ui/icon"
import { showToast } from "@opencode-ai/ui/toast"
import { useSDK } from "@/context/sdk"
import { unwrap } from "@/utils/sdk-unwrap"
import { SettingsList } from "./settings-list"
import { SettingsRow } from "./settings-row"
import { SettingsObservabilityPrivacy } from "./settings-observability-privacy"
import { SettingsObservabilityTimeline } from "./settings-observability-timeline"
import { SettingsObservabilityCost } from "./settings-observability-cost"
import { SettingsObservabilityExporters } from "./settings-observability-exporters"

const confirmText = "DELETE"

type CohortMetrics = {
  modelProvider: string | null
  modelId: string | null
  skillHmac: string | null
  latencyP50Ms: number
  latencyP95Ms: number
  costPerTurnNanoUsd: number
  failureRatePct: number
  totalEvents: number
  traceCount: number
}
type CompareResult = { cohorts: CohortMetrics[]; referenceIndex?: number; timeWindowMs?: number }

export const SettingsObservability: Component = () => {
  const sdk = useSDK()
  const [sessionId, setSessionId] = createSignal<string>()
  const [scope, setScope] = createSignal<"session" | "project" | "all">("session")
  const [confirmation, setConfirmation] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [activeSubtab, setActiveSubtab] = createSignal<"overview" | "traces" | "timeline" | "comparisons" | "cost" | "events" | "privacy" | "exporters">("overview")

  const [settings, settingsActions] = createResource(() => unwrap(sdk.client.observability.settings()))
  const [exportersConfig] = createResource(() => unwrap(sdk.client.observability.exporters.config()))
  const [health, healthActions] = createResource(() => unwrap(sdk.client.observability.health()))
  const [sessions] = createResource(() => unwrap(sdk.client.session.list({ limit: 50 })))
  const [events, eventsActions] = createResource(sessionId, (id) => unwrap(sdk.client.observability.events.list({ sessionId: id, limit: 50 })))
  const [summary, summaryActions] = createResource(sessionId, (id) => unwrap(sdk.client.observability.summary({ sessionId: id })))
  const [comparison, comparisonActions] = createResource(activeSubtab, (tab) => tab === "comparisons" ? unwrap(sdk.client.observability.compare({ timeWindowMs: 7 * 24 * 60 * 60 * 1000 })) : Promise.resolve(null)) as unknown as [() => CompareResult | null, { refetch: () => Promise<void> }]

  createEffect(() => {
    const first = sessions()?.[0]
    if (!sessionId() && first) setSessionId(first.id)
  })

  const selected = () => sessions()?.find((item) => item.id === sessionId())
  const refresh = () => void Promise.all([settingsActions.refetch(), healthActions.refetch(), eventsActions.refetch(), summaryActions.refetch(), comparisonActions.refetch()])

  const update = async (patch: { enabled?: boolean; captureMode?: "local_metadata" | "local_redacted"; retentionDays?: number; maxEvents?: number }) => {
    setBusy(true)
    try {
      const config = await unwrap(sdk.client.config.get())
      await unwrap(sdk.client.config.update({ config: { ...config, experimental: { ...config.experimental, observability: { ...config.experimental?.observability, ...patch } } } }))
      await Promise.all([settingsActions.refetch(), healthActions.refetch()])
      showToast({ variant: "success", title: "Observability settings saved" })
    } catch (error) {
      showToast({ variant: "error", title: "Unable to save observability settings", description: error instanceof Error ? error.message : "Request failed" })
    } finally { setBusy(false) }
  }

  const remove = async () => {
    const session = selected()
    if (scope() !== "all" && !session) return
    setBusy(true)
    try {
      const body = scope() === "all" ? { scope: "all" as const } : scope() === "project" ? { scope: "project" as const, id: session!.projectID } : { scope: "session" as const, id: session!.id }
      const result = await unwrap(sdk.client.observability.data.delete({ body }, { headers: { "X-Confirm-Delete": "yes" } }))
      setConfirmation("")
      refresh()
      showToast({ variant: "success", title: `${result.deletedCount} observability events deleted` })
    } catch (error) {
      showToast({ variant: "error", title: "Unable to delete observability data", description: error instanceof Error ? error.message : "Request failed" })
    } finally { setBusy(false) }
  }

  const formatPct = (pct: number | undefined) => pct === undefined ? "—" : `${pct.toFixed(1)}%`
  const formatMs = (ms: number | undefined) => ms === undefined ? "—" : `${(ms / 1000).toFixed(1)}s`
  const formatCost = (nano: number | undefined) => nano === undefined ? "—" : `$${(nano / 1_000_000_000).toFixed(4)}`
  const diffColor = (val: number | undefined, betterLower = true) => {
    if (val === undefined) return ""
    return betterLower ? val < 0 : val > 0 ? "var(--icon-success-base)" : "var(--icon-critical-base)"
  }
  const diffSign = (val: number | undefined) => val === undefined ? "" : val > 0 ? "+" : ""

  return <div class="flex h-full flex-col overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
    <div class="flex items-start justify-between gap-4 pt-6 pb-8"><div><h2 class="text-16-medium text-text-strong">Observability</h2><p class="text-12-regular text-text-weak">Local metadata only. No prompts, responses, tool payloads, or raw errors are displayed.</p></div><Button size="small" variant="secondary" onClick={refresh}>Refresh</Button></div>
    <div class="flex flex-col gap-8">
      {/*
        Plain buttons, not the shared <Tabs> component: this panel already
        lives inside dialog-settings.tsx's outer vertical/"settings"-variant
        Tabs.Content. tabs.css's orientation/variant overrides key off
        [data-orientation="vertical"]/[data-variant="settings"] on the
        nearest [data-component="tabs"] ANCESTOR, but apply via a plain
        descendant combinator on [data-slot="tabs-list"]/[data-slot="tabs-content"]
        with no boundary at the next [data-component="tabs"] — so a second,
        nested <Tabs> here inherited height:100%/width:200px meant for the
        outer sidebar, collapsing this panel's actual content to 0 height
        (invisible, though present in the DOM) every time this tab was opened.
      */}
      <div class="flex items-center gap-1 mb-4" role="tablist">
        {([
          ["overview", "sliders", "Overview"],
          ["traces", "branch", "Traces"],
          ["timeline", "task", "Timeline"],
          ["comparisons", "bullet-list", "Comparisons"],
          ["cost", "checklist", "Cost"],
          ["events", "bullet-list", "Events"],
          ["privacy", "shield", "Privacy"],
          ["exporters", "cloud-upload", "Exporters"],
        ] as const).map(([value, icon, label]) => (
          <button
            type="button"
            role="tab"
            aria-selected={activeSubtab() === value}
            class="flex items-center gap-2 rounded-md px-3 py-1.5 text-12-medium"
            classList={{
              "bg-surface-base-active text-text-strong": activeSubtab() === value,
              "text-text-weak hover:text-text-strong": activeSubtab() !== value,
            }}
            onClick={() => setActiveSubtab(value)}
          >
            <Icon name={icon} />
            {label}
          </button>
        ))}
      </div>

        <Show when={activeSubtab() === "overview"}><div class="no-scrollbar">
          <section><h3 class="pb-2 text-14-medium text-text-strong">Capture</h3><SettingsList><SettingsRow title="Enable native observability" description="Stores local LLM and tool metadata only."><SwitchComponent checked={settings()?.enabled ?? false} disabled={busy()} onChange={(enabled) => void update({ enabled })} /></SettingsRow><SettingsRow title="Capture mode" description="Neither mode stores readable content."><Select size="small" variant="secondary" options={["local_metadata", "local_redacted"] as const} current={settings()?.captureMode ?? "local_metadata"} label={(item) => item === "local_metadata" ? "Metadata only" : "Metadata + redaction classes"} onSelect={(item) => item && void update({ captureMode: item })} /></SettingsRow></SettingsList><div class="mt-2 rounded-md bg-surface-warning-base px-3 py-2 text-12-regular text-text-strong">Local SQLite storage is not encrypted at rest. {exportersConfig()?.exporters.length ? `${exportersConfig()!.exporters.length} exporter(s) configured — see the Exporters tab.` : "No exporter is configured."}</div></section>
          <section><h3 class="pb-2 text-14-medium text-text-strong">Retention</h3><SettingsList><SettingsRow title="Retention (days)" description="Delete events older than this many days. Empty keeps events until another limit applies."><TextField size="small" variant="normal" type="number" placeholder="e.g. 30" value={String(settings()?.retentionDays ?? "")} onBlur={(v: string) => { update({ retentionDays: v ? parseInt(v, 10) : undefined }) }} /></SettingsRow><SettingsRow title="Max events" description="Maximum local observability event count. Default: 100000."><TextField size="small" variant="normal" type="number" placeholder="100000" value={String(settings()?.maxEvents ?? "")} onBlur={(v: string) => { update({ maxEvents: v ? parseInt(v, 10) : 100000 }) }} /></SettingsRow></SettingsList></section>
          <section><h3 class="pb-2 text-14-medium text-text-strong">Service health</h3><div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Metric label="Queue" value={String(health()?.queueSize ?? 0)} />
            <Metric label="Queue bytes" value={`${((health()?.queueBytes ?? 0) / 1024).toFixed(1)} KiB`} />
            <Metric label="Accepted" value={String(health()?.eventsAccepted ?? 0)} />
            <Metric label="Inserted" value={String(health()?.eventsInserted ?? 0)} />
            <Metric label="Rejected context" value={String(health()?.eventsRejectedInvalidContext ?? 0)} />
            <Metric label="Rejected event" value={String(health()?.eventsRejectedInvalidEvent ?? 0)} />
            <Metric label="Dropped queue" value={String(health()?.eventsDroppedQueueFull ?? 0)} />
            <Metric label="Dropped circuit" value={String(health()?.eventsDroppedCircuitOpen ?? 0)} />
            <Metric label="DB failures" value={String(health()?.eventsFailedDb ?? 0)} />
            <Metric label="DB busy" value={String(health()?.eventsFailedBusy ?? 0)} />
            <Metric label="DB full" value={String(health()?.eventsFailedFull ?? 0)} />
            <Metric label="DB corrupt" value={String(health()?.eventsFailedCorrupt ?? 0)} />
            <Metric label="Sanitizer failed" value={String(health()?.sanitizerFailed ?? 0)} />
            <Metric label="Last error" value={health()?.lastErrorKind ?? "—"} />
          </div><Show when={health()?.circuitOpen}><div class="mt-2 rounded-md bg-surface-critical-base px-3 py-2 text-12-regular text-text-on-critical-base">The write circuit is open; product requests still continue.</div></Show></section>
          <section><h3 class="pb-2 text-14-medium text-icon-critical-base">Delete local observability data</h3><div class="rounded-lg border border-border-critical-base bg-surface-critical-weak p-4"><div class="flex flex-col gap-3"><Select size="small" variant="secondary" options={["session", "project", "all"] as const} current={scope()} label={(item) => item === "session" ? "Current session" : item === "project" ? "Current project" : "All local observability data"} onSelect={(item) => item && setScope(item)} /><TextField label="Confirmation" value={confirmation()} placeholder="Type DELETE to confirm" onChange={setConfirmation} /><div><Button variant="primary" disabled={busy() || confirmation() !== confirmText || (scope() !== "all" && !selected())} onClick={() => void remove()}>Delete data</Button></div></div></div></section>
        </div></Show>

        <Show when={activeSubtab() === "traces"}><div class="no-scrollbar">
          <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between" }}>
            <Select size="small" variant="secondary" options={sessions() ?? []} current={selected()} value={(item) => item.id} label={(item) => item.title || item.id} onSelect={(item) => item && setSessionId(item.id)} />
            <span class="text-11-regular" style={{ color: "var(--text-weaker)" }}>{sessions()?.length ?? 0} sessions</span>
          </div>
          <Show when={events()}>
            {(value) => <div class="overflow-hidden rounded-lg bg-surface-base">
              <div class="grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-2 bg-surface-inset px-4 py-2 text-11-medium text-text-weak"><span>Type</span><span>Status</span><span class="text-right">Time</span><span class="text-right">Duration / cost</span></div>
              <For each={value()} fallback={<div class="px-4 py-4 text-12-regular text-text-weak">No observability events for this session.</div>}>
                {(event) => <div class="grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-2 border-b border-border-weak-base px-4 py-2 text-12-regular last:border-none"><span class="truncate text-text-strong">{event.type}</span><span class="flex items-center gap-1">{event.status}<Show when={event.derivedStatus === "orphaned"}><span class="rounded bg-surface-warning-base px-1.5 py-0.5 text-11-regular text-text-strong">orphelin probable</span></Show></span><span class="text-right text-text-weak">{new Date(event.tsMs).toLocaleTimeString()}</span><span class="text-right text-text-weak">{event.durationMs === undefined ? "—" : `${(event.durationMs / 1000).toFixed(1)}s`} · {event.costNanoUsd === undefined ? "—" : `$${(event.costNanoUsd / 1_000_000_000).toFixed(4)}`}</span></div>}
              </For>
            </div>}
          </Show>
        </div></Show>

        <Show when={activeSubtab() === "comparisons"}><div class="no-scrollbar">
          <div class="flex items-center justify-between gap-4 mb-4">
            <div><h3 class="text-14-medium text-text-strong">Compare configurations</h3><p class="text-12-regular text-text-weak">Grouped by model provider, model, and skill — over the last 7 days. Never prompts or responses.</p></div>
          </div>
          <div class="comparison-notice text-12-regular text-text-weak mb-4">Cohorts are inferred from (model provider, model, skill) — there is no explicit named-configuration tag yet, so runs that only differ by prompt or agent settings land in the same cohort.</div>
            {(() => {
              const data = comparison()
              if (!data || !data.cohorts.length) return <div class="text-12-regular text-text-weak p-8 text-center">No cohort data available. Run some LLM calls first.</div>
                const cohorts = data.cohorts
                const refIdx = data.referenceIndex ?? 0
                const reference = cohorts[refIdx]
                return <div class="comparison-grid" style={{ display: "grid", "grid-template-columns": "repeat(auto-fit, minmax(280px, 1fr))", gap: "12px" }}>
                  {cohorts.map((cohort: CohortMetrics, idx: number) => {
                    const isRef = idx === refIdx
                    const diff = isRef ? null : {
                      p50: reference.latencyP50Ms && cohort.latencyP50Ms ? ((cohort.latencyP50Ms - reference.latencyP50Ms) / reference.latencyP50Ms) * 100 : null,
                      p95: reference.latencyP95Ms && cohort.latencyP95Ms ? ((cohort.latencyP95Ms - reference.latencyP95Ms) / reference.latencyP95Ms) * 100 : null,
                      cost: reference.costPerTurnNanoUsd && cohort.costPerTurnNanoUsd ? ((cohort.costPerTurnNanoUsd - reference.costPerTurnNanoUsd) / reference.costPerTurnNanoUsd) * 100 : null,
                      failure: reference.failureRatePct && cohort.failureRatePct ? cohort.failureRatePct - reference.failureRatePct : null,
                    }
                    return <section class="comparison-card" data-variant={isRef ? "baseline" : "candidate"} style={{ border: isRef ? "2px solid var(--icon-success-base)" : "1px solid var(--border-weak-base)", "border-radius": "8px", padding: "12px", background: isRef ? "var(--surface-success-weak)" : "var(--surface-base)" }}>
                      <div class="comparison-card-heading"><span class="text-12-medium">{isRef ? "Reference" : "Candidate"}</span><span class="text-11-regular text-text-weak">{isRef ? "baseline configuration" : "same cohort"}</span></div>
                      <div class="comparison-config text-13-medium" style={{ margin: "8px 0" }}>{cohort.modelProvider ?? "unknown"} / {cohort.modelId ?? "unknown"}</div>
                      <dl class="comparison-metrics text-12-regular" style={{ display: "grid", gap: "4px" }}>
                        <div style={{ display: "flex", "justify-content": "space-between" }}><dt>Latency p50</dt><dd style={{ display: "flex", "align-items": "center", gap: "8px" }}>{cohort.latencyP50Ms ? `${cohort.latencyP50Ms} ms` : "—"}{diff?.p50 !== null && <small style={{ color: diff?.p50 !== undefined && diff.p50 < 0 ? "var(--icon-success-base)" : "var(--icon-critical-base)" }}>{diffSign(diff?.p50)}{diff?.p50?.toFixed(1)}%</small>}</dd></div>
                        <div style={{ display: "flex", "justify-content": "space-between" }}><dt>Latency p95</dt><dd style={{ display: "flex", "align-items": "center", gap: "8px" }}>{cohort.latencyP95Ms ? `${cohort.latencyP95Ms} ms` : "—"}{diff?.p95 !== null && <small style={{ color: diff?.p95 !== undefined && diff.p95 < 0 ? "var(--icon-success-base)" : "var(--icon-critical-base)" }}>{diffSign(diff?.p95)}{diff?.p95?.toFixed(1)}%</small>}</dd></div>
                        <div style={{ display: "flex", "justify-content": "space-between" }}><dt>Cost / turn</dt><dd style={{ display: "flex", "align-items": "center", gap: "8px" }}>{formatCost(cohort.costPerTurnNanoUsd)}{diff?.cost !== null && <small style={{ color: diff?.cost !== undefined && diff.cost > 0 ? "var(--icon-critical-base)" : "var(--icon-success-base)" }}>{diffSign(diff?.cost)}{diff?.cost?.toFixed(1)}%</small>}</dd></div>
                        <div style={{ display: "flex", "justify-content": "space-between" }}><dt>Failure rate</dt><dd style={{ display: "flex", "align-items": "center", gap: "8px" }}>{formatPct(cohort.failureRatePct)}{diff?.failure !== null && <small style={{ color: diff?.failure !== undefined && diff.failure > 0 ? "var(--icon-critical-base)" : "var(--icon-success-base)" }}>{diffSign(diff?.failure)}{diff?.failure?.toFixed(1)} pt</small>}</dd></div>
                      </dl>
                    </section>
                  })}
                </div>
            })()}
        </div></Show>

        <Show when={activeSubtab() === "events"}><div class="no-scrollbar">
          <div class="flex items-center justify-between gap-4 pb-2">
            <h3 class="text-14-medium text-text-strong">Session events</h3>
            <Select size="small" variant="secondary" options={sessions() ?? []} current={selected()} value={(item) => item.id} label={(item) => item.title || item.id} onSelect={(item) => item && setSessionId(item.id)} />
          </div>
          <Show when={summary()}>
            {(value) => <p class="mb-2 text-12-regular text-text-weak">{value().totalEvents} events · ${(value().totalCostNanoUsd / 1_000_000_000).toFixed(4)}</p>}
          </Show>
          <div class="overflow-hidden rounded-lg bg-surface-base">
            <div class="grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-2 bg-surface-inset px-4 py-2 text-11-medium text-text-weak"><span>Type</span><span>Status</span><span class="text-right">Time</span><span class="text-right">Duration / cost</span></div>
            <For each={events() ?? []} fallback={<div class="px-4 py-4 text-12-regular text-text-weak">No observability events for this session.</div>}>
              {(event) => <div class="grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-2 border-b border-border-weak-base px-4 py-2 text-12-regular last:border-none"><span class="truncate text-text-strong">{event.type}</span><span class="flex items-center gap-1">{event.status}<Show when={event.derivedStatus === "orphaned"}><span class="rounded bg-surface-warning-base px-1.5 py-0.5 text-11-regular text-text-strong">orphelin probable</span></Show></span><span class="text-right text-text-weak">{new Date(event.tsMs).toLocaleTimeString()}</span><span class="text-right text-text-weak">{event.durationMs === undefined ? "—" : `${(event.durationMs / 1000).toFixed(1)}s`} · {event.costNanoUsd === undefined ? "—" : `$${(event.costNanoUsd / 1_000_000_000).toFixed(4)}`}</span></div>}
            </For>
          </div>
        </div></Show>

        <Show when={activeSubtab() === "timeline"}><div class="no-scrollbar">
          <SettingsObservabilityTimeline sessions={sessions() ?? []} sessionId={sessionId()} onSelectSession={setSessionId} />
        </div></Show>

        <Show when={activeSubtab() === "cost"}><div class="no-scrollbar">
          <SettingsObservabilityCost />
        </div></Show>

        <Show when={activeSubtab() === "privacy"}><div class="no-scrollbar">
          <SettingsObservabilityPrivacy sessions={sessions() ?? []} sessionId={sessionId()} projectId={selected()?.projectID} onSelectSession={setSessionId} />
        </div></Show>

        <Show when={activeSubtab() === "exporters"}><div class="no-scrollbar">
          <SettingsObservabilityExporters events={events() ?? []} />
        </div></Show>
    </div>
  </div>
}

const Metric: Component<{ label: string; value: string }> = (props) => <div class="rounded-lg bg-surface-base px-3 py-3"><span class="text-11-regular text-text-weak">{props.label}</span><div class="text-16-medium text-text-strong">{props.value}</div></div>