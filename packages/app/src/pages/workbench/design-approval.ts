/* SPDX-License-Identifier: MIT */
/**
 * DA-UI-02 / DA-UI-03 — the approval machine for Design create/export.
 *
 * Plan-Audit §9.1: the export flow returns a `202 approvalRequired`
 * envelope when the broker gates the operation. Before DA-UI-02 the
 * surface put the approval id in the success message, which was
 * indistinguishable from a real success and left no way to allow, deny,
 * cancel or retry.
 *
 *   idle ─▶ requesting ─▶ approval-required ─▶ resolving ─▶ retrying ─▶ succeeded
 *                                  │                │                │
 *                                  ▼                ▼                ▼
 *                              (expired)         cancelled        failed
 *                                  │
 *                                  └─▶ requesting  (re-request path)
 *
 * `expired` is a sub-state of `approval-required` rather than a state of
 * its own, so the modal can warn without losing the approval id it still
 * has to release.
 *
 * This module holds the machine *and* the four operations that talk to the
 * broker, with the client injected (ADR-0001, factory with deps). They
 * lived inside `design-surface.tsx`, which imports Solid's client-only
 * runtime and therefore cannot be loaded by `bun:test` at all — so the
 * only coverage they had was a regex over their own source, which is what
 * let an expiry ship with no reachable control and a request left pending
 * on the server. Here they are ordinary functions with a fake client.
 */

export type ApprovalState =
  | { kind: "idle" }
  | { kind: "requesting" }
  | {
      kind: "approval-required"
      approvalId: string
      capability: string
      resource: string
      expiresAt: number
      expired: boolean
    }
  | { kind: "resolving" }
  | { kind: "retrying" }
  | { kind: "succeeded" }
  | { kind: "failed"; error: string }
  | { kind: "cancelled" }

/** The events that drive the state machine. */
export type ApprovalEvent =
  | { type: "request-start" }
  | {
      type: "request-approval-required"
      approvalId: string
      capability: string
      resource: string
      expiresAt: number
    }
  | { type: "request-succeeded" }
  | { type: "request-failed"; error: string }
  | { type: "resolve-start" }
  | { type: "resolve-completed" }
  | { type: "retry-start" }
  | { type: "cancel-start" }
  | { type: "expire" }
  | { type: "cancel" }

/**
 * Pure reducer. An invalid transition returns the input state unchanged so
 * the caller can branch on the result without crashing the surface.
 */
export function reduceApprovalState(state: ApprovalState, event: ApprovalEvent): ApprovalState {
  switch (event.type) {
    case "request-start":
      // Restartable from idle, from a terminal state, and — the case that
      // was missing — from an *expired* approval. `canStartApproval` said
      // an expired approval could be restarted while this arm silently
      // returned the state unchanged, so the re-request the UI advertised
      // could never fire.
      if (
        state.kind === "idle" ||
        state.kind === "succeeded" ||
        state.kind === "failed" ||
        state.kind === "cancelled" ||
        (state.kind === "approval-required" && state.expired)
      ) {
        return { kind: "requesting" }
      }
      return state
    case "request-approval-required":
      if (state.kind !== "requesting") return state
      return {
        kind: "approval-required",
        approvalId: event.approvalId,
        capability: event.capability,
        resource: event.resource,
        expiresAt: event.expiresAt,
        expired: false,
      }
    case "request-succeeded":
      if (state.kind !== "requesting" && state.kind !== "retrying") return state
      return { kind: "succeeded" }
    case "request-failed":
      // `resolving` belongs here too. A broker error while a decision was
      // in flight dispatched this event from `resolving`, the arm ignored
      // it, and the machine stayed in `resolving` — which the modal
      // renders with no controls at all. Same trap as the expiry, one
      // state over.
      if (
        state.kind !== "requesting" &&
        state.kind !== "retrying" &&
        state.kind !== "resolving"
      ) {
        return state
      }
      return { kind: "failed", error: event.error }
    case "resolve-start":
      // Allow and deny need a live approval; the broker rejects a decision
      // on one it has already expired.
      if (state.kind !== "approval-required" || state.expired) return state
      return { kind: "resolving" }
    case "cancel-start":
      // Cancelling does not need a live approval — the opposite. An
      // expired approval is exactly the one still sitting pending on the
      // server with nobody about to decide it.
      if (state.kind !== "approval-required") return state
      return { kind: "resolving" }
    case "resolve-completed":
      if (state.kind !== "resolving") return state
      return { kind: "retrying" }
    case "retry-start":
      if (state.kind !== "retrying") return state
      return { kind: "requesting" }
    case "expire":
      if (state.kind !== "approval-required" || state.expired) return state
      return { ...state, expired: true }
    case "cancel":
      if (
        state.kind === "succeeded" ||
        state.kind === "failed" ||
        state.kind === "cancelled" ||
        state.kind === "idle"
      ) {
        return state
      }
      return { kind: "cancelled" }
  }
}

/** True when a fresh request may start — the double-click guard, and the expiry escape. */
export function canStartApproval(state: ApprovalState): boolean {
  return (
    state.kind === "idle" ||
    state.kind === "succeeded" ||
    state.kind === "failed" ||
    state.kind === "cancelled" ||
    (state.kind === "approval-required" && state.expired)
  )
}

/** True when the modal should render (waiting on the user, or mid-resolve). */
export function isApprovalModalVisible(state: ApprovalState): boolean {
  return state.kind === "approval-required" || state.kind === "resolving"
}

/** The two broker calls the approval flow needs. */
export interface ApprovalClient {
  resolveApproval(approvalId: string, decision: "allow" | "deny"): Promise<{ decision: { kind: string } }>
  cancelApproval(approvalId: string): Promise<unknown>
}

/** What the surface reports back to its own export/message signals. */
export interface ApprovalOutcome {
  exportState: "idle" | "error" | "exported"
  message: string
}

export interface ApprovalOperationsDeps {
  /** The live connection's client, or undefined when disconnected. */
  client: () => ApprovalClient | undefined
  state: () => ApprovalState
  dispatch: (event: ApprovalEvent) => void
  /** Drop the expiry timer; called wherever the machine leaves `approval-required`. */
  clearTimer: () => void
  /** Re-issue the gated operation — the surface's export flow. */
  restart: () => Promise<void>
  report: (outcome: ApprovalOutcome) => void
}

export interface ApprovalOperations {
  /** Allow or deny an approval that has not expired. */
  resolve(decision: "allow" | "deny"): Promise<void>
  /** Withdraw the request from the broker. Valid while expired, too. */
  cancel(): Promise<void>
  /** Release the stale approval and ask for a fresh one. */
  rerequest(): Promise<void>
  /** Leave the surface without stranding a pending request on the broker. */
  detach(): void
}

export function createApprovalOperations(deps: ApprovalOperationsDeps): ApprovalOperations {
  const message = (e: unknown, fallback: string): string =>
    e instanceof Error ? e.message : fallback

  return {
    async resolve(decision) {
      const client = deps.client()
      const state = deps.state()
      if (!client) return
      if (state.kind !== "approval-required" || state.expired) return
      deps.clearTimer()
      deps.dispatch({ type: "resolve-start" })
      try {
        const result = await client.resolveApproval(state.approvalId, decision)
        deps.dispatch({ type: "resolve-completed" })
        if (decision === "allow" && result.decision.kind === "allow") {
          await deps.restart()
          return
        }
        deps.dispatch({ type: "cancel" })
        deps.report({ exportState: "idle", message: "Export annulé par l'utilisateur" })
      } catch (e) {
        const text = message(e, "approval resolution failed")
        deps.dispatch({ type: "request-failed", error: text })
        deps.report({ exportState: "error", message: text })
      }
    },

    async cancel() {
      const client = deps.client()
      const state = deps.state()
      if (!client) return
      // An *expired* approval is precisely the one that still needs
      // cancelling: the deadline passed on this side and the broker is
      // still holding a request nobody is going to decide. Refusing here
      // is how the pending request came to be orphaned.
      if (state.kind !== "approval-required") return
      deps.clearTimer()
      deps.dispatch({ type: "cancel-start" })
      try {
        await client.cancelApproval(state.approvalId)
        deps.dispatch({ type: "cancel" })
        deps.report({ exportState: "idle", message: "Export annulé" })
      } catch (e) {
        // A broker refusing to cancel an approval it has already expired
        // is not something the user can act on, and leaving the machine
        // in `resolving` would trap them behind a modal with no controls.
        // The local state settles; the reason is still shown.
        deps.dispatch({ type: "cancel" })
        deps.report({
          exportState: "idle",
          message: `Export annulé (le serveur a refusé l'annulation : ${message(e, "raison inconnue")})`,
        })
      }
    },

    async rerequest() {
      const client = deps.client()
      const state = deps.state()
      if (!client) return
      if (state.kind !== "approval-required" || !state.expired) return
      deps.clearTimer()
      try {
        // Release the stale request first. Without this the broker keeps a
        // pending approval for an operation nobody will decide, and the
        // fresh attempt races it. Best-effort by nature — an approval the
        // broker has already expired refuses the call — but it is
        // *attempted*, which is the part that was missing.
        await client.cancelApproval(state.approvalId)
      } catch {
        // Already expired server-side, or gone. Nothing left to release.
      }
      deps.report({ exportState: "exported", message: "" })
      await deps.restart()
    },

    detach() {
      deps.clearTimer()
      const state = deps.state()
      if (state.kind === "approval-required") {
        // The surface is going away with a request still pending on the
        // broker. Aborting the local fetch does not withdraw it: without
        // this the approval sat there until its TTL ran out, invisible,
        // and the user's next export raced it. Best-effort by necessity —
        // the component is unmounting and there is nobody to report to.
        const client = deps.client()
        if (client) void client.cancelApproval(state.approvalId).catch(() => undefined)
      }
      deps.dispatch({ type: "cancel" })
    },
  }
}
