import { describe, expect, test } from "bun:test"
import path from "node:path"
import { ExporterRegistry } from "../../src/observability/exporter"
import { ExportProjectionSchema, shouldExportSpan, toExportProjection, type ExportableEventRow } from "../../src/observability/export-projection"

// Phase 4 (plan §14/§18: "no-network when exporters empty" + ExportProjection
// anti-leak). Companion to resilience.test.ts's Phase 1-3 "no observability
// pipeline module imports a network client" test, which intentionally does
// NOT cover observability/exporters/ (non-recursive glob) — this file covers
// that subdirectory explicitly instead.

const baseRow: ExportableEventRow = {
  event_id: "01HXXXXXXXXXXXXXXXXXXXXXXX",
  trace_id: "01HTRACEXXXXXXXXXXXXXXXXXX",
  span_id: "01HSPANXXXXXXXXXXXXXXXXXXX",
  parent_span_id: null,
  session_id: "session-abc",
  project_id: "project-def",
  workspace_id: null,
  event_type: "llm.call.finished",
  status: "finished",
  ts_ms: Date.now(),
  duration_ms: 120,
  model_provider: "anthropic",
  model_id: "claude-sonnet-5",
  input_tokens: 100,
  output_tokens: 50,
  cache_read_tokens: null,
  cache_write_tokens: null,
  cost_nano_usd: 5000,
  pricing_version: "v1",
  pricing_source: "Session.getUsage",
  redaction_status: "metadata_only",
  metadata_json: {},
  local_redacted_json: { classes: [] },
}

describe("ExporterRegistry.from (Phase 4)", () => {
  test("returns [] for undefined, missing exporters key, and empty exporters array", () => {
    expect(ExporterRegistry.from(undefined)).toEqual([])
    expect(ExporterRegistry.from({})).toEqual([])
    expect(ExporterRegistry.from({ exporters: [] })).toEqual([])
  })

  test("constructs one Exporter per configured entry", () => {
    const exporters = ExporterRegistry.from({
      exporters: [{ type: "langfuse", host: "https://example.invalid", publicKey: "pk", secretKey: "sk" }],
    })
    expect(exporters).toHaveLength(1)
    expect(exporters[0]!.name).toBe("langfuse")
  })
})

describe("exporter no-network with empty config (Phase 4)", () => {
  test("zero exporters means the export loop never runs, so fetch is never called", async () => {
    const originalFetch = globalThis.fetch
    let fetchCalled = false
    globalThis.fetch = (() => {
      fetchCalled = true
      throw new Error("network access attempted with zero exporters configured")
    }) as unknown as typeof fetch
    try {
      const exporters = ExporterRegistry.from({ exporters: [] })
      expect(exporters).toHaveLength(0)
      // Same shape as runtime.ts's runExport(): iterate configured exporters.
      // With zero entries this loop body never executes.
      for (const exporter of exporters) await exporter.export([])
      expect(fetchCalled).toBe(false)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("a configured Langfuse exporter DOES call fetch when export() runs (positive control, proves the spy above is meaningful)", async () => {
    const originalFetch = globalThis.fetch
    let calls = 0
    globalThis.fetch = (async () => {
      calls++
      return new Response("{}", { status: 200 })
    }) as unknown as typeof fetch
    try {
      const exporters = ExporterRegistry.from({
        exporters: [{ type: "langfuse", host: "https://example.invalid", publicKey: "pk", secretKey: "sk" }],
      })
      const projection = toExportProjection(baseRow, new Uint8Array(32).fill(1))
      await exporters[0]!.export([projection])
      expect(calls).toBe(1)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("exporter.ts and export-projection.ts (top-level, not the exporters/ subdirectory) never reference fetch", async () => {
    for (const file of ["exporter.ts", "export-projection.ts"]) {
      const content = await Bun.file(path.join(import.meta.dir, "../../src/observability", file)).text()
      expect(content).not.toMatch(/\bfetch\(/)
    }
  })
})

describe("shouldExportSpan (Phase 4)", () => {
  test("excludes started (incomplete) and dropped (internal bookkeeping) events", () => {
    expect(shouldExportSpan({ status: "started" })).toBe(false)
    expect(shouldExportSpan({ status: "dropped" })).toBe(false)
  })

  test("includes finished/failed/aborted terminal events", () => {
    expect(shouldExportSpan({ status: "finished" })).toBe(true)
    expect(shouldExportSpan({ status: "failed" })).toBe(true)
    expect(shouldExportSpan({ status: "aborted" })).toBe(true)
  })
})

describe("ExportProjection anti-leak (Phase 4, ADR-1026)", () => {
  test("toExportProjection never surfaces Phase 3 opt-in content even if the caller passes a full raw row", () => {
    const rowWithContent = {
      ...baseRow,
      // A real EventRow (repository.ts) carries these columns. A future
      // caller passing that full row structurally satisfies
      // ExportableEventRow (extra properties are allowed) — the guarantee
      // must hold at the READ side (toExportProjection only ever reads the
      // fields it names), not rely on the caller never having these fields.
      local_content_redacted_json: "REDACTED BUT STILL SENSITIVE PROMPT TEXT",
      local_full_json: "RAW SECRET sk-THISISASECRETVALUE1234567890",
    }
    const projection = toExportProjection(rowWithContent, new Uint8Array(32).fill(2))
    const serialized = JSON.stringify(projection)
    expect(serialized).not.toContain("PROMPT TEXT")
    expect(serialized).not.toContain("THISISASECRETVALUE")
    expect(Object.keys(projection)).not.toContain("localContentRedacted")
    expect(Object.keys(projection)).not.toContain("localFull")
  })

  test("toExportProjection HMACs session/project/workspace ids instead of passing them through in clear", () => {
    const projection = toExportProjection(baseRow, new Uint8Array(32).fill(3))
    expect(projection.sessionIdHmac).toMatch(/^[0-9a-f]{64}$/)
    expect(projection.sessionIdHmac).not.toBe(baseRow.session_id)
    expect(JSON.stringify(projection)).not.toContain(baseRow.session_id!)
    expect(JSON.stringify(projection)).not.toContain(baseRow.project_id!)
  })

  test("ExportProjectionSchema is strict: a content field on the object always fails validation", () => {
    const valid = toExportProjection(baseRow, new Uint8Array(32).fill(4))
    expect(() => ExportProjectionSchema.parse({ ...valid, localFull: "leak" })).toThrow()
    expect(() => ExportProjectionSchema.parse({ ...valid, localContentRedacted: "leak" })).toThrow()
  })
})
