<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# M0-01 EVIDENCE — throwaway substrate spike

> Statut : **EVIDENCE_PINNED** (input for ADR-000)
> Date : 2026-09-01T16:55+02:00
> Source : `docs/automation-v2/spikes/m0-01-substrate.ts` (throwaway,
> plan §193).

## 0. Cadrage

Ce document est l'**évidence mesurée** qui alimente ADR-000 (choix
du substrate d'exécution durable). Le spike est conforme à plan
§193 (« throwaway spike, explicitly non-production, no stable
persisted format, no public compatibility promise, discarded/migrated
after ADR »).

**Code de production touché** : aucun. Le spike lit
`packages/workflow-runtime/src/index.ts` (lecture statique
exhaustive, 91 lignes) et l'instancie avec un store jetable sous
`os.tmpdir()`. Tous les fichiers de state sont supprimés à la fin.

**Commande de reproduction** :

```bash
cd D:\App\unifia\.worktrees\rev3m-20260901\design
bun docs/automation-v2/spikes/m0-01-substrate.ts
```

**Dernière exécution** : 2026-09-01, 4 PASS / 2 PARTIAL / 1 FAIL / 7
MISSING.

## 1. Verdict par scénario (plan §38)

| # | Scénario | Verdict | Évidence |
|---|---|---|---|
| 1 | Happy path (no kill) | **PASS** | 3 steps executed, status=completed, nextStep=3 |
| 2 | Crash during step 1 → transitions to failed | **PASS** | state.status=failed, error=simulated crash |
| 3 | Resume after failure | **PARTIAL** | executor retry on resume works, but the retry semantics (idempotency key, UNKNOWN_EXTERNAL_STATE) are not modeled. **ADR-007 required.** |
| 4 | Crash during approval step | **PARTIAL** | approval was asked once and granted. The current code does not record approval outside the executor, so the approval decision is lost on a real crash. **ADR-002 + ADR-004 required** for effect-bound approval. |
| 5 | Duplicate trigger | **FAIL** | second start did NOT throw. The current runtime allows the duplicate to **silently overwrite the existing state**. This is a data-loss bug. |
| 6 | Cancel a paused workflow | **PASS** | status=cancelled after cancel() |
| 7 | Switch engaged before start | **PASS** | start threw: "workflow automation is disabled" |
| 8 | UNKNOWN_EXTERNAL_STATE handling | **MISSING** | the current runtime has no model for unknown external state. **ADR-007 required.** |
| 9 | Idempotency identity | **MISSING** | no IdempotencyKey in the runtime. **ADR-007 required.** |
| 10 | Durable timer / wait | **MISSING** | the runtime has no wait primitive. A step is awaited in-process; if the process dies, the wait is lost. **ADR-022 required.** |
| 11 | WorkflowVersion canonicalization (JCS + SHA-256) | **MISSING** | state is `JSON.stringify`, not JCS. No `DigestEnvelope`. **ADR-001 required.** |
| 12 | OwnershipScope / DeploymentScope enforcement | **MISSING** | the runtime does not check the scope. **ADR-020 required.** |
| 13 | Worker lease + fencing | **MISSING** | no worker identity, no lease, no fencing. **ADR-008 required.** |
| 14 | AtomicTransitionBoundary (state + side effect) | **MISSING** | the runtime saves state BEFORE the executor returns. If the executor has a side effect and the process dies after, the next resume retries the executor. There is no atomicity between commit and side effect. **ADR-004 + ADR-007 required.** |

## 2. Verdict agrégé

```text
PASS     4
PARTIAL  2
FAIL     1   (silent data loss on duplicate trigger)
MISSING  7
```

**Interprétation** :

- **4 PASS** : le runtime est **fonctionnellement** utilisable pour des
  workflows triviaux. Le store fichier fait un rename atomique (bon).
  Le switch d'engagement est honoré. Le cancel fonctionne.
- **2 PARTIAL** : le runtime a des **trous d'invariant** visibles. Un
  crash pendant une approbation perd la décision. Un retry après
  failure n'a pas d'idempotency. Ces deux cas sont du domaine ADR-007
  et ADR-002.
- **1 FAIL** : un bug de **perte de données silencieuse** sur trigger
  dupliqué. Le runtime actuel écrase l'état existant sans avertir. C'est
  un NO-GO immédiat (plan §238 interdit la perte d'effet irréversible
  non signalée).
- **7 MISSING** : le runtime actuel n'a **aucune** des abstractions
  substrate-grade du plan. UNKNOWN_EXTERNAL_STATE, idempotency,
  durable timer, canonicalization, scope, lease, atomic transition
  boundary — toutes absentes.

## 3. Conclusion pour ADR-000

L'**évidence empirique** confirme R-014 (BASELINE.md §5.1,
RISK_REGISTER.md, ADR-000) : le `@unifia/workflow-runtime` actuel
n'est pas un durable execution substrate au sens du plan §34-40.

L'option **A (Native Unifia declarative kernel)** reste la candidate
préférée (cf. ADR-000 PROPOSED) parce qu'elle évite la dépendance
externe. Mais la **charge d'implémentation** est désormais
quantifiée :

- ADR-001 (canonicalization) : JCS + SHA-256 + DigestEnvelope.
- ADR-002 (WorkflowIR) : 6+ node families + binding CEL.
- ADR-004 (history authority) : durable timer + atomic transition.
- ADR-007 (side-effect/retry) : IdempotencyKey + UNKNOWN_EXTERNAL_STATE.
- ADR-008 (scheduler) : worker identity + lease + fencing.
- ADR-022 (timer) : durable wait + cancel + timeout.
- ADR-020 (scope) : OwnershipScope / DeploymentScope enforced.

Soit **7 ADR** qui doivent être rendus avant que le kernel natif soit
utilisable. Le chemin DBOS ou Temporal-court-circuite tout cela mais
introduit une dépendance externe (vérification de la license MIT
DBOS, vérification du statut production-ready de `temporalite`).

L'option **B (DBOS)** est un raccourci raisonnable si DBOS-SQLite est
production-ready et si la license MIT est tenue. L'option **D
(Temporal)** demande `temporalite` production-ready.

L'option **A reste la plus alignée** avec la doctrine de souveraineté
Unifia et la cible `local-single-node` (EXECUTION_PROFILE_REQUIREMENTS
§1.1). Le coût est élevé mais mesuré.

## 4. Ce qui n'est PAS couvert par ce spike

- Comparaison avec DBOS et Temporal (les deux nécessitent un setup
  externe non disponible dans cette session).
- Le plan §38 liste 7 scénarios de kill ; ce spike en couvre 6 (le
  scénario « remote A succeeds but local ack lost » est `MISSING` par
  design — le runtime n'a pas de modèle remote/local).
- Performance (recovery time, throughput) — sera mesuré en M1 après
  ADR-000.
- Concurrence multi-worker (plan §107) — non applicable au runtime
  actuel single-process.

## 5. Statut

| Élément | Statut |
|---|---|
| Code de production modifié | **NON** |
| Code de production durable touché | **NON** |
| Spike run | **RÉUSSI** (1 exécution, 4 PASS / 2 PARTIAL / 1 FAIL / 7 MISSING) |
| Verdict pour ADR-000 | R-014 confirmé empiriquement |
| Décision ADR-000 | **EN ATTENTE** (décision externe Erwan) |

## Liens

- `docs/automation-v2/spikes/m0-01-substrate.ts` (code du spike)
- `docs/automation-v2/RISK_REGISTER.md#R-014`
- `docs/automation-v2/AUTOMATE_TRUST_PATH.md#A.1`
- `docs/automation-v2/BASELINE.md#5.1`
- `docs/adr/ADR-000-durable-execution-substrate.md`
- plan V2.3.1 §38 (failure matrix), §193 (throwaway spike), §194 (M0-01)
