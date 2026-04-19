import { createSignal, Show } from "solid-js"
import { usePlatform, type Platform } from "../../context/platform"
import { ServerConnection } from "../../context/server"

export interface RemoteConnectProps {
  onConnect: (url: string) => void
  onCancel?: () => void
}

export type CheckServerResult =
  | { ok: true }
  | { ok: false; kind: "auth" | "http" | "network"; status?: number; message: string }

/**
 * Pré-flight check appelé avant d'engager une connexion remote. Distingue
 * échec réseau / TLS, échec d'auth (401), et autres erreurs HTTP, pour que
 * l'appelant puisse afficher un message contextuel au lieu d'un opaque
 * "impossible de joindre" une fois l'utilisateur déjà dans l'app principale.
 */
export async function checkServerReachable(
  platform: Pick<Platform, "fetch">,
  url: string,
  username?: string,
  password?: string,
  timeoutMs = 10000,
): Promise<CheckServerResult> {
  const cleanUrl = url.replace(/\/+$/, "")
  const fetchFn = platform.fetch ?? fetch
  const headers: Record<string, string> = {}
  if (password) {
    headers["Authorization"] = "Basic " + btoa(`${username ?? "opencode"}:${password}`)
  }
  try {
    const response = await fetchFn(`${cleanUrl}/doc`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (response.ok) return { ok: true }
    if (response.status === 401) {
      return { ok: false, kind: "auth", status: 401, message: "Authentication failed. Check username/password." }
    }
    return { ok: false, kind: "http", status: response.status, message: `Server returned ${response.status}` }
  } catch (e: any) {
    return { ok: false, kind: "network", message: e?.message || "Cannot reach server" }
  }
}

/**
 * Remote server connection dialog for mobile and web clients.
 * Allows connecting to a desktop OpenCode instance over the network.
 */
export function RemoteConnect(props: RemoteConnectProps) {
  const platform = usePlatform()
  const [serverUrl, setServerUrl] = createSignal("")
  const [username, setUsername] = createSignal("opencode")
  const [password, setPassword] = createSignal("")
  const [status, setStatus] = createSignal<"idle" | "checking" | "error" | "connected">("idle")
  const [error, setError] = createSignal("")

  async function checkServer() {
    const url = serverUrl().replace(/\/+$/, "")
    if (!url) {
      setError("Please enter a server URL")
      setStatus("error")
      return
    }

    setStatus("checking")
    setError("")

    const result = await checkServerReachable(platform, url, username(), password())
    if (result.ok) {
      setStatus("connected")
      if (platform.setDefaultServer) {
        await platform.setDefaultServer(url as ServerConnection.Key)
      }
      props.onConnect(url)
    } else {
      setError(result.message)
      setStatus("error")
    }
  }

  return (
    <div class="flex flex-col gap-4 p-6 max-w-md mx-auto">
      <h2 class="text-lg font-semibold">Connect to OpenCode Server</h2>
      <p class="text-sm text-secondary">
        Enter the URL of your desktop OpenCode instance.
        Start it with <code>opencode serve --hostname 0.0.0.0</code>
      </p>

      <label class="flex flex-col gap-1">
        <span class="text-sm font-medium">Server URL</span>
        <input
          type="url"
          placeholder="http://192.168.1.100:4096"
          value={serverUrl()}
          onInput={(e) => setServerUrl(e.currentTarget.value)}
          class="px-3 py-2 border rounded-lg bg-surface text-primary"
        />
      </label>

      <label class="flex flex-col gap-1">
        <span class="text-sm font-medium">Username</span>
        <input
          type="text"
          value={username()}
          onInput={(e) => setUsername(e.currentTarget.value)}
          class="px-3 py-2 border rounded-lg bg-surface text-primary"
        />
      </label>

      <label class="flex flex-col gap-1">
        <span class="text-sm font-medium">Password</span>
        <input
          type="password"
          placeholder="OPENCODE_SERVER_PASSWORD"
          value={password()}
          onInput={(e) => setPassword(e.currentTarget.value)}
          class="px-3 py-2 border rounded-lg bg-surface text-primary"
        />
      </label>

      <Show when={error()}>
        <p class="text-sm text-red-500">{error()}</p>
      </Show>

      <div class="flex gap-2">
        <button
          onClick={checkServer}
          disabled={status() === "checking"}
          class="flex-1 px-4 py-2 bg-primary text-white rounded-lg font-medium disabled:opacity-50"
        >
          {status() === "checking" ? "Connecting..." : "Connect"}
        </button>
        <Show when={props.onCancel}>
          <button
            onClick={props.onCancel}
            class="px-4 py-2 border rounded-lg"
          >
            Cancel
          </button>
        </Show>
      </div>

      <Show when={status() === "connected"}>
        <p class="text-sm text-green-600 font-medium">Connected successfully!</p>
      </Show>
    </div>
  )
}
