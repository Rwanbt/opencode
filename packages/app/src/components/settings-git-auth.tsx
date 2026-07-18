// FORK: Stretch — Git push/pull auth settings (HTTPS token / SSH key).
// Credentials are stored in $XDG_CONFIG/opencode/git-credentials.json via
// the backend PUT /git/credentials route. Sensitive values are never echoed
// back to the frontend (GET /git/credentials returns masked info only).
import { Button } from "@opencode-ai/ui/button"
import { createResource, createSignal, Match, Show, Switch } from "solid-js"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"

type AuthType = "none" | "https-token" | "ssh-key"

type MaskedCredentials =
  | { type: "none" }
  | { type: "https-token"; username: string; tokenSet: boolean }
  | { type: "ssh-key"; keySet: boolean; hasPassphrase: boolean }

export function SettingsGitAuth() {
  const language = useLanguage()
  const sdk = useSDK()

  const [masked, { refetch }] = createResource<MaskedCredentials>(async () => {
    try {
      const res = await fetch(`${sdk.url}/git/credentials?directory=${encodeURIComponent(sdk.directory)}`)
      if (!res.ok) return { type: "none" }
      return (await res.json()) as MaskedCredentials
    } catch {
      return { type: "none" }
    }
  })

  const [authType, setAuthType] = createSignal<AuthType>("none")
  const [token, setToken] = createSignal("")
  const [username, setUsername] = createSignal("x")
  const [privateKey, setPrivateKey] = createSignal("")
  const [passphrase, setPassphrase] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  const [saveError, setSaveError] = createSignal<string | null>(null)
  const [saveOk, setSaveOk] = createSignal(false)
  const [editing, setEditing] = createSignal(false)

  async function save() {
    setSaving(true)
    setSaveError(null)
    setSaveOk(false)
    try {
      let body: object
      if (authType() === "none") {
        body = { type: "none" }
      } else if (authType() === "https-token") {
        if (!token()) { setSaveError(language.t("settings.fork.gitAuth.tokenRequired")); return }
        body = { type: "https-token", token: token(), username: username() || "x" }
      } else {
        if (!privateKey()) { setSaveError(language.t("settings.fork.gitAuth.sshKeyRequired")); return }
        body = { type: "ssh-key", privateKey: privateKey(), passphrase: passphrase() || undefined }
      }
      const res = await fetch(`${sdk.url}/git/credentials?directory=${encodeURIComponent(sdk.directory)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) { setSaveError(language.t("settings.fork.gitAuth.serverError")); return }
      setSaveOk(true)
      setEditing(false)
      setToken("")
      setPrivateKey("")
      setPassphrase("")
      refetch()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  function startEdit(type: AuthType) {
    setAuthType(type)
    setToken("")
    setPrivateKey("")
    setPassphrase("")
    setSaveError(null)
    setSaveOk(false)
    setEditing(true)
  }

  const inputClass =
    "w-full text-12-regular font-mono bg-transparent border border-border-weak-base focus:border-border-base rounded px-2 py-1 text-text-base outline-none placeholder:text-text-weaker"
  const labelClass = "text-11-regular text-text-weak"

  return (
    <div class="flex flex-col gap-3 py-4 border-t border-border-weak-base">
      <div class="flex items-center justify-between px-4">
        <div class="flex flex-col gap-0.5">
          <span class="text-13-medium text-text-base">{language.t("settings.fork.gitAuth.title")}</span>
          <span class="text-11-regular text-text-weaker">
            {language.t("settings.fork.gitAuth.description")}
          </span>
        </div>

        {/* Current status badge */}
        <Show when={!editing()}>
          <Switch>
            <Match when={masked()?.type === "https-token"}>
              <span class="text-10-regular text-[#22c55e] px-2 py-0.5 rounded border border-[#22c55e]/30">
                {language.t("settings.fork.gitAuth.httpsTokenActive")} ✓
              </span>
            </Match>
            <Match when={masked()?.type === "ssh-key"}>
              <span class="text-10-regular text-[#22c55e] px-2 py-0.5 rounded border border-[#22c55e]/30">
                {language.t("settings.fork.gitAuth.sshKeyActive")} ✓
              </span>
            </Match>
            <Match when={masked()?.type === "none" || !masked()}>
              <span class="text-10-regular text-text-weaker px-2 py-0.5 rounded border border-border-weak-base">
                {language.t("settings.fork.gitAuth.notConfigured")}
              </span>
            </Match>
          </Switch>
        </Show>
      </div>

      {/* Summary + action buttons when not editing */}
      <Show when={!editing()}>
        <div class="flex gap-2 px-4">
          <Button size="small" variant="ghost" onClick={() => startEdit("https-token")}>
            {masked()?.type === "https-token" ? language.t("settings.fork.gitAuth.editToken") : language.t("settings.fork.gitAuth.tokenButton")}
          </Button>
          <Button size="small" variant="ghost" onClick={() => startEdit("ssh-key")}>
            {masked()?.type === "ssh-key" ? language.t("settings.fork.gitAuth.editSshKey") : language.t("settings.fork.gitAuth.sshButton")}
          </Button>
          <Show when={masked()?.type !== "none"}>
            <Button
              size="small"
              variant="ghost"
              onClick={async () => {
                await fetch(`${sdk.url}/git/credentials?directory=${encodeURIComponent(sdk.directory)}`, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ type: "none" }),
                })
                refetch()
              }}
            >
              {language.t("common.delete")}
            </Button>
          </Show>
        </div>
        <Show when={saveOk()}>
          <span class="text-11-regular text-[#22c55e] px-4">{language.t("settings.fork.gitAuth.saved")}</span>
        </Show>
      </Show>

      {/* Edit form */}
      <Show when={editing()}>
        <div class="flex flex-col gap-3 px-4">
          <Switch>
            {/* HTTPS token form */}
            <Match when={authType() === "https-token"}>
              <div class="flex flex-col gap-1">
                <span class={labelClass}>{language.t("settings.fork.gitAuth.username")}</span>
                <input
                  class={inputClass}
                  type="text"
                  placeholder="x"
                  value={username()}
                  onInput={(e) => setUsername(e.currentTarget.value)}
                />
              </div>
              <div class="flex flex-col gap-1">
                <span class={labelClass}>{language.t("settings.fork.gitAuth.token")}</span>
                <input
                  class={inputClass}
                  type="password"
                  placeholder="ghp_..."
                  value={token()}
                  onInput={(e) => setToken(e.currentTarget.value)}
                  autocomplete="off"
                />
                <span class="text-10-regular text-text-weaker">
                  {language.t("settings.fork.gitAuth.tokenHint")}
                </span>
              </div>
            </Match>

            {/* SSH key form */}
            <Match when={authType() === "ssh-key"}>
              <div class="flex flex-col gap-1">
                <span class={labelClass}>{language.t("settings.fork.gitAuth.privateKey")}</span>
                <textarea
                  class={`${inputClass} h-32 resize-y`}
                  placeholder={"-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----"}
                  value={privateKey()}
                  onInput={(e) => setPrivateKey(e.currentTarget.value)}
                  autocomplete="off"
                  spellcheck={false}
                />
              </div>
              <div class="flex flex-col gap-1">
                <span class={labelClass}>{language.t("settings.fork.gitAuth.passphrase")}</span>
                <input
                  class={inputClass}
                  type="password"
                  placeholder={language.t("settings.fork.gitAuth.nonePlaceholder")}
                  value={passphrase()}
                  onInput={(e) => setPassphrase(e.currentTarget.value)}
                  autocomplete="off"
                />
                <span class="text-10-regular text-text-weaker">
                  {language.t("settings.fork.gitAuth.passphraseHint")}
                </span>
              </div>
            </Match>
          </Switch>

          <Show when={saveError()}>
            <span class="text-11-regular text-[#ef4444]">{saveError()}</span>
          </Show>

          <div class="flex gap-2">
            <Button size="small" onClick={save} disabled={saving()}>
              {saving() ? language.t("settings.fork.gitAuth.saveProgress") : language.t("common.save")}
            </Button>
            <Button
              size="small"
              variant="ghost"
              onClick={() => { setEditing(false); setSaveError(null) }}
            >
              {language.t("common.cancel")}
            </Button>
          </div>
        </div>
      </Show>
    </div>
  )
}
