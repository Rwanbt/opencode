// Phase 4 exporter admin panel (ADR-1026). Lets a user configure/remove the
// Langfuse exporter, test connectivity with a synthetic (non-real) event,
// and preview the exact ExportProjection that would be sent for a real
// event before ever opting into exporting anything. secretKey is a
// write-only field — the config-read route never returns it, so this panel
// can never display or leak a configured secret back to the screen.
import { type Component, createResource, createSignal, For, Show } from "solid-js"
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

type EventItem = { eventId: string; type: string; status: string; tsMs: number }

export const SettingsObservabilityExporters: Component<{ events: EventItem[] }> = (props) => {
  const sdk = useSDK()
  const [host, setHost] = createSignal("https://cloud.langfuse.com")
  const [publicKey, setPublicKey] = createSignal("")
  const [secretKey, setSecretKey] = createSignal("")
  const [previewEventId, setPreviewEventId] = createSignal<string>()
  const [busy, setBusy] = createSignal(false)
  const [testResults, setTestResults] = createSignal<{ exporter: string; ok: boolean; attempts: number; error?: string }[]>()
  const [preview, setPreview] = createSignal<{ exportable: boolean; reason?: string; projection?: unknown }>()

  const [config, configActions] = createResource(() => unwrap(sdk.client.observability.exporters.config()))
  const terminalEvents = () => props.events.filter((e) => e.status !== "started")

  const saveLangfuse = async () => {
    if (!host() || !publicKey() || !secretKey()) {
      showToast({ variant: "error", title: "Missing fields", description: "Host, public key, and secret key are all required." })
      return
    }
    setBusy(true)
    try {
      const cfg = await unwrap(sdk.client.config.get())
      const existing = (cfg.experimental?.observability?.exporters ?? []).filter((e: { type: string }) => e.type !== "langfuse")
      const next = [...existing, { type: "langfuse" as const, host: host(), publicKey: publicKey(), secretKey: secretKey() }]
      await unwrap(
        sdk.client.config.update({
          config: { ...cfg, experimental: { ...cfg.experimental, observability: { ...cfg.experimental?.observability, exporters: next } } },
        }),
      )
      setSecretKey("")
      await configActions.refetch()
      showToast({ variant: "success", title: "Langfuse exporter configured" })
    } catch (error) {
      showToast({ variant: "error", title: "Unable to save exporter", description: error instanceof Error ? error.message : "Request failed" })
    } finally {
      setBusy(false)
    }
  }

  const removeExporter = async (type: string) => {
    setBusy(true)
    try {
      const cfg = await unwrap(sdk.client.config.get())
      const next = (cfg.experimental?.observability?.exporters ?? []).filter((e: { type: string }) => e.type !== type)
      await unwrap(
        sdk.client.config.update({
          config: { ...cfg, experimental: { ...cfg.experimental, observability: { ...cfg.experimental?.observability, exporters: next } } },
        }),
      )
      await configActions.refetch()
      showToast({ variant: "success", title: `${type} exporter removed` })
    } catch (error) {
      showToast({ variant: "error", title: "Unable to remove exporter", description: error instanceof Error ? error.message : "Request failed" })
    } finally {
      setBusy(false)
    }
  }

  const setBackfill = async (backfillOnStart: boolean) => {
    setBusy(true)
    try {
      const cfg = await unwrap(sdk.client.config.get())
      await unwrap(
        sdk.client.config.update({
          config: { ...cfg, experimental: { ...cfg.experimental, observability: { ...cfg.experimental?.observability, backfillOnStart } } },
        }),
      )
      await configActions.refetch()
    } catch (error) {
      showToast({ variant: "error", title: "Unable to save setting", description: error instanceof Error ? error.message : "Request failed" })
    } finally {
      setBusy(false)
    }
  }

  const runTest = async () => {
    setBusy(true)
    setTestResults(undefined)
    try {
      const result = await unwrap(sdk.client.observability.exporters.test())
      setTestResults(result.results)
      const allOk = result.results.every((r) => r.ok)
      if (!result.results.length) {
        showToast({ variant: "error", title: "No exporters configured", description: "Configure an exporter above first." })
      } else {
        showToast({ variant: allOk ? "success" : "error", title: allOk ? "All exporters reachable" : "One or more exporters failed" })
      }
    } catch (error) {
      showToast({ variant: "error", title: "Test failed", description: error instanceof Error ? error.message : "Request failed" })
    } finally {
      setBusy(false)
    }
  }

  const runPreview = async () => {
    const eventId = previewEventId()
    if (!eventId) return
    setBusy(true)
    setPreview(undefined)
    try {
      const result = await unwrap(sdk.client.observability.exporters.preview({ eventId }))
      setPreview(result)
    } catch (error) {
      showToast({ variant: "error", title: "Preview failed", description: error instanceof Error ? error.message : "Request failed" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="flex flex-col gap-6">
      <div>
        <h3 class="pb-2 text-14-medium text-text-strong">Exporters</h3>
        <p class="text-12-regular text-text-weak">
          Off by default. A configured exporter only ever receives a redacted ExportProjection (ADR-1026) — never raw prompts, responses, tool payloads, or Phase 3 opt-in content, even if opted in for local storage.
        </p>
      </div>

      <Show when={config()?.exporters.length} fallback={<div class="rounded-lg bg-surface-base px-3 py-3 text-12-regular text-text-weak">No exporter configured.</div>}>
        <div class="flex flex-col gap-2">
          <For each={config()?.exporters ?? []}>
            {(exporter) => (
              <div class="flex items-center justify-between rounded-lg bg-surface-base px-3 py-3">
                <div class="text-12-regular">
                  <span class="text-12-medium text-text-strong">{exporter.type}</span> — {exporter.host} ({exporter.publicKey})
                </div>
                <Button variant="secondary" size="small" disabled={busy()} onClick={() => void removeExporter(exporter.type)}>
                  Remove
                </Button>
              </div>
            )}
          </For>
        </div>
      </Show>

      <SettingsList>
        <SettingsRow title="Backfill on start" description="When enabled, the next time an exporter is configured, it exports the ENTIRE existing local event history instead of only new events. Off by default.">
          <SwitchComponent checked={config()?.backfillOnStart ?? false} disabled={busy()} onChange={(v) => void setBackfill(v)} />
        </SettingsRow>
      </SettingsList>

      <div>
        <h3 class="pb-2 text-14-medium text-text-strong">Add Langfuse exporter</h3>
        <SettingsList>
          <SettingsRow title="Host" description="Langfuse instance base URL.">
            <TextField size="small" variant="normal" value={host()} onChange={setHost} />
          </SettingsRow>
          <SettingsRow title="Public key" description="Langfuse project public key.">
            <TextField size="small" variant="normal" value={publicKey()} onChange={setPublicKey} />
          </SettingsRow>
          <SettingsRow title="Secret key" description="Langfuse project secret key. Never displayed back once saved.">
            <TextField size="small" variant="normal" type="password" value={secretKey()} onChange={setSecretKey} />
          </SettingsRow>
        </SettingsList>
        <div class="mt-2">
          <Button variant="primary" size="small" disabled={busy()} onClick={() => void saveLangfuse()}>
            Save exporter
          </Button>
        </div>
      </div>

      <div>
        <h3 class="pb-2 text-14-medium text-text-strong">Test connection</h3>
        <p class="pb-2 text-12-regular text-text-weak">Sends one synthetic, non-real event through every configured exporter right now.</p>
        <Button variant="secondary" size="small" disabled={busy()} onClick={() => void runTest()}>
          Send test event
        </Button>
        <Show when={testResults()}>
          {(results) => (
            <div class="mt-3 flex flex-col gap-2">
              <For each={results()}>
                {(r) => (
                  <div class="flex items-center gap-2 rounded-md px-3 py-2 text-12-regular" classList={{ "bg-surface-success-weak": r.ok, "bg-surface-critical-base text-text-on-critical-base": !r.ok }}>
                    <Icon name={r.ok ? "check" : "warning"} />
                    <span class="text-12-medium">{r.exporter}</span>
                    <span>{r.ok ? `ok (${r.attempts} attempt${r.attempts === 1 ? "" : "s"})` : `failed after ${r.attempts} attempts: ${r.error}`}</span>
                  </div>
                )}
              </For>
            </div>
          )}
        </Show>
      </div>

      <div>
        <h3 class="pb-2 text-14-medium text-text-strong">Preview projection</h3>
        <p class="pb-2 text-12-regular text-text-weak">See exactly what would be sent for a real event — without sending it anywhere.</p>
        <div class="flex items-center gap-2">
          <Select
            size="small"
            variant="secondary"
            options={terminalEvents()}
            current={terminalEvents().find((e) => e.eventId === previewEventId())}
            value={(e) => e.eventId}
            label={(e) => `${e.type} · ${new Date(e.tsMs).toLocaleTimeString()}`}
            onSelect={(e) => e && setPreviewEventId(e.eventId)}
          />
          <Button variant="secondary" size="small" disabled={busy() || !previewEventId()} onClick={() => void runPreview()}>
            Preview
          </Button>
        </div>
        <Show when={preview()}>
          {(result) => (
            <Show
              when={result().exportable}
              fallback={<div class="mt-3 rounded-md bg-surface-warning-base px-3 py-2 text-12-regular text-text-strong">Not exportable: {result().reason}</div>}
            >
              <pre class="mt-3 overflow-x-auto rounded-md bg-surface-inset px-3 py-2 text-11-regular text-text-weak">{JSON.stringify(result().projection, null, 2)}</pre>
            </Show>
          )}
        </Show>
      </div>
    </div>
  )
}
