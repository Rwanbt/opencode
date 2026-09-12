---
id: 0023
title: Licensing Strategy
status: PROPOSED
date: 2026-07-31
---

# ADR-0023: Licensing Strategy

**Statut :** `PROPOSED`
**Date :** 2026-07-31
**Décideurs :** Erwan, Hermes Agent (MiniMax M3)
**Source :** Plan V3 §15 (Licensing)

## Contexte

Unifia hérite de opencode (MIT). Quelle license pour Unifia et les capability packs ?

## Décision

**Trois tiers** :

| Tier | License | Exemples |
|---|---|---|
| **Open source** | MIT | Unifia core, capability packs OSS |
| **Source-available** | BUSL-1.1 | Unifia Cloud (future) |
| **Commercial** | Propriétaire | Support, hosting |

**Capability packs** : licences choisies par les auteurs (MIT, Apache 2.0, BSD, etc.).

## Conséquences

### Positives
- MIT pour la communauté
- BUSL pour le côté commercial

### Négatives
- Complexité de gestion

## Plan

- Phase 18 : BUSL pour Unifia Cloud si lancé

## Liens

- LICENSE-AUDIT-UNIFIA.md
- ADR-0011 (Migration)
