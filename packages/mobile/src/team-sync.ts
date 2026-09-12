// =============================================================================
// mobile/team-sync.ts — TEAM-M04
//
// When the mobile Team surface refetches: on resume, on reconnect, and never
// otherwise.
//
// A phone is not a desktop. It loses the network in a lift, it suspends the
// whole app when the user switches away, and every request it makes costs
// battery the user can feel. The two failure modes this exists to avoid are
// opposites, and both are easy to ship:
//
//   Refetch too eagerly   an app that refreshes on every task switch drains
//                         the battery and hammers the server from a device
//                         that is not even on screen.
//
//   Refetch too rarely    an app resumed after a night asleep that shows
//                         yesterday's runs as if they were current. Stale data
//                         presented as fresh is worse than a spinner.
//
// Dependencies are injected so the policy can be tested for what it decides
// rather than by suspending a real phone.
// =============================================================================

/** Beyond this, data held from before a suspend is treated as out of date. */
export const RESUME_STALE_AFTER_MS = 30_000

export interface TeamSyncDependencies {
  readonly isOnline: () => boolean
  readonly now: () => number
  readonly refresh: () => Promise<void>
  readonly staleAfterMs?: number
}

export type SyncOutcome =
  /** A refresh ran. */
  | "refreshed"
  /** Held data is still recent enough; nothing was fetched. */
  | "fresh"
  /** No network; the caller should show the offline state, not an empty one. */
  | "offline"
  /** A refresh was already running; this one folded into it. */
  | "coalesced"

export interface TeamSync {
  /** The app came back to the foreground. */
  onResume(): Promise<SyncOutcome>
  /** The device regained connectivity. */
  onReconnect(): Promise<SyncOutcome>
  /** The device lost connectivity. */
  onDisconnect(): void
  /** True once a refresh has been missed because the device was offline. */
  readonly pendingRefresh: () => boolean
  readonly lastRefreshAt: () => number | undefined
}

export function createTeamSync(dependencies: TeamSyncDependencies): TeamSync {
  const staleAfter = dependencies.staleAfterMs ?? RESUME_STALE_AFTER_MS

  let lastRefreshAt: number | undefined
  let inFlight: Promise<void> | undefined
  let pending = false

  async function refresh(): Promise<SyncOutcome> {
    // Two triggers can land together — a resume that also restores the network
    // is one user action, not two. Folding the second into the first is what
    // keeps it one request.
    if (inFlight !== undefined) {
      await inFlight
      return "coalesced"
    }
    const started = dependencies.now()
    inFlight = dependencies.refresh()
    try {
      await inFlight
      lastRefreshAt = started
      pending = false
      return "refreshed"
    } finally {
      inFlight = undefined
    }
  }

  return {
    async onResume() {
      if (!dependencies.isOnline()) {
        // Remembered rather than attempted: a request with no network fails,
        // and a failure here would spend a recovery attempt on a condition the
        // client already knows about.
        pending = true
        return "offline"
      }
      if (lastRefreshAt !== undefined && dependencies.now() - lastRefreshAt < staleAfter) return "fresh"
      return refresh()
    },

    async onReconnect() {
      if (!dependencies.isOnline()) return "offline"
      // Always refetches, regardless of how recent the last one was: the whole
      // point of having been offline is that whatever is held may have been
      // superseded while the device could not hear about it.
      return refresh()
    },

    onDisconnect() {
      pending = true
    },

    pendingRefresh: () => pending,
    lastRefreshAt: () => lastRefreshAt,
  }
}
