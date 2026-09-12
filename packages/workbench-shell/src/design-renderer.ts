/* SPDX-License-Identifier: MIT */

import type { Spec } from "@unifia/spec-runtime"

export type DesignRenderOptions = { width?: number; height?: number }

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;")
}

function positiveDimension(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value !== undefined && value > 0 ? Math.min(Math.trunc(value), 4096) : fallback
}

/** Produces a stable SVG fixture from a validated design spec. */
export function renderDesignSpecSvg(spec: Spec, options: DesignRenderOptions = {}): string {
  const width = positiveDimension(options.width, 1024)
  const height = positiveDimension(options.height, 768)
  const primary = spec.tokens?.colors?.primary ?? "#ffffff"
  const foreground = spec.tokens?.colors?.foreground ?? "#111111"
  const gutter = spec.tokens?.spacing?.gutter ?? 24
  const titleY = Math.max(gutter * 2, 48)
  const ruleStart = titleY + 44
  const ruleGap = Math.max(spec.tokens?.spacing?.stack ?? 16, 16)
  const rules = spec.rules.map((rule, index) => {
    const y = ruleStart + index * ruleGap
    return `<text x="${gutter}" y="${y}" fill="${escapeXml(foreground)}" font-family="sans-serif" font-size="16">${escapeXml(`${rule.id}: ${rule.statement}`)}</text>`
  }).join("")
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeXml(spec.title)}"><rect width="${width}" height="${height}" fill="${escapeXml(primary)}"/><text x="${gutter}" y="${titleY}" fill="${escapeXml(foreground)}" font-family="sans-serif" font-size="28" font-weight="600">${escapeXml(spec.title)}</text>${rules}</svg>`
}
