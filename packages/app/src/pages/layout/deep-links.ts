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
const isSafeDirectory = (d: string) => {
  if (!d || d.length > DIR_MAX) return false
  if (/[\0\r\n]/.test(d)) return false
  // Catch javascript: / data: / opencode: masquerading as a path.
  if (/^[a-z][a-z0-9+.-]*:/i.test(d) && !/^[a-zA-Z]:[\\/]/.test(d)) return false
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
