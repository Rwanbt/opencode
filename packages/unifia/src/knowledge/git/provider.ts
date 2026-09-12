/* SPDX-License-Identifier: MIT */
/**
 * Knowledge Git provider (P8).
 *
 * Per runbook §18: explicit fetch / inspect / merge, no
 * automatic push, no pull, hooks off by default. The pre-push
 * scan detects secrets that have been removed in the last
 * commit but still appear in the outgoing range.
 */

import type { KnowledgeLocator, KnowledgeVersionHash } from "@unifia/contracts/knowledge"

export type SecretKind =
  | "private_key_block"
  | "openai_anthropic_key"
  | "aws_access_key"
  | "github_pat"
  | "generic_credential"

export interface SecretHit {
  kind: SecretKind
  locator: KnowledgeLocator
  commit: string
  line: number
  excerpt: string
}

export interface OutgoingRange {
  from: string
  to: string
  /** Locators touched in the range. */
  touchedLocators: KnowledgeLocator[]
}

export interface PrepushScanResult {
  ok: boolean
  hits: SecretHit[]
}

const PATTERNS: Array<{ kind: SecretKind; re: RegExp }> = [
  { kind: "private_key_block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { kind: "openai_anthropic_key", re: /sk-[A-Za-z0-9]{20,}/ },
  { kind: "aws_access_key", re: /AKIA[0-9A-Z]{16}/ },
  { kind: "github_pat", re: /ghp_[A-Za-z0-9]{30,}/ },
  { kind: "generic_credential", re: /([Aa][Pp][Ii][_-]?[Kk][Ee][Yy]|[Tt][Oo][Kk][Ee][Nn]|[Ss][Ee][Cc][Rr][Ee][Tt])[=:]\s*[A-Za-z0-9_\-]{16,}/ },
]

/** Pure: scan a list of file contents for secrets. */
export function scanForSecrets(
  files: ReadonlyArray<{ locator: KnowledgeLocator; commit: string; content: string }>,
): SecretHit[] {
  const out: SecretHit[] = []
  for (const f of files) {
    const lines = f.content.split("\n")
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? ""
      for (const p of PATTERNS) {
        if (p.re.test(line)) {
          out.push({
            kind: p.kind,
            locator: f.locator,
            commit: f.commit,
            line: i + 1,
            excerpt: line.slice(0, 80),
          })
        }
      }
    }
  }
  return out
}

export class GitProvider {
  private autoPush = false
  private hookPolicy: "off" | "warn" | "block" = "off"

  setAutoPush(value: boolean): void {
    this.autoPush = value
  }

  getAutoPush(): boolean {
    return this.autoPush
  }

  setHookPolicy(p: "off" | "warn" | "block"): void {
    this.hookPolicy = p
  }

  getHookPolicy(): "off" | "warn" | "block" {
    return this.hookPolicy
  }

  async prepushScan(range: OutgoingRange, contents: ReadonlyArray<{ locator: KnowledgeLocator; commit: string; content: string }>): Promise<PrepushScanResult> {
    const relevant = contents.filter((c) => range.touchedLocators.includes(c.locator))
    const hits = scanForSecrets(relevant)
    return { ok: hits.length === 0, hits }
  }
}

export function emptyOutgoingRange(from: string, to: string): OutgoingRange {
  return { from, to, touchedLocators: [] }
}

export type { KnowledgeVersionHash }
