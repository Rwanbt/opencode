---
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Unifia contributors
id: KNOW-0009
title: Memory lifecycle — candidate, active, superseded, archived
status: ACCEPTED
date: 2026-08-29
sources:
  - plan gelé §29 (Memory lifecycle), §31 (Auto-promotion), §33 (Supersession)
  - runbook V2 §15 (Phase 4 — Lifecycle mémoire)
---

# ADR-KNOW-0009 — Memory lifecycle

## Contexte

Sans lifecycle explicite, un agent peut prendre un brouillon
pour une décision, ou pire, considérer une note *superseded*
comme encore active. Le plan gelé §29 fixe quatre états :
`candidate`, `active`, `superseded`, `archived`, et interdit
explicitement la suppression silencieuse (§33).

Les trois règles métier sont :

1. **Auto-promotion** seulement pour les sources explicites
   (runbook §15) : "remember this", ADR accepté, contrainte
   explicite, KNOWN_FAILURE_PATTERNS, préférence explicite.
2. **Supersession** automatique seulement comme **proposal** ;
   la mutation exige une approbation explicite ou une action
   agent autorisée.
3. **Tout candidate durable** est immédiatement un fichier
   Markdown (Class A) dans `PersonalSpace/inbox/`. Jamais
   uniquement une ligne SQLite.

## Décision

**États et transitions** :

```
candidate ──[promote]──> active ──[supersede]──> superseded
                              │
                              ├──[archive]──> archived
                              │
                              └──[supersede-by-newer-active]──> superseded

archived ──[restore]──> active   (rare, tracée)
```

**Règles** :

1. `unifia_lifecycle: candidate` est un **workflow state**, pas
   un état durable final. Un candidate a une durée de vie
   maximale (par défaut 30 jours) ; au-delà, il est soit
   promu, soit archivé.
2. `unifia_lifecycle: active` est l'état par défaut après
   promotion. Une note active est incluse dans le retrieval
   sauf si elle est explicitement filtrée.
3. `unifia_lifecycle: superseded` est un état **traçable**.
   La note superseded conserve son `unifia_id` ; elle est
   exclue du retrieval actif mais reste accessible par
   `knowledge_get` (référence historique).
4. `unifia_lifecycle: archived` est l'état de mise au rebut.
   La note archivée est exclue du retrieval, mais reste
   présente dans le vault ; elle n'est pas supprimée.

**Auto-promotion** (un source est `active` sans approbation
explicite) :

- "remember this" (commande utilisateur explicite) ;
- ADR accepté (transition `proposed` → `accepted`) ;
- contrainte explicite (`unifia_type: constraint`) ;
- `KNOWN_FAILURE_PATTERNS.md` importé ;
- préférence explicite (`unifia_type: preference` avec
  `unifia_pinned: true`).

**Supersession** :

- détection automatique : "possible contradiction" → proposal ;
- mutation : approbation explicite ou action agent autorisée
  via `EgressGrant` ou `MutationIntent` signé ;
- jamais de "model decides old knowledge is obsolete →
  silently deletes it" (plan gelé §33).

**Inbox** (runbook §15 P4.3) :

- L'Inbox est limitée aux contradictions, faible confiance,
  merge proposals, supersession proposals.
- L'Inbox n'est pas une corvée quotidienne. Le système
  accumule ; l'utilisateur traite par batch.

## Alternatives rejetées

- **Pas de supersession** : un agent peut continuer à utiliser
  une note obsolète comme si elle était active.
- **Suppression physique** : viole P10 "No Silent Destructive
  Operation" et la portabilité du vault.
- **Lifecycle implicite (durée de vie basée sur timestamp)** :
  trop magique, aucune traçabilité, aucune raison documentée.
- **Candidate en SQLite seul** : viole P3 "Markdown Canonical"
  et la récupérabilité sans Unifia.

## Conséquences

- Phase 4.1 livre les états et la provenance.
- Phase 4.2 livre la promotion et la supersession.
- Phase 4.3 livre l'Inbox.
- `E-04` du DoD teste la migration dry-run + rollback (les
  transitions de lifecycle sont des mutations de Class A et
  sont tracées dans le WAL Class C).
- Le test `lifecycle.test.ts` couvre les 5 chemins (create
  candidate, promote, supersede, archive, invalid transition).
- `knowledge doctor` détecte :
  - les candidates de plus de 30 jours non promus ;
  - les supersededs sans `unifia_supersedes` rempli ;
  - les archives qui n'ont jamais été `active`.

## Validation

- Phase 4.1 + 4.2 + 4.3 sont les cartes 0041, 0042, 0043
  (à exécuter dans une session ultérieure).
- Le test `E-04` du DoD vérifie le rollback.

---

## Amendement 2026-08-30 — La suppression entre dans V1

**Statut de l'ADR révisé** : `ACCEPTED (amended 2026-08-30)`.

### Ce qui a motivé l'amendement

Le périmètre initial du Sovereign Knowledge Core promettait à l'utilisateur de
**voir, éditer, supprimer et exporter** ses données. L'implémentation refusait
`delete` par construction, en s'appuyant sur cet ADR. Six revues du rapport
final ont relevé l'écart (R-0017) : pour un produit dont la promesse est la
souveraineté, l'absence de droit à l'effacement n'est pas un détail de
périmètre. Décision du propriétaire : la suppression entre en V1.

### Ce que l'ADR rejetait réellement

La section « Alternatives rejetées » rejette la **suppression physique**
parce qu'elle viole P10, *No Silent Destructive Operation*. Le mot qui porte
est **silent**. Ce que l'ADR interdit, c'est qu'un contenu disparaisse sans
trace et sans recours — pas que l'utilisateur puisse retirer une note de son
vault.

### Décision

`delete` est supporté et signifie **retirer la note du vault, de façon
enregistrée et réversible** — la sémantique par défaut d'Obsidian, qui
déplace vers `.trash/` plutôt que de délier le fichier.

- La note quitte son locator : elle disparaît des listings, du retrieval et
  des backlinks, comme l'utilisateur l'attend.
- Elle est déplacée sous `.unifia/trash/`, pas supprimée du disque.
- L'opération est écrite au WAL (`kind: delete`, `previousHash` renseigné,
  `newHash: null`) avec le locator d'origine, donc **traçable** — P10 est
  satisfait par l'enregistrement, pas par le refus.
- Elle est **restaurable** par son `auditId` tant que la corbeille n'a pas
  été vidée.
- Vider la corbeille est une opération distincte, explicite, et la seule qui
  détruit réellement. C'est là que P10 exige une confirmation de
  l'opérateur, pas sur le `delete` courant.

`archive` reste distinct et garde son sens : retirer du retrieval **sans**
retirer du vault. Les deux répondent à des besoins différents et coexistent.

### Alternatives rejetées

- **Continuer à refuser `delete`** : contredit la promesse produit et laisse
  l'utilisateur sans droit à l'effacement sur ses propres données.
- **`unlink` direct** : viole réellement P10, et perd l'écriture concurrente
  d'un éditeur externe sans recours.
- **Traiter `archive` comme la suppression** : une note archivée reste dans
  le vault et reste lisible ; ce n'est pas ce que « supprimer » veut dire
  pour un utilisateur.

### Conséquences

- `MutationKind: "delete"` devient exécutable dans `VaultMutationWriter`.
- Une capacité de restauration et une commande de corbeille accompagnent la
  suppression ; sans elles, « réversible » serait une affirmation sans
  mécanisme.
- L'invariant WAL `delete ⇒ newHash: null` reste correct : plus aucun contenu
  ne réside au locator d'origine.
