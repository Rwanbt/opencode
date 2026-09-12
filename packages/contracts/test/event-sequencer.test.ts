/* SPDX-License-Identifier: MIT */
import { EventGapError, SessionEventHub, SessionEventHubRegistry } from "../src/event-sequencer.ts"
import type { RuntimeEvent } from "../src/runtime.ts"

let checks = 0
const check = (condition: boolean, message: string): void => {
  checks += 1
  if (!condition) throw new Error(message)
}
const refuses = (run: () => unknown, message: string): void => {
  checks += 1
  try {
    run()
  } catch {
    return
  }
  throw new Error(message)
}

const event = (text: string): Omit<RuntimeEvent, "sequence"> => ({ sessionId: "s1", type: "text", data: text, timestamp: 1 })
const take = async (stream: AsyncIterable<RuntimeEvent>, count: number): Promise<RuntimeEvent[]> => {
  const iterator = stream[Symbol.asyncIterator]()
  const collected: RuntimeEvent[] = []
  for (let index = 0; index < count; index += 1) {
    const next = await Promise.race([iterator.next(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("stream stalled")), 2_000))])
    if (next.done) break
    collected.push(next.value)
  }
  await iterator.return?.()
  return collected
}

// --- Sequences are assigned and monotonic -------------------------------------
const hub = new SessionEventHub()
check(hub.lastSequence === 0, "a fresh hub did not start at sequence zero")
const first = hub.publish(event("one"))
const second = hub.publish(event("two"))
check(first.sequence === 1 && second.sequence === 2, `sequences were ${first.sequence} and ${second.sequence}`)
check(hub.lastSequence === 2, "lastSequence did not follow publication")

// --- Replay from a cursor -----------------------------------------------------
check((await take(hub.subscribe(0), 2)).map((entry) => entry.data).join(",") === "one,two", "a reader from zero did not receive the history")
check((await take(hub.subscribe(1), 1)).map((entry) => entry.data).join(",") === "two", "a reader resuming at 1 did not replay only what followed")
// Resuming at the head must replay nothing: the reader waits instead of being
// handed an event it has already seen.
const atHead = hub.subscribe(2)[Symbol.asyncIterator]()
const headPending = atHead.next()
const settled = await Promise.race([headPending.then(() => "settled"), new Promise((resolve) => setTimeout(() => resolve("pending"), 150))])
check(settled === "pending", "resuming at the head replayed an event the reader had already seen")
await atHead.return?.()

// A reconnecting reader receives what it missed *and then* what happens next.
const resumed = hub.subscribe(1)
const iterator = resumed[Symbol.asyncIterator]()
check((await iterator.next()).value?.data === "two", "the reconnecting reader did not replay the missed event")
const live = iterator.next()
const third = hub.publish(event("three"))
check((await live).value?.sequence === third.sequence, "the reconnecting reader did not continue into live events")
await iterator.return?.()

// --- A live reader is woken, not polled ---------------------------------------
const liveHub = new SessionEventHub()
const liveIterator = liveHub.subscribe()[Symbol.asyncIterator]()
const waiting = liveIterator.next()
liveHub.publish(event("delivered"))
check((await waiting).value?.data === "delivered", "a waiting reader was not woken by a publication")
await liveIterator.return?.()

// --- A gap is reported, never silently skipped --------------------------------
const small = new SessionEventHub(2)
for (const text of ["a", "b", "c", "d"]) small.publish(event(text))
check(small.oldestRetained === 2, `oldestRetained was ${small.oldestRetained}`)
refuses(() => small.subscribe(1), "resuming from a dropped sequence did not raise a gap error")
try {
  small.subscribe(1)
} catch (error) {
  checks += 1
  if (!(error instanceof EventGapError)) throw new Error("the gap was not reported as an EventGapError")
  checks += 1
  if (error.requested !== 1 || error.oldestRetained !== 2) throw new Error("the gap error did not carry the cursor bounds")
}
check((await take(small.subscribe(2), 2)).map((entry) => entry.data).join(",") === "c,d", "a reader at the retention boundary did not get the retained events")
check((await take(small.subscribe(0), 2)).map((entry) => entry.data).join(",") === "c,d", "a reader from zero did not get what is still retained")

refuses(() => hub.subscribe(-1), "a negative cursor was accepted")
refuses(() => hub.subscribe(1.5), "a fractional cursor was accepted")
refuses(() => new SessionEventHub(0), "a zero history limit was accepted")

// --- Independent readers -------------------------------------------------------
const shared = new SessionEventHub()
const readerA = shared.subscribe()[Symbol.asyncIterator]()
const readerB = shared.subscribe()[Symbol.asyncIterator]()
const pendingA = readerA.next()
const pendingB = readerB.next()
shared.publish(event("broadcast"))
check((await pendingA).value?.data === "broadcast" && (await pendingB).value?.data === "broadcast", "a publication did not reach every live reader")
await readerA.return?.()
const stillLive = readerB.next()
shared.publish(event("after one reader left"))
check((await stillLive).value?.data === "after one reader left", "one reader returning ended another reader's stream")
await readerB.return?.()

// --- Close ends readers ---------------------------------------------------------
const closing = new SessionEventHub()
const closingIterator = closing.subscribe()[Symbol.asyncIterator]()
const pendingClose = closingIterator.next()
closing.close()
check((await pendingClose).done === true, "closing the hub did not end a waiting reader")
refuses(() => closing.publish(event("late")), "a closed hub accepted a publication")

// --- Registry -------------------------------------------------------------------
const registry = new SessionEventHubRegistry()
const firstLookup = registry.for("s1")
const secondLookup = registry.for("s1")
const otherSession = registry.for("s2")
check(firstLookup === secondLookup, "the registry created two hubs for one session")
check(firstLookup !== otherSession, "the registry shared one hub across sessions")
registry.for("s1").publish(event("kept"))
registry.close("s1")
check(registry.for("s1").lastSequence === 0, "closing a session did not discard its hub")
registry.closeAll()

console.log(`SessionEventHub: ${checks}/${checks} passed`)
