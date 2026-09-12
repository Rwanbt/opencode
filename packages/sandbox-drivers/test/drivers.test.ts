/* SPDX-License-Identifier: MIT */
import { SandboxBroker, assertSandboxDriverConformance, type SandboxDriver, type SandboxPolicy } from "@unifia/contracts"
import { DockerDriver, NativeRestrictedDriver, SandboxPolicyError, SandboxUnavailableError, Wsl2Driver } from "../src/index.js"

let checks = 0
const check = (condition: boolean, message: string): void => {
  checks += 1
  if (!condition) throw new Error(message)
}
const rejects = async (run: () => Promise<unknown>, expected: unknown, message: string): Promise<void> => {
  checks += 1
  try {
    await run()
  } catch (error) {
    if (error instanceof (expected as new () => Error)) return
    throw new Error(`${message} (threw ${String(error)})`)
  }
  throw new Error(`${message} (resolved)`)
}

const policy = (over: Partial<SandboxPolicy> = {}): SandboxPolicy => ({
  backend: "native",
  network: "none",
  filesystem: { readOnly: true },
  resources: { cpu: 1, memoryMb: 128, timeoutMs: 10_000 },
  ...over,
})

// --- Native driver: the contract conformance suite ---------------------------
const native = new NativeRestrictedDriver()
const conformance = await assertSandboxDriverConformance(native)
check(conformance.backend === "native", "conformance reported the wrong backend")
check(conformance.checks.length === 4, `conformance ran ${conformance.checks.length} checks instead of 4`)

// --- It actually executes -----------------------------------------------------
const handle = await native.prepare(policy())
const isWindows = process.platform === "win32"
const echo = isWindows
  ? await native.execute(handle, { command: "cmd.exe", args: ["/c", "echo", "hello-sandbox"] })
  : await native.execute(handle, { command: "/bin/echo", args: ["hello-sandbox"] })
check(echo.exitCode === 0, `echo exited ${echo.exitCode}: ${echo.stderr}`)
check(echo.stdout.includes("hello-sandbox"), `echo produced ${JSON.stringify(echo.stdout)}`)
check(echo.durationMs >= 0, "duration was negative")

// A non-zero exit is reported, not thrown.
const failing = isWindows
  ? await native.execute(handle, { command: "cmd.exe", args: ["/c", "exit", "3"] })
  : await native.execute(handle, { command: "/bin/sh", args: ["-c", "exit 3"] })
check(failing.exitCode === 3, `a failing command reported exit ${failing.exitCode}`)

// A missing command is reported as an execution result, not an unhandled throw.
const missing = await native.execute(handle, { command: "unifia-no-such-binary", args: [] })
check(missing.exitCode === 127, `a missing binary reported exit ${missing.exitCode}`)

// --- The environment is not inherited ------------------------------------------
process.env.UNIFIA_SANDBOX_LEAK_PROBE = "leaked-secret"
const envDump = isWindows
  ? await native.execute(handle, { command: "cmd.exe", args: ["/c", "set"] })
  : await native.execute(handle, { command: "/usr/bin/env", args: [] })
check(!envDump.stdout.includes("leaked-secret"), "the host environment leaked into the sandbox")
const declared = isWindows
  ? await native.execute(handle, { command: "cmd.exe", args: ["/c", "echo", "%UNIFIA_DECLARED%"], env: { UNIFIA_DECLARED: "visible" } })
  : await native.execute(handle, { command: "/bin/sh", args: ["-c", "echo $UNIFIA_DECLARED"], env: { UNIFIA_DECLARED: "visible" } })
check(declared.stdout.includes("visible"), "an explicitly declared variable did not reach the sandbox")
delete process.env.UNIFIA_SANDBOX_LEAK_PROBE

// --- The timeout kills, it does not merely stop waiting -------------------------
const shortHandle = await native.prepare(policy({ resources: { timeoutMs: 700 } }))
const startedAt = Date.now()
const killed = isWindows
  ? await native.execute(shortHandle, { command: "cmd.exe", args: ["/c", "ping", "-n", "20", "127.0.0.1"] })
  : await native.execute(shortHandle, { command: "/bin/sleep", args: ["20"] })
const elapsed = Date.now() - startedAt
check(killed.exitCode === 124, `a timed-out command reported exit ${killed.exitCode}`)
check(killed.stderr.includes("killed after"), "the timeout did not report that it killed the process")
check(elapsed < 10_000, `the timeout took ${elapsed}ms, so it did not enforce its deadline`)

// --- Policy refusals ------------------------------------------------------------
await rejects(() => native.prepare(policy({ network: "open" })), SandboxPolicyError, "an open network policy was accepted")
await rejects(() => native.prepare(policy({ network: "limited" })), SandboxPolicyError, "native accepted a network policy it cannot enforce")
// An unenforceable policy is refused when it is declared, not when something runs.
await rejects(() => native.prepare(policy({ resources: { timeoutMs: 0 } })), SandboxPolicyError, "a zero timeout was accepted at prepare")
await rejects(() => native.prepare(policy({ resources: { timeoutMs: 5_000, cpu: 0 } })), SandboxPolicyError, "a zero cpu allocation was accepted")
await rejects(() => native.prepare(policy({ resources: { timeoutMs: 5_000, memoryMb: -1 } })), SandboxPolicyError, "a negative memory allocation was accepted")
await rejects(() => native.execute({ id: "native-unknown", backend: "native", createdAt: 0, policy: policy() }, { command: "true", args: [] }), SandboxPolicyError, "an unprepared handle was executed")
const readOnlyHandle = await native.prepare(policy({ filesystem: { readOnly: false } }))
check(readOnlyHandle.policy.filesystem.readOnly, "the driver honoured a writable filesystem request instead of forcing read-only")
checks += 1
if (new DockerDriver("alpine:3.21").backend !== "docker") throw new Error("docker driver reports the wrong backend")
try {
  checks += 1
  new DockerDriver("")
  throw new Error("docker driver accepted an unpinned image")
} catch (error) {
  if (!(error instanceof SandboxPolicyError)) throw error
}

// --- WSL2: real availability decides whether it runs ----------------------------
const wsl = new Wsl2Driver("Ubuntu")
const wslInfo = (await wsl.inspect())[0]
check(wslInfo?.backend === "wsl2", "wsl2 inspection omitted its backend")
if (wslInfo?.available) {
  const wslConformance = await assertSandboxDriverConformance(wsl)
  check(wslConformance.checks.length === 4, "wsl2 did not pass the conformance suite")
  const wslHandle = await wsl.prepare(policy({ backend: "wsl2" }))
  const wslEcho = await wsl.execute(wslHandle, { command: "/bin/echo", args: ["hello-wsl"] })
  check(wslEcho.exitCode === 0 && wslEcho.stdout.includes("hello-wsl"), `wsl2 echo failed: ${wslEcho.stderr}`)
  await wsl.terminate(wslHandle)
  process.stdout.write("      wsl2: available, conformance and execution verified\n")
} else {
  process.stdout.write("      wsl2: SKIPPED — the distribution did not respond; availability is reported, not assumed\n")
}

// --- Docker: unavailable must throw, never fall back ------------------------------
const docker = new DockerDriver("alpine:3.21")
const dockerInfo = (await docker.inspect())[0]
check(dockerInfo?.backend === "docker", "docker inspection omitted its backend")
if (dockerInfo?.available) {
  const dockerConformance = await assertSandboxDriverConformance(docker)
  check(dockerConformance.checks.length === 4, "docker did not pass the conformance suite")

  // The conformance suite only proves the plumbing: it runs `true` and checks
  // that an integer exit code came back. Docker earns its place by enforcing
  // isolation the native driver cannot, so the isolation itself is what has to
  // be exercised — otherwise "docker verified" only means the daemon answered.
  const dockerHandle = await docker.prepare(policy({ backend: "docker" }))

  const dockerEcho = await docker.execute(dockerHandle, { command: "echo", args: ["hello-docker"] })
  check(dockerEcho.exitCode === 0 && dockerEcho.stdout.includes("hello-docker"), `docker echo failed: ${dockerEcho.stderr}`)

  // Network "none" is a claim about the container, not about the flag. On a
  // bridge network the container has eth0; with none it has only lo.
  const interfaces = await docker.execute(dockerHandle, { command: "ip", args: ["-o", "addr"] })
  check(interfaces.exitCode === 0, `listing interfaces failed: ${interfaces.stderr}`)
  check(interfaces.stdout.includes("lo"), "the interface listing returned nothing, so an absent eth0 proves nothing")
  check(!interfaces.stdout.includes("eth0"), `the sandbox has a network interface: ${interfaces.stdout}`)

  // Read-only is enforced by the kernel, not by the policy object agreeing with
  // itself: a write into the container root must actually fail.
  const write = await docker.execute(dockerHandle, { command: "touch", args: ["/probe"] })
  check(write.exitCode !== 0, "a write into a read-only sandbox succeeded")
  check(write.stderr.toLowerCase().includes("read-only"), `the write failed for another reason: ${write.stderr}`)

  // The host environment is not inherited, and a declared variable still arrives.
  process.env.UNIFIA_SANDBOX_LEAK_PROBE = "leaked-secret"
  const dockerEnv = await docker.execute(dockerHandle, { command: "env", args: [] })
  check(!dockerEnv.stdout.includes("leaked-secret"), "the host environment leaked into the docker sandbox")
  const dockerDeclared = await docker.execute(dockerHandle, { command: "env", args: [], env: { UNIFIA_DECLARED: "visible" } })
  check(dockerDeclared.stdout.includes("UNIFIA_DECLARED=visible"), "an explicitly declared variable did not reach the docker sandbox")
  delete process.env.UNIFIA_SANDBOX_LEAK_PROBE

  // A writable filesystem request is downgraded, never honoured.
  const dockerWritable = await docker.prepare(policy({ backend: "docker", filesystem: { readOnly: false } }))
  check(dockerWritable.policy.filesystem.readOnly, "the docker driver honoured a writable filesystem request")
  await docker.terminate(dockerWritable)

  // The timeout kills the container rather than merely giving up on waiting.
  // 3s rather than the native driver's 700ms: a container takes about a second
  // to start, and a deadline firing during startup would report exit 124
  // without ever proving that a running process was killed.
  const dockerShort = await docker.prepare(policy({ backend: "docker", resources: { timeoutMs: 3_000 } }))
  const dockerStartedAt = Date.now()
  const dockerKilled = await docker.execute(dockerShort, { command: "sleep", args: ["30"] })
  const dockerElapsed = Date.now() - dockerStartedAt
  check(dockerKilled.exitCode === 124, `a timed-out container reported exit ${dockerKilled.exitCode}`)
  check(dockerElapsed < 20_000, `the docker timeout took ${dockerElapsed}ms, so it did not enforce its deadline`)
  await docker.terminate(dockerShort)

  await docker.terminate(dockerHandle)
  process.stdout.write("      docker: available, conformance + isolation verified (network none, read-only enforced, env not inherited, timeout kills)\n")
} else {
  await rejects(() => docker.prepare(policy({ backend: "docker" })), SandboxUnavailableError, "an unavailable docker backend prepared a sandbox anyway")
  process.stdout.write("      docker: SKIPPED — daemon absent; verified that it refuses rather than falling back\n")
}

// --- The broker never downgrades silently -------------------------------------------
const brokerWithNativeOnly = new SandboxBroker([native as SandboxDriver], ["c:\\workspace"])
const auto = await brokerWithNativeOnly.prepare({ backend: "auto", network: "none", filesystem: { readOnly: true, paths: [] }, resources: { timeoutMs: 5_000 } })
check(auto.backend === "native", `auto selection resolved to ${auto.backend}`)
await rejects(() => new SandboxBroker([]).prepare({ backend: "auto", network: "none", filesystem: { readOnly: true }, resources: {} }), Error, "an empty broker selected a backend")
await rejects(() => brokerWithNativeOnly.prepare({ backend: "docker", network: "none", filesystem: { readOnly: true }, resources: {} }), Error, "the broker substituted a backend that was not requested")

await native.terminate(handle)
await native.terminate(shortHandle)
console.log(`SandboxDrivers: ${checks}/${checks} passed`)
