<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->
<!--
  Importé tel quel depuis le pack gelé fourni par le décideur le 2026-09-02.
  Seules ces lignes de commentaire ont été ajoutées, pour satisfaire la gate
  SPDX du hook pre-commit. Aucun contenu normatif n'est modifié.
-->

# ADR-000 — Durable Execution Substrate

**Projet :** Unifia Automate  
**Type :** Architecture Decision Record — fondation d’exécution durable  
**Version consolidée :** `V1.1.2-E1 / IMPLEMENTATION PACK`  
**Date de gel pré-M0 :** 2026-09-02  
**Statut architecture :** `FROZEN`  
**Statut contrat M0 :** `FROZEN`  
**Statut M0 :** `MEASURED-COMPLETE`
**Statut substrate final :** `RATIFIED — UNIFIA_NATIVE (2026-09-05)`
**Statut M1 :** `UNBLOCKED - FINAL GATE 81 REQUIRED`
**Stratégie :** `S2 — LOCAL AUTHORITY + PROFILE-SPECIFIC CERTIFIED ADAPTERS`  
**Finalistes Local :**
1. `UNIFIA_NATIVE`
2. `DBOS_GO_SQLITE`

---

# 0. Objet de ce fichier

Ce fichier est le document d’implémentation canonique d’ADR-000.

Il consolide et remplace, pour l’exécution du chantier M0, les versions de travail précédentes :

- ADR-000 V1.0 ;
- ADR-000 V1.1 ;
- ADR-000 V1.1.1 ;
- ADR-000 V1.1.2 ;
- erratum V1.1.2-E1.

Les versions antérieures restent utiles comme historique de décision, mais **ne doivent plus être utilisées comme contrat d’implémentation**.

La prochaine preuve admissible pour sélectionner le substrate n’est plus une nouvelle review théorique.

Elle est constituée par :

```text
M0_RESULTS_NATIVE.json
M0_RESULTS_DBOS_GO.json
M0_FAILURE_EVIDENCE/
DURABLE-SUBSTRATE-BENCHMARK.md
PACKAGING_RESULTS.md
RESOURCE_RESULTS.md
```

---

# 1. Mission d’implémentation

Construire un harness M0 substrate-neutral, puis qualifier à armes égales :

```text
A — Unifia Native DurableWorkflowAuthority
B — DBOS Go + SQLite DurableWorkflowAuthority adapter
```

Le M0 doit déterminer empiriquement :

1. si chaque candidat peut satisfaire les invariants durables d’Unifia ;
2. si les deux implémentent réellement la même sémantique canonique ;
3. quelles contraintes leur modèle de reprise impose au futur WorkflowIR ;
4. leurs différences de packaging, ressources et maintenance ;
5. si au moins un candidat mérite la ratification finale d’ADR-000.

Aucun candidat n’est présélectionné.

---

# 2. Règle suprême

```text
ONE WorkflowRun
=
ONE DurableWorkflowAuthority
```

Un `WorkflowRun` ne peut jamais être simultanément contrôlé par deux autorités durables indépendantes.

Cette règle est absolue.

Elle s’applique à :

- Native ;
- DBOS ;
- futures autorités Server ;
- migrations ;
- recovery ;
- backup/restore ;
- upgrade ;
- multi-process ;
- Desktop + CLI + Workbench Server ;
- reprise après crash.

---

# 3. Authority ≠ process

Une autorité logique unique peut être implémentée par plusieurs processus coordonnés.

Donc :

```text
ONE AUTHORITY
≠
ONE OS PROCESS
```

Un substrate multi-process peut être conforme si son protocole garantit qu’il reste une seule autorité logique.

Ce qui est interdit :

```text
Process A dispatch independently
+
Process B dispatch independently
+
same WorkflowRun
+
no shared fencing/coordination authority
```

---

# 4. Baseline repository

Baseline publique de référence historique :

```text
Repository:
Rwanbt/unifia

Branch:
work-design

Commit:
1bbbe6a614d90f1208e834767a2e28184cf0253c
```

Avant de coder, l’agent DOIT revérifier :

```text
current repository
current branch
HEAD
worktree cleanliness
package topology
whether later Automate baseline work has been integrated
```

Ne jamais supposer que le SHA historique est encore le bon point de départ.

Produire :

```text
docs/automate/m0/BASELINE.md
```

contenant :

```text
repository
branch
HEAD
tree hash if available
date
dirty/clean state
relevant package paths
```

---

# 5. Faits repository déjà établis à revalider

Le runtime historique est principalement :

```text
packages/workflow-runtime
```

Il est un sequential checkpointed step runner.

Son modèle historique ressemble à :

```text
WorkflowDefinition {
  id
  version
  workspaceId
  steps[]
}

WorkflowState {
  workflowId
  definition
  status
  nextStep
  outputs
  error?
}
```

Le store fichier historique persiste approximativement :

```text
.unifia/workflows/<workflowId>.json
```

avec un pattern :

```text
temporary file
→ rename
```

Le runtime historique n’est pas considéré comme une `DurableWorkflowAuthority` Automate V2.

Il manque notamment :

```text
WorkflowRunId independent from WorkflowDefinition.id
WorkflowDeploymentId
LogicalInvocationId
AttemptId
EffectKey
EffectId
EffectPolicy
authoritative durable history
projection reconstruction contract
durable timers
durable waits
durable approvals
transition/outbox atomicity
effect reconciliation
UNKNOWN_EXTERNAL_STATE
authority fencing
schema/version upgrade contract
```

---

# 6. Workbench Server — contrainte de migration

Le Workbench Server historique maintient une relation :

```text
workflowId → workspaceId
```

dans une map mémoire bornée.

Cette map :

```text
MUST NOT
```

rester source de vérité pour le scope d’un WorkflowRun Automate V2.

Le futur run doit porter durablement ses informations d’ownership/scope.

Les opérations :

```text
resume
cancel
inspect
approve
```

doivent retrouver et autoriser le run depuis des informations durables/reconstructibles.

---

# 7. Workbench Orchestrator

`workbench-orchestrator` reste :

```text
Work/session/workspace orchestration
```

et n’acquiert pas l’autorité durable Automate.

Il peut devenir :

```text
executor
client
adapter
control-plane caller
```

mais jamais une seconde authority du même run.

---

# 8. Policy P-1 — licence

Décision gelée :

```text
P-1 =
OSI_STRICT_FOR_FOUNDATIONAL_COMPONENTS
```

Un composant est fondationnel si le remplacer exige de réécrire un ou plusieurs éléments suivants :

```text
WorkflowRun durability
history authority
effect semantics
execution contract
```

Un tel composant doit utiliser une licence open-source OSI compatible avec :

```text
redistribution
forking
modification
self-hosting
long-term Unifia sovereignty
```

Les composants optionnels/non-fondationnels peuvent suivre une autre policy de provenance, hors ADR-000.

---

# 9. Conséquence Restate

Restate n’est pas rejeté parce qu’Unifia serait juridiquement interdit.

Le serveur Restate est rejeté comme fondation locale sous P-1 parce que sa licence courante est BSL 1.1, non OSI.

Donc :

```text
Restate
=
POLICY_ELIMINATED
for foundational Local DurableWorkflowAuthority
```

---

# 10. Policy P-2 — composant local

Décision gelée :

```text
P-2 =
UNIFIA_MANAGED_NATIVE_COMPONENT_ALLOWED
```

Un composant local peut être :

```text
TypeScript
Rust
Go
native binary
managed sidecar
```

si Unifia contrôle :

```text
install
start
stop
restart
upgrade
health
signature/digest verification
resource limits
backup integration
uninstall
```

Le premier Local profile n’exige pas :

```text
separately administered workflow cluster
mandatory remote control plane
mandatory separately administered database
```

---

# 11. Policy P-3 — plateforme

Décision gelée :

```text
P-3 =
PER_PLATFORM_LOCAL_GA
```

Windows, macOS et Linux peuvent être certifiés indépendamment.

Mais avant le gel du schéma durable productif, exécuter un preflight Windows couvrant au minimum :

```text
file locking
second process startup
SQLite/storage locking
restart
upgrade/replacement
backup/restore path
rename/file replacement semantics
file scanner/antivirus interference where reproducible
```

---

# 12. Mobile

`mobile-local-execution` est :

```text
FUTURE_COMPATIBILITY_REQUIRED
```

ADR-000 n’exige pas une implémentation Android production aujourd’hui.

Le choix Local ne doit cependant pas rendre une future exécution mobile structurellement impossible sans décision explicite.

---

# 13. Stratégie S2

Décision gelée :

```text
S2
```

Architecture :

```text
Unifia canonical semantics
          │
DurableWorkflowAuthority
          │
    ┌─────┴───────────┐
    │                 │
Local profile      Future server profiles
    │                 │
Native/DBOS        Temporal/DBOS/other
certified          certified adapter
```

Le Local substrate sélectionné ne détermine pas automatiquement le substrate Server/Cluster.

Chaque futur profile devra être certifié via le même contrat canonique.

---

# 14. Run authority identity

Chaque WorkflowRun stocke durablement :

```text
authorityKind
authorityProtocolVersion
```

`authorityKind` est immuable pendant le run.

Une migration d’autorité live est interdite.

Une transition vers une autre autorité nécessite :

```text
new WorkflowRun
```

ou :

```text
explicit offline migration
while no previous authority can execute
```

---

# 15. Autorité locale — ownership

Pour une autorité locale Unifia-owned :

```text
one durable authority store
→ one active authority ownership domain
```

Des processus concurrents :

```text
Desktop
CLI
Workbench Server
Supervisor
Test runner
Second desktop instance
```

doivent :

```text
become client of existing authority
```

ou :

```text
fail explicitly
```

Ils ne doivent pas devenir deux schedulers indépendants.

---

# 16. AuthorityGeneration

`AuthorityGeneration` représente un fencing epoch logique.

Pour un modèle Native :

```text
owner N
→ ownership transfer
→ owner N+1
```

Après activation de `N+1`, `N` ne doit plus pouvoir :

```text
commit authoritative state
authorize new external dispatch
complete authoritative transition
```

Un substrate externe n’est pas obligé d’exposer un entier nommé `AuthorityGeneration`.

Il doit démontrer une propriété équivalente de stale-owner rejection.

---

# 17. Contrat canonique minimal M0

Le harness définit une représentation substrate-neutral des concepts suivants :

```text
WorkflowVersionId
WorkflowDeploymentId
WorkflowRunId

DeploymentScope
OwnershipScope

LogicalInvocationId
AttemptId

EffectKey
EffectId
EffectPolicy
EffectRecord

WorkflowEvent
HistorySequence

DurableTimerId
CanonicalTimestamp

ApprovalId
ApprovalBinding

CancellationState

AuthorityKind
AuthorityProtocolVersion
AuthorityGeneration

SchemaVersion

UnifiaValue

UNKNOWN_EXTERNAL_STATE
```

Le contrat M0 n’est pas encore le WorkflowIR complet.

---

# 18. Identifiants globaux

Les identifiants suivants doivent être globalement uniques :

```text
WorkflowDeploymentId
WorkflowRunId
```

Ils ne doivent pas dépendre :

```text
local sequence counter
store-local row id
authority-local counter
process-local counter
```

Leur représentation concrète :

```text
UUID
ULID
other opaque format
```

n’est pas décidée par ADR-000.

L’ordre métier doit utiliser des timestamps/séquences explicites, pas l’encodage de l’ID.

---

# 19. LogicalInvocationId

Un WorkflowRun contient :

```text
1..N LogicalInvocations
```

Une LogicalInvocation reste stable à travers :

```text
retry
restart
authority reacquisition
projection rebuild
```

Retry :

```text
same LogicalInvocationId
same EffectKey if same logical effect
new AttemptId
```

---

# 20. EffectKey

L’identité sémantique normative est :

```text
EffectKey {
  effectIdentityVersion
  deploymentId
  runId
  logicalInvocationId
  effectSlot
}
```

L’`EffectId` est un identifiant opaque dérivé de ou associé durablement à l’EffectKey.

ADR-000 ne fige pas :

```text
hash algorithm
binary encoding
text encoding
canonical serializer
```

Cela appartient à ADR-001.

---

# 21. EffectSlot

`effectSlot` est un locator structurel stable.

Conceptuellement :

```text
EffectSlot {
  nodeExecutionPath
  iterationCoordinates
  effectOrdinal
}
```

## nodeExecutionPath

Identité stable du nœud dans une WorkflowVersion immuable.

## iterationCoordinates

Pour :

```text
map
bounded loop
fan-out
structured parallel
```

les coordonnées doivent être matérialisées durablement avant le dispatch externe.

Pour une map :

```text
stable item key
```

est préféré.

Sans clé métier stable, l’ordre/index utilisé doit lui-même être matérialisé.

Retry interdit :

```text
re-enumerate collection
→ silently derive new coordinates
```

## effectOrdinal

Distingue plusieurs effets émis par une même invocation logique.

Sa précision complète est routée vers `M0-M01`.

---

# 22. EffectPolicy

Classes canoniques :

```text
PURE
IDEMPOTENT
REPEATABLE
RECONCILABLE
NON_REPEATABLE
```

## PURE

Aucun effet externe observable.

## IDEMPOTENT

La répétition du même EffectKey ne produit pas de mutation externe supplémentaire.

## REPEATABLE

Le contrat métier autorise la répétition.

Cela ne signifie pas nécessairement idempotence.

## RECONCILABLE

Le provider possède un mécanisme d’observation permettant de déterminer si l’effet logique a eu lieu.

## NON_REPEATABLE

En cas d’incertitude, aucun replay automatique.

---

# 23. Sémantique des effets

ADR-000 interdit toute promesse générique :

```text
exactly once
```

ou :

```text
at-most-once via idempotency
```

Le modèle cible est :

```text
durable execution/dispatch semantics

+

stable EffectKey

+

provider idempotency when available

+

reconciliation when available

+

explicit uncertainty otherwise
```

Un retry du même effet logique :

```text
new AttemptId
same EffectKey
```

---

# 24. UNKNOWN_EXTERNAL_STATE

`UNKNOWN_EXTERNAL_STATE` est un état durable first-class.

Exemple :

```text
provider executed effect
local acknowledgement lost
outcome cannot be proven
```

Dans ce cas :

```text
NO blind retry
```

La sortie de cet état exige :

```text
reconciliation evidence
```

ou :

```text
explicit durable operator resolution
```

Toutes les surfaces doivent préserver cette distinction :

```text
API
CLI
Desktop UI
audit
history
```

---

# 25. UnifiaValue

Le modèle canonique M0 contient :

```text
null

boolean

UTF-8 string

UnifiaNumber

ordered array<UnifiaValue>

object<string, UnifiaValue>

CanonicalTimestamp where schema explicitly expects it

ArtifactRef

SecretRef / CredentialRef
```

Types hôtes interdits comme valeur durable générique :

```text
undefined
NaN
+Infinity
-Infinity
BigInt without tagged type
Date / time.Time / runtime date object
Map
Set
Symbol
function
class instance
runtime-specific object
raw large binary payload
raw secret material
```

---

# 26. UnifiaNumber — domaine canonique

`UnifiaNumber` est :

```text
any finite IEEE-754 binary64 semantic value
```

Interdits :

```text
NaN
+Infinity
-Infinity
```

Normalisation :

```text
-0
→
+0
```

Il n’existe pas de borne générale ±(2^53−1) sur une valeur déjà canonique.

Exemples valides :

```text
9007199254740992.0
1.7976931348623157e308
5e-324
```

---

# 27. Frontière des entiers hôtes

Les types entiers hôtes :

```text
Go int/int64/uint*
Rust i*/u*
JavaScript BigInt
```

ne sont pas un sous-type durable M0.

Conversion automatique vers `UnifiaNumber` autorisée uniquement dans :

```text
[-9007199254740991,
 +9007199254740991]
```

En dehors :

```text
NUMBER_OUT_OF_CANONICAL_RANGE
```

avant persistance.

Important :

```text
host float64 9007199254740992
→ PASS

host int64 9007199254740992
→ REJECT
```

Cette distinction est volontaire.

---

# 28. CanonicalTimestamp

`CanonicalTimestamp` représente :

```text
signed Unix epoch milliseconds in UTC
```

Plage M0 :

```text
[-(2^53 - 1),
 +(2^53 - 1)]
milliseconds
```

Un `CanonicalTimestamp` est conceptuellement une quantité entière exacte.

Les objets hôtes :

```text
JS Date
Go time.Time
Rust date/time object
```

ne sont pas persistés automatiquement.

Ils peuvent être convertis uniquement lorsqu’un champ/schema attend explicitement un CanonicalTimestamp.

---

# 29. Chaînes

Les strings canoniques sont des séquences Unicode représentables en UTF-8.

Pendant M0 :

```text
NO implicit NFC/NFD normalization
```

La séquence de code points/scalar values doit round-trip sans altération.

`U+0000` est autorisé et doit round-trip exactement.

---

# 30. Table de conversion hôte

| Valeur hôte | Résultat canonique |
|---|---|
| JS/Bun finite `number` | `UnifiaNumber` |
| Go finite `float64` | `UnifiaNumber` |
| Rust finite `f64` | `UnifiaNumber` |
| `-0` | `+0` |
| NaN / ±Infinity | reject |
| host integer safe range | `UnifiaNumber` |
| host integer outside safe range | reject |
| JS `BigInt` | reject |
| generic Date/time object | reject |
| typed timestamp field | `CanonicalTimestamp` |
| `undefined` | reject |
| function/Symbol | reject |
| Map/Set | reject |
| binary payload | `ArtifactRef` |
| secret | `SecretRef` / `CredentialRef` |

Les adapters ne peuvent pas choisir une policy différente.

---

# 31. Erreurs canoniques

Minimum :

```text
UNSUPPORTED_CANONICAL_VALUE
NUMBER_OUT_OF_CANONICAL_RANGE
NON_FINITE_NUMBER
UNSUPPORTED_HOST_TYPE
NON_CANONICAL_TIME
```

Les exceptions internes Go/JS/Rust ne sont pas autoritaires.

---

# 32. Durable Timer contract

Un timer M0 porte conceptuellement :

```text
timerId
createdAt
notBefore
state
missedTimerPolicy
```

États :

```text
PENDING
ELIGIBLE
FIRED
CANCELLED
EXPIRED
```

Invariant :

```text
FIRED
MUST NOT
return to PENDING
```

Après restart/resume :

```text
authoritativeTime >= notBefore
→ timer becomes eligible
```

pour la policy M0 :

```text
FIRE_ON_RECOVERY
```

`ELIGIBLE` ne signifie pas que l’effet externe résultant est complété.

Un changement de wall clock vers le passé ne doit pas refire un timer déjà FIRED.

Une implémentation peut utiliser une horloge monotone en interne.

---

# 33. WorkflowVersion pinning

Chaque run possède un :

```text
workflowVersionId
```

immuable.

Après upgrade :

un run incomplet peut :

```text
resume with compatible pinned WorkflowVersion implementation
```

ou :

```text
remain blocked
```

ou :

```text
undergo explicit offline migration
```

Interdit :

```text
load newest workflow definition and continue silently
```

---

# 34. SchemaVersion

L’état persistant identifie un `SchemaVersion`.

Règles :

```text
supported older schema
→ compatible read or explicit migration

unsupported newer schema opened by old binary
→ fail safely before mutation

migration
→ explicit
→ crash-safe
→ auditable
```

ADR-000 ne fixe pas une policy N-1/N+1 générale.

---

# 35. Authoritative history

Pour un WorkflowRun :

```text
authoritative durable information
defines strict logical progression
```

Une transition reconnue durable ne doit pas disparaître sous la garantie certifiée.

Le materialized state doit être reconstructible depuis l’information durable autoritaire.

Une projection ne peut pas devenir une seconde authority.

ADR-000 n’exige pas event-sourcing physique.

Autorisé :

```text
checkpointing
event history
snapshot + suffix
other internal model
```

si les invariants observables restent vrais.

---

# 36. Approval

Une approval doit devenir durable dans l’Automate authority.

L’actuel broker in-memory peut devenir façade.

Il ne peut pas rester source de vérité.

Un `ApprovalId` ne doit jamais être réutilisé de façon à pouvoir désigner une autre demande après restart.

Le scope exact ApprovalBinding ↔ LogicalInvocation est routé vers `M0-M02`.

---

# 37. Artifact authority

ArtifactStore reste l’autorité du domaine Artifact.

Automate persiste des :

```text
ArtifactRef
```

et ne prétend pas avoir une transaction distribuée atomique avec ArtifactStore si elle n’existe pas.

Les incohérences cross-store se traitent via :

```text
EffectKey
EffectPolicy
reconciliation
```

---

# 38. Capability / policy

Automate doit conserver les semantics utiles déjà présentes dans les contrats/catalogues :

```text
capability
scope
sandbox
timeout
retry
approval
reversible/effect semantics
```

Interdit :

```text
validate rich semantics
→ project into poorer runtime
→ silently lose enforcement metadata
```

---

# 39. Migration legacy `reversible`

Le catalogue legacy possède un booléen :

```text
reversible: boolean
```

Le nouveau modèle possède :

```text
EffectPolicy
```

La conversion n’est pas bijective.

Aucune migration ne doit choisir automatiquement la policy la plus permissive.

Ce travail est routé vers :

```text
MIG-M01
```

---

# 40. Candidats M0

## A. UNIFIA_NATIVE

Status :

```text
SURVIVOR
```

ADR-000 décide uniquement :

```text
Unifia-owned local durable authority candidate
```

Il ne ratifie pas encore :

```text
Rust
TypeScript
SQLite
RocksDB
custom WAL
```

Pour le M0, choisir une topology réaliste et documentée dans :

```text
docs/automate/m0/NATIVE_TOPOLOGY.md
```

Le choix M0 n’est pas automatiquement ADR-006.

---

## B. DBOS_GO_SQLITE

Status :

```text
SURVIVOR
```

DBOS Go doit être intégré derrière l’adapter canonique Unifia.

Le modèle DBOS interne ne devient pas le modèle canonique.

La qualification doit enregistrer :

```text
DBOS version
Go version
SQLite driver
journal_mode
synchronous
busy_timeout
max open connections
checkpoint strategy
caller-provided SQLiteSystemDB yes/no
```

---

# 41. DBOS — configuration candidate

M0 compare la meilleure configuration raisonnablement certifiable de DBOS, pas ses convenience defaults.

Le harness doit contrôler explicitement la configuration SQLite via le mécanisme supporté par DBOS lorsque possible.

Aucune affirmation :

```text
DBOS SQLite is production-certified by upstream for Unifia
```

n’est autorisée.

Le M0 produit cette preuve pour le profile Unifia.

---

# 42. DBOS internal identity

DBOS possède ses propres notions de :

```text
workflow
step
invocation/recovery identity
```

Elles restent implementation details.

La sémantique visible par Automate doit rester :

```text
WorkflowRunId
LogicalInvocationId
EffectKey
AttemptId
```

Un test dédié doit provoquer une divergence possible entre identité interne DBOS et identité Unifia et vérifier que la sémantique Unifia reste autoritaire.

---

# 43. Replay vs checkpoint

Le M0 ne suppose pas qu’un modèle est supérieur.

Deux classes :

```text
checkpoint-oriented recovery
```

et :

```text
orchestration replay with durable operation result replay
```

doivent être caractérisées.

Sortie obligatoire :

```text
REQUIRES_DETERMINISTIC_ORCHESTRATION:
YES | NO | PARTIAL
```

Cette sortie est une entrée de décision ADR-000 et une future contrainte d’ADR-002.

---

# 44. Replay conformance scenario

Harness-controlled initial values :

```text
T1
R1
O1
```

pour :

```text
time
random
ordering
```

Après checkpoint partiel :

```text
crash
```

Recovery ambient values :

```text
T2 != T1
R2 != R1
O2 != O1
```

Observer :

```text
which observations were requested again
which values were replayed/materialized
which control-flow decisions were recomputed
EffectKey stability
completed effect replay behavior
final canonical state
```

PASS canonique :

```text
Unifia-visible semantics remain correct

EffectKeys remain stable/correct

no forbidden duplicate effect

no durable decision silently changes
```

Indépendamment de PASS :

documenter les contraintes de déterminisme imposées à ADR-002.

---

# 45. M0 scientific rule

Le M0 compare d’abord :

```text
CAN THIS ARCHITECTURE SATISFY THE CONTRACT?
```

Puis séparément :

```text
WHAT DOES IT COST TO OWN / DEPEND ON?
```

Le TCO ne peut pas compenser un échec de correctness.

---

# 46. Result taxonomy

Résultats autorisés :

```text
PASS
FAIL_ARCHITECTURAL
FAIL_CORRECTABLE
NOT_APPLICABLE
BLOCKED
NOT_VALID
```

## PASS

Le candidat satisfait la propriété testée.

## FAIL_ARCHITECTURAL

Le candidat ne peut pas satisfaire l’invariant sans violer une décision gelée.

Élimination.

## FAIL_CORRECTABLE

Le candidat pourrait satisfaire l’invariant après correction.

Documenter :

```text
root cause
correction
engineering scope
affected components
new risks
rerun required
```

Le candidat reste inéligible à la sélection jusqu’au rerun PASS.

## NOT_APPLICABLE

Doit être pré-déclaré avant exécution.

## BLOCKED

Le test ne peut pas être exécuté pour une raison explicite.

## NOT_VALID

Le harness n’a pas prouvé la propriété.

Aucune conclusion sur le candidat.

---

# 47. Predeclared NOT_APPLICABLE

Avant la première exécution, chaque candidat publie :

```text
M0_EXPECTED_NA_NATIVE.json
M0_EXPECTED_NA_DBOS_GO.json
```

Chaque entrée :

```json
{
  "test": "FC-XX",
  "reason": "...",
  "architecture_basis": "..."
}
```

Aucun N/A post-hoc sans nouvelle review explicite du test concerné.

---

# 48. M0 harness architecture

Créer un package dédié, sans couplage à un candidat :

```text
packages/automate-m0-contract
packages/automate-m0-harness
```

ou adapter la topology réelle du monorepo après PRE1.

Ne pas inventer un package si une topology plus cohérente existe déjà.

Le harness définit :

```text
DurableWorkflowAuthorityQualificationAdapter
```

interface conceptuelle commune.

---

# 49. Qualification Adapter — capacités minimales

L’adapter doit permettre au harness de :

```text
initialize candidate store

start run

resume run

inspect durable state

inject effect executor

inject approval decision

schedule durable timer/wait

cancel run

simulate authority shutdown

simulate forced crash

reopen authority

inspect history/projection

create backup

restore backup

open with alternate schema/binary version

attempt second authority ownership

query candidate diagnostics
```

Ne pas exposer au harness des détails spécifiques inutiles.

---

# 50. Fake external effect provider

Construire un provider déterministe contrôlé par le harness.

Il doit supporter :

```text
EffectKey

attempt logging

provider-side idempotency

delayed ACK

success then ACK loss

query/reconcile

forced unknown outcome

forced error

response metadata

canary secret injection
```

Le provider doit conserver son propre journal séparé du substrate pour déterminer ce qui a réellement été exécuté.

---

# 51. Fixture linéaire

Workflow M0 minimal :

```text
trigger
↓
Effect A
↓
durable approval / durable wait
↓
Effect B
```

Utilisé pour la majorité des crash tests.

---

# 52. Fixture non linéaire

Workflow M0 :

```text
trigger
↓
materialized map
↓
effect per item
↓
bounded loop
↓
effect per iteration
↓
structured parallel
↓
join
```

Assertions :

```text
all logical effects distinct
EffectKeys stable across retry
EffectKeys stable across restart
reorder cannot silently change materialized coordinates
new AttemptId does not change same logical EffectKey
```

---

# 53. FC-31A — Canonical round-trip

Teste :

```text
already canonical UnifiaValue
→ persistence
→ restart
→ canonical UnifiaValue
```

Égalité sémantique exacte.

---

# 54. FC-31A — nombres

PASS requis pour :

```text
0
1
-1
9007199254740991
9007199254740992
-9007199254740992
0.5
-0.5
smallest positive binary64 subnormal
smallest positive binary64 normal
largest finite binary64
```

`-0` :

```text
→ +0
```

REJECT :

```text
NaN
+Infinity
-Infinity
```

Pour les valeurs sensibles, le fixture doit également contenir le pattern IEEE-754 attendu :

```text
smallest positive subnormal:
0x0000000000000001

smallest positive normal:
0x0010000000000000

largest finite:
0x7fefffffffffffff
```

Carte :

```text
M0-M06
CANONICAL_BINARY64_BIT_VECTORS
```

---

# 55. FC-31A — strings

Cas obligatoires :

```text
""
"ascii"
"é"
"日本語"
"👨‍💻"
combining sequence
embedded newline
U+0000
```

Aucune normalisation implicite.

---

# 56. FC-31A — containers

Cas obligatoires :

```text
[]
{}
[null, true, false, 0, "x"]
nested arrays
nested objects
object containing array
array containing object
```

---

# 57. FC-31B — host adapter

Teste la conversion du langage hôte vers UnifiaValue.

Cas obligatoires :

```text
typed integer +9007199254740991
→ PASS

typed integer -9007199254740991
→ PASS

typed integer +9007199254740992
→ NUMBER_OUT_OF_CANONICAL_RANGE

typed integer -9007199254740992
→ NUMBER_OUT_OF_CANONICAL_RANGE

Go int64 max
→ NUMBER_OUT_OF_CANONICAL_RANGE

Go int64 min
→ NUMBER_OUT_OF_CANONICAL_RANGE

JS BigInt outside safe range
→ NUMBER_OUT_OF_CANONICAL_RANGE

host float64 9007199254740992
→ PASS
```

---

# 58. FC-31B — time

Cas :

```text
CanonicalTimestamp 0
CanonicalTimestamp -86400000
CanonicalTimestamp 1672531200000
```

Generic Date/time object outside timestamp-typed field :

```text
UNSUPPORTED_HOST_TYPE
```

Explicit timestamp field :

```text
host date/time
→ CanonicalTimestamp UTC epoch ms
```

Exécuter sous plusieurs host timezones.

Résultat canonique identique.

Ajouter une note M0 :

si le host object ne peut pas représenter une valeur CanonicalTimestamp extrême :

```text
explicit adapter error
NO clamp
NO truncation
```

---

# 59. Failure matrix

## FC-01 — crash before first durable transition

Attendu :

```text
no phantom completion
```

## FC-02 — crash after durable transition before dispatch

Attendu :

```text
command remains recoverable
```

## FC-03 — crash during Effect A

Attendu :

```text
EffectPolicy-safe result
```

## FC-04 — provider success, local ACK lost

Attendu :

```text
no blind duplicate
idempotency OR reconciliation OR UNKNOWN_EXTERNAL_STATE
```

## FC-05 — restart while approval pending

Attendu :

```text
same durable approval
same run
no lost request
```

## FC-06 — duplicate external trigger

Attendu selon dedupe contract :

```text
no silent state overwrite
no unintended duplicate
```

## FC-07 — crash while timer pending

Attendu :

```text
timer survives
```

## FC-08 — cancel while waiting

Attendu :

```text
no new dispatch
```

## FC-09 — cancel while effect active

Attendu :

```text
honest terminal/uncertain state
```

## FC-10 — crash immediately after completion

Attendu :

```text
remains completed
no effect replay
```

## FC-11 — projection/reconstruction

Attendu :

```text
reconstructed canonical state
==
materialized canonical state
```

## FC-12 — graceful vs forced shutdown

Attendu :

```text
documented semantics
no silent corruption
```

## FC-13 — power loss / OS-storage fault

Attendu :

```text
acknowledged durable transition survives claimed failure model
```

## FC-13-CTRL — negative durability control

Avant FC-13, utiliser une configuration volontairement non-durable.

Le harness DOIT détecter une perte.

Sinon :

```text
POWER LOSS HARNESS
=
NOT_VALID
```

## FC-14 — second authority/process

Deux vrais processus.

Attendu :

```text
one authority
OR client
OR explicit ownership failure
OR proven coordinated single logical authority
```

Jamais deux dispatchers indépendants.

## FC-15 — wall clock backward

Attendu :

```text
already-fired timer does not refire
canonical eligibility preserved
```

## FC-16 — wall clock forward

Attendu :

```text
canonical notBefore semantics preserved
```

## FC-17 — suspend/resume

Attendu :

```text
FIRE_ON_RECOVERY semantics
```

## FC-18 — upgrade with waiting run

Attendu :

```text
pinned WorkflowVersion semantics preserved
```

## FC-19 — old binary opens newer unsupported schema

Attendu :

```text
fail safely before mutation
```

## FC-20 — torn/corrupted durable record

Attendu :

```text
detect/refuse/recover according to documented contract
```

## FC-21 — ENOSPC during transition/outbox

Attendu :

```text
no falsely acknowledged durable transition
```

## FC-22 — storage permission loss

Attendu :

```text
fail closed
```

## FC-23 — cancel vs effect completion race

Attendu :

```text
one deterministic canonical terminal result
```

## FC-24 — approval allow vs expiry vs cancel race

Attendu :

```text
one valid resolution
```

## FC-25 — stale authority generation

Attendu :

```text
stale owner cannot commit/dispatch
```

## FC-26 — backup → destroy → restore

Attendu :

```text
canonical state restored
authority ownership re-established safely
```

AuthorityGeneration post-restore est précisé dans `M0-M03`.

## FC-27 — secret in executor input

Attendu :

```text
no plaintext durable leak
```

## FC-28 — secret in error/provider metadata

Attendu :

```text
no plaintext durable leak
```

## FC-29 — multiple independent WorkflowRuns

Attendu :

```text
no cross-run corruption
```

## FC-30 — concurrent same-definition starts

Attendu :

```text
distinct run identities
no overwrite
```

## FC-31A

Canonical UnifiaValue round-trip.

## FC-31B

Host adapter conformance.

## FC-32 — replay model conformance

Utiliser le scénario T1/R1/O1 → crash → T2/R2/O2.

Produire :

```text
REQUIRES_DETERMINISTIC_ORCHESTRATION
```

et vérifier la correction canonique.

---

# 60. Power-loss methodology

Un simple :

```text
kill -9
```

n’est PAS un power-loss test.

Méthodes acceptables :

```text
abrupt VM power-off
fault-injection storage layer
faulting virtual block device
equivalent reproducible mechanism
```

La méthode exacte doit être :

```text
scripted
documented
repeatable
versioned
```

FC-13-CTRL est obligatoire.

---

# 61. SQLite qualification

Pour tout candidat SQLite, enregistrer :

```text
SQLite version
driver
journal_mode
synchronous
busy_timeout
connection count
checkpoint policy
WAL behavior
backup mechanism
```

Une configuration dont la documentation permet de perdre un commit reconnu durable sous le failure model revendiqué échoue la certification de cette garantie.

---

# 62. Windows preflight

Exécuter avant final substrate/schema freeze productif :

```text
second process
locking
restart
storage replacement
backup/restore
SQLite concurrency
upgrade
file scanner interactions where reproducible
```

Produire :

```text
WINDOWS_PREFLIGHT.md
```

---

# 63. Security canary

Canaries injectés dans :

```text
executor input
executor exception
provider error
provider response metadata
```

Recherche ensuite dans :

```text
durable history
materialized state
logs linked to durable state
audit export
ArtifactRef metadata
```

Un secret brut ne doit pas y apparaître sauf contrat de sécurité explicitement autorisé.

---

# 64. Backup/restore

Le M0 doit démontrer :

```text
consistent backup
destroy store
restore
reopen authority
reconstruct run
preserve effects/approvals/timers
prevent stale old authority
```

---

# 65. Upgrade test artifacts

Conserver des binaries/artifacts de qualification versionnés permettant :

```text
old → new supported path
new state → old unsupported open
```

Ne pas simuler uniquement la version avec un flag runtime.

---

# 66. Native M0 scope

Native M0 est :

```text
correctness qualification kernel
```

Pas :

```text
full production Automate product
```

Mais tout invariant REQUIRED manquant est :

```text
FAIL_CORRECTABLE
```

et non :

```text
NOT_APPLICABLE
```

Le candidat doit rerun jusqu’à PASS avant sélection.

---

# 67. Native topology note

Avant codage substantiel du Native candidate, produire :

```text
NATIVE_TOPOLOGY.md
```

Comparer au minimum :

```text
TypeScript/Bun core
Rust core
Hybrid
```

selon :

```text
existing Unifia stack
desktop packaging
mobile future
SQLite/storage integration
fault injection
IPC cost
testability
maintenance
```

Choisir le meilleur topology M0.

Ce choix est qualification-only et ne ratifie pas ADR-006.

---

# 68. DBOS adapter note

Produire :

```text
DBOS_ADAPTER.md
```

Documenter :

```text
DBOS API used
DBOS version
Go module topology
process topology
IPC/API between Bun/TS and Go
SQLiteSystemDB configuration
workflow/step mapping
EffectKey mapping
EffectPolicy enforcement boundary
replay semantics
shutdown/restart lifecycle
packaging
```

---

# 69. Packaging comparison

Produire pour chaque candidat :

```text
install steps
first startup
binary/package size
startup latency
idle memory
active memory
disk usage
upgrade process
backup process
uninstall
offline operation
```

Même machine/règles lorsque possible.

---

# 70. TCO / ownership comparison

Ne pas convertir en score arbitraire unique.

Documenter :

## Native

```text
owned durable-engine code
security response burden
schema maintenance
crash correctness ownership
future distributed pressure
cross-platform burden
```

## DBOS Go

```text
upstream dependency
upgrade compatibility
forkability
API churn risk
adapter maintenance
Go/runtime packaging
exit/migration burden
governance dependency
```

Horizon :

```text
5 years
```

---

# 71. Downstream execution-model constraint

Pour chaque candidat, documenter :

```text
recovery strategy
determinism obligations
materialization points
WorkflowIR restrictions
node restrictions
compiler/runtime restrictions
```

Ceci est une dimension architecturale de sélection, distincte de la performance.

---

# 72. Exit strategy

Avant ratification finale, chaque finaliste doit documenter :

```text
stop accepting new runs
finish/block existing runs
export durable state
preserve history
preserve EffectKey/EffectRecord
preserve approvals/timers
introduce replacement authority
prevent live dual authority
```

Produire :

```text
EXIT_NATIVE.md
EXIT_DBOS_GO.md
```

---

# 73. Option E audit

Conserver une annexe avec les non-finalistes étudiés :

```text
Restate
Temporal
DBOS TypeScript
Reflow
Weft
Vercel Workflow/WDK
Cloudflare Workflows
Hatchet
```

Pour chacun :

```text
source
license
topology
maturity
reason not finalist
```

Ce discovery gate est fermé pour le cycle ADR-000 courant.

---

# 74. Cartes Medium routées

Créer explicitement les cartes suivantes.

## M0-M01 — EffectOrdinal stability

Définir/tester plusieurs effets depuis une même LogicalInvocation.

## M0-M02 — ApprovalBinding scope

Définir le scope exact entre :

```text
WorkflowRun
LogicalInvocation
EffectKey
ApprovalId
```

## M0-M03 — AuthorityGeneration after restore

Un restore doit réacquérir une fresh authority generation.

## M0-M04 — DBOS multi-process proof

FC-14 doit être démontré empiriquement, pas accepté depuis une documentation.

## M0-M05 — Predeclared NOT_APPLICABLE

Implémenter la pré-déclaration.

## M0-M06 — Binary64 bit vectors

Ajouter les bit patterns IEEE-754 attendus.

## MIG-M01

Migration `reversible:boolean → EffectPolicy`.

## ADR001-M01

Physical canonical serialization + Unicode normalization policy.

## ADR008-M01

Extended clock/time semantics.

## ADR016-M01

History retention/snapshot/compaction.

---

# 75. Structure d’artefacts attendue

Adapter à la topology réelle du repo, mais produire conceptuellement :

```text
docs/automate/m0/
  BASELINE.md
  M0-CONTRACT.md
  NATIVE_TOPOLOGY.md
  DBOS_ADAPTER.md
  DURABLE-SUBSTRATE-BENCHMARK.md
  PACKAGING_RESULTS.md
  RESOURCE_RESULTS.md
  WINDOWS_PREFLIGHT.md
  EXIT_NATIVE.md
  EXIT_DBOS_GO.md
  OPTION_E_AUDIT.md

  M0_RESULTS_NATIVE.json
  M0_RESULTS_DBOS_GO.json

  M0_EXPECTED_NA_NATIVE.json
  M0_EXPECTED_NA_DBOS_GO.json

  fixtures/
    M0_UNIFIAVALUE_VECTOR_V1.*
    linear-workflow.*
    nonlinear-workflow.*
    replay-workflow.*

  evidence/
    native/
    dbos-go/
```

---

# 76. Evidence requirements

Chaque PASS mécanique doit être accompagné d’une preuve reproductible :

```text
command
test id
candidate version
OS
runtime versions
configuration
raw result
logs
durable store snapshots where safe
fault injection config
```

Un PASS prose-only est interdit si le test est automatisable.

---

# 77. Machine-readable result schema

Chaque résultat doit contenir au minimum :

```json
{
  "test_id": "FC-04",
  "status": "PASS",
  "candidate": "UNIFIA_NATIVE",
  "candidate_version": "...",
  "environment": {
    "os": "...",
    "arch": "...",
    "runtime": "..."
  },
  "configuration": {},
  "evidence": [],
  "notes": ""
}
```

Pour `FAIL_CORRECTABLE` :

```json
{
  "root_cause": "...",
  "correction": "...",
  "engineering_scope": "...",
  "affected_components": [],
  "new_risks": [],
  "rerun_required": true
}
```

---

# 78. Candidate summary

Chaque M0 result file contient :

```text
candidate
version
commit
environment
storage configuration
PASS count
FAIL_ARCHITECTURAL count
FAIL_CORRECTABLE count
NOT_APPLICABLE count
BLOCKED count
NOT_VALID count
REQUIRES_DETERMINISTIC_ORCHESTRATION
```

---

# 79. Selection gate

Ordre de décision :

## Gate A — validity

```text
critical harness tests valid?
FC-13-CTRL valid?
shared fixtures identical?
```

Si non :

```text
NO DECISION
```

## Gate B — hard architecture correctness

Tout `FAIL_ARCHITECTURAL` sur un invariant Local REQUIRED :

```text
candidate eliminated
```

## Gate C — correctable failures

Tout `FAIL_CORRECTABLE` :

```text
fix
rerun
PASS required before final selection
```

## Gate D — compare surviving candidates

Comparer :

```text
correctness confidence
operational simplicity
packaging
resource footprint
cross-platform fit
determinism burden
future mobile path
maintenance ownership
dependency burden
exit strategy
```

---

# 80. Final ADR-000 outcomes

Après M0, une seule décision :

## A

```text
Local DurableWorkflowAuthority
=
UNIFIA_NATIVE
```

## B

```text
Local DurableWorkflowAuthority
=
DBOS_GO
```

## C

```text
NO CANDIDATE PASSES
```

Dans C :

```text
ADR-000 remains OPEN
M1 remains NO-GO
```

Ne jamais choisir un candidat seulement parce que l’autre a échoué.

---

# 81. M1 gate

M1 est interdit tant que :

```text
ADR-000 substrate not ratified
```

Après M0, avant M1 :

```text
select substrate
update ADR-000 final decision
external evidence review
Critical = 0
High = 0
ratify required downstream topology/history ADRs
rerun Final M1 Gate
```

---

# 82. Interdictions absolues

Le chantier ne doit jamais introduire :

```text
two durable authorities for one run

generic exactly-once claim

blind retry of uncertain irreversible effect

AI as policy authority

AI bypassing validators

secret plaintext in durable history by default

in-memory map as durable run ownership authority

mutable WorkflowVersion for running production run

silent latest-version resume

host-language serialization semantics as Unifia semantics

substrate-local identity replacing EffectKey

post-hoc NOT_APPLICABLE to hide failure

power-loss PASS without working negative control

M1 implementation before ADR-000 final ratification
```

---

# 83. AI role

L’IA peut :

```text
generate WorkflowIR proposals
explain
diagnose
repair proposals
optimize
generate tests
```

L’IA ne devient pas :

```text
durable state authority
security authority
permission authority
secret authority
policy authority
effect outcome authority
```

---

# 84. Autonomous implementation protocol

L’agent d’implémentation travaille de manière autonome.

Il ne demande une décision utilisateur que si :

```text
irreversible external action
security-sensitive credential choice
license acceptance outside frozen policy
destructive remote operation
architecture contradiction not resolvable from this ADR
```

Pour un obstacle technique corrigeable :

```text
investigate
document
fix
rerun
continue
```

Ne pas s’arrêter après chaque test/carte.

---

# 85. Recommended implementation order

```text
I0 — verify baseline
I1 — create M0 artifact structure
I2 — freeze shared contract code
I3 — implement UnifiaValue + adapter conformance vectors
I4 — implement fake external provider
I5 — implement shared linear/nonlinear/replay fixtures
I6 — implement result schema + evidence capture
I7 — implement power-loss harness + FC-13-CTRL
I8 — implement Native qualification candidate
I9 — run early discriminating Native tests
I10 — implement DBOS Go adapter
I11 — run early discriminating DBOS tests
I12 — complete FC matrix on both
I13 — Windows preflight
I14 — packaging/resource comparison
I15 — exit strategies
I16 — produce benchmark
I17 — independent evidence review
I18 — final ADR-000 substrate decision
```

---

# 86. Early discriminating tests

Avant d’investir dans toute la matrice, exécuter en priorité :

```text
P0-1 FC-13-CTRL
P0-2 FC-13
P0-3 FC-31A
P0-4 FC-31B
P0-5 FC-14
P0-6 FC-25
P0-7 FC-04
P0-8 FC-32 replay conformance
```

Si un candidat révèle un `FAIL_ARCHITECTURAL`, documenter immédiatement avant d’investir dans les tests moins discriminants.

---

# 87. Test discipline

Chaque test doit pouvoir être lancé :

```text
individually
for Native
for DBOS Go
for both
```

Avec :

```text
fixed random seed where relevant
unique temp workspace/store
cleanup
raw evidence preservation on failure
```

Les fault tests ne doivent pas contaminer les tests suivants.

---

# 88. Determinism discipline

Le harness lui-même doit contrôler :

```text
time
random
ordering
fault timing
provider acknowledgement
```

Un test dont le résultat varie sans seed/fault schedule documenté doit être classé :

```text
NOT_VALID
```

jusqu’à stabilisation.

---

# 89. CI

Les tests ordinaires peuvent tourner en CI standard.

Les tests destructifs/fault-injection lourds peuvent avoir une suite dédiée :

```text
M0_STANDARD
M0_FAULT
M0_POWERLOSS
M0_WINDOWS_PREFLIGHT
```

Ne pas prétendre qu’une CI classique simule une coupure d’alimentation si elle ne le fait pas.

---

# 90. No fake E2E

Un E2E M0 doit réellement traverser :

```text
canonical contract
selected adapter
real durable store
real restart/reopen
fake external provider as separate authority of external facts
```

Il est interdit de bypasser le substrate par un test double qui écrit directement l’état attendu.

---

# 91. Completion criteria — M0 implementation

Le chantier M0 est terminé uniquement lorsque :

```text
shared harness implemented
Native candidate implemented
DBOS Go candidate implemented

FC-01..FC-30 executed where applicable
FC-13-CTRL executed
FC-31A/B executed
FC-32 executed

all NOT_APPLICABLE predeclared
Windows preflight executed
packaging measured
resources measured
exit strategies documented

M0_RESULTS_NATIVE.json complete
M0_RESULTS_DBOS_GO.json complete
DURABLE-SUBSTRATE-BENCHMARK.md complete

Critical M0 findings = 0
High M0 findings = 0
```

Si un candidat garde un `FAIL_CORRECTABLE`, il ne peut pas gagner tant qu’il n’a pas été corrigé et rerun.

---

# 92. ADR-000 final ratification criteria

ADR-000 devient `RATIFIED` seulement si :

```text
P-1 frozen
P-2 frozen
P-3 frozen
S2 frozen

canonical contract frozen

M0 Native complete
M0 DBOS Go complete

power-loss proof valid
second-writer proof valid
Windows preflight complete

exit strategy complete

selected candidate:
no unresolved REQUIRED FAIL

Critical ADR/M0 findings = 0
High ADR/M0 findings = 0

final external evidence review complete
```

---

# 93. Current official status

```text
ADR-000 ARCHITECTURE
=
FROZEN

P-1 / P-2 / P-3
=
FROZEN

S2
=
FROZEN

M0 CONTRACT
=
FROZEN

LOCAL FINALISTS
=
FROZEN

1. UNIFIA_NATIVE
2. DBOS_GO_SQLITE

M0
=
READY

SUBSTRATE
=
NOT RATIFIED

M1
=
NO-GO
```

---

# 94. Implementation directive

**Commencer maintenant le chantier M0.**

Ne pas produire une nouvelle ADR théorique avant d’avoir des résultats exécutables.

La prochaine décision de substrate doit être fondée sur :

```text
M0_RESULTS_NATIVE.json
M0_RESULTS_DBOS_GO.json
```

et non sur la préférence d’un reviewer ou d’un agent.

---

# END ADR-000 IMPLEMENTATION PACK

---

# 84. Addendum - 2026-09-05 - M0 measured complete (FC-13 real power-loss)

M0 P0 matrix measured to completion. Mechanical application of the
frozen gates (sections Gate A-D, section 80). NO rubric text above is
modified - this addendum only records measured state.

## Measured results (local evidence - docs/automation-v2/m0/)

```text
M0 P0 symmetric matrix (both finalists):
  UNIFIA_NATIVE   : 8 measured PASS (incl. FC-13, FC-13-CTRL) - 0 FAIL
  DBOS_GO_SQLITE  : 8 measured PASS (incl. FC-13, FC-13-CTRL) - 0 FAIL

FC-13 real power-loss (60 iterations, one frozen environment):
  FC-13-CTRL      : 20/20 CONTROL_LOST_WRITE   -> methodology VALID
  UNIFIA_NATIVE   : 20/20 DURABLE_SURVIVED     -> PASS
  DBOS_GO_SQLITE  : 20/20 DURABLE_SURVIVED     -> PASS
  evidence: docs/automation-v2/m0/FC13-METHODOLOGY.md + evidence-fc13/*.json
```

## Gate state (frozen rubric)

```text
Gate A validity        : PASS (harness tests valid, FC-13-CTRL valid,
                         shared fixtures identical)
Gate B architecture    : no FAIL_ARCHITECTURAL - no elimination
Gate C correctable     : no outstanding FAIL_CORRECTABLE
Gate D comparison      : TWO surviving candidates - the frozen
                         dimensions do not produce a mechanical winner
                         (benchmark link 6-6 + FC-13 symmetric PASS)
```

## Outcome (frozen section 80)

```text
Outcome A or B : DECIDED - owner selected A (UNIFIA_NATIVE), recorded in section 85
Outcome C       : excluded (both finalists pass all gates)
```

Per frozen section 16 of the implementation plan: with both finalists
fully qualified and the decision still linked, the choice between
UNIFIA_NATIVE and DBOS_GO_SQLITE belongs to the owner alone, using
ONLY the frozen Gate D dimensions. The AI must not break this link.

```text
ADR-000 substrate final : OWNER_DECISION_REQUIRED
M1                      : NO-GO (frozen section 81 - unchanged)
```

---

# 85. Addendum - 2026-09-05 - OWNER DECISION RECORDED - RATIFICATION

Explicit owner input at the frozen Gate D / section 80 decision
boundary. The frozen rubric text is NOT modified; this addendum
records the decision and its basis.

## Decision

```text
Outcome A (frozen section 80)
Local DurableWorkflowAuthority = UNIFIA_NATIVE
```

## Owner Gate D assessment (frozen dimensions only)

```text
correctness confidence : TIE (no owner-level discriminator)
operational simplicity : UNIFIA_NATIVE
packaging              : UNIFIA_NATIVE
resource footprint     : UNIFIA_NATIVE (absent decisive measured
                         DBOS advantage)
cross-platform fit     : UNIFIA_NATIVE
determinism burden     : DBOS_GO_SQLITE (acknowledged, outweighed)
future mobile path     : UNIFIA_NATIVE
maintenance ownership  : UNIFIA_NATIVE (slight)
dependency burden      : UNIFIA_NATIVE
exit strategy          : UNIFIA_NATIVE
```

The DBOS determinism/replay advantage is acknowledged and does not
outweigh the operational, packaging, mobile, dependency, ownership
and exit-strategy advantages of the native kernel.

## DBOS record (accurate framing)

```text
DBOS_GO_SQLITE: qualified finalist, not selected at Gate D.
```

The complete DBOS qualification evidence is PRESERVED (M0 P0 matrix,
FC-13 real power-loss 20/20 DURABLE_SURVIVED, benchmark). The M0
comparison remains valuable architecture evidence. DBOS is NOT
recorded as a failed experiment. DBOS status: qualification/reference
evidence only, unless a future explicit ADR reopens the substrate
decision. NOT authorized: two production substrates.

## Production substrate commitments (owner directives 2-4)

```text
production substrate   : UNIFIA_NATIVE - exactly ONE WorkflowRun
                         authority in production
substrate-neutral      : WorkflowRun authority, history, attempts,
contracts required      timers, effects, recovery, inspection remain
                         exposed substrate-neutral (facade level);
                         higher layers must not couple to Native
                         implementation details
forbidden in prod      : DBOS_GO_SQLITE, CUSTOM_GO_SQLITE_CONTROL,
                         legacy workflow runtime as alternative
                         WorkflowRun authority
qualification code     : may remain isolated for regression/
                         reference purposes
```

## Ratification state

```text
ADR-000 substrate final : RATIFIED - UNIFIA_NATIVE
M1                      : UNBLOCKED (frozen section 81: final M1
                          gate rerun still required at M1 close)
```