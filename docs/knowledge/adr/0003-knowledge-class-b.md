---
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Unifia contributors
id: KNOW-0003
title: Class B — Portable metadata (copy-on-write)
status: ACCEPTED
date: 2026-08-29
sources:
  - plan gelé §10 (Class B — Portable Metadata)
  - runbook V2 §8.1
---

# ADR-KNOW-0003 — Class B Portable Metadata

## Contexte

Un sous-ensemble de métadonnées doit **voyager avec la note**
(par exemple quand l'utilisateur copie son vault d'une machine à
une autre) sans pour autant être dupliqué dans le Markdown lui-même
(qui deviendrait bruyant), ni perdu quand le vault est restauré
sur une nouvelle installation. La Class B est l'instance
canonique pour ces informations.

## Décision

La **Class B** est un dossier `.unifia/portable/` dans la racine
du vault, géré en **copy-on-write**. Chaque modification d'un
élément de Class B produit une nouvelle révision tagguée par
hash, et l'invariant suivant est tenu :

> **OLD VALID | NEW VALID | VALID + orphan harmless**

Concrètement :

1. l'ancienne révision reste valide jusqu'à ce que la nouvelle soit
   confirmée (acked) ;
2. la nouvelle révision est considérée valide dès qu'elle est
   écrite + fsync + hash vérifié ;
3. entre OLD et NEW, les deux révisions coexistent ; aucun
   consommateur ne doit paniquer.

Contenu autorisé en Class B :

- l'identité portable d'un document externe stable (par exemple
  un identifiant d'ADR externe, un DOI, un identifiant de
  ticket) ;
- des alias portables (par exemple `ADR-0017` ↔ chemin local) ;
- des références de provenance minimales (commit source, sans
  chemin absolu, sans token).

Contenu **interdit** en Class B (runbook §10, plan gelé §10) :

- credentials, provider tokens, PolicyGrants, EgressGrants ;
- capabilities MCP, device secrets ;
- chemins absolus ;
- provenance complète de session (qui doit rester en Class C).

## Alternatives rejetées

- **Stocker la Class B dans le frontmatter Markdown** : le
  frontmatter devient trop gros, et la copie du vault vers une
  autre machine ne transporte pas les révisions intermédiaires.
- **Stocker la Class B en SQLite au niveau du vault** : la DB
  est Class D, pas Class B ; SQLite n'est pas portable par copie
  de fichier (WAL + journal).
- **Pas de Class B du tout, tout en Class C** : la Class C est
  locale à la machine, donc tout ce qui doit voyager doit
  forcément être en A (frontmatter) ou en B (sidecar).

## Conséquences

- Le GC de Class B ne s'exécute qu'en **Admin Task** sous lock
  exclusif (runbook §13 Phase 2.4), avec reachability re-validée.
- La Class B est lue par le ContextRouter comme source
  d'alias portables (un ADR pré-existant `docs/adr/0017` peut
  être référencé par son ID court `ADR-0017` grâce à la Class B).
- Le WAL de mutation (Phase 2.3) **ne contient jamais le
  Markdown complet** ; il contient des deltas de Class B (avec
  ancien hash, nouveau hash, scope).
- Une migration Class B → Class A est possible (par exemple un
  alias stable qui devient un champ `unifia_id_alias` dans le
  frontmatter), mais elle est explicite et tracée.

## Validation

- Phase 2.4 livrera le GC Class B avec un test d'invariant
  `packages/unifia/test/knowledge/class-b-gc.test.ts`.
- Le format exact des fichiers `.unifia/portable/*.json` est
  défini en Phase 1.1.
