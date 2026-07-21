// FORK: GitHub account connection — OAuth Device Flow, capability checks,
// git runtime diagnostics. Distinct from SettingsGitAuth (generic manual
// HTTPS token / SSH key, any host) rendered further down this same panel —
// see server/routes/github.ts and github/{auth,client,credentials,diagnostics}.ts
// for the backend side.
import { createResource, createSignal, Match, onCleanup, Show, Switch } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"

interface GithubIdentity {
  login: string
  name?: string
  avatarUrl?: string
  profileUrl: string
}

interface GithubStatus {
  connected: boolean
  configured: boolean
  identity?: GithubIdentity
}

interface GithubCapabilities {
  apiReachable: boolean
  authenticated: boolean
  privateRepositoryAccess: boolean | "unknown"
  gitHttpsAvailable: boolean
  gitHttpsAuthenticated: boolean
  gitSshAvailable: boolean | "unsupported"
  lastCheckedAt: number
}

interface GitRuntimeReport {
  gitAvailable: boolean
  gitVersion?: string
  execPath?: string
  httpsHelperFound: boolean
  httpsHelperPath?: string
  httpsHelperExecutable: boolean
  httpsProbeSucceeded: boolean
  sshAvailable: boolean
  platform: string
  architecture: string
  failure?: { stage: string; category: string; safeMessage: string }
}

type FlowState =
  | { kind: "idle" }
  | {
      kind: "waiting"
      userCode: string
      verificationUri: string
      verificationUriComplete?: string
      intervalSeconds: number
    }
  | { kind: "error"; message: string }

export function SettingsGithubAuth() {
  const language = useLanguage()
  const sdk = useSDK()

  const [status, { refetch: refetchStatus }] = createResource<GithubStatus>(async () => {
    try {
      const res = await fetch(`${sdk.url}/github/status`)
      if (!res.ok) return { connected: false, configured: false }
      return (await res.json()) as GithubStatus
    } catch {
      return { connected: false, configured: false }
    }
  })

  const [flow, setFlow] = createSignal<FlowState>({ kind: "idle" })
  const [capabilities, setCapabilities] = createSignal<GithubCapabilities>()
  const [testing, setTesting] = createSignal(false)
  const [diagnostics, setDiagnostics] = createSignal<GitRuntimeReport>()
  const [diagnosing, setDiagnosing] = createSignal(false)
  const [showDiagnostics, setShowDiagnostics] = createSignal(false)
  const [copied, setCopied] = createSignal(false)

  let pollTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => {
    if (pollTimer) clearTimeout(pollTimer)
  })

  async function poll(intervalSeconds: number) {
    try {
      const res = await fetch(`${sdk.url}/github/device/poll`, { method: "POST" })
      const result = await res.json()
      if (result.status === "pending") {
        pollTimer = setTimeout(() => poll(intervalSeconds), intervalSeconds * 1000)
        return
      }
      if (result.status === "slow_down") {
        const next = result.nextIntervalSeconds ?? intervalSeconds + 5
        setFlow((f) => (f.kind === "waiting" ? { ...f, intervalSeconds: next } : f))
        pollTimer = setTimeout(() => poll(next), next * 1000)
        return
      }
      if (result.status === "success") {
        setFlow({ kind: "idle" })
        refetchStatus()
        return
      }
      if (result.status === "expired") {
        setFlow({ kind: "error", message: language.t("settings.fork.githubAuth.expired") })
        return
      }
      if (result.status === "denied") {
        setFlow({ kind: "error", message: language.t("settings.fork.githubAuth.denied") })
        return
      }
      setFlow({ kind: "error", message: result.message ?? language.t("settings.fork.githubAuth.errorGeneric") })
    } catch {
      setFlow({ kind: "error", message: language.t("settings.fork.githubAuth.errorGeneric") })
    }
  }

  async function connect() {
    try {
      const res = await fetch(`${sdk.url}/github/device/start`, { method: "POST" })
      if (!res.ok) {
        setFlow({ kind: "error", message: language.t("settings.fork.githubAuth.errorGeneric") })
        return
      }
      const auth = await res.json()
      setFlow({
        kind: "waiting",
        userCode: auth.userCode,
        verificationUri: auth.verificationUri,
        verificationUriComplete: auth.verificationUriComplete,
        intervalSeconds: auth.intervalSeconds,
      })
      pollTimer = setTimeout(() => poll(auth.intervalSeconds), auth.intervalSeconds * 1000)
    } catch {
      setFlow({ kind: "error", message: language.t("settings.fork.githubAuth.errorGeneric") })
    }
  }

  async function cancel() {
    if (pollTimer) clearTimeout(pollTimer)
    setFlow({ kind: "idle" })
    await fetch(`${sdk.url}/github/device/cancel`, { method: "POST" }).catch(() => {})
  }

  async function disconnect() {
    await fetch(`${sdk.url}/github/disconnect`, { method: "POST" }).catch(() => {})
    setCapabilities(undefined)
    setDiagnostics(undefined)
    setShowDiagnostics(false)
    refetchStatus()
  }

  async function testConnection() {
    setTesting(true)
    try {
      const res = await fetch(`${sdk.url}/github/test-connection`, { method: "POST" })
      if (res.ok) setCapabilities((await res.json()) as GithubCapabilities)
    } finally {
      setTesting(false)
    }
  }

  async function diagnoseGit() {
    setDiagnosing(true)
    setShowDiagnostics(true)
    try {
      const res = await fetch(`${sdk.url}/github/diagnostics`)
      if (res.ok) setDiagnostics((await res.json()) as GitRuntimeReport)
    } finally {
      setDiagnosing(false)
    }
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard API unavailable — the code is still visible to copy manually
    }
  }

  const badgeClass = (ok: boolean | "unknown") =>
    ok === true
      ? "text-10-regular text-[#22c55e] px-2 py-0.5 rounded border border-[#22c55e]/30"
      : ok === "unknown"
        ? "text-10-regular text-text-weaker px-2 py-0.5 rounded border border-border-weak-base"
        : "text-10-regular text-[#ef4444] px-2 py-0.5 rounded border border-[#ef4444]/30"

  const badgeLabel = (ok: boolean | "unknown") =>
    ok === true
      ? language.t("settings.fork.githubAuth.statusAvailable")
      : ok === "unknown"
        ? language.t("common.unknown")
        : language.t("settings.fork.githubAuth.statusUnavailable")

  return (
    <div class="flex flex-col gap-3 py-4 border-t border-border-weak-base">
      <div class="flex flex-col gap-0.5 px-4">
        <span class="text-13-medium text-text-base">{language.t("settings.fork.githubAuth.title")}</span>
        <span class="text-11-regular text-text-weaker">{language.t("settings.fork.githubAuth.description")}</span>
      </div>

      <Show when={status.latest && !status.latest.configured}>
        <div class="px-4">
          <span class="text-11-regular text-text-weaker">{language.t("settings.fork.githubAuth.notConfigured")}</span>
        </div>
      </Show>

      <Show when={status.latest?.configured}>
        <Switch>
          {/* Disconnected, idle */}
          <Match when={!status.latest?.connected && flow().kind === "idle"}>
            <div class="px-4">
              <Button size="small" onClick={connect}>
                {language.t("settings.fork.githubAuth.connectButton")}
              </Button>
            </div>
          </Match>

          {/* Device flow in progress */}
          <Match when={flow().kind === "waiting"}>
            {(() => {
              const f = flow() as Extract<FlowState, { kind: "waiting" }>
              return (
                <div class="flex flex-col gap-2 px-4">
                  <span class="text-12-medium text-text-base">
                    {language.t("settings.fork.githubAuth.authorizeTitle")}
                  </span>
                  <div class="flex items-center gap-2">
                    <span class="text-16-medium font-mono tracking-widest text-text-base">{f.userCode}</span>
                    <Button size="small" variant="ghost" onClick={() => copyCode(f.userCode)}>
                      {copied() ? language.t("settings.fork.githubAuth.copied") : language.t("settings.fork.githubAuth.copyCode")}
                    </Button>
                  </div>
                  <div class="flex gap-2">
                    <a href={f.verificationUriComplete ?? f.verificationUri} target="_blank" rel="noreferrer">
                      <Button size="small">{language.t("settings.fork.githubAuth.openGithub")}</Button>
                    </a>
                    <Button size="small" variant="ghost" onClick={cancel}>
                      {language.t("common.cancel")}
                    </Button>
                  </div>
                  <span class="text-11-regular text-text-weaker">
                    {language.t("settings.fork.githubAuth.waitingAuthorization")}
                  </span>
                </div>
              )
            })()}
          </Match>

          {/* Flow error */}
          <Match when={flow().kind === "error"}>
            <div class="flex flex-col gap-2 px-4">
              <span class="text-11-regular text-[#ef4444]">{(flow() as Extract<FlowState, { kind: "error" }>).message}</span>
              <div>
                <Button size="small" onClick={connect}>
                  {language.t("settings.fork.githubAuth.connectButton")}
                </Button>
              </div>
            </div>
          </Match>

          {/* Connected */}
          <Match when={status.latest?.connected && flow().kind === "idle"}>
            <div class="flex flex-col gap-3 px-4">
              <div class="flex items-center gap-2">
                <Show when={status.latest?.identity?.avatarUrl}>
                  <img
                    src={status.latest?.identity?.avatarUrl}
                    alt=""
                    class="w-6 h-6 rounded-full"
                    referrerpolicy="no-referrer"
                  />
                </Show>
                <span class="text-12-medium text-text-base">
                  {language.t("settings.fork.githubAuth.connectedAs", { login: status.latest?.identity?.login ?? "" })}
                </span>
              </div>

              <Show when={capabilities()}>
                {(caps) => (
                  <div class="flex flex-col gap-1.5">
                    <div class="flex items-center justify-between">
                      <span class="text-11-regular text-text-weak">
                        {language.t("settings.fork.githubAuth.apiStatusLabel")}
                      </span>
                      <span class={badgeClass(caps().apiReachable)}>{badgeLabel(caps().apiReachable)}</span>
                    </div>
                    <div class="flex items-center justify-between">
                      <span class="text-11-regular text-text-weak">
                        {language.t("settings.fork.githubAuth.gitHttpsStatusLabel")}
                      </span>
                      <span class={badgeClass(caps().gitHttpsAuthenticated)}>
                        {caps().gitHttpsAuthenticated
                          ? language.t("settings.fork.githubAuth.statusAuthorized")
                          : badgeLabel(caps().gitHttpsAvailable)}
                      </span>
                    </div>
                    <div class="flex items-center justify-between">
                      <span class="text-11-regular text-text-weak">
                        {language.t("settings.fork.githubAuth.privateReposStatusLabel")}
                      </span>
                      <span class={badgeClass(caps().privateRepositoryAccess)}>
                        {badgeLabel(caps().privateRepositoryAccess)}
                      </span>
                    </div>
                    <Show when={caps().apiReachable && !caps().gitHttpsAuthenticated}>
                      <span class="text-11-regular text-[#ef4444]">
                        {language.t("settings.fork.githubAuth.connectedButGitBroken")}
                      </span>
                    </Show>
                  </div>
                )}
              </Show>

              <div class="flex gap-2">
                <Button size="small" variant="ghost" onClick={testConnection} disabled={testing()}>
                  {testing()
                    ? language.t("settings.fork.githubAuth.testingInProgress")
                    : language.t("settings.fork.githubAuth.testConnectionButton")}
                </Button>
                <Button size="small" variant="ghost" onClick={diagnoseGit} disabled={diagnosing()}>
                  {diagnosing()
                    ? language.t("settings.fork.githubAuth.diagnosingInProgress")
                    : language.t("settings.fork.githubAuth.diagnoseGitButton")}
                </Button>
                <Button size="small" variant="ghost" onClick={disconnect}>
                  {language.t("settings.fork.githubAuth.disconnectButton")}
                </Button>
              </div>

              <Show when={showDiagnostics() && diagnostics()}>
                {(report) => (
                  <div class="flex flex-col gap-1 mt-1 p-2 rounded border border-border-weak-base">
                    <span class="text-11-medium text-text-base">
                      {language.t("settings.fork.githubAuth.diagnosticsTitle")}
                    </span>
                    <div class="flex items-center justify-between">
                      <span class="text-10-regular text-text-weak">
                        {language.t("settings.fork.githubAuth.diagnosticsGitVersionLabel")}
                      </span>
                      <span class="text-10-regular text-text-weaker font-mono">
                        {report().gitVersion ?? language.t("settings.fork.githubAuth.diagnosticsNotFound")}
                      </span>
                    </div>
                    <div class="flex items-center justify-between">
                      <span class="text-10-regular text-text-weak">
                        {language.t("settings.fork.githubAuth.diagnosticsHttpsHelperLabel")}
                      </span>
                      <span class="text-10-regular text-text-weaker">
                        {report().httpsHelperFound
                          ? language.t("settings.fork.githubAuth.diagnosticsFound")
                          : language.t("settings.fork.githubAuth.diagnosticsNotFound")}
                      </span>
                    </div>
                    <div class="flex items-center justify-between">
                      <span class="text-10-regular text-text-weak">
                        {language.t("settings.fork.githubAuth.diagnosticsProbeLabel")}
                      </span>
                      <span class="text-10-regular text-text-weaker">
                        {report().httpsProbeSucceeded
                          ? language.t("settings.fork.githubAuth.diagnosticsSucceeded")
                          : language.t("settings.fork.githubAuth.diagnosticsFailed")}
                      </span>
                    </div>
                    <Show when={report().failure}>
                      {(failure) => (
                        <span class="text-10-regular text-[#ef4444] mt-1">{failure().safeMessage}</span>
                      )}
                    </Show>
                  </div>
                )}
              </Show>
            </div>
          </Match>
        </Switch>
      </Show>
    </div>
  )
}
