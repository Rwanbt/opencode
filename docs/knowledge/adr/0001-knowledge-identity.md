---
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Unifia contributors
id: KNOW-0001
title: Knowledge document identity (UUIDv7, locator, version hash)
status: ACCEPTED
date: 2026-08-29
authors: Knowledge Agent (MiniMax M3)
sources:
  - docs/knowledge/execution/MODULE-MAP.md
  - plan gelé §26 (Identity)
  - runbook V2 §8.2 (Identité)
---

# ADR-KNOW-0001 — Identité d'un document Knowledge

## Contexte

Un document Knowledge managé doit avoir un identifiant **stable** qui
survit au déplacement, à la copie entre machines, au renommage de
répertoire, et qui ne dépend ni du chemin ni du hash du contenu (un
même ID peut avoir plusieurs versions successives). Sans cette
garantie, l'index FTS, le graphe de wikilinks, les backlinks et
les références inter-documents se cassent au moindre `mv`.

Les contraintes additionnelles sont :

- l'identifiant doit être **lisible** (texte, pas binaire), pour
  permettre aux wikilinks Obsidian de référencer une note
  canonique ;
- l'identifiant doit être **ordonnable** dans le temps, pour
  faciliter la fusion par supersession ;
- l'identifiant ne doit **pas** révéler le contenu du document
  (sinon, un ID fuité dans un log泄露 du secret).

## Décision

Un document Knowledge managé porte un `unifia_id` au format
**UUIDv7** (RFC 9562), en représentation lowercase canonique avec
tirets (`0190d2c0-7b00-7000-8000-000000000001`).

Trois champs d'identification cohabitent, chacun avec un rôle
distinct :

| Champ | Format | Rôle | Durée |
|---|---|---|---|
| `unifia_id` | UUIDv7 texte | Identité stable de la note | Tant que la note existe |
| `unifia_locator` | Chemin normalisé relatif au Knowledge Root | Localisation physique | Tant que la note reste au même endroit |
| `unifia_version` | Hash BLAKE3 (sinon SHA-256 si BLAKE3 indisponible) | Version immuable du contenu | Change à chaque mutation |

**Règles** :

- `unifia_id` est **assigné une seule fois** à la promotion d'un
  document `candidate` vers `active`. Avant promotion, le
  document n'a pas d'ID managé.
- Le **locator** est réécrit si le document est déplacé. Le locator
  est mis à jour par un événement `file.moved` et un événement
  `graph.relink`.
- Le **hash de version** est recalculé après chaque write
  réussie (post-fsync). L'ancien hash est conservé dans l'historique
  Class B tant que la version n'est pas garbage-collectée.
- Un document **non managé** (par exemple une note de vault
  pré-existant sans frontmatter `unifia_schema: 1`) n'obtient
  **jamais** un faux ID stable `path + hash`. Il est référencé par
  son locator et son hash, mais n'a pas d'`unifia_id`. Le
  ContextRouter le traitera avec `trust = unverified` jusqu'à
  promotion explicite.
- Les doublons d'`unifia_id` sont une **erreur détectable**, jamais
  fusionnés silencieusement. `knowledge doctor` les signale.

## Alternatives rejetées

- **ULID** : ordonnable et compact, mais l'écosystème
  JavaScript/TypeScript (Bun, Drizzle, Vitest) est centré UUID.
  Imposer ULID nécessiterait un parseur et un validateur custom,
  et une migration ultérieure si un autre outil (par exemple
  Obsidian) s'attend à UUID.
- **Hash-only (`unifia_id = sha256(content)`)** : change à chaque
  mutation, casse les wikilinks, casse les supersessions.
- **Path-only (`unifia_id = relative_path`)** : casse au
  déplacement, n'a pas de sens cross-machine.
- **BLAKE3 obligatoire** : ajoute une dépendance uniquement pour
  BLAKE3. Le runtime Node/Bun fournit déjà SHA-256. Si BLAKE3 est
  déjà disponible (via `@napi-rs/blake3` ou un binding natif), on
  l'utilise ; sinon SHA-256 est accepté sans dégradation de
  sécurité mesurable.

## Conséquences

- Le format UUIDv7 est lisible, ordonnable, et un tri lexicographique
  sur `unifia_id` reflète approximativement l'ordre de création.
- Le `unifia_locator` est mis à jour par un événement domain
  `file.moved` ; un déplacement de fichier ne casse pas les
  références.
- Le `unifia_version` permet la détection d'**editing
  extérieur** : si le hash observé à la lecture ne correspond
  pas au hash de la dernière mutation, le fichier a été
  modifié hors Unifia.
- `knowledge doctor` doit implémenter la détection de doublons
  d'ID (Phase 3.3) et la détection de documents non indexés.
- Une migration ULID vers UUIDv7 (ou l'inverse) est possible mais
  coûteuse ; cette décision est volontairement définitive pour
  V1 sauf impossibilité prouvée de l'écosystème.

## Validation

- 11 fixtures dev + 11 fixtures holdout utilisent déjà des UUIDv7
  préfixés (cartes 0002).
- `tests/knowledge/eval/check-isolation.ts` valide l'unicité des
  IDs par side.
- Phase 1.1 ajoutera un test unitaire
  `packages/contracts/test/knowledge/id.test.ts` qui assert le
  format, l'unicité et la sérialisation.
