import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { ObservabilityRuntime } from "../../src/observability/runtime"
import { createTraceContext } from "../../src/observability/trace-context"
import { tmpdir } from "../fixture/fixture"

const event = () => ({
  type: "llm.call.started" as const,
  status: "started" as const,
  tsMs: Date.now(),
  redactionStatus: "metadata_only" as const,
  payloadTruncated: false,
  schemaVersion: 1 as const,
  metadata: {},
  localRedacted: { classes: [] },
})

describe("observability runtime", () => {
  test("owns one service per instance, not a module singleton", async () => {
    await using a = await tmpdir()
    await using b = await tmpdir()

    const serviceA = await Instance.provide({ directory: a.path, fn: () => ObservabilityRuntime.service() })
    const serviceB = await Instance.provide({ directory: b.path, fn: () => ObservabilityRuntime.service() })
    const serviceAAgain = await Instance.provide({ directory: a.path, fn: () => ObservabilityRuntime.service() })

    expect(serviceA).not.toBe(serviceB)
    expect(serviceA).toBe(serviceAAgain)

    await Instance.disposeDirectory(a.path)
    await Instance.disposeDirectory(b.path)
  })

  test("flushes pending events on instance dispose", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: () => {
        const service = ObservabilityRuntime.service()
        expect(service.record(createTraceContext(), event())).toMatchObject({ ok: true })
        expect(service.stats().queueSize).toBe(1)
      },
    })

    await Instance.disposeDirectory(tmp.path)

    await Instance.provide({
      directory: tmp.path,
      fn: () => {
        // A fresh instance boot after disposal gets a brand new service.
        expect(ObservabilityRuntime.service().stats().queueSize).toBe(0)
      },
    })

    await Instance.disposeDirectory(tmp.path)
  })
})
