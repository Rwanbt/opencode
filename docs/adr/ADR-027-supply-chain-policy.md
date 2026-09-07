<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-027 — Supply Chain Policy (C-AR-02)

> **Statut** : DECIDED
> **Date** : 2026-09-02
> **Source** : C-AR-02 (open depuis M1, résolu post-M3-R2),
>   M2-TEST graph property tests (décision « pas de fast-check »),
>   plan V2.3.1 §30 (certification gates) + §125 (security) + §195
>   (M1 build/lock) + §246 (EXECUTION_STATUS).
> **Cible** : `Automate Core × local-single-node × Windows` (puis tous
>   les profiles §186-188).

## Status

DECIDED. ADR de **politique d'ingénierie** (niveau supply chain), ni
runtime ni schéma — définit le contrat que tout CI et toute PR doivent
respecter. **N'est PAS** bloqué par ADR-000.

## Contexte

Pendant M1 → PostM3-R2, plusieurs décisions supply chain ont été prises
**sans ADR** pour les porter :

1. **bun** comme package manager (et runtime de test), version pinnée
   `1.3.11` (`package.json#packageManager`). Pas npm/yarn/pnpm.
2. **zod** comme unique bibliothèque de validation de schéma. Pas ajv,
   joi, yup, valibot.
3. **Pas de fast-check** ni autre property-based testing framework
   (décision M2-TEST documentée dans le commit `3e0598ac5f` — runaway
   process observé, 1.4 GB / 12k threads, fixe manuel par worker
   stagnation).
4. **bun test** pour unit + integration. Pas jest, pas vitest.
5. **biome** pour lint + format. Pas eslint, pas prettier.
6. **Conventional Commits 1.0** (engagement dans
   `commit-convention` skill) + scope = package.
7. **Husky** pour pre-commit (`biome check`) + pre-push
   (`bun run typecheck` workspace-wide).
8. **Lockfile commited** (`bun.lockb`, exact versions).
9. **Tauri version épinglée** (ADR-008 référencé).

La dette de cette absence d'ADR est documentée en EXEC_STATUS
section « Executable sans attendre » (« C-AR-02 — ouvert depuis M1, non
bloqué par ADR-000 »). La décision M2-TEST « pas de fast-check » est
précisément une décision de chaîne d'approvisionnement prise sans ADR
pour la porter.

C-AR-02 ratifie rétroactivement ces décisions et fixe la politique pour
les ajouts futurs.

## Decision

### 1. Package manager et runtime

- **Un seul** : `bun@1.3.11` (et au-delà, tant que `^1.3.11` est
  satisfait). Tout écart déclenche warning puis exit dans le pre-push
  hook (`.husky/pre-push`).
- **Lockfile** : `bun.lockb` commited, mis à jour via `bun install`
  uniquement (pas de `bun install --no-lockfile`).
- **Engines** : `package.json#engines` doit être cohérent avec
  `packageManager` (cf. ADR-000 cas applicable).

### 2. Bibliothèques de schema et de validation

- **zod** uniquement. Toute nouvelle validation structurelle
  (`parseX(input): X`) **doit** utiliser `z.ZodType<…>` ou équivalent
  Zod (pas de type guard ad-hoc, pas d'assert).
- **Branded types** : pattern natif TS + intersection Zod refine
  (cf. `M0-01 ids.ts`).
- **Effets runtime** : `zod` côté contrat (M0 contract, M1 contract),
  pas d'ajv/joi/yup/valibot même comme dépendance dev.

### 3. Property-based et fuzzing

- **Pas de fast-check** pour le moment. Décision documentée :
  - Runaway process observé en M2-TEST (commit `3e0598ac5f`, fichiers
    `graph-validators.ts` + `graph-property.test.ts`) avec 1.4 GB
    memory, 12k threads, kill manuel après 2h de stagnation worker.
  - Couverture actuelle : tests mutation-testés manuellement (cf.
    M2-TEST 22/22 + M3-TEST crash matrix 18/18).
  - **Réouverture de la question** : si property-based redevient
    nécessaire (ex. invariant cryptographic sur typed digest envelope,
    ADR-026), réouverture via ADR-028+ avec preuve de contrôle
    runaway.
- **Fuzzing** : applicable uniquement aux parseurs de données
  externes (libFuzzer via Ziggy / cargo-fuzz côté Rust). Pas de fuzz
  pour le moment — re-évaluation post-M3.

### 4. Tests

- **bun test** pour `unit_*` + `integration_*` (gates §2
  `certification/gates.yaml`). Pas de jest, vitest, mocha, node:test.
- **Mutation testing** : manuel (relecture de chaque test supprimé
  puis re-run). Pas de Stryker ni équivalent pour le moment.
- **Couverture cible par carte GREEN** : 8-12 tests minimum
  (cf. POST-M3-TRACKS-PLAN §3 + chaque plan d'implémentation).
- **Couverture globale** : pas de seuil chiffré — chaque carte
  documente son propre `acceptance` (cf. EXECUTION_STATUS).

### 5. Lint et format

- **biome** pour lint + format (gates §1 `lint`).
- **Configuration** : `biome.json` racine + éventuellement overrides
  par package. Pas de `.eslintrc`, pas de `.prettierrc`.
- **Skip allowed** : `packages/app/e2e/**` (finding R-008) avec
  justification dans `gates.yaml#lint.allowed_skips`.

### 6. Commits

- **Conventional Commits 1.0** : `<type>(<scope>): <description>`.
  Types autorisés : `feat`, `fix`, `refactor`, `perf`, `docs`,
  `test`, `chore`, `build`, `ci`, `style`. Scope = nom du package
  (`contracts`, `workflow-runtime`, `secret-broker`,
  `automate-m0-contract`, etc.) ou du track (M2, M3, R1, R2, R3).
- **Pas de merge commits** dans `main` (squash merge preferred).
- **PR ≤ 400 LOC** changed (cf. senior engineering reflexes). Au-delà
  : split en PRs autonomes buildable.
- **Pas de secrets** dans les commits. Pre-commit vérifie via
  secret-leak canary (M1-12) + git-secrets-style pattern matching
  futur (gates §6 `secret_canary`).

### 7. Hooks git (husky)

- **pre-commit** : `biome check` sur les fichiers staged. Refuse le
  commit si erreur. Auto-fix warning (et non erreur, pour ne pas
  bloquer les corrections manuelles).
- **pre-push** :
  1. `bun run typecheck` workspace-wide via turbo.
  2. Protected branches check (TEAM-G01) : refuse push direct à
     `main`, `dev`, `opti-ui`, `Team-build-opti-ui`, `Team`.
  3. Lease check si worker (`.team/active_lease`).
- **Skip** : `--no-verify` autorisé uniquement avec note explicite
  dans le message de commit (cf. M2 cleanup commit `7ce0d4a896`
  qui a résorbe 1 erreur + 10 warnings biome accumulés).

### 8. Politiques de vulnérabilité et license

- **Audit** :
  - `bun audit` (en place nativement) — bloquant si Critical.
  - **TODO post-M3** : `osv-scanner --recursive .` ou
    `trivy fs .` pour les dépendances natives Rust (sidecar Tauri).
  - **Cadence** : pre-MR pour deps modifiées, weekly pour
    audit complet (proposition gate § future).
- **Licence** : MIT pour le code Unifia core. Allowlist dépendances
  : MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC. Refus
  GPL/AGPL/LGPL sauf exception documentée (un seul cas à ce jour :
  aucun).
- **SBOM** : génération `bunx @cyclonedx/cyclonedx-bun` ou
  `bunx @mongodb/sbom-tools` à post-M3-R3. **Pas bloquant** pour la
  cible première locale (single-tenant, single-OS).

### 9. Mises à jour de dépendances

- **Manuelles** pour le moment (cf. profil `agent/automate-v2-baseline`
  par l'auteur du plan).
- **Automation** (renovate, dependabot) : **désactivé** pour la
  branche `agent/automate-v2-baseline-20260901` jusqu'à la fin de
  l'implémentation V2.3.1 (risque de drift substrate, finding
  F-M2-06 implicite).
- **Patchs de sécurité** : manuels, fenêtre 7 jours après disclosure
  (cible interne, pas SLA contractuel).

### 10. Native deps

- **Tauri** : version exacte pinnée (ADR-008 référencé).
- **Bun native modules** : aucun utilisé à ce jour. Si ajout futur
  (ex. `bun:sqlite` pour le cache local) : ADR-028+ séparé
  obligatoire.
- **WebView2** (Windows) : version épinglée au runtime livré par
  Edge stable. Mises à jour via le canal officiel Microsoft.

## Consequences

- **C-AR-01** (M1-08 capability enforcer) reste résolu. C-AR-02
  devient le 2ème ADR de la série « Constraint Architectural Review ».
- **C-AR-03** (LLM supply chain, post-M3+), **C-AR-04** (UX
  framework) restent ouverts, à traiter en certifications prep.
- **gates.yaml §1** : les sections `lint`, `typecheck`, `build` se
  réfèrent à cette politique.
- **gates.yaml §6** : `secret_canary` (NOT_BUILT) sera défini en
  cohérence avec §6.
- **gates.yaml §9** : `adr_dependencies` n'inclut pas ADR-027
  explicitement (n'est pas architectural au sens runtime/schema),
  mais toute nouvelle carte supply-chain-impactante doit
  référencer cet ADR.

## Liens

- `commit-convention` skill
- `.husky/pre-commit`, `.husky/pre-push`
- `biome.json`
- `bun.lockb`
- `package.json#packageManager`
- Plan V2.3.1 §30 (certification) + §125 (security) + §195 (build)
  + §246 (EXECUTION_STATUS)
- ADR-008 (scheduler / worker time authority, référence Tauri pin)
- ADR-024 (extension runtime, no third-party first target)
- M2-TEST commit `3e0598ac5f` (graph property tests, no fast-check)
- M1-12 observability (zero-alloc logger, secret-leak canary seed)

## Décisions de fond (rappel)

1. **bun** unique runtime.
2. **zod** unique validation.
3. **bun test** unique test runner.
4. **biome** unique lint/format.
5. **Pas de fast-check** (runaway process documenté).
6. **Husky** + Conventional Commits.
7. **No 3rd-party extensions** for first target (ADR-024).
8. **Lockfile** + **engines** + **packageManager** always committed.
9. **SBOM** + **trivy** post-M3-R3 (non bloquant première cible).
10. **Pas d'automation renovate/dependabot** avant fin V2.3.1.
