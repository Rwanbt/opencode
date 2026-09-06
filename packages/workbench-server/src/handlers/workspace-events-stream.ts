/* SPDX-License-Identifier: MIT */
/**
 * FUNC-001/C2-2: the client connects once per workspace and expects one
 * merged event stream across every session in it — there is no
 * "workspace-scoped" primitive on RuntimeAdapter, every implementation
 * (Fake/OpenCode/Unifia) is session-scoped. This fans in each known
 * session's subscribeEvents() into one SSE stream, and either relies on
 * the runtime's `onSessionCreated` push hook or — when the backend
 * pre-dates E13i — uses the bounded polling fallback from
 * `./workspace-events.js`.
 *
 * Sequence numbers are per-session (see FakeRuntimeAdapter), not
 * comparable across sessions, so v1 does not support cross-session
 * resumption: every session (initial or discovered later) always starts
 * its own subscription at afterSequence 0. A dropped connection restarts
 * every session's stream from 0 rather than replaying only the gap —
 * acceptable for now; a composite per-session cursor is future work if
 * that turns out to matter.
 */
import type { RuntimeEvent } from "@unifia/contracts"
import type { Principal } from "../auth.js"
import { WAKE } from "../constants.js"
import { sseFrame, createPollingFallback } from "../workspace-events.js"
import type { ServerContext } from "../server-context.js"

export async function workspaceEvents(
  ctx: ServerContext,
  request: Request,
  workspaceId: string,
  principal: Principal,
): Promise<Response> {
  const token = ctx.authorize(request, workspaceId)
  if (!token) return ctx.deny(principal, "workspace.events.scope", 403, { resource: workspaceId })
  const eventGate = await ctx.checkCapability("workspace.watch", workspaceId, principal)
  if (eventGate) return eventGate

  const encoder = new TextEncoder()
  const iterators = new Map<string, AsyncIterator<RuntimeEvent>>()
  const pending = new Map<
    string | typeof WAKE,
    Promise<{ sessionId: string | typeof WAKE; result?: IteratorResult<RuntimeEvent> }>
  >()
  // E13i: the legacy `setInterval(listSessions, 5_000)` is REPLACED by
  // the push hook (primary) or the bounded polling fallback (when the
  // backend pre-dates E13i). RFC-0001 documents the fallback contract
  // (backoff 1s→30s, jitter, errors logged not swallowed).
  let discoveryStop: (() => void) | undefined

  const arm = (sessionId: string, iterator: AsyncIterator<RuntimeEvent>) => {
    pending.set(sessionId, iterator.next().then((result) => ({ sessionId, result })))
  }
  const armWake = () => {
    pending.set(
      WAKE,
      new Promise((resolve) => {
        wakeResolve = () => resolve({ sessionId: WAKE })
      }),
    )
  }
  let wakeResolve: () => void = () => {}
  armWake()

  const addSession = (sessionId: string) => {
    if (iterators.has(sessionId)) return
    const iterator = ctx.runtime.subscribeEvents({ sessionId, afterSequence: 0 })[Symbol.asyncIterator]()
    iterators.set(sessionId, iterator)
    arm(sessionId, iterator)
    wakeResolve()
    armWake()
  }
  for (const session of await ctx.runtime.listSessions({ workspaceId })) addSession(session.id)

  const stream = new ReadableStream<Uint8Array>({
    start: (controller) => {
      controller.enqueue(encoder.encode(": unifia stream open\n\n"))
      // E13i: pick the discovery strategy once, at stream open.
      // `hasPushHook` is the boundary adapter's static answer to
      // "does my backend push new-session events?" — a backend that
      // pre-dates E13i reports `false` and we use the bounded
      // polling fallback instead. Mixing both (push + poll) would
      // duplicate every new session and arm `addSession` twice.
      if (ctx.runtime.hasPushHook) {
        discoveryStop = ctx.runtime.onSessionCreated({ workspaceId }, (session) => addSession(session.id))
      } else {
        discoveryStop = createPollingFallback(ctx.runtime, { workspaceId }, (session) => addSession(session.id))
          .stop
      }
    },
    pull: async (controller) => {
      while (true) {
        const winner = await Promise.race(pending.values())
        if (winner.sessionId === WAKE) continue // a session was added mid-race; re-race with the updated set
        pending.delete(winner.sessionId)
        if (!winner.result || winner.result.done) {
          iterators.delete(winner.sessionId)
          continue
        }
        arm(winner.sessionId, iterators.get(winner.sessionId)!)
        controller.enqueue(encoder.encode(sseFrame(winner.result.value)))
        return
      }
    },
    cancel: async () => {
      if (discoveryStop) discoveryStop()
      await Promise.all([...iterators.values()].map((iterator) => iterator.return?.()))
    },
  })
  ctx.allow(principal, "workspace.events", { resource: workspaceId })
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache", "connection": "keep-alive" },
  })
}
