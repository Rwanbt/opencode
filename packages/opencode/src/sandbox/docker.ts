import { Log } from "@/util/log"
import { execSync, spawn } from "node:child_process"

const log = Log.create({ service: "sandbox.docker" })
const DEFAULT_IMAGE = "node:lts-slim"
const CONTAINER_WORKDIR = "/workspace"

interface DockerContainer {
  id: string
  image: string
  hostDir: string
}

let container: DockerContainer | undefined

/** Check if Docker CLI is available on the host. */
export function isDockerAvailable(): boolean {
  try {
    execSync("docker version --format '{{.Server.Version}}'", {
      stdio: "pipe",
      timeout: 5_000,
    })
    return true
  } catch {
    return false
  }
}

/** Ensure a sandbox container is running for the given project directory. */
export async function ensureContainer(hostDir: string, image?: string): Promise<DockerContainer> {
  if (container && container.hostDir === hostDir) {
    // Verify container is still running
    try {
      execSync(`docker inspect --format='{{.State.Running}}' ${container.id}`, {
        stdio: "pipe",
        timeout: 5_000,
      })
      return container
    } catch {
      log.info("container no longer running, recreating")
      container = undefined
    }
  }

  const img = image ?? DEFAULT_IMAGE
  log.info("creating sandbox container", { image: img, hostDir })

  // Pull image if not present (best-effort, may already exist)
  try {
    execSync(`docker image inspect ${img}`, { stdio: "pipe", timeout: 30_000 })
  } catch {
    log.info("pulling docker image", { image: img })
    execSync(`docker pull ${img}`, { stdio: "pipe", timeout: 120_000 })
  }

  // Convert Windows path to Docker-compatible mount path
  const mountPath = hostDir.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`)

  // Create container with project mounted
  const id = execSync(
    [
      "docker",
      "create",
      "--interactive",
      "--workdir",
      CONTAINER_WORKDIR,
      "-v",
      `${mountPath}:${CONTAINER_WORKDIR}`,
      img,
      "sleep",
      "infinity",
    ].join(" "),
    { encoding: "utf-8", timeout: 30_000 },
  ).trim()

  execSync(`docker start ${id}`, { stdio: "pipe", timeout: 10_000 })
  log.info("sandbox container started", { id: id.slice(0, 12) })

  container = { id, image: img, hostDir }
  registerCleanup()
  return container
}

/** Execute a command inside the sandbox container. Returns { stdout, exitCode }. */
export async function exec(
  containerInfo: DockerContainer,
  command: string,
  options?: {
    cwd?: string
    env?: Record<string, string>
    timeout?: number
    onOutput?: (chunk: string) => void
    abort?: AbortSignal
  },
): Promise<{ output: string; exitCode: number | null }> {
  const workdir = options?.cwd
    ? options.cwd.replace(containerInfo.hostDir, CONTAINER_WORKDIR).replace(/\\/g, "/")
    : CONTAINER_WORKDIR

  const args = ["exec", "-w", workdir]

  // Pass environment variables
  if (options?.env) {
    for (const [k, v] of Object.entries(options.env)) {
      // Skip host-specific env vars that don't make sense in container
      if (k.startsWith("OPENCODE_") || k === "HOME" || k === "PATH" || k === "SHELL") continue
      args.push("-e", `${k}=${v}`)
    }
  }

  args.push(containerInfo.id, "sh", "-c", command)

  return new Promise<{ output: string; exitCode: number | null }>((resolve, reject) => {
    let output = ""
    const proc = spawn("docker", args, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: options?.timeout,
    })

    const handleChunk = (chunk: Buffer) => {
      const text = chunk.toString()
      output += text
      options?.onOutput?.(text)
    }

    proc.stdout?.on("data", handleChunk)
    proc.stderr?.on("data", handleChunk)

    if (options?.abort) {
      const abortHandler = () => {
        proc.kill("SIGTERM")
        setTimeout(() => proc.kill("SIGKILL"), 3_000)
      }
      if (options.abort.aborted) {
        abortHandler()
      } else {
        options.abort.addEventListener("abort", abortHandler, { once: true })
      }
    }

    proc.on("close", (code) => {
      resolve({ output, exitCode: code })
    })
    proc.on("error", (err) => {
      reject(err)
    })
  })
}

/** Stop and remove the sandbox container. */
export async function cleanup(): Promise<void> {
  if (!container) return
  const id = container.id
  container = undefined
  try {
    execSync(`docker rm -f ${id}`, { stdio: "pipe", timeout: 10_000 })
    log.info("sandbox container removed", { id: id.slice(0, 12) })
  } catch (err) {
    log.warn("failed to remove sandbox container", { id: id.slice(0, 12), error: err })
  }
}

/** Get the container workdir equivalent of a host path. */
export function toContainerPath(hostDir: string, hostPath: string): string {
  return hostPath.replace(hostDir, CONTAINER_WORKDIR).replace(/\\/g, "/")
}

// Best-effort cleanup on process exit
let cleanupRegistered = false
export function registerCleanup(): void {
  if (cleanupRegistered) return
  cleanupRegistered = true
  process.on("exit", () => {
    if (!container) return
    try {
      execSync(`docker rm -f ${container.id}`, { stdio: "pipe", timeout: 5_000 })
    } catch { /* best-effort */ }
  })
}
