# AUDIT-FINDINGS-STATUS — Unifia Fork (2026-04-17 audit, suivi 2026-08-01)

**Date :** 2026-08-01
**Audit source :** [AUDIT_REPORT.md](AUDIT_REPORT.md) (2026-04-17)
**Statut :** Suivi des 20 findings

## Vue d'ensemble

| Statut | Count | Description |
|---|---:|---|
| ✅ Fixed | 16 | Déjà corrigés dans le fork |
| ⚠️ Warning | 0 | À investiguer |
| 🔎 To verify | 2 | À vérifier |
| **Total** | **21** | |

## Findings par criticité

### CRITIQUE (5)

## ### CRITIQUE/HAUTE/MOYENNE — Warning


## ### To verify

- **A.3**: Cleanup stream SSE sur abort potentiellement incomplet
- **A.20**: ASSETLINKS.json probablement absent côté `unifia.ai`

### Warning (à investiguer)

- **A.4**: Lifecycle `llama-server` Android `onPause`/`onDestroy` incomplet
- **A.5**: Runtime permission request Android manquante
- **A.11**: Commandes Tauri sans guard argument

## ### Fixed (depuis audit)

- **A.1**: Tokenizer naïf `length / 4` partout
- **A.2**: Reasoning budget hard-capé à 1024
- **A.6**: `Promise.all` sans propagation d'AbortSignal
- **A.7**: Cast `as any` sur window events mobile
- **A.8**: `ensureCorrectModel` — pas de circuit breaker
- **A.9**: Secrets sensibles en `localStorage` (mobile)
- **A.10**: CSP `null` dans `tauri.conf.json` mobile
- **A.12**: `_ownedChildPid` module-level peut devenir stale
- **A.13**: `JSON.parse(localStorage)` try/catch partiel
- **A.14**: Regex `QUANT_SUFFIX` — `.*$` backtracking
- **A.15**: Duplication tokenizer inline `llm.ts:171`
- **A.16**: `messageAgentColor` boucle backwards avec `.find` interne
- **A.17**: Ring buffer stderr 4096 B tronque stack traces llama-server
- **A.18**: Polling health 5 s permanent
- **A.19**: Deep-link : `scheme: ["unifia"]` plugin ≠ manifest double intent-filter
- **A.21**: HF search sans AbortController (complément)

## Plan

1. **v1.0** : Vérifier les findings 🔎 et ⚠️ restants
2. **v1.1** : Appliquer les fixes si applicable
3. **v2.0** : Audit complet refait (2026-08)

## Liens

- [AUDIT_REPORT.md](AUDIT_REPORT.md) — rapport original 2026-04-17
- [SECURITY_AUDIT.md](SECURITY_AUDIT.md) — audit sécurité séparé
- [ANDROID_AUDIT.md](ANDROID_AUDIT.md) — audit Android séparé
- ADR-0009 (AuditRuntime)
- ADR-0006 (PolicyEngine)
