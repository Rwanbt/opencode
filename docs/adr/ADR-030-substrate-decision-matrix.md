<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

ADR-030 — Substrate Policy / Fallback Evidence Pack

Statut : INFORMATIONAL / NON_NORMATIVE
Date : 2026-09-02
Révision : 2026-09-03
Source normative : ADR-000 + EXECUTION_PROFILE_REQUIREMENTS.md

Rôle

Ce fichier n'est pas une seconde ADR de sélection. Il documente l'impact
des politiques de licence/packaging sur les fallbacks. Si un fait diverge avec
ADR-000, ADR-000 fait autorité et ADR-030 devient STALE.

Baseline synchronisée

| Option         | local-single-node                | Raison                                                              |
|----------------|----------------------------------|---------------------------------------------------------------------|
| A Native       | SELECTED_PENDING_M0_PROOF        | choix produit souverain/local-first ; kernel non encore prouvé      |
| B DBOS-TS      | ELIMINATED_LOCAL                 | EPR-002 : PostgreSQL requis côté TS                                |
| B′ DBOS-Go     | NOT_QUALIFIED                    | EPR-006 packaging/lifecycle/platform/mobile à prouver               |
| C Restate      | ELIMINATED_BY_POLICY             | EPR-007 : licence serveur non OSI                                   |
| D Temporal     | ELIMINATED_LOCAL                 | EPR-002 : service + persistence administrés séparément en production |

Les anciens faits « DBOS-SQLite preview en TS » et « temporalite early stage »
sont supprimés. DBOS-SQLite n'est pas une option TypeScript ; temporalite
est archivé.

Conséquence réelle des politiques

P-1/P-2 ne font pas « gagner » A : A est un choix architectural explicite.
Elles déterminent surtout l'existence d'un fallback si M0 échoue.

Politique retenue :

Licence : EPR-007, OSI-approved + revue de compatibilité produit.

Packaging : EPR-006, basé sur la frontière opérationnelle et non le
langage.

Donc le fallback documenté après échec M0 est :

qualifier B′ DBOS-Go contre EPR-006 ;

si B′ échoue, définir une Option E ;

Restate ne revient qu'avec un amendement explicite de la politique EPR-007.

Matrice de fallback

| Choix policy                                          | A         | B TS       | B′ Go                | Restate      | Temporal |
|-------------------------------------------------------|-----------|------------|----------------------|--------------|----------|
| EPR-007 stricte + EPR-006 opérationnelle               | sélectionné sous preuve | éliminé | à qualifier          | éliminé policy | éliminé  |

Fallback si M0 échoue : B′ puis Option E.

Règle anti-drift

Ce document MUST NOT contenir de faits techniques absents ou différents de
l'evidence table d'ADR-000. Une modification du verdict d'un candidat dans
ADR-000 exige une mise à jour de ce mémo dans le même changement.

Effort

Aucune estimation calendaire non sourcée n'est normative ici.
