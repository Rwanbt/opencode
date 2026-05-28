# Roadmap

> This is the **fork roadmap** tracking work planned or in progress on top of the upstream
> [anomalyco/opencode](https://github.com/anomalyco/opencode) base.

---

## ✅ Shipped (fork additions)

### Mobile — On-device inference
- [x] OpenCL Adreno routing (Q4_0, tier-based: Adreno 7xx+ only)
- [x] Hexagon NPU (HTP skeletons, llama-server static 128 MB, `--poll 1000 --cpu-mask 0xfc`)
- [x] ngram-cache speculative decoding opt-in (`OPENCODE_LLAMA_SPEC_TYPE`)
- [x] Gemma-4 E4B in model catalog (mobile + desktop)
- [x] Multimodal projector wiring (mmproj IPC + auto-download)

### Mobile — On-device toolchain
- [x] Alpine rootfs with Rust/cargo, gcc/g++, build-base, pip
- [x] cargo ADB reverse proxy (build on device, compile on host)
- [x] SELinux compat (hard links → symlinks, tgz AAPT2 fix)

### Desktop
- [x] Auto-detect sibling `mmproj-*.gguf` and pass `--mmproj` to llama-server
- [x] Settings panel: sliders, accelerator selector, system prompt, advanced section
- [x] Benchmark tab (inference speed measurement on current device)

### Infrastructure & Quality
- [x] Health stack: biome + knip, lint clean, dead code removed
- [x] Security audit: 15/15 findings closed (XSS, pinned CI actions, CVEs, TLS)
- [x] Standards scorecard (verify-standards)

---

## 🔄 In progress

- [ ] **LOC refactor**: decompose `layout.tsx` (2548 LOC), `session/index.tsx` (2292), `message-part.tsx` (2268), `provider.ts` (1677)
- [ ] **ADRs**: document key architectural decisions (mobile gate, config cascade, sidecar build)

---

## 📋 Planned

### Phase next — Quality
- [ ] CHANGELOG.md kept up to date on each feature branch merge
- [ ] Pre-commit hook: `bun typecheck && bunx biome check . && shellcheck scripts/`
- [ ] `bun audit` step in CI (complement to Dependabot)

### Phase next — Mobile
- [ ] iOS stub → real build (requires macOS CI runner)
- [ ] KleidiAI rebuild with NDK r27c (ARM optimized GEMM kernels)
- [ ] Speculative decoding with Gemma-4 vocab-compatible drafter

### Phase next — Desktop
- [ ] Pocket TTS voice clone (gated HuggingFace repo access required)
- [ ] Multi-session local LLM (parallel inference slots)

---

## 🚫 Out of scope (fork)

- Upstream feature development (contribute via PR to anomalyco/opencode)
- macOS/iOS native features (no Apple hardware in CI)
- Enterprise SSO / SAML (upstream roadmap item)
