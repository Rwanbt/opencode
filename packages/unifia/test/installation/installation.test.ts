import { describe, expect, test } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { Installation } from "../../src/installation"

const encoder = new TextEncoder()

function mockHttpClient(handler: (request: HttpClientRequest.HttpClientRequest) => Response) {
  const client = HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, handler(request))))
  return Layer.succeed(HttpClient.HttpClient, client)
}

function mockSpawner(handler: (cmd: string, args: readonly string[]) => string = () => "") {
  const spawner = ChildProcessSpawner.make((command) => {
    const std = ChildProcess.isStandardCommand(command) ? command : undefined
    const output = handler(std?.command ?? "", std?.args ?? [])
    return Effect.succeed(
      ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(0),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        stdin: { [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") } as any,
        stdout: output ? Stream.make(encoder.encode(output)) : Stream.empty,
        stderr: Stream.empty,
        all: Stream.empty,
        getInputFd: () => ({ [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") }) as any,
        getOutputFd: () => Stream.empty,
      }),
    )
  })
  return Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function testLayer(
  httpHandler: (request: HttpClientRequest.HttpClientRequest) => Response,
  spawnHandler?: (cmd: string, args: readonly string[]) => string,
) {
  return Installation.layer.pipe(Layer.provide(mockHttpClient(httpHandler)), Layer.provide(mockSpawner(spawnHandler)))
}

describe("installation", () => {
  describe("latest", () => {
    test("reads release version from GitHub releases", async () => {
      const layer = testLayer(() => jsonResponse({ tag_name: "v1.2.3" }))

      const result = await Effect.runPromise(
        Installation.Service.use((svc) => svc.latest("unknown")).pipe(Effect.provide(layer)),
      )
      expect(result).toBe("1.2.3")
    })

    test("strips v prefix from GitHub release tag", async () => {
      const layer = testLayer(() => jsonResponse({ tag_name: "v4.0.0-beta.1" }))

      const result = await Effect.runPromise(
        Installation.Service.use((svc) => svc.latest("curl")).pipe(Effect.provide(layer)),
      )
      expect(result).toBe("4.0.0-beta.1")
    })

    test("reads npm registry versions", async () => {
      const layer = testLayer(
        () => jsonResponse({ version: "1.5.0" }),
        (cmd, args) => {
          if (cmd === "npm" && args.includes("registry")) return "https://registry.npmjs.org\n"
          return ""
        },
      )

      const result = await Effect.runPromise(
        Installation.Service.use((svc) => svc.latest("npm")).pipe(Effect.provide(layer)),
      )
      expect(result).toBe("1.5.0")
    })

    test("reads npm registry versions for bun method", async () => {
      const layer = testLayer(
        () => jsonResponse({ version: "1.6.0" }),
        () => "",
      )

      const result = await Effect.runPromise(
        Installation.Service.use((svc) => svc.latest("bun")).pipe(Effect.provide(layer)),
      )
      expect(result).toBe("1.6.0")
    })

    // The fork used to ask npm for `opencode-ai`, then upgrade by installing
    // `unifia-ai` at whatever version that returned. Upstream is on a separate,
    // faster-moving version line, so this reported updates that did not exist.
    test("asks npm for this fork's package, never upstream's", async () => {
      const requested: string[] = []
      const layer = testLayer(
        (request) => {
          requested.push(request.url)
          return jsonResponse({ version: "1.5.0" })
        },
        (cmd, args) => {
          if (cmd === "npm" && args.includes("registry")) return "https://registry.npmjs.org\n"
          return ""
        },
      )

      await Effect.runPromise(Installation.Service.use((svc) => svc.latest("npm")).pipe(Effect.provide(layer)))

      expect(requested).toHaveLength(1)
      expect(requested[0]).toContain("/unifia-ai/")
      expect(requested[0]).not.toContain("opencode-ai")
    })

    test("asks GitHub for this fork's releases, never upstream's", async () => {
      const requested: string[] = []
      const layer = testLayer((request) => {
        requested.push(request.url)
        return jsonResponse({ tag_name: "v1.2.3" })
      })

      await Effect.runPromise(Installation.Service.use((svc) => svc.latest("unknown")).pipe(Effect.provide(layer)))

      expect(requested).toHaveLength(1)
      expect(requested[0]).toContain("/repos/Rwanbt/unifia/")
      expect(requested[0]).not.toContain("anomalyco")
    })

    // Every method left on Installation.Method resolves through a channel this
    // fork publishes to. Homebrew, Scoop and Chocolatey were removed rather
    // than re-pointed, so no code path can reach upstream's registries.
    test("no upgrade method reaches a registry this fork does not publish to", async () => {
      const requested: string[] = []
      const layer = testLayer(
        (request) => {
          requested.push(request.url)
          return jsonResponse({ version: "1.5.0", tag_name: "v1.5.0" })
        },
        (cmd, args) => {
          if (cmd === "npm" && args.includes("registry")) return "https://registry.npmjs.org\n"
          return ""
        },
      )

      for (const method of ["curl", "npm", "yarn", "pnpm", "bun", "unknown"] as const) {
        await Effect.runPromise(Installation.Service.use((svc) => svc.latest(method)).pipe(Effect.provide(layer)))
      }

      for (const url of requested) {
        expect(url).not.toContain("anomalyco")
        expect(url).not.toContain("opencode-ai")
        expect(url).not.toContain("formulae.brew.sh")
        expect(url).not.toContain("chocolatey.org")
        expect(url).not.toContain("ScoopInstaller")
      }
    })
  })
})
