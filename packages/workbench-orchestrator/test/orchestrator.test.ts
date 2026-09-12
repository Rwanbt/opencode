/* SPDX-License-Identifier: MIT */
import { FakeRuntimeAdapter, type RuntimeAdapter } from "@unifia/contracts"
import { MultiWorkspaceRouter, UnknownWorkspaceError, WorkbenchOrchestrator, WorkspaceLimitError } from "../src/index.js"

let checks = 0
const check = (condition: boolean, message: string): void => {
  checks += 1
  if (!condition) throw new Error(message)
}
const rejects = async (run: () => Promise<unknown>, message: string): Promise<void> => {
  checks += 1
  try {
    await run()
  } catch {
    return
  }
  throw new Error(message)
}
const throws = (run: () => unknown, expected: unknown, message: string): void => {
  checks += 1
  try {
    run()
  } catch (error) {
    if (error instanceof (expected as new () => Error)) return
    throw new Error(`${message} (threw ${String(error)})`)
  }
  throw new Error(`${message} (did not throw)`)
}

/** Counts how many runtimes are constructed, so "no restart" is measurable. */
let runtimesCreated = 0
const makeRuntime = (): RuntimeAdapter => {
  runtimesCreated += 1
  return new FakeRuntimeAdapter(() => 1_000)
}

// --- The exit criterion: switching workspace must not restart the core -------
const clock = { value: 10_000 }
const runtime = makeRuntime()
const orchestrator = new WorkbenchOrchestrator(runtime, { idleTimeoutMs: 5_000, maxOpenWorkspaces: 3, now: () => clock.value })
check(runtimesCreated === 1, `setup created ${runtimesCreated} runtimes instead of 1`)

orchestrator.open("ws-a")
orchestrator.open("ws-b")
const sessionA = await orchestrator.router.createSession("ws-a")
const sessionB = await orchestrator.router.createSession("ws-b")

for (let switches = 0; switches < 25; switches += 1) {
  orchestrator.use(switches % 2 === 0 ? "ws-a" : "ws-b")
  await orchestrator.router.listSessions({ workspaceId: switches % 2 === 0 ? "ws-a" : "ws-b" })
}
check(runtimesCreated === 1, `25 workspace switches created ${runtimesCreated} runtimes; the core was restarted`)
check((await orchestrator.health()).runtimeHealthy, "the shared runtime is not healthy after switching")

// --- Isolation is enforced by scoping, not by multiplying runtimes ----------
const listedA = await orchestrator.router.listSessions({ workspaceId: "ws-a" })
check(listedA.length === 1 && listedA[0].id === sessionA.id, "workspace A did not see exactly its own session")
check(!listedA.some((session) => session.id === sessionB.id), "a session leaked across workspaces")

await rejects(() => orchestrator.router.sendPrompt("ws-a", { sessionId: sessionB.id, prompt: "cross" }), "a workspace prompted another workspace's session")
await rejects(() => orchestrator.router.cancelSession("ws-a", sessionB.id), "a workspace cancelled another workspace's session")
throws(() => orchestrator.router.subscribeEvents("ws-a", sessionB.id), Error, "a workspace subscribed to another workspace's events")

// The owning workspace still works.
await orchestrator.router.sendPrompt("ws-a", { sessionId: sessionA.id, prompt: "hello" })
const stream = orchestrator.router.subscribeEvents("ws-a", sessionA.id)[Symbol.asyncIterator]()
const event = await Promise.race([stream.next(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("event timeout")), 5_000))])
check(!event.done && event.value.data === "hello", "the owning workspace did not receive its own event")
await stream.return?.()

// --- A runtime that ignores scope must not leak through the router -----------
const leakyRuntime: RuntimeAdapter = {
  getInfo: async () => ({ id: "fake", version: "leaky", capabilities: [], healthy: true }),
  listSessions: async () => [
    { id: "s-own", workspaceId: "ws-x", runtimeId: "fake", createdAt: 1, messageCount: 0 },
    { id: "s-other", workspaceId: "ws-y", runtimeId: "fake", createdAt: 1, messageCount: 0 },
  ],
  createSession: async (input) => ({ id: "s-new", workspaceId: input.workspaceId, runtimeId: "fake", createdAt: 1, messageCount: 0 }),
  sendPrompt: async () => {},
  subscribeEvents: () => ({ [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined }) }) }),
  cancelSession: async () => {},
}
const leakyRouter = new MultiWorkspaceRouter(leakyRuntime)
const filtered = await leakyRouter.listSessions({ workspaceId: "ws-x" })
check(filtered.length === 1 && filtered[0].id === "s-own", "the router trusted a runtime that ignored the scope")

const mislabelling: RuntimeAdapter = { ...leakyRuntime, createSession: async () => ({ id: "s-bad", workspaceId: "ws-other", runtimeId: "fake", createdAt: 1, messageCount: 0 }) }
await rejects(() => new MultiWorkspaceRouter(mislabelling).createSession("ws-x"), "the router accepted a session scoped to another workspace")

// --- Lifecycle --------------------------------------------------------------
check(orchestrator.openWorkspaces.length === 2, `expected 2 open workspaces, got ${orchestrator.openWorkspaces.length}`)
const reopened = orchestrator.open("ws-a")
check(orchestrator.openWorkspaces.length === 2, "re-opening an open workspace created a second lease")
check(reopened.workspaceId === "ws-a", "re-opening returned the wrong lease")
throws(() => orchestrator.use("ws-unknown"), UnknownWorkspaceError, "using an unopened workspace was accepted")

orchestrator.open("ws-c")
throws(() => orchestrator.open("ws-d"), WorkspaceLimitError, "the workspace limit was not enforced")

// Idle eviction closes untouched workspaces and only those.
// ws-b and ws-c were last touched at 10 000; ws-a is refreshed at 11 000. At
// 15 500 the deadline is 10 500, so b and c are past it and a is not — the gap
// has to stay under the 5 000 ms timeout for ws-a to survive.
clock.value += 1_000
orchestrator.use("ws-a")
clock.value += 4_500
const evicted = orchestrator.evictIdle()
check(evicted.includes("ws-b") && evicted.includes("ws-c"), `eviction closed ${evicted.join(",")}`)
check(!evicted.includes("ws-a"), "eviction closed a workspace that was still in use")
check(runtimesCreated === 1, "eviction disposed and recreated the runtime")
check((await orchestrator.health()).runtimeHealthy, "the runtime did not survive eviction")

// Closing a workspace forgets its sessions without touching the runtime.
check(orchestrator.close("ws-a"), "closing an open workspace returned false")
check(!orchestrator.close("ws-a"), "closing an already-closed workspace returned true")
await rejects(() => orchestrator.router.sendPrompt("ws-a", { sessionId: sessionA.id, prompt: "after close" }), "a closed workspace could still prompt its old session")

// Shutdown releases workspaces and leaves the runtime alive and usable.
orchestrator.open("ws-e")
const closed = orchestrator.shutdown()
check(closed.includes("ws-e"), "shutdown did not report the workspaces it closed")
check(orchestrator.openWorkspaces.length === 0, "shutdown left a workspace open")
check(runtimesCreated === 1, "shutdown recreated the runtime")
const afterShutdown = await orchestrator.health()
check(afterShutdown.runtimeHealthy && afterShutdown.openWorkspaces === 0, "the runtime did not outlive the orchestrator's workspaces")
check(afterShutdown.routedCalls > 25, `routedCalls was ${afterShutdown.routedCalls}, so routing was not measured`)

console.log(`WorkbenchOrchestrator: ${checks}/${checks} passed`)
