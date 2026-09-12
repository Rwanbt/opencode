# P1-C100 — Plan détaillé : Harness multi-runtime

**Carte parente :** P1-C100 (Phase 1, DEFERRED → DETAILED)
**Statut :** `READY` — prêt à exécuter
**Date :** 2026-07-31
**Source :** Plan V3 §13 « CI, tests, builds et harness multi-runtime »

## Contexte

Pour valider qu'Unifia fonctionne avec OpenCode legacy, Unifia runtime, et un FakeRuntime (test), il faut un **harness de conformance** qui exerce les 10 scénarios du Plan V3 §13.

## Découpage en sous-cartes

### P1-C100a — FakeRuntimeAdapter
- **Statut :** `READY`
- **Scope :** `packages/unifia/src/runtime/fake.ts` (~200 lignes)
- **Livrable :** FakeRuntime qui simule sessions, prompts, events, permissions
- **Acceptance :** tous les tests peuvent utiliser FakeRuntime sans I/O

### P1-C100b — OpenCodeRuntimeAdapter test fixture
- **Statut :** `PROPOSED`
- **Scope :** `packages/unifia/src/runtime/opencode-fixture.ts` (~150 lignes)
- **Livrable :** Mock de l'API OpenCode legacy pour tester l'adapter
- **Acceptance :** OpenCodeRuntimeAdapter passe la conformance suite

### P1-C100c — Conformance suite (10 scénarios)
- **Statut :** `PROPOSED`
- **Scope :** `packages/contracts/test/conformance.test.ts` (~400 lignes)
- **Livrable :** Tests pour les 10 scénarios du Plan V3 §13 :
  1. Créer une session
  2. Envoyer un prompt
  3. Recevoir les événements
  4. Demander une permission
  5. Répondre à une permission
  6. Annuler
  7. Changer de workspace
  8. Lire/écrire un artefact
  9. Fermer proprement
  10. Récupérer après crash
- **Acceptance :** les 3 runtimes (Fake, OpenCode, Unifia) passent les 10 scénarios

### P1-C100d — Recording/Replay
- **Statut :** `PROPOSED`
- **Scope :** `packages/unifia/src/runtime/recording.ts` (~250 lignes)
- **Livrable :** System qui enregistre les events d'une session et les rejoue
- **Acceptance :** un recording peut être rejoué bit-pour-bit par n'importe quel adapter

### P1-C100e — Workspace fixtures
- **Statut :** `PROPOSED`
- **Scope :** `packages/contracts/test/fixtures/` (~100 fichiers)
- **Livrable :** Set de workspaces de test (mono-repo, poly-repo, large, empty)
- **Acceptance :** chaque fixture est créé/détruit proprement

## Critères de sortie Plan V3 §13

- [ ] CI verte
- [ ] FakeRuntime déterministe
- [ ] OpenCodeRuntimeAdapter passe la suite
- [ ] Le Workbench peut démarrer sans UI
- [ ] Les builds ne dépendent pas de secrets personnels
- [ ] Les téléchargements de sidecars sont hashés

## Dépendances

- **P2-C200** (Contrats Unifia) doit être fait EN PREMIER pour définir `RuntimeAdapter` interface
- **P1-C110** (SBOM) doit être fait pour le scan de licences

## Risques

| Risque | Niveau | Mitigation |
|---|---|---|
| OpenCode legacy a des bugs non-fixés | `MEDIUM` | Fixtures précis + tests d'intégration |
| FakeRuntime trop différent du vrai runtime | `LOW` | Tests de parité (mêmes outputs) |
| Recording/Replay fragile | `LOW` | Format JSON simple + versionning |

## Estimation

- **P1-C100a** : 1-2 jours
- **P1-C100b** : 1-2 jours
- **P1-C100c** : 3-4 jours
- **P1-C100d** : 2-3 jours
- **P1-C100e** : 1 jour
- **Total** : 8-12 jours solo, 4-6 jours équipe 2-3
