# Independent P3 Review — Claude

**Date**: 2026-08-03
**Status**: `AMENDMENTS_REQUIRED_BEFORE_IMPLEMENTATION`
**Reviewer**: Claude (read-only independent review)
**Branch observed**: `recovery/unifia-audit-correction-20260803`

## Recommendation

`START_P3_CONTRACTS`: contract amendments are authorized; runtime implementation
and upstream imports remain closed until the amendments and conformance doubles
are complete.

## Critical blockers

### B1 — WebSocket authentication bypass

Open Cowork `src/main/remote/gateway.ts` marks WebSocket clients authenticated
outside token mode and routes messages without the same authorization path as
channel messages. The P3 contract must authenticate every transport plane before
agent routing, not only channel messages.

### B2 — Pairing is not out-of-band authentication

The pairing flow can send a code to the unauthenticated requester and accept the
same requester’s reply. Pairing must require approval from an already
authenticated out-of-band actor.

### B3 — Sandbox new-target and Windows-path escape risk

Open Cowork `src/main/sandbox/path-guard.ts` falls back to lexical containment
when `realpathSync` cannot resolve a new target, and logs rather than rejects
some unconverted Windows command paths. The contract must canonicalize the
nearest existing parent, reject symlinked-parent escapes, and never widen the
root through path conversion or denylist-only command checks.

## Additional blockers

- B4: bundled Open Cowork DOCX/PDF/PPTX/XLSX skills carry Anthropic-restricted
  nested licences and cannot remain `ADOPT` candidates.
- B5: OpenWork approval `auto` returns allow without a scoped request or audit.
- B6: OpenWork authorized-root handling uses lexical `resolve` without full
  realpath containment.
- B7: Open Cowork plugin install enables/materializes components, can overwrite
  same-name paths, and lacks digest/licence provenance in the registry record.

## Minimum contract amendments

C1 CapabilityDescriptor/Request with scope parameters.
C2 single PolicyEngine, default deny, named critical combinations.
C3 ApprovalBroker with scope, expiry, revocation and timeout deny; no unrestricted
   service `auto` mode.
C4 ProvenanceRecord with source repo, commit, path, SHA-256 digest, SPDX/restricted
   licence state, copyright, modifications and importer.
C5 lifecycle `registered -> approved -> materialized`; installation does not enable.
C6 SandboxPort with parent canonicalization, symlink/junction protection and
   fail-closed Windows handling.
C7 RemoteTransportPort with authentication on every transport plane, out-of-band
   pairing approval, anti-replay and invalid `open` mode.
C8 AuditRuntime with append-only storage outside agent-writable workspace and
   events for all decisions, including automatic and denied decisions.
C9 SecretStore, TaintTracker, quotas, kill switches and threat model.

## Required conformance tests

Approval: reject global auto mode, deny undeclared capability, timeout deny,
expiry/revocation deny, audit allow/deny.

Remote: reject open mode, deny unauthenticated WebSocket clients in every mode,
route WS through the same authorization path, deny empty allowlist on every
transport, require out-of-band pairing, reject replay.

Sandbox: deny new target under symlinked parent, existing symlink escape,
lexical traversal, Windows path outside workspace, quoted destructive command,
TOCTOU parent replacement, and junction escape.

Plugins/provenance: install leaves components disabled, materialization requires
approval, identity is digest-based, no overwrite, no implicit capabilities,
external CLI is brokered, restricted/nested licence blocks adoption, `/ee` is
rejected, digest mismatch is denied.

## Gate

`P3_CONTRACT_AMENDMENT_REQUIRED`. No runtime code was changed by this review.