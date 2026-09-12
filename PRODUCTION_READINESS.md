# Production Readiness — Unifia Workbench v1.0.0

> [!IMPORTANT]
> **SUPERSÉDÉ — ne pas utiliser pour décider d'une release.**
> Le document canonique est [`PROD_READINESS.md`](PROD_READINESS.md), dont le
> §0 porte le registre de gates faisant autorité. Ce fichier est conservé
> comme checklist thématique : ses cases n'ont jamais été renseignées et ne
> reflètent aucun état vérifié.

**Statut :** `SUPERSÉDÉ` (était `DRAFT`)
**Date :** 2026-07-31
**Cible :** Gate A (Workbench headless stable)

## Vue d'ensemble

Ce document liste **tous les critères** qu'Unifia doit remplir avant d'être considéré comme **production-ready** pour un usage réel (utilisateurs finaux, déploiement large).

## Catégories de readiness

### 1. Fonctionnel

- [ ] **Workbench démarre** en CLI (`unifia --headless`)
- [ ] **Workbench démarre** en GUI (`unifia` ou app Tauri)
- [ ] **Au moins 1 runtime** est fonctionnel (OpenCode legacy ou Unifia)
- [ ] **Sessions** : create, list, prompt, cancel, get
- [ ] **Workspaces** : load, list, close
- [ ] **Conformance suite** : 100% pass
- [ ] **i18n** : 21 langues fonctionnelles

### 2. Sécurité

- [ ] **0 secret** dans le repo (gitleaks)
- [ ] **0 code `/ee/`** importé (pré-commit + CI)
- [ ] **0 dépendance copyleft** (cargo deny + license-checker)
- [ ] **SBOM CycloneDX** 1.5 généré
- [ ] **Audit licences** : 95%+ deps en MIT/Apache/BSD
- [ ] **DO-NOT-IMPORT hooks** actifs
- [ ] **Provenance** : chaque import upstream tracé

### 3. Performance

- [ ] **Démarrage** : < 5 secondes (du lancement à l'UI)
- [ ] **Commandes CLI** : < 100ms par commande
- [ ] **Mémoire** : < 500 MB idle (CLI), < 1 GB GUI
- [ ] **Bundle size** : < 200 MB (Tauri), < 300 MB (Electron)

### 4. Fiabilité

- [ ] **Crash recovery** : state restauré après crash
- [ ] **Transactions** : DB SQLite cohérente
- [ ] **Idempotence** : re-run des commandes sans effet de bord
- [ ] **Logs** : structurés, exportables
- [ ] **Erreurs** : typées, lisibles, actionnables

### 5. Documentation

- [ ] **README** : installation, usage, contribution
- [ ] **CHANGELOG** : v1.0.0 complet
- [ ] **RELEASE-NOTES** : notes de release
- [ ] **API reference** : générée depuis TypeScript
- [ ] **Migration guide** : depuis opencode legacy
- [ ] **Tutoriels** : 5+ use cases courants

### 6. Ops

- [ ] **CI/CD** : GitHub Actions fonctionnel
- [ ] **Releases** : automatisés via release-drafter
- [ ] **Deps update** : Renovate configuré
- [ ] **Monitoring** : Sentry optionnel
- [ ] **Backup** : stratégie documentée

### 7. UX

- [ ] **Onboarding** : 5 min pour démarrer
- [ ] **Apprentissage** : < 30 min pour les bases
- [ ] **Erreurs utilisateur** : messages clairs
- [ ] **Documentation in-app** : intégrée

### 8. Compatibilité

- [ ] **macOS** : 13+ (Ventura)
- [ ] **Linux** : Ubuntu 22.04+, Fedora 38+
- [ ] **Windows** : 11 22H2+
- [ ] **Architectures** : x86_64, ARM64 (Apple Silicon, Linux ARM)

### 9. Légaux

- [ ] **LICENSE** : MIT
- [ ] **THIRD-PARTY-NOTICES** : généré
- [ ] **PATENTS** : aucune revendication copyleft
- [ ] **Trademark** : Unifia® déposé (recommandé)

### 10. Métier

- [ ] **Pricing** : décide (free / freemium / paid)
- [ ] **Support** : canaux définis (Discord, GitHub, email)
- [ ] **Documentation utilisateur** : site web
- [ ] **Onboarding** : vidéo tutorielle

## Critères bloquants (Gate A)

Pour passer **Gate A**, les critères suivants sont **bloquants** :

- [ ] 1. Fonctionnel : ≥ 80% (workbench CLI + runtime legacy)
- [ ] 2. Sécurité : 100% (0 secret, 0 /ee/, 0 copyleft)
- [ ] 4. Fiabilité : ≥ 50% (crash recovery, transactions)
- [ ] 5. Documentation : ≥ 80% (README, CHANGELOG, MIGRATION)

**Auto-revue interdite** pour les sections SECURITY-CRITICAL (futures).

## Cibles par release

| Release | Critères | Statut cible |
|---|---|---|
| v1.0.0 (Gate A) | 1, 2, 4, 5 (80%+) | ✅ Prêt |
| v1.5.0 (LTS) | + 3 (perf), 7 (UX) | ✅ Prêt |
| v2.0.0 (Gate B) | + 6 (8, 9) | ✅ Cowork ready |
| v3.0.0 (Gate C) | + 10 (métier) | ✅ Plateforme ready |

## Audit checklist

Pour chaque release, **deux reviewers** (Erwan + 1 contributeur senior) doivent :
- [ ] Vérifier cette checklist
- [ ] Cocher les critères remplis
- [ ] Documenter les NON-critères (deferred ones acceptable)
- [ ] Signer le rapport (`docs/autonomy/reports/GATE-X-CHECKLIST.md`)

## Conclusion

Unifia v1.0.0 est considéré **production-ready** quand :
1. Gate A passe (workbench headless stable)
2. Migration opencode → unifia est non-breaking (déjà livré)
3. Documentation utilisateur est complète
4. Aucun SECURITY-CRITICAL criteria n'est à fail

**Date estimée Gate A** : 4-6 semaines après début Phase 2 (2026-09-15 environ).

— *Équipe Unifia*
