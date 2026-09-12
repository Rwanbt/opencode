<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

EXECUTION PROFILE REQUIREMENTS — UNIFIA AUTOMATE

Statut : PINNED
Date : 2026-09-01
Révision de clarification : 2026-09-03
Source : plan V2.3.1, BASELINE.md, AUTOMATE_TRUST_PATH.md, THREAT_MODEL.md.
Ce document reste la source normative des contraintes consommées par ADR-000.
La révision 2026-09-03 ne change pas les profils ; elle ajoute des identifiants
stables et lève les ambiguïtés de licence/packaging révélées par la review.

0. Cible première

Automate Core × local-single-node × Windows.

1. Profils

1.1 local-single-node — MANDATORY

machine unique ;

offline ;

self-contained ;

aucun service de workflow séparément administré ;

aucune base durable administrée séparément ;

aucun cloud propriétaire obligatoire ;

pas de HA ;

boucle locale autorisée ;

stockage local autorisé ;

un composant auxiliaire entièrement livré, signé, supervisé, mis à jour et
supprimé par Unifia peut être accepté s'il respecte EPR-006.

1.2 server-single-node — FUTURE_COMPATIBILITY_REQUIRED

exactement un nœud d'autorité ;

HA : non ;

service système autorisé ;

réseau autorisé ;

stockage local / DB auto-hébergée ;

aucun contrat ne doit redéfinir ce profil comme une paire active-passive.

1.3 server-cluster — FUTURE_COMPATIBILITY_REQUIRED

multi-nœuds ;

HA requise ;

worker fleet distribuée ;

rolling upgrade requis ;

cluster recovery requis ;

la topologie de réplication de l'autorité durable est dépendante du
substrate et ne peut être figée avant le substrate + sa preuve M0.

1.4–1.8

Les profils browser-isolated-worker, desktop-host-assisted,
desktop-isolated-worker, mobile-control et mobile-local-execution
conservent leur classification antérieure.

mobile-local-execution reste FUTURE_COMPATIBILITY_REQUIRED : aucun choix
du substrate ne doit le rendre structurellement impossible.

2. Exigences normatives consommées par ADR-000

Les identifiants ci-dessous sont désormais la source. Les ADR consommateurs
ne doivent pas réinventer leur numérotation.

| ID       | Exigence normative                                                                                                                                                                | Portée         |
|----------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------------|
| EPR-001  | local-single-node MUST fonctionner offline.                                                                                                                                       | cible première |
| EPR-002  | local-single-node MUST être self-contained et MUST NOT exiger de service de workflow ou de base durable séparément administrés.                                                   | cible première |
| EPR-003  | Aucun cloud propriétaire MUST être nécessaire au chemin d'exécution local.                                                                                                        | souveraineté   |
| EPR-004  | L'API produit MUST rester consommable depuis la stack TypeScript/Bun/Node. L'implémentation interne MAY utiliser un composant natif si EPR-006 est satisfait.                    | intégration    |
| EPR-005  | Le choix MUST NOT rendre mobile-local-execution structurellement impossible. L'état de portabilité doit être PROVED, NOT_MEASURED ou BLOCKED, jamais supposé.                     | futur mobile   |
| EPR-006  | Un composant auxiliaire local MAY être accepté uniquement s'il est livré/supprimé avec Unifia, signé, SBOM-inventorié, supervisé et mis à jour par Unifia, sans runtime/config admin exigé, avec IPC authentifié/versionné, offline, cross-platform qualifié et sans fermeture structurelle du mobile. | packaging |
| EPR-007  | Tout composant obligatoire distribué avec Unifia MUST être sous licence OSI-approved et passer une revue de compatibilité redistribution/copyleft avec le modèle de distribution Unifia. Une licence source-available non-OSI ne satisfait pas cette exigence. | licence |
| EPR-008  | Le substrate MUST être self-hostable et forkable durablement.                                                                                                                       | souveraineté   |
| EPR-009  | Le substrate MUST supporter durable wait, durable approval, crash recovery, backup/restore.                                                                                          | durable execution |
| EPR-010  | Un WorkflowRun MUST avoir exactement une autorité durable à un instant logique donné ; aucune double autorité silencieuse n'est permise.                                            | autorité       |
| EPR-011  | Les effets sont durable at-least-once avec identité logique stable ; idempotence si provider disponible ; réconciliation quand l'état externe est interrogeable ; sinon UNKNOWN_EXTERNAL_STATE. Aucune claim exactly-once. | effets |
| EPR-012  | Timers/leases MUST utiliser une autorité de temps durable/control-plane et survivre aux restarts selon les ADR dédiés.                                                            | temps          |
| EPR-013  | La charge opérationnelle du profil local MUST rester faible : aucune administration de cluster/service durable séparé pour exécuter Automate local.                              | ops            |
| EPR-014  | La sélection d'un substrate MUST être falsifiable par un proof M0 écrit avant exécution ; tout scénario non vert bloque le passage M1.                                          | preuve         |

3. Politique de licence — clarification

« OSI-approved » et « acceptable pour le produit » sont deux tests différents.

Vérifier le statut OSI de la licence.

Vérifier redistribution, modification/fork, linking/derivative-work et
obligations de copyleft.

Enregistrer l'analyse dans l'evidence pack du candidat.

Une licence OSI-approved à copyleft fort n'est donc pas automatiquement
rejetée ; elle doit être évaluée contre le modèle de distribution.

4. Politique de composant auxiliaire — clarification

Le langage n'est pas un hard eliminator.

Go, Rust, C/C++ ou autre sont acceptables uniquement si EPR-006 est prouvé.
Le hard eliminator est la création d'une frontière d'exploitation séparément
administrée, pas le choix du langage.

5. Profils et HA

local-single-node: HA = non.

server-single-node: HA = non, un nœud.

server-cluster: HA = oui, mais mécanisme de réplication dépendant du
substrate et décidé après la preuve du substrate.

6. Anti-drift

ADR-000 et ADR-030 MUST citer les EPR-* ci-dessus.
Une CI documentaire SHOULD vérifier qu'aucun ADR ne définit un deuxième jeu
REQ-* présenté comme sourced depuis ce fichier.
