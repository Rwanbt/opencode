// Phase 3 Timeline + TraceDetail (plan §16). Timeline groups a session's
// events by traceId into rows with a relative-width bar; clicking a row
// fetches and expands the full span sequence for that trace (TraceDetail),
// including opt-in content when present (settings-observability-privacy.tsx
// is where that content capture is actually turned on).
import { type Component, createMemo, createResource, createSignal, For, Show } from "solid-js"
import { Select } from "@opencode-ai/ui/select"
import { Icon } from "@opencode-ai/ui/icon"
import { useSDK } from "@/context/sdk"
import { unwrap } from "@/utils/sdk-unwrap"

type SessionItem = { id: string; title?: string }
type EventDto = {
  eventId: string
  traceId: string
  spanId: string
  type: string
  status: string
  derivedStatus?: "orphaned"
  tsMs: number
  durationMs?: number
  costNanoUsd?: number
  localContentRedacted?: string
  localFull?: string
  hasSensitiveContent: boolean
}

function groupByTrace(events: EventDto[]) {
  const traces = new Map<string, EventDto[]>()
  for (const event of events) {
    const bucket = traces.get(event.traceId)
    if (bucket) bucket.push(event)
    else traces.set(event.traceId, [event])
  }
  return [...traces.entries()]
    .map(([traceId, items]) => {
      const startMs = Math.min(...items.map((e) => e.tsMs))
      const endMs = Math.max(...items.map((e) => e.tsMs + (e.durationMs ?? 0)))
      const hasSensitiveContent = items.some((e) => e.hasSensitiveContent)
      const hasOrphan = items.some((e) => e.derivedStatus === "orphaned")
      return { traceId, items, startMs, endMs, hasSensitiveContent, hasOrphan }
    })
    .sort((a, b) => b.startMs - a.startMs)
}

export const SettingsObservabilityTimeline: Component<{
  sessions: SessionItem[]
  sessionId?: string
  refreshKey?: number
  onSelectSession: (id: string) => void
  scope: "project" | "all"
}> = (props) => {
  const sdk = useSDK()
  const selected = () => props.sessions.find((s) => s.id === props.sessionId)
  const [expandedTraceId, setExpandedTraceId] = createSignal<string>()

  const [events] = createResource(
    () => props.sessionId ? { sessionId: props.sessionId, refreshKey: props.refreshKey, scope: props.scope } : undefined,
    (source) => unwrap(sdk.client.observability.events.list({ sessionId: source.sessionId, scope: props.scope, limit: 200 })) as Promise<EventDto[]>,
  )

  const traces = createMemo(() => groupByTrace(events() ?? []))
  const windowMs = createMemo(() => {
    const list = traces()
    if (!list.length) return 1
    const min = Math.min(...list.map((t) => t.startMs))
    const max = Math.max(...list.map((t) => t.endMs))
    return Math.max(1, max - min)
  })
  const windowStart = createMemo(() => (traces().length ? Math.min(...traces().map((t) => t.startMs)) : 0))

  const [trace, traceActions] = createResource(expandedTraceId, (traceId) => unwrap(sdk.client.observability.trace.get({ traceId, scope: props.scope })) as Promise<{ traceId: string; events: EventDto[] }>)

  const toggle = (traceId: string) => {
    if (expandedTraceId() === traceId) {
      setExpandedTraceId(undefined)
      return
    }
    setExpandedTraceId(traceId)
    void traceActions.refetch()
  }

  return (
    <div class="flex flex-col gap-4">
      <div class="flex items-center justify-between gap-4">
        <h3 class="text-14-medium text-text-strong">Timeline</h3>
        <Select size="small" variant="secondary" options={props.sessions} current={selected()} value={(item) => item.id} label={(item) => item.title || item.id} onSelect={(item) => item && props.onSelectSession(item.id)} />
      </div>

      <div class="flex flex-col gap-1">
        <For each={traces()} fallback={<div class="px-2 py-4 text-12-regular text-text-weak">No traces for this session.</div>}>
          {(entry) => {
            const offsetPct = () => ((entry.startMs - windowStart()) / windowMs()) * 100
            const widthPct = () => Math.max(0.5, ((entry.endMs - entry.startMs) / windowMs()) * 100)
            return (
              <button
                type="button"
                class="flex flex-col gap-1 rounded-md px-2 py-2 text-left hover:bg-surface-base-hover"
                classList={{ "bg-surface-base-active": expandedTraceId() === entry.traceId }}
                onClick={() => toggle(entry.traceId)}
              >
                <div class="flex items-center justify-between gap-2 text-11-regular text-text-weak">
                  <span class="truncate font-mono">{entry.traceId.slice(0, 12)}…</span>
                  <span class="flex items-center gap-1">
                    <Show when={entry.hasSensitiveContent}>
                      <Icon name="warning" />
                    </Show>
                    <Show when={entry.hasOrphan}>
                      <span class="rounded bg-surface-warning-base px-1.5 py-0.5 text-11-regular text-text-strong">orphelin probable</span>
                    </Show>
                    {entry.items.length} event{entry.items.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div class="relative h-4 w-full rounded bg-surface-inset">
                  <div
                    class="absolute h-4 rounded bg-icon-info-base"
                    style={{ left: `${offsetPct()}%`, width: `${widthPct()}%` }}
                  />
                </div>
              </button>
            )
          }}
        </For>
      </div>

      <Show when={expandedTraceId()}>
        <div class="rounded-lg border border-border-weak-base p-4">
          <h4 class="pb-2 text-13-medium text-text-strong">Trace detail</h4>
          <Show when={trace()} fallback={<div class="text-12-regular text-text-weak">Loading…</div>}>
            {(value) => (
              <div class="flex flex-col gap-2">
                <For each={value().events}>
                  {(event) => (
                    <div class="rounded-md bg-surface-base px-3 py-2">
                      <div class="flex items-center justify-between text-12-regular">
                        <span class="text-text-strong">{event.type}</span>
                        <span class="text-text-weak">{event.status}</span>
                      </div>
                      <Show when={event.localFull ?? event.localContentRedacted}>
                        {(content) => (
                          <div class="mt-2 flex flex-col gap-1">
                            <div class="flex items-center gap-1 text-11-medium text-icon-critical-base">
                              <Icon name="warning" />
                              {event.localFull ? "Full content captured (opt-in)" : "Redacted content captured (opt-in)"}
                            </div>
                            <pre class="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-surface-inset p-2 text-11-regular text-text-strong">{content()}</pre>
                          </div>
                        )}
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            )}
          </Show>
        </div>
      </Show>
    </div>
  )
}
