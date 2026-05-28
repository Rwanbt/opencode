export const deepLinkEvent = "opencode:deep-link"

const parseUrl = (input: string) => {
  if (!input.startsWith("opencode://")) return
  if (typeof URL.canParse === "function" && !URL.canParse(input)) return
  try {
    return new URL(input)
  } catch {
    return
  }
}

// A directory path is user-clickable, so we forbid embedded URL schemes (which
// would be passed through to the shell/opener) and control chars, and cap the
// length. An absurdly long path coming from a hostile deep link would clog UI
// state and could hit API-side parsing limits.
const DIR_MAX = 4096
// Heuristic absolute-path check. Tauri runs on Windows / macOS / Linux; the
// renderer has no access to `node:path`, so we inline the rule:
//   * POSIX absolute: starts with `/`
//   * Windows absolute: `X:\` or `X:/` with a letter, or UNC `\\server\share`
// A relative path (e.g. `../../etc`) or bare name is rejected — the app's
// project picker always has an absolute root, and a hostile deep link that
// could inject a relative path might otherwise be resolved against whatever
// CWD the process happens to have.
const isAbsolutePath = (d: string) => {
  if (d.startsWith("/")) return true
  if (/^[a-zA-Z]:[\\/]/.test(d)) return true
  if (d.startsWith("\\\\")) return true // UNC
  return false
}
const isSafeDirectory = (d: string) => {
  if (!d || d.length > DIR_MAX) return false
  if (/[\0\r\n]/.test(d)) return false
  // Catch javascript: / data: / opencode: masquerading as a path.
  if (/^[a-z][a-z0-9+.-]*:/i.test(d) && !/^[a-zA-Z]:[\\/]/.test(d)) return false
  if (!isAbsolutePath(d)) return false
  return true
}

// Provider IDs are identifiers like "anthropic" / "openrouter" — we never load
// arbitrary strings as module names, but a hostile providerID could still
// XSS via any component that renders it unescaped. Constrain to a safe shape.
const isSafeProviderID = (p: string) => /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(p)

// OAuth one-time codes / states are opaque to us; only bound the size.
const isBoundedOpaque = (s: string, max = 4096) =>
  s.length > 0 && s.length <= max && !/[\0\r\n]/.test(s)

// Prompts land in the chat input — no scheme / control-char filter needed but
// a hostile QR should not be able to stuff a multi-megabyte string in state.
const PROMPT_MAX = 16_384

export const parseDeepLink = (input: string) => {
  const url = parseUrl(input)
  if (!url) return
  if (url.hostname !== "open-project") return
  const directory = url.searchParams.get("directory")
  if (!directory || !isSafeDirectory(directory)) return
  return directory
}

export const parseNewSessionDeepLink = (input: string) => {
  const url = parseUrl(input)
  if (!url) return
  if (url.hostname !== "new-session") return
  const directory = url.searchParams.get("directory")
  if (!directory || !isSafeDirectory(directory)) return
  const prompt = url.searchParams.get("prompt") || undefined
  if (!prompt) return { directory }
  if (prompt.length > PROMPT_MAX) return { directory }
  return { directory, prompt }
}

export type OAuthCallbackDeepLink = {
  providerID: string
  code: string
  state?: string
}

/**
 * Parse an OAuth callback returned via custom URL scheme, e.g.
 * `opencode://oauth/callback?providerID=anthropic&code=xxx&state=yyy`.
 * The provider's authorize() step embeds this URL as the `redirect_uri`
 * so the browser lands back in the app and we can finish the token
 * exchange without the user copy-pasting a code.
 */
export const parseOAuthCallbackDeepLink = (input: string): OAuthCallbackDeepLink | undefined => {
  const url = parseUrl(input)
  if (!url) return
  // `opencode://oauth/callback?...` → hostname="oauth", pathname="/callback"
  if (url.hostname !== "oauth") return
  const path = url.pathname.replace(/^\/+|\/+$/g, "")
  if (path !== "callback") return
  const providerID = url.searchParams.get("providerID")
  const code = url.searchParams.get("code")
  if (!providerID || !code) return
  if (!isSafeProviderID(providerID)) return
  if (!isBoundedOpaque(code)) return
  const state = url.searchParams.get("state") ?? undefined
  if (state !== undefined && !isBoundedOpaque(state)) return
  return { providerID, code, state }
}

export const collectOpenProjectDeepLinks = (urls: string[]) =>
  urls.map(parseDeepLink).filter((directory): directory is string => !!directory)

export const collectNewSessionDeepLinks = (urls: string[]) =>
  urls.map(parseNewSessionDeepLink).filter((link): link is { directory: string; prompt?: string } => !!link)

export const collectOAuthCallbackDeepLinks = (urls: string[]) =>
  urls.map(parseOAuthCallbackDeepLink).filter((link): link is OAuthCallbackDeepLink => !!link)

// Window-level CustomEvent dispatched when an OAuth callback deep link is
// received. The dialog-connect-provider dialog subscribes to it and
// finishes the token exchange automatically.
export const oauthCallbackEvent = "opencode:oauth-callback"

type OpenCodeWindow = Window & {
  __OPENCODE__?: {
    deepLinks?: string[]
  }
}

export const drainPendingDeepLinks = (target: OpenCodeWindow) => {
  const pending = target.__OPENCODE__?.deepLinks ?? []
  if (pending.length === 0) return []
  if (target.__OPENCODE__) target.__OPENCODE__.deepLinks = []
  return pending
}

// ── createDeepLinkHandler ────────────────────────────────────────────────────

import { makeEventListener } from "@solid-primitives/event-listener"
import { onMount } from "solid-js"
import { base64Encode } from "@opencode-ai/util/encode"
import type { useProviders } from "@/hooks/use-providers"
import type { useServer } from "@/context/server"
import type { setSessionHandoff } from "@/pages/session/handoff"

interface DeepLinkHandlerDeps {
  providers: ReturnType<typeof useProviders>
  server: ReturnType<typeof useServer>
  openProject: (directory: string, nav?: boolean) => void | Promise<void>
  navigateWithSidebarReset: (href: string) => void
  popularProviders: string[]
  setSessionHandoff: typeof setSessionHandoff
}

export function createDeepLinkHandler(deps: DeepLinkHandlerDeps) {
  const { providers, server, openProject, navigateWithSidebarReset, popularProviders, setSessionHandoff: _setSessionHandoff } = deps

  const handleDeepLinks = (urls: string[]) => {
    // OAuth callbacks are routed even in non-local mode (e.g. an admin using
    // a remote server still needs to finish auth when redirected back to the
    // desktop app by the provider). Handle them first, then the local-only
    // project links.
    for (const callback of collectOAuthCallbackDeepLinks(urls)) {
      // S2.A2: validate providerID against the live provider registry.
      // The shape guard in parseOAuthCallbackDeepLink prevents XSS via the
      // ID alone, but a hostile QR could still dispatch a callback for an
      // ID we don't know — which at best wastes a dialog wake-up, at worst
      // confuses the dialog subscriber. `popularProviders` is our static
      // fallback for first-launch (registry not yet loaded from the server).
      const known = new Set<string>([
        ...providers.all().map((p) => p.id),
        ...popularProviders,
      ])
      if (!known.has(callback.providerID)) {
        console.warn("[deep-link] oauth callback for unknown providerID, dropping", {
          providerID: callback.providerID,
        })
        continue
      }
      window.dispatchEvent(new CustomEvent(oauthCallbackEvent, { detail: callback }))
    }

    if (!server.isLocal()) return

    for (const directory of collectOpenProjectDeepLinks(urls)) {
      openProject(directory)
    }

    for (const link of collectNewSessionDeepLinks(urls)) {
      openProject(link.directory, false)
      const slug = base64Encode(link.directory)
      if (link.prompt) {
        _setSessionHandoff(slug, { prompt: link.prompt })
      }
      const href = link.prompt ? `/${slug}/session?prompt=${encodeURIComponent(link.prompt)}` : `/${slug}/session`
      navigateWithSidebarReset(href)
    }
  }

  onMount(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ urls: string[] }>).detail
      const urls = detail?.urls ?? []
      if (urls.length === 0) return
      handleDeepLinks(urls)
    }

    handleDeepLinks(drainPendingDeepLinks(window))
    makeEventListener(window, deepLinkEvent, handler as EventListener)
  })

  return {}
}
