import { Effect, Layer, Schema, ServiceMap, Stream } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import * as CrossSpawnSpawner from "@/effect/cross-spawn-spawner"
import { makeRuntime } from "@/effect/run-service"
import { withTransientReadRetry } from "@/util/effect-http-client"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import path from "node:path"
import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { Flag } from "../flag/flag"
import { Log } from "../util/log"
import { CHANNEL as channel, VERSION as version } from "./meta"

import semver from "semver"

// This fork publishes its own releases (tags `v<semver>-fork[.N]`, see
// .github/workflows/release.yml) instead of anomalyco/opencode's. Update
// checks must compare against this repo, or every install looks perpetually
// out of date against upstream's own (unrelated) version numbering.
const FORK_REPO = "Rwanbt/unifia"

// The npm package the CLI installs and upgrades itself as. Kept next to
// FORK_REPO because the two have to name the same product: the update check
// used to read upstream's `opencode-ai` and then install `unifia-ai`, so it
// compared this fork against a version line that is not its own.
const NPM_PACKAGE = "unifia-ai"

// Shipped as a release asset by .github/workflows/release.yml, so the
// installer the upgrade path runs is the one this repo builds.
const INSTALL_SCRIPT_URL = `https://github.com/${FORK_REPO}/releases/latest/download/install`

export namespace Installation {
  const log = Log.create({ service: "installation" })

  // Unifia distributes through the install script, npm and the desktop
  // updaters. Upstream additionally ships to Homebrew, Scoop and Chocolatey;
  // those methods are deliberately absent here rather than re-pointed, because
  // every one of them resolved to upstream's package — detecting a channel this
  // fork does not publish to is how a Unifia install got told that OpenCode's
  // latest version was available to it.
  export type Method = "curl" | "npm" | "yarn" | "pnpm" | "bun" | "unknown"

  export type ReleaseType = "patch" | "minor" | "major"

  export const Event = {
    Updated: BusEvent.define(
      "installation.updated",
      z.object({
        version: z.string(),
      }),
    ),
    UpdateAvailable: BusEvent.define(
      "installation.update-available",
      z.object({
        version: z.string(),
      }),
    ),
  }

  export function getReleaseType(current: string, latest: string): ReleaseType {
    const currMajor = semver.major(current)
    const currMinor = semver.minor(current)
    const newMajor = semver.major(latest)
    const newMinor = semver.minor(latest)

    if (newMajor > currMajor) return "major"
    if (newMinor > currMinor) return "minor"
    return "patch"
  }

  export const Info = z
    .object({
      version: z.string(),
      latest: z.string(),
    })
    .meta({
      ref: "InstallationInfo",
    })
  export type Info = z.infer<typeof Info>

  export const VERSION = version
  export const CHANNEL = channel
  export const USER_AGENT = `opencode/${CHANNEL}/${VERSION}/${Flag.UNIFIA_CLIENT}`

  export function isPreview() {
    return CHANNEL !== "latest"
  }

  export function isLocal() {
    return CHANNEL === "local"
  }

  export class UpgradeFailedError extends Schema.TaggedErrorClass<UpgradeFailedError>()("UpgradeFailedError", {
    stderr: Schema.String,
  }) {}

  // Response schemas for external version APIs
  const GitHubRelease = Schema.Struct({ tag_name: Schema.String })
  const NpmPackage = Schema.Struct({ version: Schema.String })

  export interface Interface {
    readonly info: () => Effect.Effect<Info>
    readonly method: () => Effect.Effect<Method>
    readonly latest: (method?: Method) => Effect.Effect<string>
    readonly upgrade: (method: Method, target: string) => Effect.Effect<void, UpgradeFailedError>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Installation") {}

  export const layer: Layer.Layer<Service, never, HttpClient.HttpClient | ChildProcessSpawner.ChildProcessSpawner> =
    Layer.effect(
      Service,
      Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient
        const httpOk = HttpClient.filterStatusOk(withTransientReadRetry(http))
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

        const text = Effect.fnUntraced(
          function* (cmd: string[], opts?: { cwd?: string; env?: Record<string, string> }) {
            const proc = ChildProcess.make(cmd[0], cmd.slice(1), {
              cwd: opts?.cwd,
              env: opts?.env,
              extendEnv: true,
            })
            const handle = yield* spawner.spawn(proc)
            const out = yield* Stream.mkString(Stream.decodeText(handle.stdout))
            yield* handle.exitCode
            return out
          },
          Effect.scoped,
          Effect.catch(() => Effect.succeed("")),
        )

        const run = Effect.fnUntraced(
          function* (cmd: string[], opts?: { cwd?: string; env?: Record<string, string> }) {
            const proc = ChildProcess.make(cmd[0], cmd.slice(1), {
              cwd: opts?.cwd,
              env: opts?.env,
              extendEnv: true,
            })
            const handle = yield* spawner.spawn(proc)
            const [stdout, stderr] = yield* Effect.all(
              [Stream.mkString(Stream.decodeText(handle.stdout)), Stream.mkString(Stream.decodeText(handle.stderr))],
              { concurrency: 2 },
            )
            const code = yield* handle.exitCode
            return { code, stdout, stderr }
          },
          Effect.scoped,
          Effect.catch(() => Effect.succeed({ code: ChildProcessSpawner.ExitCode(1), stdout: "", stderr: "" })),
        )

        const upgradeCurl = Effect.fnUntraced(
          function* (target: string) {
            // The fork's own installer, published as a release asset. This read
            // `https://opencode.ai/install` — upstream's script, on a domain
            // this fork does not control — so `unifia upgrade` on a curl
            // install fetched and ran OpenCode's installer, replacing Unifia
            // with the upstream product.
            const response = yield* httpOk.execute(HttpClientRequest.get(INSTALL_SCRIPT_URL))
            const body = yield* response.text
            const bodyBytes = new TextEncoder().encode(body)
            const proc = ChildProcess.make("bash", [], {
              stdin: Stream.make(bodyBytes),
              env: { VERSION: target },
              extendEnv: true,
            })
            const handle = yield* spawner.spawn(proc)
            const [stdout, stderr] = yield* Effect.all(
              [Stream.mkString(Stream.decodeText(handle.stdout)), Stream.mkString(Stream.decodeText(handle.stderr))],
              { concurrency: 2 },
            )
            const code = yield* handle.exitCode
            return { code, stdout, stderr }
          },
          Effect.scoped,
          Effect.orDie,
        )

        const methodImpl = Effect.fn("Installation.method")(function* () {
          // `.unifia/bin` first: that is where the install script deploys
          // (INSTALL_DIR in `install`). Only `.opencode/bin` was tested, so a
          // current curl install fell through every package-manager probe and
          // reported "unknown" — leaving `unifia upgrade` with no method.
          if (process.execPath.includes(path.join(".unifia", "bin"))) return "curl" as Method
          if (process.execPath.includes(path.join(".opencode", "bin"))) return "curl" as Method
          if (process.execPath.includes(path.join(".local", "bin"))) return "curl" as Method
          const exec = process.execPath.toLowerCase()

          const checks: Array<{ name: Method; command: () => Effect.Effect<string> }> = [
            { name: "npm", command: () => text(["npm", "list", "-g", "--depth=0"]) },
            { name: "yarn", command: () => text(["yarn", "global", "list"]) },
            { name: "pnpm", command: () => text(["pnpm", "list", "-g", "--depth=0"]) },
            { name: "bun", command: () => text(["bun", "pm", "ls", "-g"]) },
          ]

          checks.sort((a, b) => {
            const aMatches = exec.includes(a.name)
            const bMatches = exec.includes(b.name)
            if (aMatches && !bMatches) return -1
            if (!aMatches && bMatches) return 1
            return 0
          })

          for (const check of checks) {
            const output = yield* check.command()
            if (output.includes(NPM_PACKAGE)) {
              return check.name
            }
          }

          return "unknown" as Method
        })

        const latestImpl = Effect.fn("Installation.latest")(function* (installMethod?: Method) {
          const detectedMethod = installMethod || (yield* methodImpl())

          if (detectedMethod === "npm" || detectedMethod === "bun" || detectedMethod === "pnpm") {
            const r = (yield* text(["npm", "config", "get", "registry"])).trim()
            const reg = r || "https://registry.npmjs.org"
            const registry = reg.endsWith("/") ? reg.slice(0, -1) : reg
            const channel = CHANNEL
            // NPM_PACKAGE, not upstream's `opencode-ai`. Reading upstream meant
            // comparing this fork's version against a separate, faster-moving
            // version line, then upgrading to a `unifia-ai` release carrying
            // that number — which does not exist.
            const response = yield* httpOk.execute(
              HttpClientRequest.get(`${registry}/${NPM_PACKAGE}/${channel}`).pipe(HttpClientRequest.acceptJson),
            )
            const data = yield* HttpClientResponse.schemaBodyJson(NpmPackage)(response)
            return data.version
          }

          const response = yield* httpOk.execute(
            HttpClientRequest.get(`https://api.github.com/repos/${FORK_REPO}/releases/latest`).pipe(
              HttpClientRequest.acceptJson,
            ),
          )
          const data = yield* HttpClientResponse.schemaBodyJson(GitHubRelease)(response)
          // Strip the same `-fork[.N]` suffix the release workflow strips when
          // computing UNIFIA_VERSION, so this matches Installation.VERSION
          // exactly instead of comparing "1.2.3" against "1.2.3-fork".
          return data.tag_name.replace(/^v/, "").replace(/-fork.*$/, "")
        }, Effect.orDie)

        const upgradeImpl = Effect.fn("Installation.upgrade")(function* (m: Method, target: string) {
          let result: { code: ChildProcessSpawner.ExitCode; stdout: string; stderr: string } | undefined
          switch (m) {
            case "curl":
              result = yield* upgradeCurl(target)
              break
            case "npm":
              result = yield* run(["npm", "install", "-g", `${NPM_PACKAGE}@${target}`])
              break
            case "pnpm":
              result = yield* run(["pnpm", "install", "-g", `${NPM_PACKAGE}@${target}`])
              break
            case "bun":
              result = yield* run(["bun", "install", "-g", `${NPM_PACKAGE}@${target}`])
              break
            default:
              return yield* new UpgradeFailedError({ stderr: `Unknown method: ${m}` })
          }
          if (!result || result.code !== 0) {
            return yield* new UpgradeFailedError({ stderr: result?.stderr || "" })
          }
          log.info("upgraded", {
            method: m,
            target,
            stdout: result.stdout,
            stderr: result.stderr,
          })
          yield* text([process.execPath, "--version"])
        })

        return Service.of({
          info: Effect.fn("Installation.info")(function* () {
            return {
              version: VERSION,
              latest: yield* latestImpl(),
            }
          }),
          method: methodImpl,
          latest: latestImpl,
          upgrade: upgradeImpl,
        })
      }),
    )

  export const defaultLayer = layer.pipe(
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(CrossSpawnSpawner.defaultLayer),
  )

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export async function method(): Promise<Method> {
    return runPromise((svc) => svc.method())
  }

  export async function latest(installMethod?: Method): Promise<string> {
    return runPromise((svc) => svc.latest(installMethod))
  }

  export async function upgrade(m: Method, target: string): Promise<void> {
    return runPromise((svc) => svc.upgrade(m, target))
  }
}
