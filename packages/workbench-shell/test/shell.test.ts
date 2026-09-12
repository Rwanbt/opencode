/* SPDX-License-Identifier: MIT */

/**
 * The five §20 exit criteria, plus the three UX rules that are statements about
 * behaviour rather than about appearance.
 */

import type { RuntimeAdapter, RuntimeEvent, Session } from "@unifia/contracts"
import { SHELL_MODES, ShellError, WORK_V1_FUNCTIONS, WorkbenchShell, isReadOnly, surface, type ShellMode } from "../src/index.js"
import { test } from "bun:test"

test('shell.test', async () => {

let checks = 0
const check = (condition: boolean, message: string): void => {
  checks += 1
  if (!condition) throw new Error(message)
}
const refuses = (run: () => unknown, reason: string, message: string): void => {
  checks += 1
  try {
    run()
  } catch (error) {
    if (error instanceof ShellError && error.refusal.reason === reason) return
    throw new Error(`${message} (threw ${error instanceof ShellError ? error.refusal.reason : String(error)})`)
  }
  throw new Error(`${message} (did not refuse)`)
}

const now = 1_700_000_000_000

// One runtime, and it counts how many times anyone asks it who it is.
let runtimesConstructed = 0
const makeRuntime = (): RuntimeAdapter => {
  runtimesConstructed += 1
  const sessions: Session[] = [
    { id: "s-1", workspaceId: "ws-1", runtimeId: "fake", createdAt: now, messageCount: 2 },
    { id: "s-2", workspaceId: "ws-1", runtimeId: "fake", createdAt: now, messageCount: 0 },
  ]
  return {
    getInfo: async () => ({ id: "fake", version: "1.0.0", capabilities: [], healthy: true }),
    listSessions: async () => sessions,
    createSession: async ({ workspaceId }) => {
      const session: Session = { id: `s-${sessions.length + 1}`, workspaceId, runtimeId: "fake", createdAt: now, messageCount: 0 }
      sessions.push(session)
      return session
    },
    sendPrompt: async () => {},
    subscribeEvents: () => ({ [Symbol.asyncIterator]: () => ({ next: async (): Promise<IteratorResult<RuntimeEvent>> => ({ done: true, value: undefined }) }) }),
    cancelSession: async () => {},
  }
}

const runtime = makeRuntime()
const shell = new WorkbenchShell({ runtime, runtimeId: "fake", now: () => now })

// --- The navigation and the Work V1 surface match §20 ---------------------------
check(SHELL_MODES.length === 4, `the shell declares ${SHELL_MODES.length} modes instead of 4`)
for (const mode of ["code", "work", "design", "automate"]) check((SHELL_MODES as readonly string[]).includes(mode), `mode from the plan is missing: ${mode}`)
check(WORK_V1_FUNCTIONS.length === 11, `Work V1 declares ${WORK_V1_FUNCTIONS.length} functions instead of the 11 in §20`)
for (const fn of ["workspace-switcher", "session-chat", "files", "search", "artifacts", "documents", "trace", "approvals", "activity-log", "capability-picker", "export"]) {
  check((WORK_V1_FUNCTIONS as readonly string[]).includes(fn), `Work V1 function from the plan is missing: ${fn}`)
}

// --- Criterion: switching mode does not change runtime ----------------------------
const before = runtimesConstructed
for (const mode of [...SHELL_MODES, ...SHELL_MODES, "work" as ShellMode]) {
  check(shell.switchMode(mode) === runtime, `switching to ${mode} handed back a different runtime`)
}
check(runtimesConstructed === before, `${runtimesConstructed - before} extra runtimes were built while switching modes`)
check(shell.modeSwitches > 0, "no mode switch was recorded")
refuses(() => shell.switchMode("terminal" as ShellMode), "unknown-mode", "an undeclared mode was accepted")

// --- Criterion: Code and Work share sessions -----------------------------------------
shell.switchMode("code")
const fromCode = await shell.openSession("s-1")
shell.switchMode("work")
const fromWork = await shell.openSession("s-1")
check(fromCode !== undefined && fromWork !== undefined, "a session was not reachable from both modes")
check(fromCode === fromWork, "Code and Work resolved the same session id to different objects")
check(fromWork?.runtimeId === "fake", "the session changed runtime with the mode")

// --- Criterion: an artifact made in Work opens in Code and Design ----------------------
shell.switchMode("work")
const artifact = shell.createArtifact("artifact-abc")
check(artifact.createdIn === "work", "the artifact did not record the mode that made it")
for (const mode of ["code", "design", "automate", "work"] as ShellMode[]) {
  shell.switchMode(mode)
  const opened = shell.openArtifact("artifact-abc")
  check(opened !== undefined, `an artifact created in Work did not open in ${mode}`)
  check(opened?.value.artifactId === "artifact-abc", `opening from ${mode} returned a different lineage`)
  // createdIn is provenance, never a gate: it survives the round trip unchanged.
  check(opened?.value.createdIn === "work", `opening from ${mode} rewrote the artifact's origin`)
  check(opened?.provenance.mode === mode, `the result did not carry the mode it was surfaced in`)
}
check(shell.openArtifact("artifact-missing") === undefined, "an unknown artifact id produced a result")

// --- UX rule: every result carries visible provenance ------------------------------------
shell.switchMode("work")
const result = shell.invoke("search", "s-1", () => ["hit"])
check(result.provenance.sessionId === "s-1" && result.provenance.mode === "work" && result.provenance.runtimeId === "fake", "a result was produced without full provenance")
check(surface(result) === result, "a result with provenance was refused")
refuses(() => surface({ value: 1 }), "missing-provenance", "a result without provenance was surfaced")

// --- UX rule: destructive actions require a preview the user has seen ----------------------
refuses(() => shell.commit("artifact.delete", "artifact-abc", undefined, () => "deleted"), "preview-required", "a destructive action ran with no preview")
const token = shell.preview("artifact.delete", "artifact-abc")
refuses(() => shell.commit("artifact.delete", "artifact-other", token, () => "deleted"), "preview-mismatch", "a preview of one target authorised another")
refuses(() => shell.commit("session.delete", "artifact-abc", token, () => "deleted"), "preview-mismatch", "a preview of one action authorised another")
check(shell.commit("artifact.delete", "artifact-abc", token, () => "deleted") === "deleted", "a matching preview did not authorise its action")
refuses(() => shell.commit("artifact.delete", "artifact-abc", token, () => "deleted"), "preview-spent", "a preview token authorised a second deletion")
// Non-destructive work is not made ceremonial by any of this.
check(shell.commit("search", "query", undefined, () => "ok") === "ok", "a harmless action was forced through the preview gate")

// --- Criterion: mobile consumes the same contracts, read-only -------------------------------
const mobile = shell.projectReadOnly()
check(mobile.runtime === runtime, "the read-only projection built a second runtime")
check(mobile.readOnly, "the projection is not marked read-only")
check(mobile.functions().length < WORK_V1_FUNCTIONS.length, "the read-only projection offers every write function")
check(mobile.functions().every(isReadOnly), "the read-only projection offers a write function")
for (const fn of WORK_V1_FUNCTIONS.filter(isReadOnly)) {
  check(mobile.invoke(fn, "s-1", () => fn).value === fn, `the read-only projection refused the read function ${fn}`)
}
for (const fn of WORK_V1_FUNCTIONS.filter((candidate) => !isReadOnly(candidate))) {
  refuses(() => mobile.invoke(fn, "s-1", () => fn), "write-in-read-only", `the read-only projection allowed the write function ${fn}`)
}
check(!shell.readOnly, "projecting a read-only view made the original read-only")

// --- Criterion: the shell stays usable without a network ---------------------------------------
// Every network entry point throws, then the whole surface is driven. A shell
// that reaches for the network anywhere in this path fails here rather than on
// a train.
const realFetch = globalThis.fetch
globalThis.fetch = (() => { throw new Error("the shell reached for the network") }) as typeof fetch
try {
  const offline = new WorkbenchShell({ runtime, runtimeId: "fake", now: () => now })
  for (const mode of SHELL_MODES) {
    offline.switchMode(mode)
    for (const fn of WORK_V1_FUNCTIONS) check(offline.invoke(fn, "s-1", () => fn).value === fn, `${fn} failed offline in ${mode}`)
  }
  offline.createArtifact("artifact-offline")
  check(offline.openArtifact("artifact-offline") !== undefined, "an artifact was unreadable offline")
  const offlineToken = offline.preview("workspace.delete", "ws-1")
  check(offline.commit("workspace.delete", "ws-1", offlineToken, () => "gone") === "gone", "a previewed action failed offline")
  check((await offline.openSession("s-2"))?.id === "s-2", "a session was unreachable offline")
} finally {
  globalThis.fetch = realFetch
}

console.log(`WorkbenchShell: ${checks}/${checks} passed`)
})
