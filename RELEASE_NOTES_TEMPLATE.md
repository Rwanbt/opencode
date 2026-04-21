# OpenCode Fork — Release Notes Template

> Use this template for every release of the `Rwanbt/opencode` fork.
> Replace the `<...>` placeholders, keep the section order, drop empty
> subsections. The first published release using this template is the
> merge of the pre-production hardening work tracked in
> `PRODUCTION_REVIEW_2026-04.md` and the `SPRINT{1..5}_NOTES.md` series.

---

## Release `<vX.Y.Z>` — `<YYYY-MM-DD>`

### Highlights

- Pre-production hardening merged: 6 blockers (B1–B6) and 9 warnings (W1–W9) from `PRODUCTION_REVIEW_2026-04.md` are now closed or gated behind opt-in flags.
- New "Why This Fork" value matrix shipped in `README.md`: LAN-first pairing, local-model orchestration, per-session cost caps, DAG team runs, crash observability, GDPR endpoints.
- Supply-chain baseline in place: Dependabot, CodeQL, SBOM (SPDX + CycloneDX), cosign keyless signing, SLSA Level 3 build provenance.
- Keychain-backed auth storage (desktop) with migration helper and a localhost IPC channel for the Bun sidecar.

### Breaking changes

#### W9 — Shell environment is now filtered before it reaches the sidecar

The desktop launcher used to inherit the **entire** login-shell environment
(`zsh -il` / `bash -l`) and forward it to the `opencode` sidecar. Starting
this release, only an explicit allowlist is forwarded:

- **Exact allowlist:** `PATH`, `HOME`, `USER`, `LANG`, `LANGUAGE`, `TERM`,
  `TMPDIR`, `TMP`, `TEMP`, `NO_COLOR`, `FORCE_COLOR`, `NODE_ENV`,
  `BUN_INSTALL`, `SHELL`, plus every `XDG_*`.
- **Prefix allowlist:** `LC_*`, `OPENCODE_*`.
- **Stripped:** anything matching `*_API_KEY`, `*_TOKEN`, `*_SECRET`,
  `GITHUB_TOKEN`, `AWS_*`, and any other non-allowlisted variable.

**Who is affected**

- Users who exported `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
  `GITHUB_TOKEN`, etc. in `~/.zshrc` / `~/.bashrc` / `~/.profile`
  expecting OpenCode to pick them up transparently.
- MCP servers relying on `GITHUB_TOKEN` being inherited from the user
  shell.

**Migration path**

1. Preferred: declare credentials via `opencode auth login <provider>`
   so they land in `auth.json` (or the OS keychain, opt-in via
   `OPENCODE_AUTH_STORAGE=keychain`).
2. If you need a variable to reach the sidecar for a specific command,
   export it with the `OPENCODE_` prefix (forwarded by default) or pass
   it inline: `ANTHROPIC_API_KEY=xxx opencode ...`.
3. For MCP servers, declare the required environment explicitly in the
   MCP server config (`env: { GITHUB_TOKEN: "..." }`), not via shell
   inheritance.

### Features

- **Cost cap per session** (`experimental.task.cost_cap`) — `POST
  /task/:id/followup` returns `429 cost_cap_exceeded` past the cap.
- **Background task semaphore** (`experimental.task.max_parallel`) —
  tasks beyond the cap stay `queued` and drain FIFO.
- **llama-server tuning** — `--mmap`, `--slots`, `--slot-save-path`,
  `--cache-reuse 256`, speculative decoding via
  `OPENCODE_DRAFT_MODEL` with VRAM headroom guard
  (`OPENCODE_DRAFT_FORCE=1` opt-out).
- **Crash reporter** — on-disk JSON crash dumps under
  `<datadir>/crashes/`, rotated at 50 files, opt-in upload via
  `experimental.crash.upload_endpoint`.
- **GDPR endpoints** — `GET /user/data/export` streams a full JSON
  export; `DELETE /user/data` (requires `X-Confirm-Delete: yes`) purges
  sessions, `auth.json`, config, crash dumps and sandbox worktrees.
- **Audit log** — `audit_log` table with retention purger
  (`experimental.audit.retention_days`, 24h timer), instrumented on
  `session.create|remove`, `auth.set|remove`, `permission.grant|deny`,
  `task.cancel`, `config.update`.
- **Provider fallback (gated)** — `experimental.provider.fallback:
  "local" | "cloud"` enables handshake-only retry of `streamText` on
  the secondary provider; no mid-stream switching.
- **Thermal listener (scaffold)** — `get_thermal_state` Tauri command
  on Android, polled every 30 s to derive the runtime profile.
  `OPENCODE_THERMAL_FORCE=1` enables desktop simulation.
- **WebSocket ticket flow** — `POST /auth/ws-ticket` issues 60-second
  single-use JWTs; clients upgrade via `Sec-WebSocket-Protocol:
  bearer,<jwt>` or cookie. Query-string legacy gated by
  `experimental.ws_auth_legacy` (default `true` this release).
- **Mock provider harness** (`test/lib/mock-provider.ts`) and
  in-process server helper (`test/lib/in-process-server.ts`) for e2e.

### Fixes

- **B3** — Android `network_security_config.xml` restricted to RFC1918
  LAN ranges instead of global cleartext.
- **B4** — `AbortSignal.timeout(15000)` on all outbound Ollama
  probe/list/show/remove fetches.
- **B5** — `File.read` (already) rejects symlinks escaping the project
  root via `assertInsideProject` + `realpathSync`.
- **B6** — Dependabot, CodeQL (JS/TS), SBOM workflow, and now cosign
  keyless signing + SLSA Level 3 provenance are all live.
- **W5** — `ensureCorrectModel` restart-loop circuit breaker verified
  (`MAX_RESTARTS=3` over 120 s).
- **W7** — MCP tool scoping uses exact `Set.has` lookups; fixes the
  `github` vs `github_enterprise` prefix collision.
- **W8** — CORS allowlist tightened to
  `opencode.ai / www.opencode.ai / docs.opencode.ai /
  console.opencode.ai` + dev-loopback origins.
- **W1/W2/W3** — typed task cost helper, typed `getWorktreeInfo`
  errors logged, `experimental.task.cost_cap` enforced.
- **I7** — secret scanner extended to Slack / Stripe / GitHub PAT /
  Google / Anthropic / OpenAI / Datadog patterns, plus tool-output
  prompt-injection detection (`experimental.dlp.scan_tool_outputs`).

### Security

- cosign keyless signing activates automatically on every published
  release (see `.github/workflows/release-sign.yml`). Signatures
  (`.sig`, `.cert`) and SHA-256 digests (`.sha256`) are attached as
  release assets. Verify with:
  ```
  cosign verify-blob \
    --certificate-identity-regexp 'https://github.com/Rwanbt/opencode/.+' \
    --certificate-oidc-issuer https://token.actions.githubusercontent.com \
    --signature <file>.sig --certificate <file>.cert <file>
  ```
- SLSA Level 3 build provenance (`*.intoto.jsonl`) attached to every
  artifact. Verify with `slsa-verifier verify-artifact`.
- Dependabot, CodeQL and SBOM remain enabled per `PR` and weekly cron.
- `auth.json` tokens can now optionally live in the OS keychain on
  desktop (`OPENCODE_AUTH_STORAGE=keychain`). Migration is idempotent
  and rollback-safe (renames `auth.json` → `auth.json.migrated`).

### Upgrade notes

- If you relied on shell-inherited credentials, re-read the **W9
  Breaking change** section above before upgrading.
- The keychain backend is **opt-in** this release
  (`OPENCODE_AUTH_STORAGE=keychain`). Default remains the on-disk
  `auth.json` at mode 0o600.
- Android LAN connectivity to non-RFC1918 hosts over plain HTTP is
  rejected. Use HTTPS or run the server on a LAN range.
- `experimental.ws_auth_legacy` defaults to `true`; it will flip to
  `false` once the three client call sites (`app`, `terminal`, `web
  Share`) finish migrating to `createAuthenticatedWebSocket`.

### Checksums

All release artifacts ship with `.sha256`, `.sig`, `.cert` and
`.intoto.jsonl` siblings. Cross-verify:

```
sha256sum -c <artifact>.sha256
cosign verify-blob ...   # see Security section
slsa-verifier verify-artifact <artifact> \
  --provenance-path <artifact>.intoto.jsonl \
  --source-uri github.com/Rwanbt/opencode \
  --source-tag <vX.Y.Z>
```

| Artifact | SHA-256 |
|----------|---------|
| `<opencode-desktop-x86_64.msi>` | `<fill in from .sha256>` |
| `<opencode-desktop-aarch64.dmg>` | `<fill in from .sha256>` |
| `<opencode-mobile.apk>` | `<fill in from .sha256>` |
| `<opencode-cli-linux.tar.gz>` | `<fill in from .sha256>` |

### References

- **Why This Fork matrix** — see `README.md` (section "Why This
  Fork").
- **Pre-production audit closed in this release** —
  `PRODUCTION_REVIEW_2026-04.md` blockers B1–B6 and warnings W1–W9.
- **QA checklist signed off per device** — `QA_ANDROID_DEVICES.md`
  and `MANUAL_TESTS.md`.
- **Sprint change log** — `SPRINT1_NOTES.md` through
  `SPRINT5_NOTES.md` (and `SPRINT6_NOTES.md` if present).
- **Prod readiness index** — `PROD_READINESS.md`.
