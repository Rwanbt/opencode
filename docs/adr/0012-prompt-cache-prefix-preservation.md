# ADR-0012: Prompt Cache Prefix Preservation After Compaction and Agent Switch

**Status**: Proposed
**Date**: 2026-07-13
**Deciders**: @Rwanbt

---

## Context

Anthropic (and Anthropic-shaped proxies: Bedrock Claude, OpenRouter Claude, some
OpenAI-compatible gateways) support prompt caching via `cache_control`
breakpoints: a provider-side prefix cache keyed on exact message/tool content.
`ProviderTransform.applyCaching()` (`provider/transform.ts`) already marks the
system prompt and the last 2 non-system messages for Anthropic-family models,
and `tokens.cache.read`/`tokens.cache.write` are tracked end-to-end via the
`observability` branch (merged into `dev` prior to this work).

Two scenarios were identified where the existing cache markers can't help:

1. **After compaction**: the conversation history is replaced by a single
   summary message. Nothing distinguished that message as "the new anchor" —
   `MessageV2.toModelMessagesEffect()` discarded the `mode`/`summary` fields
   entirely when converting to the AI SDK's `ModelMessage` format, so no
   downstream code could recognize it.
2. **After an agent switch** with the same effective toolset: tools were
   passed through in whatever insertion order the caller's registry happened
   to produce, and never carried a cache breakpoint at all — so even an
   identical toolset serialized differently (or without any cache marker)
   depending on construction order.

A prior draft (v2) of this plan proposed a DB migration (`is_cache_anchor`
column) and a new telemetry pipeline. Both were rejected after verification:
`mode: "compaction"` and `summary: true` already exist and are populated by
`session/compaction.ts`; `tokens.cache.read/write` and the observability
pipeline already exist and must be reused, not duplicated.

## Decision

Gate all of this behind `OPENCODE_EXPERIMENTAL_PROMPT_CACHE_ANCHORING`
(default `false`, dynamic getter in `flag/flag.ts`). Flag off reproduces the
pre-existing `applyCaching()` path bit-for-bit.

**Phase 1 — `provider/cache.ts` (`PromptCache` namespace), pure functions:**
- `getCapabilities(model)` — detects Claude-family models, message-level vs.
  content-level cache syntax, and (new) whether a tool-level breakpoint is
  safe for this model.
- `selectMessageBreakpoints(messages, budget)` — priority-ordered candidate
  selection (system → compaction-summary anchor → last 2 messages), capped at
  the shared `MAX_BREAKPOINTS = 4` budget.
- `applyMessageCacheMarkers()` / `stripInternalProviderMetadata()` — pure,
  non-mutating application and unconditional removal of the transient marker.

**Deviation from the plan's literal text**: the transient marker lives under
`providerOptions.opencodeCacheInternal`, not `providerOptions.opencode` as
originally drafted. Reading `provider/transform.ts`'s own test suite showed
`"opencode"` is a **real provider id** (self-hosted models routed through
`@ai-sdk/openai-compatible`, where `sdkKey()` falls back to `model.providerID`)
whose `providerOptions.opencode` already carries real metadata (`itemId`,
reasoning continuation). Stripping that key unconditionally, as originally
planned, would have silently corrupted real requests to that provider. Locked
in by a dedicated regression test in `test/provider/cache.test.ts`.

**Phase 2 — compaction summary anchoring** (`session/message-v2.ts`):
`toModelMessagesEffect()` tags the compaction summary's text part with
`providerMetadata.opencodeCacheInternal.cacheAnchor = true` when
`info.mode === "compaction" && info.summary === true` and the text is
non-empty — independent of the existing `differentModel` gate, since this is
opencode-internal bookkeeping, not provider-specific continuation data. No
migration; reuses the existing `mode`/`summary` fields. The marker round-trips
through the AI SDK's `convertToModelMessages()` (`providerMetadata` on a
`UIMessage` part → `providerOptions` on the resulting `ModelMessage` content
part) and is picked up by `selectMessageBreakpoints()` as the
highest-priority "summary" candidate.

**Phase 3 — tool canonicalization + tool breakpoint** (`session/llm.ts`,
gated, since this file is shared with `observability`): when the flag is on,
`resolveTools()`'s output is canonicalized by tool name
(`PromptCache.canonicalizeToolOrder`) so the same effective toolset always
serializes in the same order regardless of caller construction order, then the
last tool (canonical order) is annotated with
`providerOptions.anthropic.cacheControl` via `PromptCache.annotateLastToolForCache()`
— verified empirically (via a mock-HTTP integration test) that the AI SDK
propagates `Tool.providerOptions` into the wire `LanguageModelV3FunctionTool.providerOptions`,
which Anthropic serializes as `cache_control` on the tool definition. Reserves
exactly 1 of the shared 4-breakpoint budget — `ProviderTransform.message()`
reduces its own budget by 1 whenever `capabilities.toolBreakpointSupported` is
true, so the two call sites never together exceed 4 breakpoints. Restricted to
the native Anthropic/Vertex-Anthropic AI SDK adapters; **not** enabled for
Bedrock (the installed SDK version does not serialize `tool.providerOptions`)
or for other Claude-shaped proxies (unverified against a real payload).
Canonicalization itself is flag-gated too — reordering tools, even
alphabetically, can shift which tool a model is more inclined to call, so flag
off must stay bit-for-bit identical to the pre-existing caller-provided order.

## Rejected Alternatives

**A) `is_cache_anchor` DB column / migration** — rejected: the existing
`mode`/`summary` fields on `MessageV2.Assistant` already identify the
compaction summary without any persisted schema change or backfill.

**B) New telemetry/StatusBar pipeline for cache metrics** — rejected:
`tokens.cache.read/write` and the `observability` branch's event pipeline
already exist and are the single source of truth; duplicating them would
violate the "one authoritative source" principle.

**C) `providerOptions.opencode` as the transient marker namespace** —
rejected after discovering it collides with the real `"opencode"` provider's
own metadata namespace (see Decision above).

**D) Sending every tool to every agent to maximize tool-prefix reuse
(OpenFox-style)** — rejected: OpenCode's permission-filtered toolset is a
security boundary (`resolveTools()` / `Permission.disabled()`); no caching
optimization is worth widening it.

## Consequences

- Flag off: zero behavior change, verified via dedicated regression tests
  asserting parity with pre-Phase-1 `applyCaching()` output and pre-Phase-3
  tool ordering.
- Flag on: system + compaction-summary + tool prefix become reusable across
  turns and (same-toolset) agent switches, within a strict ≤4-breakpoint
  budget shared with any provider-level automatic caching.
- **Known gap**: the tool budget reservation (`toolBreakpointSupported ? 1 : 0`)
  is computed per-model, not per-call — a call with an empty toolset (e.g.
  compaction) still reserves the slot even though nothing gets annotated. Safe
  (never exceeds the cap) but leaves 1 slot unused in that edge case; not
  addressed in this phase.
- **Not yet done** (blocks moving this ADR to `Accepted`): no live Anthropic
  API validation has been run (requires real credentials, out of scope for an
  automated session) — mock tests prove payload shape and determinism, not an
  actual provider-side `cache_read_input_tokens > 0`. No canary/rollout period
  has been observed. See the plan's Phase 4/5 for the exact acceptance
  criteria (50 real post-compaction sequences or 7 days, whichever comes
  first, with no breakpoint/provider-error regressions).

## Implementation

- `packages/opencode/src/provider/cache.ts` — `PromptCache` namespace (new)
- `packages/opencode/src/provider/transform.ts` — flag-gated dispatch + budget reservation
- `packages/opencode/src/session/message-v2.ts` — compaction-summary marker
- `packages/opencode/src/session/llm.ts` — tool canonicalization + tool breakpoint
- `packages/opencode/src/flag/flag.ts` — `OPENCODE_EXPERIMENTAL_PROMPT_CACHE_ANCHORING`
- Tests: `test/provider/cache.test.ts`, `test/session/prompt-cache.test.ts`,
  `test/session/prompt-cache-characterization.test.ts` (Phase 0 baseline,
  updated in Phase 2 where the plan intentionally changes prior behavior)
- Full plan: `Plan-Differe-Prompt-Cache-Apres-Compaction-et-Changement-Agent-Post-Observability-2026-07-13.md` (Obsidian vault)
