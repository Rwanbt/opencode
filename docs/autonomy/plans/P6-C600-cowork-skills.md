# P6-C600 — Open Cowork skills

**Statut :** `INTEGRATED` (design documenté, BLOQUÉ par BD-9 licence i18n)
**Date :** 2026-08-01
**Parent :** P6-C600 (Open Cowork skills)

## Objectif

Intégrer les **compétences Open Cowork** dans Unifia comme skills réutilisables.

## Skills candidats

| Skill | Description | Statut |
|---|---|---|
| `git-commit` | Commit conventionnel | OK |
| `code-review` | Review de PR | OK |
| `pr-fix` | Auto-fix CI failures | OK |
| `debate` | Multi-model debate | OK (déjà livré) |
| `plan` | Planification structurée | OK |
| `spec` | Spec-driven | OK (déjà livré) |
| `humanizer` | Humanize text | OK |
| `translator` | i18n translation | ⚠️ BLOQUÉ BD-9 |

## BD-9 (licence i18n user)

Le skill `translator` requiert les **fichiers i18n d'Open Cowork** (16 langues, 325 fichiers). Licence non confirmée.

**Action requise** : fournir la licence utilisateur d'Open Cowork OU confirmer le rebrand-style MIT.

## Format des skills

```yaml
# skill.yaml
name: skill-name
description: |
  Description longue (multiline).
  Use when ...
triggers:
  - "trigger1"
  - "trigger2"
inputs:
  - name: input_name
    type: string
    required: true
outputs:
  - name: result
    type: string
provenance:
  source: "open-cowork"
  license: "MIT"
  commit: "abc123"
```

## Estimation

- Audit Open Cowork skills : 8h
- Skill converter (Cowork → Unifia) : 16h
- Tests : 8h
- **Total : 32h (1 semaine)**

## Liens

- [BD-9 resolution](../docs/autonomy/BLOCKED-DECISIONS.md)
- [I18N-USER-INVENTORY.md](../I18N-USER-INVENTORY.md)
- [skills/debate/](../../skills/debate/SKILL.md)
- [skills/spec-driven/](../../skills/spec-driven/SKILL.md)