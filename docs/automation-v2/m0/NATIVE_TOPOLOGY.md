<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# M0 Native Topology — UNIFIA AUTOMATE V2.3.1

> Source normative : `docs/adr/ADR-000-DURABLE-EXECUTION-SUBSTRATE-M0-FROZEN.md`
> §8 (règles de qualification Native) + §20 (NATIVE_TOPOLOGY.md obligatoire).
>
> Ce fichier EST UNE CANDIDATURE. Il ne pré-sélectionne pas Native.
> Le M0 comparatif (Native vs DBOS Go) tranchera.

---

## 1. Contexte

UNIFIA_NATIVE est l'un des deux finalistes du M0 comparatif (avec
DBOS_GO_SQLITE). L'autre candidat est documenté dans
`docs/automation-v2/m0/DBOS_ADAPTER.md`.

Le choix de **topologie d'implémentation** pour la qualification M0
Native est un sous-choix. Il n'est **pas** la décision ADR-006 finale
sur la stack long-terme. C'est un choix de **celerity, testability,
et isolation** pour la fenêtre M0.

## 2. Options de topologie M0

### Option N-A : TypeScript / Bun

Implémentation dans le langage actuel du runtime V2.3.1 (Bun).

**Avantages** :
- Cohérence avec la stack actuelle (`packages/contracts`,
  `packages/workflow-runtime`, `packages/automate-m0-harness`)
- Pas de nouvel outil (Bun déjà pinné 1.3.11)
- Lecture du code source immédiat pour les reviewers V2
- Pas de cross-compilation, pas de cgo

**Inconvénients** :
- Bun runtime memory pressure sur la cible (reactor + GC + workers)
- Pas de modèle de possession strict (ownership Rust idiom absent)
- GC pauses sur la critical path (peuvent être <1ms mais non
  déterministes)
- Pas de binaire statique (Bun distribue un runtime)

### Option N-B : Rust (subprocess ou sidecar)

Implémentation dans un sidecar Rust appelé par le host TS.

**Avantages** :
- Binaire statique possible (musl, no_std optionnel)
- Ownership strict, zero-cost abstractions
- Pas de GC
- Ecosystème SQLite mature (rusqlite, sqlx)

**Inconvénients** :
- Introduit un nouveau langage dans la stack
- Cross-compilation Windows / Linux / macOS
- Build times plus longs
- Vérification croisée TypeScript ↔ Rust (FFI contract)
- DBOS Go ouvre la même question — pourquoi pas DBOS directement ?

### Option N-C : Hybrid (TypeScript orchestrateur + Rust kernel)

TS pour l'orchestration, Rust pour le kernel durable minimum.

**Avantages** :
- Séparation claire : orchestration (TS, ergonomique) vs kernel
  (Rust, durable)
- Permet de tester le kernel Rust en isolation
- Migration progressive vers plus de Rust possible

**Inconvénients** :
- Complexité FFI
- Deux langages à maintenir
- Risque de drift entre les modèles

## 3. Comparaison sur 9 axes (per pack gelé §8)

| Axe | N-A (TS/Bun) | N-B (Rust) | N-C (Hybrid) |
|---|---|---|---|
| **Durability** | Moyenne (FSync, write barriers explicites, GC) | Forte (ownership strict, contrôle fin) | Forte (kernel Rust) |
| **SQLite integration** | `bun:sqlite` (expérimental mais marche), `better-sqlite3` (mature) | `rusqlite` (mature, well-supported) | `rusqlite` côté Rust |
| **Fault injection** | Difficile (process boundaries floues) | Facile (process Rust = process OS) | Facile (kernel Rust = process OS) |
| **Windows packaging** | Facile (Bun build → exe portable) | Moyen (cargo build → exe + deps) | Moyen (deux binaires) |
| **Future mobile compatibility** | Très faible (Bun pas sur mobile) | Forte (Rust → Android/iOS via NDK) | Forte (kernel Rust portable) |
| **Existing Unifia stack** | 100% cohérent | Nouveau langage | Mixte |
| **Maintenance** | Continue stack actuelle | Nouvelle codebase à maintenir | Deux codebases |
| **Testability** | Facile (Bun test) | Bon (cargo test) | Mixte (FFI tests) |
| **IPC cost** | 0 (même process) | Élevé (subprocess ou FFI) | Élevé (FFI TS↔Rust) |

## 4. Recommandation pour la fenêtre M0 (transitoire)

**N-A (TypeScript / Bun)** pour la qualification M0 uniquement.

**Justification** :

1. La cible M0 est la qualification des invariants substrate-neutral
   (FC-01..FC-32, FC-31A/B, FC-13-CTRL). Pas la production long-terme.
2. N-A évite le coût d'introduction d'un nouveau langage pendant la
   fenêtre M0, qui est déjà chargée (réconciliation ADR-000,
   reclassification 51/51, harness substrate-neutral, deux adapters).
3. Le choix de topologie M0 n'est **pas** la décision ADR-006 finale.
   Il est révocable.
4. Si Native gagne le M0 comparatif, une migration N-A → N-B ou N-C
   peut être proposée post-M0 dans une ADR-006 révisée.

**Tradeoffs acceptés** :
- Bun memory pressure / GC pauses sur la critical path
  (acceptable pour M0, à challenger post-M0)
- Pas de binaire statique (Bun runtime nécessaire, OK pour cible
  local-single-node)

## 5. Architecture Native M0 (transitoire)

```
NativeQualificationAdapter (TypeScript)
   |
   +-- EffectLedger (append-only, SQLite via bun:sqlite ou better-sqlite3)
   |     - WAL journal mode, synchronous=NORMAL
   |     - busy_timeout=5000ms
   |     - checkpoint auto
   |
   +-- FencingAuthority (FencingToken monotonic, SQLite)
   |
   +-- EffectDispatcher (idempotent sur effect_key)
   |
   +-- ApprovalBroker (wrap existing 0007-approval-broker.md, V2)
   |
   +-- CapabilityAuthority (wrap ADR-024 contracts)
   |
   +-- WorkflowRuntime (wrap packages/workflow-runtime V2)
```

Tous les composants écrivent dans le même `M0_NATIVE_DB.sqlite`
pour les invariants FC-14, FC-25 (multi-process test).

## 6. Substrat minimal M0 Native — composants à implémenter

Pour atteindre les 10 critères M0 du pack gelé :

1. **WorkflowRun identity** : UUID v7 déterministe depuis `runId`
2. **Effect ledger** : append-only SQLite table avec effect_key UNIQUE
3. **Fencing tokens** : monotonic integers, SQLite
4. **Approval state** : SQLite table, durable restart
5. **Capability enforcement** : Zod schema validate avant chaque effect
6. **Canonical value persistence** : FC-31A — bytes exact, pas JSON
   pretty-print
7. **Host adapter** : FC-31B — float64 / typed integer séparation
8. **Timer model** : durable timer (FC-22 area), pas setTimeout
9. **Cancellation** : AtomicTransitionBoundary-based
10. **Retry / reconciliation** : M3-04/05/06 already in contracts

## 7. Livrables (per pack gelé §20)

- `docs/automate/m0/M0_RESULTS_NATIVE.json` (à venir)
- `docs/automate/m0/M0_EXPECTED_NA_NATIVE.json` (à venir, déclaratif)
- `docs/automate/m0/EXIT_NATIVE.md` (à venir, stratégie de sortie)
- `docs/automate/m0/evidence/native/` (dumps SQLite, logs, traces)

## 8. Ce que cette topologie ne prétend PAS

- **N-A est un choix pour la qualification M0 uniquement.**
- **N-A n'est pas la décision ADR-006.**
- **N-A peut être révoqué post-M0** si le candidat Native gagne.
- **N-A ne pré-sélectionne pas Native** sur DBOS Go.

## 9. Source

Pack gelé : `docs/adr/ADR-000-DURABLE-EXECUTION-SUBSTRATE-M0-FROZEN.md`
Baseline : `docs/automation-v2/m0/BASELINE.md`
DBOS_ADAPTER.md : `docs/automation-v2/m0/DBOS_ADAPTER.md`
