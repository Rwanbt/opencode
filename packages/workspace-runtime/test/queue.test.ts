/* SPDX-License-Identifier: MIT */
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { DurableQueue } from "../src/index.js"

const root = await mkdtemp(path.join(os.tmpdir(), "unifia-queue-"))
try {
  const queue = new DurableQueue<{ value: string }>(root)
  const first = await queue.enqueue("outbox", { value: "one" })
  const second = await queue.enqueue("outbox", { value: "two" })
  if (first.sequence !== 1 || second.sequence !== 2) throw new Error("queue sequence is not monotone")
  if ((await queue.pending("outbox")).length !== 2) throw new Error("pending queue lost an item")
  await queue.acknowledge("outbox", first.sequence)
  const remaining = await queue.pending("outbox")
  if (remaining.length !== 1 || remaining[0]?.sequence !== 2) throw new Error("ack did not remove only the selected item")

  const inboxPath = path.join(root, ".unifia", "queues", "inbox.jsonl")
  await appendFile(inboxPath, '{"kind":"item","sequence":1,"payload":{"value":"ok"}}\n{"kind":"item","sequence":2')
  const repaired = await queue.repair("inbox")
  if (!repaired.truncated || repaired.validRecords !== 1) throw new Error("truncated tail was not repaired")
  if ((await queue.pending("inbox"))[0]?.payload.value !== "ok") throw new Error("repaired record is not readable")
  if ((await readFile(inboxPath, "utf8")).endsWith("2")) throw new Error("partial record remained after repair")
  console.log("DurableQueue: 4/4 passed")
} finally {
  await rm(root, { recursive: true, force: true })
}