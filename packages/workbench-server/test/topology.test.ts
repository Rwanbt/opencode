/* SPDX-License-Identifier: MIT */
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createWorkbenchApp, loadConfigFromEnv, startWorkbench } from "../src/bootstrap.js"

async function spawnTopologyWorker(env: Record<string, string>): Promise<{ process: Bun.Subprocess; port: number; instanceId: string }> {
  const child = Bun.spawn([process.execPath, path.join(import.meta.dir, "topology-worker.ts")], {
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  })
  const reader = child.stdout.getReader()
  const decoder = new TextDecoder()
  let line = ""
  while (!line.includes("\n")) {
    const chunk = await reader.read()
    if (chunk.done) break
    line += decoder.decode(chunk.value, { stream: true })
  }
  reader.releaseLock()
  const firstLine = line.trim().split("\n")[0]
  const payload = JSON.parse(firstLine) as { port?: number; instanceId?: string }
  if (typeof payload.port !== "number" || typeof payload.instanceId !== "string") {
    throw new Error(`topology worker returned invalid identity: ${firstLine}`)
  }
  return { process: child, port: payload.port, instanceId: payload.instanceId }
}

const root = await mkdtemp(path.join(os.tmpdir(), "unifia-topology-"))
const key = "unifia-topology-signing-key-0123456789"
const log = path.join(root, ".unifia", "audit.jsonl")
try {
  const config = loadConfigFromEnv({ UNIFIA_WORKBENCH_SIGNING_KEY: key, UNIFIA_WORKBENCH_PORT: "0", UNIFIA_WORKBENCH_AUDIT_LOG: log })
  const first = await startWorkbench(config)
  let occupied = false
  try {
    await startWorkbench({ ...config, port: first.port })
  } catch {
    occupied = true
  }
  if (!occupied) throw new Error("a second server accepted an occupied port")

  const port = first.port
  await first.stop()
  const second = await startWorkbench({ ...config, port })
  if (second.port !== port) throw new Error("the server did not restart on the released port")
  if (second.instanceId === first.instanceId) throw new Error("the restarted server reused the previous process instance id")
  await second.stop()

  const automaticA = await startWorkbench({ ...config, port: 0 })
  const automaticB = await startWorkbench({ ...config, port: 0 })
  if (automaticA.port === automaticB.port) throw new Error("automatic-port servers shared a listener")
  if (automaticA.instanceId === automaticB.instanceId) throw new Error("automatic-port servers shared a process identity")
  await automaticA.stop()
  await automaticB.stop()

  const processA = await spawnTopologyWorker({ UNIFIA_WORKBENCH_SIGNING_KEY: key, UNIFIA_WORKBENCH_AUDIT_LOG: path.join(root, "process-a.jsonl") })
  const processB = await spawnTopologyWorker({ UNIFIA_WORKBENCH_SIGNING_KEY: key, UNIFIA_WORKBENCH_AUDIT_LOG: path.join(root, "process-b.jsonl") })
  if (processA.port === processB.port) throw new Error("independent workers shared an automatic port")
  if (processA.instanceId === processB.instanceId) throw new Error("independent workers shared a process identity")
  processA.process.kill("SIGTERM")
  processB.process.kill("SIGTERM")
  await Promise.all([processA.process.exited, processB.process.exited])

  const app = createWorkbenchApp(config)
  if ((await app.server.shutdown()).length !== 0) throw new Error("an unstarted server did not shut down cleanly")
  console.log("WorkbenchTopology: 5/5 passed")
} finally {
  await rm(root, { recursive: true, force: true })
}
