# Work/Design execution state

This file is the durable execution state for the Unifia Work/Design integration.

## Current state

- Branch: `work-design`
- Base commit: `91daa35a26a8e44d7f35b539c91030ec1e230c54`
- Current card: `M8-b` (cross-process topology proof)
- Status: `IMPLEMENTED_WITH_DEFERRED_HUMAN_PROOFS`
- Commit or push performed: yes; latest pushed SHA is tracked after this slice.

## Cards

| Card | Status | Evidence | Notes |
|---|---|---|---|
| M0 | completed | Branch and clean worktree verified | Base is the local `dev` branch requested for this worktree. |
| M0b | completed | State files, integration ownership map, size gate, and merge simulation workflow created | 152 changed lines measured; local checks pass. |
| M1a | completed | Nine gate decisions recorded in `DECISIONS.md` from the reviewed master plan | No code or generated output changed. |
| M1b | completed | Identity variants and port lifecycle tests added; existing bootstrap proves approval flow and loopback binding | Approval persistence across process restarts remains an M8 concern. |
| M2a | completed | Export, app dependency, lockfile, runtime coherence test, and declaration-only registry guard pass | Existing test fixtures are not treated as authorities. |
| M2b | completed | Persistent per-directory mode context, four-mode rail, sibling routes, local state page, and app tests | No network client or server route introduced. |
| M3 | completed | `@unifia/contracts/workbench-wire` typecheck + 5 tests | Executable wire schemas, reconciliation rules, cursor/idempotency/token policies, binary references, handshake and rate limits. |
| M1c | implemented with deferred desktop proof | server handshake 5/5 + server 72/72 + bootstrap 40/40 + topology 5/5 + security/CORS 4/4 + shell bridge 5/5 + connection 2/2 + native sidecar 8/8 + desktop typecheck + Rust cargo check | Private sidecar RPC, native Tauri issue/rotate/revoke commands, and the desktop `Platform.workbench` adapter are implemented; MV-01/MV-02 runtime traces remain required. |
| M4 | implemented with deferred human proofs | workbench-shell typecheck + shell 122/122 + modes 4/4 + client 26/26 + bridge 5/5 + connection 2/2 | Typed client, bounded retry policy, SSE cursor resume, token refresh hook, event dispatcher, merge/gap rules, native adapter and identity-checked connection controller. Concrete platform bindings and packaged WebView proofs remain pending. |
| M5 | implemented with deferred human proofs | workbench-shell typecheck + shell 122/122 + modes 4/4 + client 7/7 + routes 11/11 | Total typed route registry with compile-time Work V1 coverage and explicit work/document versus design/render lineage. |
| M6 | implemented with deferred human proofs | workbench-server typecheck + server 72/72 + bootstrap 40/40 + security/preflight/topology + operations 2/2 | Reconnectable session SSE remains cursor-based; long prompt operations now receive idempotent operation IDs and can be cancelled through a scoped route. |
| M7 | implemented with deferred human proofs | contracts/workspace + workspace-runtime typecheck/tests + server 72/72 + shell typecheck + security guard | Bounded, root-confined file listing/search and protected `GET /v1/files/list` and `GET /v1/files/search` routes. |
| M8 | implemented with deferred human proofs | server typecheck + server 72/72 + security 3/3 + P3 C8/C9 7/7 + topology 5/5 | Pending approval listing scoped to a workspace, cursor/limit audit pages for trace/activity, distinct redacted server logging, and automatic-port ownership evidence are implemented; desktop lifecycle and manual checks remain. |
| M9a | implemented with deferred human proofs | artifact-runtime 38/38 + server 72/72 + typechecks + route registry | Artifact lineage listing/detail with provenance and base64 content, scoped by workspace read capability. |
| M9b | implemented with deferred human proofs | server typecheck + shell typecheck + server 72/72 | Artifact creation and revision route delegates to the persistent ArtifactStore under `artifact.create`. |
| M10 | implemented with deferred human proofs | server typecheck + shell typecheck + server 72/72 | Local artifact export route is capability-gated by `artifact.export`; destination stays inside ArtifactStore outbox and metadata defaults to strip. |
| M11 | implemented with deferred human proofs | spec/server/shell typechecks + server 72/72 | Server-side JSON spec validation delegates to `SpecRuntime`; requested capabilities are intersected with an empty workspace grant and never elevated. |
| M12 | implemented with deferred human proofs | shell typecheck + shell 122/122 + modes 4/4 + client 11/11 + routes 11/11 | Typed client methods for bounded file listing/search, URL encoding, response typing, and export of all server route registries. |
| M13 | implemented with deferred human proofs | server 72/72 + shell 122/122 + client 13/13 + modes/routes contracts | Documents list route filters persisted artifact heads; client exposes typed artifact and document catalogs. |
| M14 | implemented with deferred human proofs | shell typecheck + client 17/17 | Client exposes typed bounded trace and activity pages with explicit cursors and page kinds. |
| M15 | implemented with deferred human proofs | shell typecheck + client 20/20 + routes 11/11 | Client exposes scoped approvals, capability search filters, and idempotent artifact export; capability-picker registry now points to the real search route. |
| M16 | implemented with deferred human proofs | shell typecheck + DesignSpecPanel 5/5 | Pure spec panel model preserves inline/file provenance, reports line/column diagnostics, and resolves requested capabilities against an empty grant. |
| M17 | implemented with deferred human proofs | shell typecheck + DesignRenderer 5/5 | Canonical escaped SVG renderer consumes validated spec/tokens with deterministic dimensions and output. |
| M18 | implemented with deferred human proofs | shell typecheck + DesignPreviewPanel 4/4 | Preview model exposes mobile/tablet/desktop SVG data sources and refuses invalid specs while preserving diagnostics. |
| M19a | implemented with deferred human proofs | shell typecheck + DesignFiles 5/5 | Workspace file page adapts to a sorted Design catalog with asset/component/style classification and safe selection. |
| M19b | implemented with deferred human proofs | shell typecheck + DesignFiles 6/6 | Design file rows expose stable labels, kinds, and selected state for a UI surface. |
| M20a | implemented with deferred human proofs | contracts + shell typecheck + DesignSystem 6/6 + server 72/72 | Versioned `.unifia/workspace.json` manifests validate catalog id/version/source/tokens and reject unknown versions or duplicate ids. |
| M20b | implemented with deferred human proofs | shell typecheck + DesignSystem 6/6 + WorkbenchClient 27/27 | Picker rows sort multiple manifest catalogs deterministically and preserve a validated selected id. |
| M20c | implemented with deferred human proofs | server route + WorkbenchServer 72/72 + route registry | `GET /v1/design-systems` reads the authorized workspace manifest and returns 404 when absent; no fallback authority exists. |
| M21 | implemented with deferred human proofs | shell typecheck + ArtifactVersionPanel 4/4 | Artifact history ordering, structural diff, provenance display, and explicit export approval state are modeled from persisted artifact summaries. |
| M22 | implemented with deferred human proofs | shell typecheck + MobileNavigation 4/4 | Mobile navigation uses the shared route registry, switches drawer/rail by viewport, and carries Work/Design counts. |
| M23 | implemented with deferred human proofs | full Workbench Shell suite + 45-suite conformance; remote typecheck 35/35; release candidate file | Candidate release checklist is recorded; MV-01 through MV-10 remain pending and no signing/merge/publication is claimed. |
| M24 | implemented with deferred human proofs | app typecheck + app unit suite 704/704 + production build | Existing Workbench route renders the shared Work registry with operation selection and Design with editable validation diagnostics plus inert responsive SVG previews; native, lifecycle, and publication gates remain pending. |
| M1c-a | implemented with deferred native proof | workbench-server handshake 4/4 + shell client 22/22 + server typecheck; unsupported versions are refused and decisions are audited | `/v1/handshake` now exchanges the versioned wire payload and preserves a server instance id. Native token issue/rotate/revoke remains the M1c blocker. |
| M1c-b | implemented with deferred native proof | shell typecheck + client 26/26 | `WorkbenchClient.applyTokenRotation()` validates the executable wire contract and serializes requests until the native provider completes rotation; native bridge and server acceptance proof remain pending. |
| M1c-c | implemented with deferred native proof | workbench-server typecheck + handshake 4/4 + server 72/72 + bootstrap 40/40 + topology 3/3 + security/preflight 4/4 | `ScopedTokenAuthority` is injected into `WorkbenchServer`; internal native-only issue/rotate/revoke methods bind tokens to the process instance and audit decisions. No HTTP token route is exposed. |
| M1c-d | implemented with deferred platform proof | shell typecheck + NativeTokenBridge 4/4 + client 26/26 | `createNativeTokenProvider` adapts issue/rotate/revoke to the shell `TokenProvider`, validates returned lease data, and keeps signing material outside the WebView. Platform bindings remain pending. |
| M1c-e | implemented with deferred platform proof | Workbench Server handshake 5/5 + server 72/72 + bootstrap 40/40 + topology 3/3 + security/CORS 4/4 + typecheck | Native scoped tokens are now registered as workspace sessions, accepted through issuer fallback, preserved across rotation grace, and fully removed on revoke. |
| M1c-f | implemented with deferred platform proof | shell 13 scripts: WorkbenchConnection 2/2, Client 26/26, NativeTokenBridge 4/4; shell typecheck PASS | `connectWorkbench` creates the client only after decoding the native lease identity, completing the handshake, and checking server instance continuity; close remains explicit through native revoke. |
| M1c-g | implemented with deferred platform proof | app typecheck PASS + 704/704 tests + production build PASS | `Platform.workbench.connect` is now an explicit native-only injection point; Workbench mode consumes it when present, shows pending state otherwise, and revokes on cleanup. |
| M1c-h | implemented with deferred platform proof | NativeTokenBridge 5/5 + WorkbenchConnection 2/2 + shell typecheck PASS | Rotation accepts the structured server lease or an adapted string, while issue/rotation reject wrong-workspace and expired leases. |
| M1c-i | implemented with deferred platform proof | WorkbenchShell 13 scripts + typecheck PASS | `connectWorkbench` now uses validated metadata returned by the native adapter and never decodes JWT payloads in the WebView. |
| M1c-j | implemented with deferred desktop proof | WorkbenchNativeBridge 8/8 + WorkbenchServer full suite + desktop typecheck + desktop `cargo check` | The Unifia sidecar mounts `/workbench`, native IPC is protected by the existing keychain token, scoped leases are backed by real workspace sessions, and desktop Tauri commands feed `connectWorkbench`; no human runtime proof is claimed. |
| M1c-k | implemented with deferred Android proof | mobile typecheck + mobile `cargo check` | The embedded Android runtime passes its Keystore-derived IPC token through native-only Rust code and the mobile adapter feeds the same shell connection contract; packaged/device traces remain pending. |
| M8-a | implemented with deferred process proof | WorkbenchTopology 4/4 | Two concurrent automatic-port listeners receive distinct ports and process identities; occupied-port rejection and restart identity remain covered. |
| M8-b | implemented with deferred desktop proof | WorkbenchTopology 5/5 + Workbench Server typecheck | Two independently spawned Workbench workers receive distinct automatic ports and process identities; the actual desktop service lifecycle remains a manual gate. |
| M9-a | implemented with deferred packaged interaction proof | `node scripts/check-workbench-security.mjs` PASS | The guard now parses desktop/mobile CSP JSON and asserts loopback connect-src, data images, object-src none, and frame-ancestors none. |
| M7-a | implemented with deferred process proof | server typecheck + topology 3/3 | `WorkbenchHandle` now exposes the process `instanceId`; restart tests prove the released port is reusable without reusing the previous process identity. |

## Manual verification register

See `work_design/MANUAL-VERIFICATION.md`. Items MV-01 through MV-10 are intentionally pending until a human runs the desktop, Android, UI, lifecycle, CSP, and publication checks.

See `work_design/BLOCKERS.md` for the code-level causes and the safe unlock order.

## Validation log

- `git status --short --branch` → clean on `work-design`
- `git log -1 --oneline` → `28b7827b31 test(workbench): prove fresh instance identity on restart`
- `bash scripts/check-pr-size.sh dev` → 152 changed lines, under the 400-line limit
- `.github/workflows/work-design-integrity.yml` → merge-tree, size, and whitespace checks declared
- `DECISIONS.md` M1a gate table → nine plan decisions recorded
- `bun run --cwd packages/workbench-shell test` → PASS (122/122 + mode contract 4/4)
- `bun run --cwd packages/spec-runtime test` → PASS (37/37)
- `bun run --cwd packages/app typecheck` → PASS
- `node scripts/check-mode-registry.mjs` → PASS after limiting detection to registry declarations
- `bun run --cwd packages/app typecheck` → PASS
- `bun run --cwd packages/app test:unit` → PASS (704 tests, 0 failures)
- M2b scope check → no Workbench network request or server route introduced
- `bun run --cwd packages/workspace-runtime typecheck` → PASS after making the package-local compiler invocation explicit
- `bun run --cwd packages/workspace-runtime test` → PASS (12/12 + 5/5 + 12/12 + 4/4)
- `bun run --cwd packages/workbench-server typecheck` → PASS after making the package-local compiler invocation explicit
- `bun run --cwd packages/workbench-server test` → PASS (72/72 + 40/40 + 3/3)
- `bun x tsc --noEmit -p packages/contracts/tsconfig.json` → PASS
- `bun test packages/contracts/test/workbench-wire.test.ts` → PASS (5/5)
- `bun run --cwd packages/workbench-server typecheck` → PASS after explicit origin/CORS policy
- `bun test packages/workbench-server/test/security.test.ts` → PASS (2/2)
- `bun test packages/workbench-server/test/server.test.ts` → PASS (72/72)
- `bun test packages/workbench-server/test/bootstrap.test.ts` → PASS (40/40)
- `bun test packages/workbench-server/test/topology.test.ts` → PASS (3/3)
- `node scripts/check-workbench-security.mjs` → PASS locally; CI guard added for server/desktop/mobile Origin and CSP alignment
- `node scripts/unifia-conformance.mjs --json unifia-conformance.json` → PASS (8/8) after adding SPDX headers to seven owned test files that the CI gate correctly required.
- Android runtime preparation → PASS: Alpine `rootfs.tgz` generated at 824426778 bytes; the WSL branch and Bun-unavailable bundle reuse path in `packages/mobile/scripts/prepare-android-runtime.sh` were exercised.
- Android release build → PASS (exit 0): unsigned APK and AAB generated under `packages/mobile/src-tauri/gen/android/app/build/outputs/`; APK size 1115164803 bytes, AAB size 1066480647 bytes.
- `bun scripts/check-android-runtime.mjs` from `packages/mobile` → PASS: rootfs and 30 native libraries present. The ORT binary was supplied from an existing local prepared worktree through an ignored hardlink; no source checkout was modified.
- C7-1 (global typecheck): `bun run typecheck` → PASS (35/35 successful, 0 cached → 35 cached on warm run; cold run `bun run typecheck --force` 22.8s, warm run 129ms; exit 0 both ways). The composite-build approach is already in place for the heavy packages — `@unifia/app`, `@unifia/mobile`, `@unifia/desktop`, `@unifia/desktop-electron` use `tsgo -b` with `references: [{ "path": "../app" }]`, and `@unifia/app` itself is `composite: true` with `emitDeclarationOnly: true`. No further code or config change was required to restore the typecheck. The C7-1 note ("`fatal error: runtime: cannot allocate memory`") is now historic; the debt is paid. Single cold runs on this 16 GB host succeed without `--concurrency` tuning; a documented risk remains: parallel cold execution of all 35 packages is at the memory limit and may be brittle on a busier host.
- `bun run --cwd packages/app test:unit` → PASS (718/718, 29750 expect() calls, 6.90s).
- `git diff --check` → PASS (empty, vert).
- Android build warnings remain: Gradle reports a debuggable release build and the native ORT sync reports a Windows file-lock warning. These require review before treating the artifact as release-ready.
- The source APK remains unsigned; a local debug-signed copy was installed and executed on `b7163823`. No release signing, merge, or publication was performed; MV-03/MV-04 and all other human gates remain pending.
- M1c token implementation → `ScopedTokenIssuer` now owns workspace + instance + capability scoped tokens, short TTL, rotation grace, and close-time revocation; focused auth/security/preflight/topology validation passes (6 tests, 0 failures).
- M4 implementation → `packages/workbench-shell/src/client.ts` adds `WorkbenchClient`, `WorkbenchEventDispatcher`, bounded authentication retry, idempotency-aware mutation handling, SSE parsing, cursor continuation, and token-rotation hook; client contract test passes 7/7.
- M5 implementation → `packages/workbench-shell/src/routes.ts` adds total `WORKBENCH_ROUTE_REGISTRY`, route helpers, capability/event mapping, and artifact lineage discriminants; route contract passes 11/11.
- M6 implementation → operation registry adds idempotent operation tracking, asynchronous prompt execution, scoped cancellation, and typed M6 route registration; operation tests pass 2/2 and existing server suites remain green.
- M7 implementation → `WorkspacePort` now exposes bounded listing/search; `WorkspaceRuntime` resolves real paths inside the registered root, refuses escapes and enforces an entry quota; Workbench routes apply workspace auth and `workspace.read`; runtime and server assertions cover list/search.
- M8 implementation → `ApprovalBroker.pending()` and `GET /v1/approvals` expose only live requests for the authorized workspace; audit pages support bounded cursors for `/v1/trace` and `/v1/activity`; `ServerLogger` is separate from audit, defaults to info, redacts sensitive fields, filters debug, and rotates at a size limit.
- M9a implementation → `ArtifactStore.list()` returns latest heads from the authoritative on-disk lineage manifests; Workbench artifact list/detail routes enforce workspace scope and `workspace.read`, expose provenance, and encode bytes explicitly as base64.
- M9b implementation → `POST /v1/artifacts` creates a new lineage or version, validates the workspace bearer scope and `artifact.create`, and delegates persistence/provenance/versioning to `ArtifactStore`.
- M10 implementation → `POST /v1/artifacts/export` checks `artifact.export` before exporting the verified latest version through `ArtifactStore`; outbox names remain path-safe and metadata is stripped unless explicitly kept.
- M11 implementation → `POST /v1/specs/validate` parses untrusted specs through `SpecRuntime` and returns explicit denied capabilities without widening the workspace grant.
- M12 implementation → `WorkbenchClient.listFiles/searchFiles` consume the protected M7 routes with typed entries, deterministic query parameters and abort signals; the shell index now exports M6–M11 route registries.
- M13 implementation → `GET /v1/documents` exposes non-binary persisted artifact heads under workspace read scope; the client adds typed artifact/document catalog methods without creating a second store.
- M14 implementation → `WorkbenchClient.trace/activity` consume the existing scoped audit pages with typed events, bounded cursors, and deterministic query parameters.
- M15 implementation → `WorkbenchClient.listApprovals/searchCapabilities/exportArtifact` consumes the existing server authorities; capability search is explicitly `package.install` gated and export uses an idempotency key.
- M16 implementation → `createDesignSpecPanelState` is the shared pure model for Design spec input and diagnostics; it delegates validation to `SpecRuntime` and never elevates capabilities.
- M17 implementation → `renderDesignSpecSvg` is the shared deterministic SVG authority; it escapes spec text and applies only validated token values.
- M18 implementation → `createDesignPreviewPanelState` derives three canonical responsive previews from the renderer and never emits an image for invalid input.
- M19a implementation → `adaptDesignFiles` is the sole adapter from the bounded workspace index to Design file categories; directories and absent selections are excluded.
- M19b implementation → `renderDesignFileRows` projects the adapted catalog into stable panel rows and marks only the validated selection.
- M20a implementation → `.unifia/workspace.json` is the explicit version-1 workspace authority; contracts validate multiple unique catalogs and reject missing/unknown versions.
- M20b implementation → `createDesignSystemPickerRows` provides deterministic labels, versions, sources, and selection state from the manifest catalogs.
- M20c implementation → `GET /v1/design-systems` reads the authorized manifest and returns 404 without fallback when it is absent.
- M21 implementation → `createArtifactVersionPanelState` and `diffArtifactVersions` expose ordered history, provenance, changed fields, and an export state that is false until an approved export result exists.
- M22 implementation → `createMobileNavigationModel` reuses the shared eleven-route registry for mobile and exposes deterministic drawer/rail and Work/Design surface counts.
- M23 implementation → `work_design/RELEASE-CANDIDATE.md` records the completed implementation scope, automated evidence, and all human release gates without declaring release readiness.
- Fresh conformance rerun → PASS 8/8: 43 suites, 25 owned packages lint clean, typecheck 35/35; browser E2E remains explicitly skipped and Gate C remains NO-GO on its documented external conditions.
- M1c-d validation → shell suite 5 scripts, including NativeTokenBridge 4/4; app typecheck and production build PASS; Workbench security guard and conformance 8/8 PASS; browser/device/manual gates remain pending.
- M1c-e validation → Workbench Server handshake 5/5, server 72/72, bootstrap 40/40, topology 3/3, security/CORS 4/4, and typecheck PASS; platform bridge and browser/device/manual gates remain pending.
- M1c-f validation → WorkbenchShell 13 scripts pass, including WorkbenchConnection 2/2; shell typecheck PASS. Desktop/mobile concrete bridge bindings and browser/device/manual gates remain pending.
- M1c-g validation → app typecheck PASS, 704/704 tests, production build PASS with existing Vite warnings. Desktop/mobile concrete bridge bindings and browser/device/manual gates remain pending.
- M8-a validation → WorkbenchTopology 4/4 confirms two automatic-port servers do not share a listener or process identity; the full cross-process desktop proof remains pending.
- M9-a validation → WorkbenchSecurityGuard parses both packaged configuration CSPs and passes explicit origin, loopback, data-image, object and frame policies; MV-09 still needs packaged artifact extraction and interactive URL checks.
- M1c-h validation → NativeTokenBridge 5/5, WorkbenchConnection 2/2, and shell typecheck PASS; concrete platform bridge and manual scope/expiry evidence remain pending.
- M1c-i validation → WorkbenchShell 13 scripts pass, NativeTokenBridge 5/5, WorkbenchConnection 2/2, and typecheck PASS; concrete platform bridge and manual evidence remain pending.
- M1c-l validation → the mounted native bridge now proves issue → rotate with previous-token grace → revoke; `WorkbenchNativeBridge: 8/8 passed`.
- Current checkpoint → `619d9a4fc5 docs(work-design): close design system authority gate`; workspace-manifest contract documented in `work_design/WORKSPACE-MANIFEST.md`; branch `work-design`, remote typecheck 35/35.
- G6 validation → workspace manifest contract, M20 route, no-fallback 404, and multiple-catalog tests pass; full conformance is `46 suites`, `PASS: 8/8` with browser.
- GitHub Actions → run `31801998229` completed `success` for the G6 implementation.
- Full conformance validation → `45 suites passed` with `--with-browser`, including `GenerativeUiBrowserE2E: 10/10`; final verdict `PASS: 8/8`.
- GitHub Actions → run `31796360360` for `e549815907` completed `success`; the preceding `31795371897` failed only in desktop typecheck before the green rerun.
- GitHub Actions → run `31761195329` (`unifia-conformance`) completed `success` on code commit `aede7fc1c5fba75e7b857a657ce8b70f90a5ffd5`; subsequent pushes `54abaa8394` are documentation-only and outside the workflow path filter.
- Device observation → APK debug source remained unsigned; a local debug-signed copy installed on `b7163823`, `MainActivity` resumed, and `/global/health` returned `healthy=true` on loopback `127.0.0.1:14096`; MV-03/MV-04 remain pending for their full procedures.
- Lifecycle sub-test → same PID `6866` and resumed `MainActivity` after relaunch; MIUI refused `adb shell input keyevent` with missing `INJECT_EVENTS`, so true background/foreground behavior remains unproven.
- CSP static extraction → desktop and mobile Tauri configurations declare explicit loopback/IPC origins, `img-src data:`, `object-src 'none'`, and `frame-ancestors 'none'`; the runtime server CSP is self/data-only. Packaged-bundle and interactive URL checks remain MV-09.
- M24 UI wiring → `packages/app/src/pages/workbench-mode.tsx` now composes `createMobileNavigationModel`, `createDesignSpecPanelState`, and `createDesignPreviewPanelState`; app typecheck passes and the unit suite reports 704/704.
- M24 production bundle → `bun run --cwd packages/app build` PASS; Vite emitted only pre-existing chunk-size, CSS minifier, and dynamic-import warnings.
- M24 interaction → Work operation cards now select a scoped operation; Design spec editing recomputes line/column diagnostics and previews without executing markup. Typecheck, 704/704 unit tests, and production build pass.

## Resume first

1. Read this file, `DECISIONS.md`, and `../INTEGRATION.md`.
2. Review the M0b diff and run the CI workflow on the first PR.
3. M24 UI wiring is implemented; M1c-g injects the live connection point into the app, and M8-a strengthens automatic-port ownership evidence. Native platform bindings and MV-01 through MV-10 remain open. Do not sign, merge, publish, or mark the candidate release-ready from automated checks alone.

## 2026-08-14 UI repair continuation

- P0-A through P0-D completed against the current `745aa86b82` baseline; see `docs/autonomy/WORK-DESIGN-UI-REPAIR-2026-08-14.md`.
- W1 fixed workspace resolution outside route params and preserves `?session=` during mode navigation.
- W2 added visible bridge failure/retry states and real Work reads plus artifact export.
- The Workbench connection is now owned once by `ModeProvider` at workspace scope and shared by all three non-Code surfaces.
- Design now reads the authoritative `.unifia/workspace.json` manifest through `GET /v1/design-systems`; `SAMPLE_SPEC` is no longer a production source.
- Automate v0 was a real read-only `.unifia/workflows` file-index surface, but it reached a `startWorkflow` call with no `workflow.run` capability ever granted in this branch (audit finding ARCH-001). Per ADR-1033 (supersedes ADR-0033, 2026-08-17), Automate is now absent from the production interface — filtered from the rail and unresolved as a route — behind a developer-only, build-time-eliminated flag. `SHELL_MODES` still declares all four modes as the shared navigation contract.
- Automated gates are green; MV-01, MV-02, MV-06, MV-07, MV-08, MV-09 and MV-10 remain pending human/runtime gates.

## 2026-08-17 — Plan de remédiation audit, Phase 1–2

- **Audit independent** (2026-08-17) found 17 findings, 5 HIGH (verdict NO-GO, score 43/100) on worktree `work-design` @ `b7add2bbaf`.
- **Remediation plan v2** tracks 27 gate cards + 8 Automate successor cards + 11 deferred debt items.
- **Phase 1–2 cards complete** (15 commits local):
  - C0-1/C0-2: baseline checkpoints & Bun 1.3.11 gates ✅
  - C1-1 through C1-4: red tests (CORS, routes, capabilities, listing) ✅
  - C2-1 through C2-5: frontière fixes (FUNC-002 CORS, FUNC-001 SSE+backoff, SEC-001 capabilities, SEC-002 error headers, approval expiry) ✅
  - C5-1/C5-2: FUNC-004 pagination listing, FUNC-005 missing-prefix ✅
  - C5-4: ARCH-001 Automate removed from production interface ✅
  - C6-1: A11Y-001 mode rail — aria-pressed, nav landmark, i18n 17 locales; commit `5cce04fc08` ✅
  - C6-4: ARCH-002 test script in contracts ✅
- **C6-2 complete** (UX-001): `ConnectionBanner` derives the visible message and static connection selector from the same `failed` phase; 17 locales carry distinct retry copy; `packages/app` typecheck passes, unit tests pass (718/718), and `e2e/modes` passes (5/5). Commit: `cec8868341`.
- **C6-3 complete** (TEST-003 + REL-001): `check-mode-registry.mjs` excludes the generated Android runtime bundle by explicit path; `unifia-conformance.yml` runs the guard and watches all `packages/**` changes; `work-design-integrity.yml` also watches all package changes. Mode registry and security guards pass locally; the Bash PR-size wrapper remains unexecutable on this Windows host (`E_ACCESSDENIED`) and is CI/Linux evidence.
- **C6-5 complete** (TEST-001): all 15 `workbench-shell/test/*.test.ts` files and `packages/unifia/test/server/workbench-bridge.test.ts` are registered with `bun:test`; shell typecheck passes, shell runner reports 15/15, and the bridge runner reports 1/1. Final fusion gate remains pending.
- **C3-1 PR1 implemented with deferred browser proof**: `packages/workbench-server/test/real-transport.test.ts` starts an ephemeral real loopback listener, drives the production `WorkbenchClient`, and includes a Chromium-origin preflight assertion from `http://tauri.localhost`; the client/server portion reaches a real accepted handshake and the harness typechecks. `test:transport` cannot launch Chromium on this Windows host (`uv_spawn EPERM`/timeout), so C3-1 remains open until the browser gate executes in CI or another runtime.
- **C3-1 PR2 implemented**: `check-workbench-test-boundary.mjs` is wired into both CI workflows and rejects transport-harness references in production source roots; the guard passes locally. Commit `09dca6f533`. C3-1 remains open only for the real Chromium preflight execution.
- **C4-1 (GATE-M native)**: build prepared in `C:\Users\barat\AppData\Local\Unifia Dev\Unifia.exe`, awaits user manual inspection (devtools, network, origins, events, capabilities).
- **Remaining high-volume**: C3-1 (EPIC 2 PR harnais E2E transport réel), C5-3a/b/c (EPIC 3 PR Design), C3-2 (E2E), C7-1/C7-2 (GATE-M final).
- **Next implementation slice**: rejouer le Chromium réel de C3-1 PR1 en CI ou sur un runtime fonctionnel; après cette preuve, cocher C3-1 et poursuivre C3-2.
- **Zero commits pushed.** All local, guards/tests passing at each step, no parallel regressions.

## 2026-08-17 — Continuation C5-3 / C3-2 / C7

- **C5-3a complete**: Design drafts persist in a versioned IndexedDB store with workspace key, revision conflict detection, and debounced UI recovery state.
- **C5-3b complete**: Design saves canonical `design-spec.json` artifacts, reads version history/provenance through the production Workbench client, and renders deterministic version diffs.
- **C5-3c complete**: SVG is a guarded artifact kind; unsafe script/event-handler/external-reference content is rejected, while approved Design renders export through the existing artifact outbox with provenance.
- **C3-2 implementation proof complete**: a connected WorkbenchServer + WorkbenchClient test traverses Code session/prompt, Work file listing, and Design spec validation through the real route authorities. This is transport/application proof, not browser proof.
- **C7-1 remains unverified**: owned SPDX, lint, focused package tests, mode/security/boundary guards pass; the global `tsgo` typecheck exhausts machine memory (`fatal error: runtime: cannot allocate memory`). The isolated legacy TypeScript check exposed and fixed a pre-existing `TS2589` deep-instantiation hotspot in `packages/unifia/src/config/config.ts`; `tsc --noEmit -p packages/unifia/tsconfig.json` now passes. Native `tsgo` still needs a machine/runtime with sufficient memory before C7 can be green.
- **C7-2 remains open**: no fresh desktop executable/manual C4-1 evidence and no fresh Chromium/device gate. `C:\Users\barat\AppData\Local\Unifia Dev\Unifia.exe` is absent on this host; no release/sign/push/publication action was taken.
- **Current checkpoint**: branch `work-design`, local commits ahead of origin, untracked `.unifia/` and `test-results/` runtime artifacts preserved. Plan is not complete: only C3-1 Chromium proof, C4-1 manual runtime proof, C7-1 native typecheck/conformance, and C7-2 final human gates remain.
- **C3-1 retry evidence**: the shared `browse` Chromium daemon starts successfully outside the sandbox (`Status: healthy`), but the production harness uses direct Playwright `chromium.launch()` and hangs before `page.goto`; two outside-sandbox runs reached the 60-second test timeout with `0 pass`. C3-1 remains open; this is an execution-environment limitation, not a browser assertion pass.
- **Android C7-2 evidence**: fresh `build:android` completed with runtime/rootfs and 30 JNI libraries present; exact universal unsigned APK was debug-signed and verified with APK Signature v2/v3, installed on `b7163823`, launched as `ai.unifia.mobile/.MainActivity`, and observed alive at PID `11993` with `lastUpdateTime=2026-08-17 16:11:08`. The fresh process is alive, but the forwarded `127.0.0.1:14096` health probe is refused; the readable runtime logs and historical health responses are timestamped 2026-08-15 and cannot be used as fresh evidence. Desktop, Chromium, and full manual C7-2 gates remain open.
- **Android suite**: `bun run test` in `packages/mobile` passes 76/76 tests across four files; expected simulated LLM errors are logged by the tests but do not fail assertions.
- **Android foreground retry**: a second launch still resolves `ai.unifia.mobile/.MainActivity` with the existing PID `11993`, but the device is on the MIUI lock screen. `adb shell input keyevent 82` is rejected with `SecurityException: INJECT_EVENTS`; therefore the UI-driven runtime startup and a fresh `/global/health` response remain unverified. No app data was cleared and no device state was bypassed.
- **Mobile bundle working tree**: `scripts/verify-mobile-bundle.mjs` passes (`22` migrations, version metadata, observability runtime, and generated-copy equality). The build regenerated both tracked `unifia-cli.js` copies with an `8,910`-line dependency-resolution diff; these generated changes remain uncommitted pending a separate artifact review.
- **Final deterministic rerun**: isolated `bunx tsc --noEmit -p packages/unifia/tsconfig.json` passes, `packages/mobile` passes `76/76`, and `scripts/verify-mobile-bundle.mjs` passes. The regenerated bundles were reviewed and committed separately as `16775793fb`; runtime scratch artifacts remain untracked and preserved.
- **Requested release builds**: desktop `bun run tauri build --no-bundle` now completes successfully and produces `packages/desktop/src-tauri/target/release/Unifia.exe`; Android `bun run build:android` completes successfully and produces the universal unsigned APK and universal AAB. The Android build validates rootfs `824422887` bytes and 30 JNI libraries. Gradle still reports the existing debuggable-release warning; no signing, install, push, or publication is implied by the build alone.
