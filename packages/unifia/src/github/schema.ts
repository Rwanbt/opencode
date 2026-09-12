// FORK: GitHub account connection — OAuth Device Flow.
// Deliberately separate from provider auth (../auth/index.ts, LLM API keys)
// and from MCP auth (../mcp/auth.ts). A GitHub session must never appear in
// Auth.all() / provider listings / GDPR provider export — see github/auth.ts
// for the storage namespace rationale.

/** Full session as persisted (never sent to the frontend as-is). */
export interface GithubSession {
  login: string
  name?: string
  avatarUrl?: string
  profileUrl: string
  accessToken: string
  refreshToken?: string
  /** epoch ms. Classic OAuth App tokens (no "Expire user authorization
   *  tokens" setting) don't expire — undefined in that case. */
  expiresAt?: number
  scopes: string[]
  connectedAt: number
}

/** Public identity — safe to return to the frontend. */
export interface GithubIdentity {
  login: string
  name?: string
  avatarUrl?: string
  profileUrl: string
}

export interface GithubCapabilities {
  apiReachable: boolean
  authenticated: boolean
  privateRepositoryAccess: boolean | "unknown"
  gitHttpsAvailable: boolean
  gitHttpsAuthenticated: boolean
  gitSshAvailable: boolean | "unsupported"
  lastCheckedAt: number
}

export type GithubStatus =
  | { connected: false; configured: boolean }
  | { connected: true; configured: true; identity: GithubIdentity; capabilities: GithubCapabilities }

export interface DeviceAuthorization {
  userCode: string
  verificationUri: string
  verificationUriComplete?: string
  expiresInSeconds: number
  intervalSeconds: number
}

export type PollResult =
  | { status: "pending" }
  | { status: "slow_down"; nextIntervalSeconds: number }
  | { status: "expired" }
  | { status: "denied" }
  | { status: "no_pending_flow" }
  | { status: "success"; identity: GithubIdentity }
  | { status: "error"; message: string }

export type GitFailureCategory =
  | "git_missing"
  | "https_helper_missing"
  | "https_helper_permission_denied"
  | "https_helper_blocked"
  | "https_helper_incompatible"
  | "tls_failure"
  | "dns_failure"
  | "network_failure"
  | "authentication_failure"
  | "authorization_failure"
  | "repository_not_found"
  | "unknown"

export interface GitRuntimeReport {
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

  failure?: {
    stage: string
    code?: number
    signal?: string
    category: GitFailureCategory
    safeMessage: string
  }
}
