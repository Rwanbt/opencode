<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# IMPLEMENTATION CARD INDEX — UNIFIA AUTOMATE

> Statut : **PINNED**
> Phase : **PRE-1.2** (livrable §21 du plan)
> Date : 2026-09-01T16:25+02:00
> Source : `PACKAGE_MIGRATION_MAP.md`, `RISK_REGISTER.md`, plan V2.3.1 §192.

Chaque carte porte : `ID · goal · dependencies · target packages/files ·
allowed write scope · complexity (S/M/L/XL) · risk (low/medium/high/critical) ·
parallelizable (yes/no) · acceptance tests · rollback · review gate`.

**Aucune carte n'est exécutée par cette session.** Cet index décrit ce
qui doit être fait, dans quel ordre, et avec quelles contraintes. Le code
de production n'est pas touché tant que R-001, R-013, R-014 ne sont pas
résolus (cf. RISK_REGISTER.md).

---

## Distribution par milestone

| Milestone | Cartes | Cartes bloquantes |
|---|---:|---|
| PRE-0 (evidence) | 0 (déjà livré) | — |
| PRE-1 (mapping) | 5 (dont 3 cartographies) | R-013 |
| Threat Model V1 | 1 | R-013, R-014 |
| EXECUTION_PROFILE_REQUIREMENTS | 1 | aucun |
| certification/gates.yaml | 1 | aucun |
| ADR-000 (substrate) | 1 | **R-013, R-014** |
| ADR-020 (ownership) | 1 | ADR-000 |
| ADR-003 (expression) | 1 | ADR-000 |
| ADR-002 (IR) | 1 | ADR-003 |
| ADR-001 (canonicalisation) | 1 | ADR-002 |
| ADR-004 (history authority) | 1 | ADR-001 |
| ADR-005 (artifact contract) | 1 | ADR-001 |
| ADR-010 (key/secret) | 1 | ADR-004, ADR-005, R-012 |
| ADR-019/023/024 impacts | 3 | ADR-000 |
| M0 (substrate proof) | 1 | tous les ADR ci-dessus |
| M1 (durable core) | 12 | M0 |
| M2 (graph engine) | 9 | M1 |
| M3 (effect/timer/cancel) | 10 | M2 |
| Tracks post-M3 | 11 | M3 |
| Certifications | 5 | tracks post-M3 |
| Migration | 3 | certifications |
| Final adversarial | 1 | migration |

**Total** : 66 cartes, dont 7 bloquantes.

---

## Distribution par capability profile

| Profile | Cartes GA | Cartes bloquantes |
|---|---:|---|
| Automate Core | 28 | M1, M2, M3 |
| Automate Browser | 8 | M1 + tracks post-M3 Browser |
| Automate AI | 6 | M1 + AI track |
| Automate Enterprise | 5 | M1 + Enterprise track |
| Automate Desktop | 4 | M1 + Desktop track |

**Cible première** : `Automate Core × local-single-node × Windows` (plan
§FIRST TARGET). Les autres profiles sont post-M3.

---

## Distribution par execution profile

| Profile | Classification | Cartes |
|---|---|---:|
| local-single-node | **MANDATORY** | 18 |
| server-single-node | FUTURE_COMPATIBILITY_REQUIRED | 5 |
| server-cluster | FUTURE_COMPATIBILITY_REQUIRED | 4 |
| browser-isolated-worker | FUTURE_COMPATIBILITY_REQUIRED | 0 (post-M3) |
| desktop-host-assisted | OPTIONAL | 0 (post-M3) |
| desktop-isolated-worker | FUTURE_COMPATIBILITY_REQUIRED | 0 (post-M3) |
| mobile-control | FUTURE_COMPATIBILITY_REQUIRED | 0 (post-M3) |
| mobile-local-execution | FUTURE_COMPATIBILITY_REQUIRED | 0 (post-M3) |

`UNSUPPORTED` : aucun profile rejeté (cf. EXECUTION_PROFILE_REQUIREMENTS.md).

---

## Cartes PRE-1 (immédiatement exécutables)

### C-PRE1-01 — Suite Automate minimale (R-013, Critical)

| Champ | Valeur |
|---|---|
| Goal | Écrire la première suite de tests pour `automate-surface.tsx` afin que les 8 gates §16.3 du plan d'audit trois modes deviennent mesurables. |
| Dependencies | aucune (carte première) |
| Target packages/files | `packages/app/src/pages/workbench/automate-surface.test.ts` (créer), `packages/app/src/pages/workbench/automate-surface.tsx` (lecture + éventuelle extraction de `decodeFile` pour testabilité) |
| Allowed write scope | `packages/app/src/pages/workbench/automate-surface.test.ts` (nouveau) ; `packages/app/src/pages/workbench/automate-surface.tsx` (extraction minimale, pas de changement de comportement) ; `packages/app/happydom.ts` (inchangé) |
| Complexity | S |
| Risk | low (test uniquement) |
| Parallelizable | yes (carte 02 et 03 parallèles possibles) |
| Acceptance tests | (a) `decodeFile` : round-trip UTF-8 et base64 vérifié. (b) Validation : `definition.id === "string" && definition.version === 1 && Array.isArray(definition.steps)` — entrées valides et invalides. (c) e2e minimal : 1 parcours qui ouvre la surface, attend l'état « approval required » quand `result.approvalRequired`, attend l'état `result.state.status` sinon. |
| Rollback | `git revert <commit>` ; aucun impact production. |
| Review gate | suite app verte (1 175 + nouvelles assertions) ; pas de régression design. |

### C-PRE1-02 — Cartographie Secret Broker (R-012, High)

| Champ | Valeur |
|---|---|
| Goal | Confirmer ou infirmer l'absence d'un package `@unifia/secret-broker` dédié en lisant `packages/workbench-server/src/auth.ts` (16 Ko) et en cherchant toute responsabilité de résolution de secrets (CredentialRef, SecretRef, OAuthConnectionRef, BrowserAuthProfileRef). |
| Dependencies | aucune |
| Target packages/files | `packages/workbench-server/src/auth.ts`, `packages/workbench-server/src/security.ts`, `packages/contracts/src/secrets.ts` (lecture) |
| Allowed write scope | aucun (lecture seule) |
| Complexity | S |
| Risk | low |
| Parallelizable | yes (avec C-PRE1-03) |
| Acceptance tests | (a) Liste exhaustive des responsabilités de `auth.ts`. (b) Verdict : `EXISTS` (responsabilité présente et mesurable) ou `ABSENT` (création requise en M1) ou `SCATTERED` (consolidation requise). |
| Rollback | n/a (lecture seule) |
| Review gate | rapport écrit dans `RISK_REGISTER.md` mise à jour de R-012. |

### C-PRE1-03 — Cartographie `workflow-catalog` (R-014 confirmation)

| Champ | Valeur |
|---|---|
| Goal | Confirmer ou infirmer la présomption `MIGRATE` pour `workflow-catalog` en lisant la source. |
| Dependencies | aucune |
| Target packages/files | `packages/workflow-catalog/src/` (lecture) |
| Allowed write scope | aucun (lecture seule) |
| Complexity | S |
| Risk | low |
| Parallelizable | yes (avec C-PRE1-02) |
| Acceptance tests | (a) Taille LOC de la source. (b) Présence/absence de tests. (c) Manifest signé ? (d) Verdict : `KEEP` / `EXTEND` / `REFACTOR` / `MIGRATE` confirmé. |
| Rollback | n/a (lecture seule) |
| Review gate | `PACKAGE_MIGRATION_MAP.md` mis à jour. |

### C-PRE1-04 — Découpage `workbench-server` (REFACTOR 97 Ko)

| Champ | Valeur |
|---|---|
| Goal | Découper `packages/workbench-server/src/index.ts` (97 040 octets) en sous-modules alignés sur les ADR. |
| Dependencies | ADR-000, ADR-001, ADR-002, ADR-005, ADR-010 |
| Target packages/files | `packages/workbench-server/src/index.ts` (découpage en `src/server/index.ts`, `src/server/operations.ts`, `src/server/capability-gate.ts`, `src/server/approval-gate.ts`, `src/server/artifact-gate.ts`, `src/server/network-gate.ts`, `src/server/authn.ts` (extrait de `auth.ts`)). Aucun changement de comportement. |
| Allowed write scope | `packages/workbench-server/src/**` (refactor structurel) |
| Complexity | L |
| Risk | medium (taille, risque de régression) |
| Parallelizable | no (série — bloque la suite) |
| Acceptance tests | (a) Tous les tests existants passent. (b) `index.ts` ≤ 800 LOC (cible `CLAUDE.md`). (c) Chaque sous-module a un test ciblé. |
| Rollback | `git revert <commit>` ; le découpage doit être réversible. |
| Review gate | suite `workbench-server` 100% verte ; pas de changement d'API publique. |

### C-PRE1-05 — Test isolation scope `workbench-orchestrator`

| Champ | Valeur |
|---|---|
| Goal | Prouver qu'un workflow lancé depuis workspace A ne peut pas écrire dans workspace B, même si l'ID de session est forgé. |
| Dependencies | C-PRE1-04 (sous-module `WorkspaceGate` extrait) |
| Target packages/files | `packages/workbench-orchestrator/test/isolation.test.ts` (nouveau) |
| Allowed write scope | `packages/workbench-orchestrator/test/isolation.test.ts` |
| Complexity | S |
| Risk | low |
| Parallelizable | yes |
| Acceptance tests | (a) Création de session workspace A. (b) Tentative de list/read/write workspace B avec `workspaceId: A`. (c) Le runtime doit lever ou filtrer. (d) `routedCalls` ne doit pas être incrémenté pour les sessions hors scope. |
| Rollback | `git revert <commit>` |
| Review gate | test ajouté à la suite orchestrator, vert. |

---

## Cartes ADR

| ID | Goal | Dependencies | Risk | Parallelizable |
|---|---|---|---|---|
| ADR-000 | Choisir le substrate (Native / DBOS / Restate / Temporal) | C-PRE1-01 | critical | no (première) |
| ADR-020 | Ownership / Deployment Scope (OwnershipScope, DeploymentScope) | ADR-000 | high | no |
| ADR-003 | Expression language (CEL / JSONata) | ADR-000 | medium | no |
| ADR-002 | WorkflowIR (DAG + node families) | ADR-003 | medium | no |
| ADR-001 | Canonicalisation + DigestEnvelope | ADR-002 | high | no |
| ADR-004 | DurableHistoryAuthority (adapter vs kernel) | ADR-001 | critical | no |
| ADR-005 | ArtifactRef / ArtifactRecord contract | ADR-001 | high | no |
| ADR-010 | Key/secret model + rotation | ADR-004, ADR-005, C-PRE1-02 | critical | no |
| ADR-019 | Code/Shell architectural impact | ADR-000 | medium | yes (après ADR-000) |
| ADR-023 | Network Authority + SSRF | ADR-000 | high | yes (après ADR-000) |
| ADR-024 | Extension isolation trust classes | ADR-000 | high | yes (après ADR-000) |

---

## Cartes M0 — Substrate proof (plan §194)

| ID | Goal | Workflow | Risk | Parallelizable |
|---|---|---|---|---|
| M0-01 | Spike : schedule → HTTP A → durable approval → HTTP B | schedule → test HTTP A → durable approval → test HTTP B | high | no (première substrate-grade) |

**Critères** : redémarrage, durable wait, approval persistence, effect
uncertainty, history mapping, timers, authority uniqueness.

---

## Cartes M1 — Durable Core (12 cartes, plan §195-197)

Cibles : `WorkflowDefinition`, `WorkflowVersion`, `WorkflowIR`,
`OwnershipScope`, `DeploymentScope`, `Trigger contracts`, canonicalisation,
`DigestEnvelope`, `ArtifactRef`/`ArtifactRecord`, at-rest protection,
durable authority adapter, identities.

Cards détaillées omises ici — elles seront créées en M1, après ADR-000.

---

## Cartes M2 — Graph Engine (9 cartes, plan §198-199)

Cibles : `if / switch / parallel / merge / map / repeat / while / child
workflow / wait`. Tests : property, fan-out/in, parallel race, bounded
loops, dynamic identity, stable map keys.

---

## Cartes M3 — Effect / Timer / Cancellation (10 cartes, plan §200-201)

Cibles : attempts, effect identity, idempotency, retry, reconciliation,
`UNKNOWN_EXTERNAL_STATE`, compensation, durable timer, timeouts,
cancellation. Tests : crash matrix avant/après chaque transition
critique.

---

## Tracks post-M3 (11 cartes parallèles, plan §202)

| Track | Cards | Bloquant |
|---|---:|---|
| Local/Security/Integrations | 2 | M3 |
| Distributed Server | 1 | M3 |
| Browser | 2 | M3 + B1 |
| AI Compiler | 2 | M3 + A1 |
| Enterprise | 3 | M3 + E1 |
| UX | 1 | M3 |
| Desktop | 1 | M3 + per-OS |
| External Ingress | 1 | Security Core |
| Network | 1 | M3 |
| MCP/Connectors | 1 | M3 |
| Final adversarial certification | 1 | migration |

---

## Cartes certifications (5, plan §186-188)

`Automate Core × local-single-node × Windows` → cible première.
`Automate Core × server-single-node × Linux` → après.
`Automate Browser × local-single-node × Windows` → post-M3.
`Automate AI × local-single-node × Windows` → post-M3.
`Automate Desktop × host-assisted × Windows` → post-M3.

---

## Cartes migration (3, plan §222-223)

V1 fixtures → migration → V2 validation → execution → compare observable
semantics, en CI, à partir du moment où IR est stabilisé.

---

## Suite

1. THREAT_MODEL.md V1
2. EXECUTION_PROFILE_REQUIREMENTS.md
3. certification/gates.yaml initial
4. ADR-000 (premier ADR — bloque M1)
5. ADR-020, ADR-003, ADR-002, ADR-001, ADR-004, ADR-005, ADR-010
6. ADR-019, ADR-023, ADR-024 (impacts architecturaux)
7. ADR-016, ADR-021 (conditionnels)

Aucun code de production n'est modifié tant que les 8 gates bloquantes
(R-001, R-013, R-014 + ADR-000..010) ne sont pas franchies.
