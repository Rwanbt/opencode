<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-021 — Repository / Module Topology

> **Statut** : DECIDED (NOT TRIGGERED)
> **Date** : 2026-09-01
> **Source** : plan V2.3.1, PACKAGE_MIGRATION_MAP.md, R-012.

## Status

**DECIDED (NOT TRIGGERED)** par PRE-1. Le `PACKAGE_MIGRATION_MAP.md`
n'a pas identifié de besoin de réorganiser la topologie du dépôt. ADR
conservé pour traçabilité.

## Context

Plan V2.3.1 ADR-021 vise à structurer le dépôt pour qu'un module
`workbench-core` ou `artifact-store` puisse être extrait en package
dédié sans casser les consumers.

`PACKAGE_MIGRATION_MAP.md §3.2` confirme que 4 packages sont absents :

- `workbench-sdk` — ABSENT_NO_ACTION
- `workbench-contracts` — ABSENT_NO_ACTION
- `workbench-core` — ABSENT_NO_ACTION
- `artifact-store` — ABSENT_NO_ACTION

Le code est déjà organisé en monorepo Bun + Turbo (cf.
`PACKAGE_MIGRATION_MAP.md §1`) avec 50 packages. Aucun consumer
n'a demandé un re-packaging.

R-012 (Secret Broker manquant) est résolu par ADR-010 (création
d'un nouveau package `@unifia/secret-broker` dans le même monorepo),
pas par une réorganisation.

## Decision

**Pas de réorganisation du dépôt**.

- Le monorepo existant est conservé.
- Les nouveaux packages (`@unifia/secret-broker`,
  `@unifia/network-authority`, `@unifia/digest-runtime`,
  `@unifia/expression-runtime`, `@unifia/retention-runtime`) sont
  ajoutés comme siblings des packages existants.
- Si un jour un package doit être extrait hors du monorepo (par
  exemple pour un déploiement séparé), un nouvel ADR ouvrira la
  discussion.

## Pourquoi « NOT TRIGGERED »

- Aucun consumer n'a besoin d'un re-packaging.
- La règle « STOP-DUPLICATE-ARCHITECTURE » (plan §20) demande de
  réutiliser ce qui existe. Ici, rien n'existe à réutiliser pour
  l'extraction.
- Le coût d'un re-packaging (refactor de tous les imports) n'est pas
  justifié par un bénéfice mesurable.

## Conséquences sur la M1 gate

Le plan §197 dit :
> ADR-021 = DECIDED IF triggered by PRE-1

`NOT TRIGGERED` est une décision valide : la topologie reste
inchangée.

## Liens

- `PACKAGE_MIGRATION_MAP.md` §3.2 (4 packages ABSENT_NO_ACTION)
- `RISK_REGISTER.md#R-012` (Secret Broker)
- ADR-010 (création `@unifia/secret-broker`)
