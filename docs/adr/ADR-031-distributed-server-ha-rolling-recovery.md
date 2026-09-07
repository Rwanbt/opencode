<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

ADR-031 — Distributed Server HA / Rolling Upgrade / Recovery (post-M0)

Statut : DECIDED
Date : 2026-09-03
Révision : post-M0, post-correction-pack-2026-09-03
Dépendances : ADR-000 (RATIFIED_REQUIRED_PENDING), ADR-008, ADR-016,
ADR-018, EXECUTION_PROFILE_REQUIREMENTS.md (EPR-*)

Status

Version antérieure (correction pack 2026-09-03) : CHANGES_REQUIRED.
Cette version est DECIDED : le M0 proof gate est techniquement
SATISFIED (51/51 scénarios PASS, cf. ADR-000 §7), le contrat
DurableHistoryAuthority a une implémentation in-memory (M1-09), et
les invariants HA/rolling/recovery sont définis sans présupposer
de topologie de réplication particulière.

ADR-000 reste `READY_TO_RATIFY_WITH_M0_REOPEN_GATE` ; la ratification
formelle est à la main d'Erwan. Cet ADR ne peut pas démarrer
l'implémentation runtime des cartes DS-09/10/11 avant cette
ratification.

Portée

local-single-node : hors scope, HA non (réaffirmé par
  EXECUTION_PROFILE_REQUIREMENTS.md §1.1 + §5).

server-single-node : un nœud, HA non (réaffirmé par EPR-002).

server-cluster : futur profil multi-nœuds ; c'est le seul profil
visé par la HA distribuée.

DS-09 — invariants seulement, mécanisme différé

Le contrat stable avant choix de topologie est comportemental :

une seule autorité durable valide pour un run à un instant logique ;

aucune partition ne peut produire deux auteurs de side effects valides ;

tout changement d'autorité porte un leader/control-plane epoch ou
équivalent substrate, vérifié à la frontière d'effet ;

les workers conservent leurs fencing tokens de lease (ADR-008) ;

l'ancien leader et les workers zombies sont rejetés après failover ;

la membership du cluster est versionnée et auditable ;

perte de quorum/autorité => fail closed, jamais promotion heuristique.

Non-décisions (à ADR post-M0)

ADR-031 ne décide toujours pas :

Raft vs autre mécanisme ;

taille du quorum ;

voter/learner topology ;

heartbeat/election tuning ;

stockage du log répliqué ;

active-active vs leader/follower pour le control plane.

Ces décisions appartiennent à un ADR post-substrate spécifique. Le
futur ADR-031.1 (post-M0 runtime) les précisera. ADR-031 (ce
document) n'est que la couche invariants.

DS-10 — Rolling upgrade

ADR-018 reste la source normative du pattern :

expand -> compatible rollout -> migrate -> contract.

Le contrat d'opérateur (futur, post-M0) doit séparer :

batchSize

maxUnavailable

maxSurge

canaryPercent

canaryDwellMs

critères de santé + minimum sample size

Invariants

canary >=1 worker quand le cluster n'est pas vide ;

le canary ne peut pas être validé sans un nombre minimum de requêtes/events ;

worker rollout et control-plane rollout sont deux opérations distinctes ;

un rollback automatique n'est permis que tant que le migration commit
point n'a pas rendu les écritures incompatibles avec N ;

leases des workers N sont drainées avant arrêt, conformément à ADR-018 ;

tests N↔N+1 obligatoires sur protocol, IR, history et connectors.

DS-11 — Recovery

Trois classes sont séparées :

NodeRecovery

Perte d'un worker/nœud sans perte de l'autorité durable.

QuorumOrAuthorityRecovery

Perte de l'autorité/quorum ; fail closed et intervention selon le substrate.

SiteDisasterRecovery

Perte d'un failure domain complet. Ne peut être revendiquée que si snapshot,
history et clés nécessaires existent dans un failure domain indépendant.

RPO / RTO

Toute policy doit déclarer explicitement :

targetRpoMs

targetRtoMs

source de snapshot

source de history

preuve de restore testée

Un simple replayRateLimit = 1000 events/s n'est pas un RTO.

Snapshot

Un snapshot n'est jamais autorisé à « perdre les events entre snapshot et
crash » silencieusement.

snapshot + history complète depuis le snapshot => recovery valide ;

history manquante/corrompue => les runs affectés deviennent
UNKNOWN_EXTERNAL_STATE ou recovery échoue explicitement ;

aucune reprise en running/succeeded sur un état incomplet.

Failure model

Le consensus standard visé est crash/partition/fail-stop, pas Byzantine.
Un nœud compromis est traité par identité, policy, signing, audit et
revocation ; aucune garantie BFT n'est revendiquée.

Implémentation (M1-09 in-memory + futur M1-10 file-backed)

L'implémentation actuelle (M1-09, YELLOW → DECIDED via ce ADR
par transition implicite) :

`InMemoryDurableHistoryAuthority` (packages/workflow-runtime/src/in-memory.ts) :
  14/14 tests PASS, transition matrix enforced per ADR-022 §4, 4 typed
  errors. Single-process, in-memory, no persistence beyond the process
  lifetime.

Le futur M1-10 (file-backed) :

Persistent adapter qui wrap `InMemoryDurableHistoryAuthority` avec
  un snapshot JSON on disk + recovery from snapshot. Le runtime
  implémentation se substitue sans changer l'interface
  `DurableHistoryAuthority`.

Le contrat M1-10 est satisfiable par :

un snapshot atomique (copy-on-write) à chaque `transition` acceptée ;

un replay déterministe depuis snapshot (idempotent, M0-8) ;

une validation au boot que le snapshot est lisible (sinon fail closed).

Aucun contrat M1-10 n'est ajouté à `WorkspaceConfig` ; le M1-10
utilise ses propres fichiers hors workspace.

Gate avant M1-11

M1-10 est prerequisite pour M1-11 (history migration V1 → V2).
M1-11 ne peut démarrer que si M1-10 est GREEN.

Configuration

La configuration de déploiement future appartient à des objets opérateur,
par exemple :

ClusterRuntimeConfig

DeploymentUpgradePolicy

DisasterRecoveryPolicy

Elle n'appartient pas au WorkspaceConfig.

Conséquence immédiate

L'ADR-031 est désormais DECIDED pour sa couche invariants. Le
M1-09 in-memory impl (14/14 PASS) satisfait les invariants DS-09
pour un single-node. M1-10 (file-backed) étendra à la persistance
sans changer les invariants. Les RuntimeTest DS-09/10/11 seront
ajoutés en post-M0 contre un harness multi-process.
