# ANDROID-AUDIT-STATUS — Unifia Mobile (2026-04-17 audit, suivi 2026-08-01)

**Date :** 2026-08-01
**Audit source :** [ANDROID_AUDIT.md](ANDROID_AUDIT.md) (2026-04-17)
**Statut :** Suivi des findings Android

## Vue d'ensemble

| Section | Titre | Statut |
|---|---|---|
| 1 | Manifeste Android — état actuel | Documenté |
| 2 | Lifecycle — points critiques | À surveiller |
| 3 | Deep-links — cohérence config ↔ manifeste | À surveiller |
| 4 | PTY bridge (remote desktop sidecar) | À investiguer |
| 5 | WebView quirks | Documenté |
| 6 | Normalisation des chemins cross-platform | À investiguer |
| 7 | Batterie et thermal throttling | Documenté |
| 8 | Checklist de régression Android | À exécuter |

## Findings clés

### Lifecycle llama-server (Section 2.1)

- Problème : spawn/kill non aligné avec Activity lifecycle
- Impact : ressources consommées en background
- Statut : ⚠️ Warning (audit A.4)

### Deep-links config ↔ manifeste (Section 3)

- Problème : configuration Tauri (`scheme: ["unifia"]`) ≠ manifest double intent-filter
- Impact : deep-links mal routés
- Statut : ⚠️ Warning (audit A.19)

### PTY bridge (Section 4)

- Problème : implémentation critique pour remote desktop
- Impact : dépendance sur la stabilité
- Statut : 🔎 To verify (audit A.20)

## Statut global

- **Aucun bug bloquant Android** détecté.
- 3 sections à investiguer (2.1, 3, 4).
- 5 sections documentées (1, 5, 6, 7, 8).

## Plan

1. **v1.0** : Investiguer les 3 sections à risque
2. **v1.1** : Fixer les bugs critiques Android
3. **v2.0** : Refactor Tauri mobile

## Liens

- [ANDROID_AUDIT.md](ANDROID_AUDIT.md) — rapport original 2026-04-17
- [AUDIT-FINDINGS-STATUS.md](AUDIT-FINDINGS-STATUS.md) — audit général
- [SECURITY-AUDIT-STATUS.md](SECURITY-AUDIT-STATUS.md) — audit sécurité
- ADR-0006 (PolicyEngine)
- ADR-0009 (AuditRuntime)
