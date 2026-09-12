# Modèle d'en-tête d'attribution Unifia

**Phase :** -2 (Audit licences et provenance)
**Statut :** `TEMPLATE` — à appliquer dès la Phase 0
**Référence :** Plan V3 §8.6 « Provenance obligatoire »

## Règle

Tout fichier (code, doc, asset) **importé d'un upstream tiers** ou **créé dans Unifia** doit porter un en-tête d'attribution conforme au modèle ci-dessous. Un import sans en-tête complet doit être rejeté en pre-commit.

## Champs obligatoires (6)

1. **Dépôt source** — URL complète du repo d'origine
2. **Commit source** — SHA du commit exact d'où le code provient
3. **Chemin source** — chemin dans le repo d'origine
4. **Licence** — SPDX-ID (`MIT`, `Apache-2.0`, `BSD-3-Clause`, etc.)
5. **Copyright** — auteur(s) original(aux)
6. **Modifications** — description des changements appliqués par Unifia (+ responsable)

## Modèles par type de fichier

### TypeScript / TSX (`.ts`, `.tsx`)

```ts
// SPDX-License-Identifier: <SPDX-id>
// Copyright (c) 2026 Unifia contributors
//
// Derived from <repo-url>@<commit-sha>
// Original path: <upstream-path>
// Original license: <SPDX-id>
// Original copyright: <copyright-holder>
//
// Modifications: <description>
// Responsible: <humain ou "hermes-agent@local.invalid">
```

### Rust (`.rs`)

```rust
// SPDX-License-Identifier: <SPDX-id>
// Copyright (c) 2026 Unifia contributors
//
// Derived from <repo-url>@<commit-sha>
// Original path: <upstream-path>
// Original license: <SPDX-id>
// Original copyright: <copyright-holder>
//
// Modifications: <description>
// Responsible: <humain ou "hermes-agent@local.invalid">
```

### Markdown (`.md`, `.mdx`)

```md
<!--
SPDX-License-Identifier: <SPDX-id>
Copyright (c) 2026 Unifia contributors

Derived from <repo-url>@<commit-sha>
Original path: <upstream-path>
Original license: <SPDX-id>
Original copyright: <copyright-holder>

Modifications: <description>
Responsible: <humain ou "hermes-agent@local.invalid">
-->
```

### JSON / YAML / TOML

Pour les fichiers de config, l'en-tête est dans un commentaire (selon le format) **ou** dans un fichier `_ATTRIBUTION.json` sibling.

```json
{
  "_attribution": {
    "spdx_license_id": "<SPDX-id>",
    "copyright": "Copyright (c) 2026 Unifia contributors",
    "derived_from": {
      "repo": "<repo-url>",
      "commit": "<commit-sha>",
      "path": "<upstream-path>",
      "original_license": "<SPDX-id>",
      "original_copyright": "<copyright-holder>"
    },
    "modifications": "<description>",
    "responsible": "<humain ou 'hermes-agent@local.invalid'>"
  }
}
```

## Cas particuliers

### Fichier 100% original Unifia (pas d'upstream)

```ts
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
//
// Original work. No upstream derivation.
```

### Fichier importé SANS modification

```ts
// SPDX-License-Identifier: <SPDX-id>
// Copyright (c) <copyright-holder>
//
// Imported verbatim from <repo-url>@<commit-sha>
// Path: <upstream-path>
// No modifications.
```

### Fichier sous copyleft (GPL, AGPL, LGPL)

⚠️ **Par défaut refusé.** Si autorisé exceptionnellement par l'utilisateur :
- Ajouter une mention explicite « This file is under <GPL-version>. Combined work licensing implications apply. »
- Signaler dans `BLOCKED-DECISIONS.md`
- Tracer dans `UPSTREAM-SOURCES.lock.json`

## Hook pre-commit (à implémenter en Phase 0)

```sh
#!/bin/sh
# Refuse tout commit qui ajoute un fichier sous packages/ sans en-tête SPDX
for f in $(git diff --cached --name-only --diff-filter=A | grep -E '\.(ts|tsx|rs|md|mdx)$'); do
  if ! head -10 "$f" | grep -q 'SPDX-License-Identifier'; then
    echo "ERROR: $f lacks SPDX-License-Identifier header. Add one before committing." >&2
    exit 1
  fi
done
```

## Procédure d'application

1. **Lors d'un import** : ajouter l'en-tête AVANT le commit.
2. **Lors d'une création originale** : ajouter l'en-tête simplifié.
3. **Lors d'un rebrand** (P0) : pour les fichiers qui changent de nom de produit, l'en-tête SPDX reste le même (la licence ne change pas).
4. **Lors d'un audit** : un script `scripts/audit-spdx-headers.ts` parcourt le repo et liste les fichiers sans en-tête.

## Statut

Ce modèle est un **template**. L'application systématique est planifiée en Phase 0 (rebrand) et Phase 1 (harness CI). Le hook pre-commit sera ajouté en P0-C050 (renames des workflows GitHub) ou carte dédiée.
