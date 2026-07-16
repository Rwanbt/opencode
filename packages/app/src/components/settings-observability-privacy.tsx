// Phase 3 PrivacyPanel (ADR-1032, plan §16). Grants/revokes opt-in content
// capture for a session or project scope. Workspace scope is fully
// supported by the backend (GET/PUT/POST /observability/privacy) but not
// surfaced here — there is no existing UI concept of "pick a workspace" in
// this settings panel to hang a selector off, and session+project cover the
// common case. Extend this component, not the API, if workspace-scope UI is
// ever needed.
import { type Component, createResource, createSignal, Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Select } from "@opencode-ai/ui/select"
import { TextField } from "@opencode-ai/ui/text-field"
import { Icon } from "@opencode-ai/ui/icon"
import { showToast } from "@opencode-ai/ui/toast"
import { useSDK } from "@/context/sdk"
import { unwrap } from "@/utils/sdk-unwrap"
import { SettingsList } from "./settings-list"
import { SettingsRow } from "./settings-row"
import { useLanguage } from "@/context/language"

type SessionItem = { id: string; title?: string; projectID: string }
type ContentCaptureLevel = "local_content_redacted" | "local_full"
type OptInScope = "session" | "project" | "all"
const ALL_PROJECTS_SCOPE_ID = "local"

const LEVEL_LABEL: Record<ContentCaptureLevel, string> = {
  local_content_redacted: "Redacted content (secrets/paths/emails masked)",
  local_full: "Full content (unredacted, bounded to 32 KiB per event)",
}

export const SettingsObservabilityPrivacy: Component<{
  sessions: SessionItem[]
  sessionId?: string
  projectId?: string
  onSelectSession: (id: string) => void
}> = (props) => {
  const language = useLanguage()
  const sdk = useSDK()
  const [scope, setScope] = createSignal<OptInScope>("session")
  const [level, setLevel] = createSignal<ContentCaptureLevel>("local_content_redacted")
  const [ttlDays, setTtlDays] = createSignal("7")
  const [busy, setBusy] = createSignal(false)

  const scopeId = () => scope() === "session" ? props.sessionId : scope() === "project" ? props.projectId : ALL_PROJECTS_SCOPE_ID
  const selectedSession = () => props.sessions.find((s) => s.id === props.sessionId)

  const [optIn, optInActions] = createResource(
    () => (scopeId() ? ([scope(), scopeId()] as const) : undefined),
    ([s, id]) => unwrap(sdk.client.observability.privacy.get({ scope: s, id: id! })),
  )

  const grant = async () => {
    const id = scopeId()
    if (!id) return
    const ttl = Math.max(1, Math.min(30, parseInt(ttlDays(), 10) || 7))
    setBusy(true)
    try {
      await unwrap(sdk.client.observability.privacy.set({ scope: scope(), id, level: level(), ttlDays: ttl }))
      await optInActions.refetch()
      showToast({ variant: "success", title: language.t("settings.fork.observability.contentCapture") + " granted", description: `Expires in ${ttl} day${ttl === 1 ? "" : "s"}.` })
    } catch (error) {
      showToast({ variant: "error", title: "Unable to grant opt-in", description: error instanceof Error ? error.message : "Request failed" })
    } finally {
      setBusy(false)
    }
  }

  const revoke = async () => {
    const id = scopeId()
    if (!id) return
    setBusy(true)
    try {
      const result = await unwrap(sdk.client.observability.privacy.revoke({ scope: scope(), id }))
      await optInActions.refetch()
      showToast({ variant: "success", title: "Opt-in revoked", description: `${result.contentCleared} event(s) had their captured content cleared.` })
    } catch (error) {
      showToast({ variant: "error", title: "Unable to revoke opt-in", description: error instanceof Error ? error.message : "Request failed" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="flex flex-col gap-6">
      <div>
        <h3 class="pb-2 text-14-medium text-text-strong">{language.t("settings.fork.observability.contentCapture")}</h3>
        <p class="text-12-regular text-text-weak">
          {language.t("settings.fork.observability.contentCaptureDescription")}
        </p>
      </div>

      <SettingsList>
        <SettingsRow title={language.t("settings.fork.observability.scope")} description={language.t("settings.fork.observability.scopeDescription")}>
          <Select size="small" variant="secondary" options={["session", "project", "all"] as const} current={scope()} label={(item) => item === "session" ? "Current session" : item === "project" ? "Current project" : "All projects"} onSelect={(item) => item && setScope(item)} />
        </SettingsRow>
        <Show when={scope() === "session"}>
          <SettingsRow title={language.t("settings.fork.observability.session")} description={language.t("settings.fork.observability.sessionDescription")}>
            <Select size="small" variant="secondary" options={props.sessions} current={selectedSession()} value={(item) => item.id} label={(item) => item.title || item.id} onSelect={(item) => item && props.onSelectSession(item.id)} />
          </SettingsRow>
        </Show>
        <SettingsRow title={language.t("settings.fork.observability.level")} description={language.t("settings.fork.observability.levelDescription")}>
          <Select size="small" variant="secondary" options={["local_content_redacted", "local_full"] as const} current={level()} label={(item) => (item === "local_content_redacted" ? "Redacted" : "Full")} onSelect={(item) => item && setLevel(item)} />
        </SettingsRow>
        <SettingsRow title={language.t("settings.fork.observability.ttl")} description={language.t("settings.fork.observability.ttlDescription")}>
          <TextField size="small" variant="normal" type="number" value={ttlDays()} onChange={setTtlDays} />
        </SettingsRow>
      </SettingsList>

      <div>
        <Button variant="primary" size="small" disabled={busy() || !scopeId()} onClick={() => void grant()}>
          {language.t("settings.fork.observability.grant")}
        </Button>
      </div>

      <div>
        <h3 class="pb-2 text-14-medium text-text-strong">{language.t("settings.fork.observability.currentStatus")}</h3>
        <Show
          when={optIn()?.optIn}
          fallback={<div class="rounded-lg bg-surface-base px-3 py-3 text-12-regular text-text-weak">{language.t("settings.fork.observability.noOptIn")}</div>}
        >
          {(active) => (
            <div class="flex flex-col gap-3">
              <div class="flex items-start gap-3 rounded-md bg-surface-critical-base px-3 py-2 text-12-regular text-text-on-critical-base">
                <Icon name="warning" />
                <div>
                  <div class="text-12-medium">
                    {LEVEL_LABEL[active().level]} is active for this {active().scope}.
                  </div>
                  <div>Expires {new Date(active().expiresAtMs).toLocaleString()} ({active().ttlDays} day TTL).</div>
                </div>
              </div>
              <div>
                <Button variant="secondary" size="small" disabled={busy()} onClick={() => void revoke()}>
                  {language.t("settings.fork.observability.revoke")}
                </Button>
              </div>
            </div>
          )}
        </Show>
      </div>
    </div>
  )
}
