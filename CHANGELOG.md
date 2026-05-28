# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This is the **fork changelog** — it tracks changes made on top of the upstream
[anomalyco/opencode](https://github.com/anomalyco/opencode) base.

---

## [Unreleased]

### Security
- Override esbuild 0.28.0 → patched (GHSA-67mh-4wv8-2f99)
- Pin 20 third-party CI actions to SHA commits; add innerHTML audit + gitleaks
- Dep overrides: XSS DOMPurify sanitization on share page, TLS fix (rejectUnauthorized), Fastify CVE, 11 transitive overrides
- All CI actions pinned to SHA (F1–F7 + F1bis–F2bis findings closed)

### Added
- **Mobile — on-device AI inference**: OpenCL Adreno routing (Q4_0, Adreno 7xx tier), Hexagon NPU (HTP skels, llama-server 128 MB), ngram-cache + KleidiAI opt-in via `OPENCODE_LLAMA_SPEC_TYPE`
- **Mobile — on-device toolchain**: Rust/cargo, gcc, g++, build-base, pip via Alpine rootfs; cargo ADB reverse proxy for toolchain commands
- **Mobile — multimodal**: wire mmproj projector through IPC + auto-download; auto-detect sibling `mmproj-*.gguf` on desktop
- **Settings**: Benchmark tab (inference speed measurement); config panel with sliders, accelerator selector (Auto/CPU/GPU/NPU), system prompt, advanced section
- **Local LLM**: agentic harness for benchmarking; optimize loop for small models (Qwen 4B); KV quant thresholds + `OPENCODE_LLAMA_PORT`
- **Health stack**: biome + knip setup, lint clean, dead code removed; `bun run deadcode`, `bun run lint`
- **Governance**: gitleaks config, pre-commit hooks, standards scorecard

### Fixed
- Mobile: Alpine rootfs hard links → symlinks, tgz packaging, Android 13+ SELinux compat
- Mobile: pin `#root` to `visualViewport.height` (keyboard overlap fix)
- Mobile: drag-to-scroll terminal scrollback + keyboard toolbar button
- Mobile: bypass LocalLLMServer spawn + lazy-init paths (local chat end-to-end)
- Mobile: set `TMPDIR` to app-private cache (fixes EROFS on bun sidecar mkdir)
- Mobile: drain llama-server stdout to prevent pipe backpressure
- Local LLM: doom-loop edit-file check; bash `description` optional; cross-message detection
- Local LLM: HuggingFace search regex gate removed at sibling level
- Tools: prevent Gemma-4 `dry_run` misuse blocking agent mode
- Settings: cap Select trigger width on Preset/Offload/Mmap dropdowns

### Performance
- Mobile: adaptive ctx-size + Hexagon detection + spec-type override
- Mobile: PLD ngram-simple + Adreno OCL 3.0 tier routing for Q4_0
- Local LLM: tune Gemma-4 sampling + SWA cache-reuse fix

---

## [1.3.15] — 2026-05-27

### Changed (Governance)
- `packages/app/src/pages/session.tsx` : refactoring (1410 → 1010 LOC) via 3 factories extraites
  - `session/session-mutations.ts` (191 LOC) — mutations revert/restore/roll
  - `session/session-sync-effects.ts` (281 LOC) — 10 effets de synchronisation
  - `session/session-scroll.ts` (236 LOC) — gestion du scroll et de l'historique
- `packages/app/src/pages/layout.tsx` : refactoring (1460 → 1127 LOC) via 4 factories extraites
  - `layout/layout-navigation.ts` (259 LOC) — 9 fonctions de navigation
  - `layout/project-actions.tsx` (192 LOC) — 7 actions projet
  - `layout/workspace-ops.ts` étendu (+74 LOC) — createWorkspace ajouté
  - `layout/deep-links.ts` étendu (+77 LOC) — createDeepLinkHandler ajouté
- Fix lint : `layout/notifications.ts` — suppression du dep `notification` inutilisé dans `useSDKNotificationToasts`

### Added
- `docs/adr/0001-factory-deps-pattern.md` — Factory with deps pattern (ADR)
- `docs/adr/0002-coordinator-loc-floor.md` — Coordinator LOC floor (ADR)
- `docs/adr/0003-fork-strategy.md` — Fork strategy vs upstream (ADR)
- `docs/` — governance docs (glossary, ownership-map, perf-baselines, rfcs, lock-hierarchy)

---

## [Base] — upstream anomalyco/opencode

See upstream repository for full changelog:
https://github.com/anomalyco/opencode

---

[Unreleased]: https://github.com/Rwanbt/opencode/compare/main...dev
[1.3.15]: https://github.com/Rwanbt/opencode/compare/v1.3.14...v1.3.15
