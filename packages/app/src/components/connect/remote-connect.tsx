import type { Platform } from "../../context/platform"

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
