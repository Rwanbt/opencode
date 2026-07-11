import { type Component, createEffect, createResource, createSignal, For, Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Select } from "@opencode-ai/ui/select"
import { Switch } from "@opencode-ai/ui/switch"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { useSDK } from "@/context/sdk"
import { SettingsList } from "./settings-list"
import { SettingsRow } from "./settings-row"

const confirmText = "DELETE"

async function unwrap<T>(request: Promise<{ data?: T; error?: unknown }>) {
  const result = await request
  if (result.data !== undefined) return result.data
  throw new Error(result.error instanceof Error ? result.error.message : "Request failed")
}

export const SettingsObservability: Component = () => {
  const sdk = useSDK()
  const [sessionId, setSessionId] = createSignal<string>()
  const [scope, setScope] = createSignal<"session" | "project" | "all">("session")
  const [confirmation, setConfirmation] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [settings, settingsActions] = createResource(() => unwrap(sdk.client.observability.settings()))
  const [health, healthActions] = createResource(() => unwrap(sdk.client.observability.health()))
  const [sessions] = createResource(() => unwrap(sdk.client.session.list({ limit: 50 })))

  createEffect(() => {
    const first = sessions()?.[0]
    if (!sessionId() && first) setSessionId(first.id)
  })

  const selected = () => sessions()?.find((item) => item.id === sessionId())
  const [events, eventsActions] = createResource(sessionId, (id) => unwrap(sdk.client.observability.events.list({ sessionId: id, limit: 50 })))
  const [summary, summaryActions] = createResource(sessionId, (id) => unwrap(sdk.client.observability.summary({ sessionId: id })))
  const refresh = () => void Promise.all([settingsActions.refetch(), healthActions.refetch(), eventsActions.refetch(), summaryActions.refetch()])

  const update = async (patch: { enabled?: boolean; captureMode?: "local_metadata" | "local_redacted" }) => {
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

  return <div class="flex h-full flex-col overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
    <div class="flex items-start justify-between gap-4 pt-6 pb-8"><div><h2 class="text-16-medium text-text-strong">Observability</h2><p class="text-12-regular text-text-weak">Local metadata only. No prompts, responses, tool payloads, or raw errors are displayed.</p></div><Button size="small" variant="secondary" onClick={refresh}>Refresh</Button></div>
    <div class="flex flex-col gap-8">
      <section><h3 class="pb-2 text-14-medium text-text-strong">Capture</h3><SettingsList><SettingsRow title="Enable native observability" description="Stores local LLM and tool metadata only."><Switch checked={settings()?.enabled ?? false} disabled={busy()} onChange={(enabled) => void update({ enabled })} /></SettingsRow><SettingsRow title="Capture mode" description="Neither mode stores readable content."><Select size="small" variant="secondary" options={["local_metadata", "local_redacted"] as const} current={settings()?.captureMode ?? "local_metadata"} label={(item) => item === "local_metadata" ? "Metadata only" : "Metadata + redaction classes"} onSelect={(item) => item && void update({ captureMode: item })} /></SettingsRow></SettingsList><div class="mt-2 rounded-md bg-surface-warning-base px-3 py-2 text-12-regular text-text-strong">Local SQLite storage is not encrypted at rest. No exporter is configured.</div></section>
      <section><h3 class="pb-2 text-14-medium text-text-strong">Service health</h3><div class="grid grid-cols-2 gap-2 sm:grid-cols-4"><Metric label="Queue" value={String(health()?.queueSize ?? 0)} /><Metric label="Queue bytes" value={`${((health()?.queueBytes ?? 0) / 1024).toFixed(1)} KiB`} /><Metric label="Inserted" value={String(health()?.eventsInserted ?? 0)} /><Metric label="Database failures" value={String(health()?.eventsFailedDb ?? 0)} /></div><Show when={health()?.circuitOpen}><div class="mt-2 rounded-md bg-surface-critical-base px-3 py-2 text-12-regular text-text-on-critical-base">The write circuit is open; product requests still continue.</div></Show></section>
      <section><div class="flex items-center justify-between gap-4 pb-2"><h3 class="text-14-medium text-text-strong">Session events</h3><Select size="small" variant="secondary" options={sessions() ?? []} current={selected()} value={(item) => item.id} label={(item) => item.title || item.id} onSelect={(item) => item && setSessionId(item.id)} /></div><Show when={summary()}>{(value) => <p class="mb-2 text-12-regular text-text-weak">{value().totalEvents} events · ${(value().totalCostNanoUsd / 1_000_000_000).toFixed(4)}</p>}</Show><div class="overflow-hidden rounded-lg bg-surface-base"><div class="grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-2 bg-surface-inset px-4 py-2 text-11-medium text-text-weak"><span>Type</span><span>Status</span><span class="text-right">Time</span><span class="text-right">Duration / cost</span></div><For each={events() ?? []} fallback={<div class="px-4 py-4 text-12-regular text-text-weak">No observability events for this session.</div>}>{(event) => <div class="grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-2 border-b border-border-weak-base px-4 py-2 text-12-regular last:border-none"><span class="truncate text-text-strong">{event.type}</span><span>{event.status}</span><span class="text-right text-text-weak">{new Date(event.tsMs).toLocaleTimeString()}</span><span class="text-right text-text-weak">{event.durationMs === undefined ? "—" : `${(event.durationMs / 1000).toFixed(1)}s`} · {event.costNanoUsd === undefined ? "—" : `$${(event.costNanoUsd / 1_000_000_000).toFixed(4)}`}</span></div>}</For></div></section>
      <section><h3 class="pb-2 text-14-medium text-icon-critical-base">Delete local observability data</h3><div class="rounded-lg border border-border-critical-base bg-surface-critical-weak p-4"><div class="flex flex-col gap-3"><Select size="small" variant="secondary" options={["session", "project", "all"] as const} current={scope()} label={(item) => item === "session" ? "Current session" : item === "project" ? "Current project" : "All local observability data"} onSelect={(item) => item && setScope(item)} /><TextField label="Confirmation" value={confirmation()} placeholder="Type DELETE to confirm" onChange={setConfirmation} /><div><Button variant="primary" disabled={busy() || confirmation() !== confirmText || (scope() !== "all" && !selected())} onClick={() => void remove()}>Delete data</Button></div></div></div></section>
    </div>
  </div>
}

const Metric: Component<{ label: string; value: string }> = (props) => <div class="rounded-lg bg-surface-base px-3 py-3"><span class="text-11-regular text-text-weak">{props.label}</span><div class="text-16-medium text-text-strong">{props.value}</div></div>
