/* SPDX-License-Identifier: MIT */
import { loadConfigFromEnv, startWorkbench } from "../src/bootstrap.js"

const handle = await startWorkbench(loadConfigFromEnv({
  ...process.env,
  UNIFIA_WORKBENCH_PORT: process.env.UNIFIA_WORKBENCH_PORT ?? "0",
}))

process.stdout.write(`${JSON.stringify({ port: handle.port, instanceId: handle.instanceId })}\n`)

const stop = () => { void handle.stop().then(() => process.exit(0)) }
process.on("SIGINT", stop)
process.on("SIGTERM", stop)
