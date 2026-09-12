# P2-C200 — Plan détaillé : Contrats Unifia (@unifia/contracts)

**Carte parente :** P2-C200 (Phase 2, DEFERRED → DETAILED)
**Statut :** `PROPOSED` — bloqué par tooling absent conteneur
**Date :** 2026-07-31
**Source :** Plan V3 §7 (6 ports), §14 (Phase 2 — Contrats)

## Contexte

Les 6 ports du Plan V3 §7 sont la **frontière canonique** entre Unifia Core et Workbench. Ils définissent le contrat que tous les adapters doivent respecter.

## Découpage en sous-cartes

### P2-C200a — Package @unifia/contracts (structure)
- **Statut :** `PROPOSED`
- **Scope :** `packages/contracts/` (nouveau package)
- **Livrable :** Package TS avec les 6 interfaces + types associés
- **Acceptance :** `bun build packages/contracts` exit 0

### P2-C200b — RuntimeAdapter interface (Plan V3 §7.1)
- **Statut :** `PROPOSED`
- **Scope :** `packages/contracts/src/runtime.ts` (~100 lignes)
- **Livrable :** Interface + 7 méthodes + types
- **Acceptance :** doc TSDoc complète, compile strict

### P2-C200c — WorkspacePort interface (Plan V3 §7.2)
- **Statut :** `PROPOSED`
- **Scope :** `packages/contracts/src/workspace.ts` (~150 lignes)
- **Livrable :** Interface + 6 méthodes + types
- **Acceptance :** doc TSDoc complète, compile strict

### P2-C200d — CapabilityPort interface (Plan V3 §7.3)
- **Statut :** `PROPOSED`
- **Scope :** `packages/contracts/src/capability.ts` (~120 lignes)
- **Livrable :** Interface + 4 méthodes + types
- **Acceptance :** doc TSDoc complète, compile strict

### P2-C200e — ArtifactPort interface (Plan V3 §7.4)
- **Statut :** `PROPOSED`
- **Scope :** `packages/contracts/src/artifact.ts` (~100 lignes)
- **Livrable :** Interface + 4 méthodes + types
- **Acceptance :** doc TSDoc complète, compile strict

### P2-C200f — SandboxPort interface (Plan V3 §7.5)
- **Statut :** `PROPOSED`
- **Scope :** `packages/contracts/src/sandbox.ts` (~120 lignes)
- **Livrable :** Interface + 4 méthodes + types
- **Acceptance :** doc TSDoc complète, compile strict

### P2-C200g — RemoteTransportPort interface (Plan V3 §7.6)
- **Statut :** `PROPOSED`
- **Scope :** `packages/contracts/src/remote.ts` (~130 lignes)
- **Livrable :** Interface + 5 méthodes + types
- **Acceptance :** doc TSDoc complète, compile strict

### P2-C200h — Version negotiation + compatibilité
- **Statut :** `PROPOSED`
- **Scope :** `packages/contracts/src/version.ts` (~80 lignes)
- **Livrable :** Numérotation semver + compatibilité N-1
- **Acceptance :** un client v1.0 refuse de parler à un server v2.0 (et vice-versa)

### P2-C200i — Contract tests (fuzzing + property-based)
- **Statut :** `PROPOSED`
- **Scope :** `packages/contracts/test/contracts.test.ts` (~300 lignes)
- **Livrable :** Tests qui valident que les implémentations respectent les interfaces
- **Outils :** `ts-auto-mock` + `fast-check` (property-based testing)
- **Acceptance :** tous les adapters passent les tests

## Critères de sortie Plan V3 §14

- [ ] L'UI n'importe pas directement le cœur
- [ ] Le Workbench fonctionne avec OpenCode ou Unifia
- [ ] Les événements sont rejouables
- [ ] Les erreurs sont typées
- [ ] Le protocole refuse les versions incompatibles

## Dépendances

- **P1-C100a** (FakeRuntime) : permet de tester les contrats en isolation
- **ADR-0001 à ADR-0005** : définissent les décisions architecturales

## Estimation

- **P2-C200a** (structure) : 0.5 jour
- **P2-C200b-g** (6 interfaces) : 3-4 jours (0.5 jour chacun)
- **P2-C200h** (versioning) : 0.5 jour
- **P2-C200i** (tests) : 2-3 jours
- **Total** : 6-8 jours solo, 3-4 jours équipe
