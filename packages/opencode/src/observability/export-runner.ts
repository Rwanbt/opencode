// Phase 4 export execution (ADR-1026). Separated from runtime.ts so the
// retry/backoff logic is unit-testable without spinning up an Instance.
import type { Exporter } from "./exporter"
import type { ExportProjection } from "./export-projection"

const DEFAULT_BACKOFF_MS = [50, 250, 1000]

export interface ExportAttemptResult {
  exporter: string
  ok: boolean
  attempts: number
  error?: string
}

// A batch that fails is retried a bounded number of times (same backoff
// shape as the Phase 1 queue's retry policy, plan §P0-7) before being given
// up on. Unlike the internal queue, there is no persistent replay here — an
// exhausted batch is simply dropped and logged (docs/observability-phase4-admin.md,
// "no retry" was the Phase 4 v1 posture; this replaces it with a BOUNDED
// retry, still never a queue, so a single stuck batch can never block export
// forever).
export async function exportWithRetry(
  exporter: Exporter,
  batch: ExportProjection[],
  opts: { sleep?: (ms: number) => Promise<void>; backoffMs?: number[] } = {},
): Promise<ExportAttemptResult> {
  const backoff = opts.backoffMs ?? DEFAULT_BACKOFF_MS
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const maxAttempts = backoff.length + 1
  let lastError: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await exporter.export(batch)
      return { exporter: exporter.name, ok: true, attempts: attempt }
    } catch (error) {
      lastError = error
      if (attempt === maxAttempts) break
      await sleep(backoff[attempt - 1]!)
    }
  }
  return {
    exporter: exporter.name,
    ok: false,
    attempts: maxAttempts,
    error: lastError instanceof Error ? lastError.message : String(lastError),
  }
}

export async function exportToAll(
  exporters: Exporter[],
  batch: ExportProjection[],
  opts?: { sleep?: (ms: number) => Promise<void>; backoffMs?: number[] },
): Promise<ExportAttemptResult[]> {
  const results: ExportAttemptResult[] = []
  for (const exporter of exporters) {
    results.push(await exportWithRetry(exporter, batch, opts))
  }
  return results
}
