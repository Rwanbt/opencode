// Phase 4 exporter registry (ADR-1026). This file constructs exporters from
// config but never makes a network request itself — the actual network
// client lives only in observability/exporters/*.ts, a separate directory the existing
// "no observability pipeline module imports a network client" test
// (resilience.test.ts) deliberately does not scan (non-recursive glob),
// making that subdirectory the one sanctioned network boundary.
import z from "zod"
import type { ExportProjection } from "./export-projection"
import { LangfuseExporter, LangfuseExporterConfigSchema } from "./exporters/langfuse"

export interface Exporter {
  name: string
  export(batch: ExportProjection[]): Promise<void>
}

export const ExporterConfigSchema = z.discriminatedUnion("type", [LangfuseExporterConfigSchema])
export type ExporterConfig = z.infer<typeof ExporterConfigSchema>

export interface ExportersConfig {
  exporters?: ExporterConfig[]
}

// Empty by default (undefined config or empty array both yield []) — the
// caller (runtime.ts) short-circuits before touching the DB or the network
// when this returns an empty array, so "no exporters configured" is
// structurally zero-cost, not just conventionally quiet.
export function fromConfig(config: ExportersConfig | undefined): Exporter[] {
  if (!config?.exporters?.length) return []
  return config.exporters.map((entry) => {
    switch (entry.type) {
      case "langfuse":
        return new LangfuseExporter(entry)
    }
  })
}

export const ExporterRegistry = { from: fromConfig }
