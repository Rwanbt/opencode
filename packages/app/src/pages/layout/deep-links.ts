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

export const parseDeepLink = (input: string) => {
  const url = parseUrl(input)
  if (!url) return
  if (url.hostname !== "open-project") return
  const directory = url.searchParams.get("directory")
  if (!directory) return
  return directory
}

export const parseNewSessionDeepLink = (input: string) => {
  const url = parseUrl(input)
  if (!url) return
  if (url.hostname !== "new-session") return
  const directory = url.searchParams.get("directory")
  if (!directory) return
  const prompt = url.searchParams.get("prompt") || undefined
  if (!prompt) return { directory }
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
  const state = url.searchParams.get("state") ?? undefined
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
