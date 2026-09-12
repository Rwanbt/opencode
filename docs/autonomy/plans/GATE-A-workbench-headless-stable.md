# Gate A — Workbench headless stable

**Carte :** P2-GATE-A
**Statut :** `PROPOSED` — bloqué code TS
**Date :** 2026-07-31
**Source :** Plan V3 §15 (Gate A), ADR-0016

## Définition

**Gate A** est le premier checkpoint du projet Unifia. Il valide que le **Workbench headless** (unifia CLI + runtime) est **stable** et **fonctionnel** sans UI.

À Gate A, Unifia doit être capable de :
1. Démarrer en mode CLI (sans GUI)
2. Utiliser au moins 1 runtime (OpenCode legacy ou Unifia)
3. Passer la conformance suite (100%)
4. Générer un SBOM valide
5. Avoir 0 secret dans le repo
6. Avoir 0 code `/ee/` importé

## Critères de sortie (gate criteria)

### 0. Blocking criteria

- [ ] **0 secret** dans le repo (gitleaks scan passing)
- [ ] **0 code `/ee/`** importé (ADR-0012)
- [ ] **0 code GPL/AGPL/SSPL** dans les deps (cargo deny + license-checker)
- [ ] **Code licenses** : 95%+ deps en MIT/Apache/BSD
- [ ] **Tests** : 100% conformance suite pass (P1-C100c)
- [ ] **SBOM** : CycloneDX 1.5 généré
- [ ] **TypeScript** : `bun run typecheck` exit 0
- [ ] **Lint** : `bun run lint` exit 0

### 1. Functional criteria

- [ ] Workbench démarre en CLI : `unifia --headless`
- [ ] Workbench peut lister les runtimes : `unifia runtime list`
- [ ] Workbench peut lister les sessions : `unifia session list`
- [ ] Workbench peut créer une session : `unifia session create --name "..."`
- [ ] Workbench peut envoyer un prompt : `unifia session <id> prompt "..."`
- [ ] Workbench peut canceller une session : `unifia session <id> cancel`
- [ ] Workbench peut charger un workspace : `unifia workspace load <path>`
- [ ] Workbench peut renvoyer les events : `unifia events --follow`

### 2. Runtime criteria

- [ ] OpenCodeRuntimeAdapter implémenté (wraps OpenCode legacy)
- [ ] UnifiaRuntimeAdapter scaffold (vide pour l'instant, mais interface)
- [ ] FakeRuntimeAdapter déterministe pour les tests
- [ ] CompositeRuntimeAdapter sélectionne le runtime selon config
- [ ] Au moins 1 des runtimes est pleinement fonctionnel

### 3. Compliance criteria

- [ ] DO-NOT-IMPORT hooks actifs (pre-commit)
- [ ] Audit complet des licences (Phase -2)
- [ ] Audit comparatif 3 upstreams (Phase -1)
- [ ] SBOM CycloneDX 1.5 dans le repo
- [ ] MIGRATION-PLAN.md documenté (unifia-migrate.sh)
- [ ] BLOCKED-DECISIONS.md à jour

### 4. Documentation criteria

- [ ] README.md rebrand Unifia
- [ ] GOVERNANCE.md et UPSTREAM-STRATEGY.md
- [ ] 12+ ADRs (runtime, workspace, capability, etc.)
- [ ] 12 plans détaillés des phases 1-10
- [ ] CHANGELOG.md v1.0.0
- [ ] RELEASE-NOTES.md v1.0.0

## Process de validation

1. **Auto-validation** (par agent) : scripts vérifient les criteria
2. **Pre-commit review** : Erwan review les commits
3. **Demo** : 30 min presentation des features
4. **DECISION** : GO ou NO-GO
   - NO-GO → fix jusqu'à GO
   - Pas de release publique possible avant Gate A GO

## Décomposition en sous-cartes

| Sous-carte | Auteur | Scope |
|---|---|---|
| GATE-A-001 | Erwan | Finalize all code TS contracts (P2-C200) |
| GATE-A-002 | Erwan | Implement OpenCodeRuntimeAdapter (P5-C500) |
| GATE-A-003 | Erwan | Implement FakeRuntimeAdapter (P1-C100a) |
| GATE-A-004 | Erwan | Implement conformance suite (P1-C100c) |
| GATE-A-005 | Erwan | Run `bun run typecheck` (must pass) |
| GATE-A-006 | Erwan | Run `bun run lint` (must pass) |
| GATE-A-007 | Erwan | Run gitleaks (0 secret) |
| GATE-A-008 | Erwan | Run /ee/ scanner (0 violation) |
| GATE-A-009 | Erwan | Run license compliance (cargo deny + license-checker) |
| GATE-A-010 | Erwan | Demo 30 min |
| GATE-A-011 | Erwan | DECISION GO/NO-GO |

## Dépendances

- **Phase 1** : P1-C100 (harness), P1-C110 (SBOM), P1-C120 (hooks)
- **Phase 2** : P2-C200 (contrats)
- **Phase 5** : P5-C500 (OpenWork extraction)
- **ADR-0001** : RuntimeAdapter design
- **ADR-0012** : Provenance /ee/

## Risques

| Risque | Niveau | Mitigation |
|---|---|---|
| Typecheck échoue sur le fork upstream | `MEDIUM` | Fix incrémental, ADR par erreur |
| OpenCode legacy a des bugs | `MEDIUM` | Adapter strict, pas de fork |
| Conformance suite trop longue | `LOW` | Priorité sur les 10 scénarios Plan V3 |
| Conflict licenses | `MEDIUM` | OpenDeps replacement si GPL |

## Estimation

**Total : 4-6 semaines solo**, 2-3 semaines équipe 2-3

## Note opérationnelle

**Gate A est le premier checkpoint bloqueur** : aucune release publique n'est possible avant GO. Les phases 6+ dépendent de Gate A.

**Auto-revue interdite** pour les parties SECURITY-CRITICAL (P3-C300 livré en parallèle mais pas Gate A lui-même).
