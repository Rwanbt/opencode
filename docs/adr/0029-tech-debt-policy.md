---
id: 0029
title: Tech-debt policy
status: PROPOSED
date: 2026-08-01
---

# ADR-0029: Politique de dette technique

**Statut :** `PROPOSED`
**Date :** 2026-08-01

## Contexte

Comment gérer la dette technique dans un projet en évolution rapide ?

## Décision

**3 niveaux de dette** :
- **Niveau 1 (Acceptable)** : TODOs, FIXMEs, hacks documentés
  - Acceptable si : 0 jours de dette
  - Action : ouvrir un issue par TODO

- **Niveau 2 (Risqué)** : code "smelly" qui marche
  - Exemples : dépendance copyleft, code "spaghetti"
  - Action : planifier un refactor dans la prochaine minor

- **Niveau 3 (Critique)** : dette qui bloque les features
  - Exemples : architecture non-extensible, performance bottleneck
  - Action : STOP feature, refactor obligatoire

**Tracking** :
- Issues GitHub : label "tech-debt:level-1/2/3"
- Docs/autonomy/BLOCKED-DECISIONS.md : pour les dettes stratégiques
- Cards TASK-GRAPH : chaque dette a une carte

## Liens

- Plan V3 §15
- BLOCKED-DECISIONS.md
- TASK-GRAPH v2.0
- ADR-0011 (Migration)
- ADR-0023 (Licensing)
