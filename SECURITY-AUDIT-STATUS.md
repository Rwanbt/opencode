# SECURITY-AUDIT-STATUS — Unifia Fork (2026-04-17 audit, suivi 2026-08-01)

**Date :** 2026-08-01
**Audit source :** [SECURITY_AUDIT.md](SECURITY_AUDIT.md) (2026-04-17)
**Statut :** Suivi des findings sécurité

## Vue d'ensemble

| Statut | Count |
|---|---:|
| ✅ Fixed | 1 |
| ⚠️ Pending | 21 |
| **Total** | **22** |

## Findings par sévérité

| ID | Titre | Statut |
|---|---|---|
| S1.A1 | Desktop `devtools: true` in release builds | ✅ Fixed |
| S2.A1 | CORS wildcard on `*.opencode.ai` subdomains | ⚠️ Pending |
| S2.A2 | Deep link `providerID` not constrained | ⚠️ Pending |
| S2.A3 | `unsafe { env::set_var(...) }` on startup | ⚠️ Pending |
| S2.A4 | Windows registry reads without alignment check | ⚠️ Pending |
| S3.A1 | `innerHTML` assignments in trusted contexts | ⚠️ Pending |
| S3.A2 | Deep link `directory` not resolved before use | ⚠️ Pending |
| S1.L1 | Terminal WebSocket reconnect timer — already fixed | ⚠️ Pending |
| S1.L2 | Markdown rendering cache grows to 200 entries module-wide | ⚠️ Pending |
| S1.L3 | `session-prefetch` cache never shrinks | ⚠️ Pending |
| S2.L1 | SSE heartbeat double-stop race | ⚠️ Pending |
| S2.L2 | Terminal focus microbursts schedule concurrent timers | ⚠️ Pending |
| S1.V1 | Cost arithmetic underflow — already fixed (audit B.5) | ⚠️ Pending |
| S1.V2 | Fetch calls without timeout (Ollama, OAuth token exchange) | ⚠️ Pending |
| S1.V3 | `File.read` does not normalize symlinks | ⚠️ Pending |
| S2.V1 | RPC worker response map races on ID reuse | ⚠️ Pending |
| S2.V2 | No Zod validation on embedding provider responses | ⚠️ Pending |
| S1.S1 | WebSocket auth via `?authorization=` query param | ⚠️ Pending |
| S1.S2 | `auth.json` tokens stored in plaintext | ⚠️ Pending |
| S2.S1 | Shell env vars inherited by CLI sidecar | ⚠️ Pending |
| S2.S2 | Android network config permits cleartext globally | ⚠️ Pending |
| S3.S1 | Android `keystore` not committed but worth confirming on for | ⚠️ Pending |

## Statut global

- **Aucun bug bloquant sécurité** détecté.
- Les findings ✅ sont déjà corrigés dans le fork upstream.
- Les findings ⚠️ sont des recommandations à appliquer progressivement.

## Plan

1. **v1.0** : Appliquer les fixes ⚠️ critiques
2. **v1.1** : Audit sécurité refait
3. **v2.0** : Hardening complet

## Liens

- [SECURITY_AUDIT.md](SECURITY_AUDIT.md) — rapport original 2026-04-17
- [AUDIT-FINDINGS-STATUS.md](AUDIT-FINDINGS-STATUS.md) — audit général
- [ANDROID_AUDIT.md](ANDROID_AUDIT.md) — audit Android séparé
- ADR-0006 (PolicyEngine)
- ADR-0007 (ApprovalBroker)
- ADR-0009 (AuditRuntime)
- ADR-0010 (TaintTracker)
