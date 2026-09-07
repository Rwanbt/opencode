---
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Unifia contributors
id: KNOW-0002
title: Markdown canonique (Class A)
status: ACCEPTED
date: 2026-08-29
sources:
  - plan gelé §9 (Class A — Canonical Knowledge)
  - runbook V2 §8.1 (Sources de vérité)
---

# ADR-KNOW-0002 — Markdown canonique (Class A)

## Contexte

Le Sovereign Knowledge Core V1 doit garantir que la connaissance
durable reste lisible, modifiable et restorable **sans Unifia**.
Sans cette garantie, l'utilisateur est otage d'un produit, et la
récupération après sinistre (vault corrompu, machine perdue, projet
abandonné) devient impossible.

Les trois sources de vérité candidates étaient :

1. une base SQLite centrale ;
2. un format binaire propriétaire ;
3. un format texte structuré (Markdown + YAML).

SQLite est lisible, mais demande un outil. Un format binaire
propriétaire n'est pas lisible. Markdown + YAML est lisible par
n'importe quel éditeur, et reste l'unité d'échange standard de
l'écosystème Obsidian.

## Décision

La **Class A** (Canonical Knowledge) est stockée en **Markdown +
YAML frontmatter**. Chaque note porte un frontmatter
`unifia_schema: 1` qui marque son appartenance au système.

Format du frontmatter (champs obligatoires en V1) :

```yaml
---
unifia_schema: 1
unifia_id: "0190d2c0-7b00-7000-8000-000000000001"
unifia_type: "decision"   # decision | constraint | failure | preference | learning | procedure | reference | semantic | episodic
unifia_lifecycle: "active"   # candidate | active | superseded | archived
unifia_created_at: "2026-08-29T00:00:00Z"
unifia_updated_at: "2026-08-29T00:00:00Z"
unifia_project_ref: "unifia"
unifia_supersedes: []   # liste d'unifia_id
unifia_restrictions:    # portable restrictions, ne peuvent que restreindre
  remote_model: deny   # deny | allow
  local_model: allow
unifia_tags:
  - "model:gemma-4"
  - "tool:bash"
---
```

Le corps Markdown est CommonMark + GFM (tables, fences, listes à
coches, blockquotes) + extensions wikilinks
(`[[Note cible]]` ou `[[Note cible|alias]]`).

## Alternatives rejetées

- **SQLite seul** : lisible mais demande un client SQLite, ce qui
  complique la récupération sur une machine vierge.
- **Format binaire** : incompatible avec Git en clair, incompatible
  avec Obsidian, incompatible avec la plupart des éditeurs.
- **JSON par note** : trop structuré, pas adapté à la prose longue
  qui est le mode naturel d'une décision ou d'un ADR.
- **Markdown sans frontmatter** : impossible d'attacher un ID, un
  lifecycle, des restrictions sans parser le corps, ce qui est
  fragile.

## Conséquences

- Un fichier `.md` du vault est lisible tel quel par Obsidian,
  VS Code, Neovim, Sublime Text, et tout éditeur Markdown.
- `gray-matter` est déjà dans les dépendances de
  `packages/unifia` (cf. MODULE-MAP), donc le parsing frontmatter
  est gratuit.
- Le CommonMark parser doit être **CommonMark + GFM + wikilinks** ;
  le wikilink parser est un mini-parser maison
  (`/\[\[([^\]]+)\]\]/g`).
- Les fichiers Class A peuvent être commités dans Git sans
  transformation.
- `knowledge doctor` détecte les fichiers `.md` qui n'ont pas
  `unifia_schema: 1` et les classe comme "non managés".
- `unifia_*` est le préfixe réservé ; aucun champ utilisateur ne
  doit commencer par `unifia_` pour éviter les collisions.

## Validation

- 11 fixtures dev + 11 fixtures holdout respectent le format
  (cartes 0002, `tests/knowledge/eval/{dev,holdout}/*.md`).
- Le parseur frontmatter est `gray-matter` (déjà en
  dépendances).
- Phase 1.1 produira un test
  `packages/contracts/test/knowledge/frontmatter.test.ts` qui
  assert que le schéma parse et roundtrip sans perte.
