# Unifia Work/Design release candidate

**Branch**: `work-design`
**Base**: `dev` at `91daa35a26a8e44d7f35b539c91030ec1e230c54`
**Candidate commit**: the commit containing this file on `work-design`
**Status**: implementation complete; human release gates pending

## Automated evidence

- Workbench Shell typecheck: PASS.
- Workbench Shell full suite: 5 package scripts pass; WorkbenchShell 122/122, client 26/26, NativeTokenBridge 4/4, modes 4/4, routes 11/11.
- Remote turbo typecheck on the latest push: 35/35 successful.
- CI conformance repair remains green at 8/8; the non-blocking Node 20/24 action warning remains known.
- Fresh local conformance rerun: PASS 8/8, 43 suites (41 Bun + 2 Vitest), 25 owned packages lint clean; browser E2E is explicitly skipped because it requires a real browser.
- GitHub Actions confirmation: run `31761195329` completed `success` for `unifia-conformance` on code commit `aede7fc1c5fba75e7b857a657ce8b70f90a5ffd5`; later documentation-only pushes do not match the workflow path filter.
- Static CSP extraction: PASS for explicit Tauri origins, loopback/IPC scoping, `img-src data:`, `object-src 'none'`, and `frame-ancestors 'none'`; the runtime server remains self/data-only for `connect-src`. MV-09 still requires packaged-bundle extraction and interactive allow/deny checks.
- Workbench UI wiring: PASS for the existing route composition; Work renders and selects from the shared eleven-function registry, while Design offers editable validation diagnostics and three responsive SVG previews through image sources. App typecheck and 704 unit tests pass.
- App production bundle: PASS; Vite build completed successfully, with existing chunk-size, CSS minifier, and dynamic-import warnings recorded but no build error.
- Workbench protocol handshake: PASS; server accepts/refuses the versioned payload, returns its authoritative instance id, audits the decision, and the client now sends the complete request body.
- Client token rotation handoff: PASS at the client boundary; `TokenRotation` is parsed at runtime and requests wait for the provider-owned rotation to complete. Native/server grace-period evidence remains pending.
- Native token authority boundary: PASS at the server boundary; issuer injection and internal issue/rotate/revoke methods are instance-bound and audited without exposing a public HTTP minting route. The private sidecar RPC is protected by the existing keychain IPC token.
- Native token shell adapter: PASS; `createNativeTokenProvider` validates structured leases, scope and expiry, while `connectWorkbench` checks native metadata against the server handshake. Desktop Tauri commands, Android Keystore RPC, and desktop/mobile `Platform.workbench` adapters are implemented; runtime evidence remains pending.
- Instance restart identity: PASS at the headless boundary; a released port can be reused only by a new process instance id. Cross-process desktop workspace contamination remains a manual/runtime gate.
- Workbench Server test command: corrected to run the two Vitest suites with `vitest`; the previous mixed Bun/Vitest script failure was runner configuration, not a handshake regression.

## Human gates

`work_design/MANUAL-VERIFICATION.md` remains authoritative. MV-01 through MV-10 are still `PENDING`; in particular no complete desktop/native bridge, Android lifecycle, SVG WebView, merge, or publication claim is made by this candidate.

`work_design/BLOCKERS.md` records the verified code-level blockers: desktop/mobile runtime traces, packaged Android WebView proof, and desktop lifecycle evidence. The versioned handshake, server issuer boundary, private sidecar RPC, Tauri commands, shell client, app injection point, and workspace-manifest Design System authority are implemented and tested.

Partial device evidence now exists for MV-03: a debug-signed local copy installed and launched on `b7163823`, with healthy loopback runtime. The full Android Work/Design, lifecycle and SVG inert procedures remain pending.

## Scope completed

M14–M22 now provide typed audit/approval/capability/export client flows, spec diagnostics, deterministic SVG and responsive previews, file and Design System models, versioned workspace-manifest catalog loading, artifact version/diff/provenance state, and shared mobile navigation.
