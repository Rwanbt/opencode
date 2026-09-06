<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# PACKAGE MIGRATION MAP — UNIFIA AUTOMATE

> Statut : **PINNED**
> Phase : **PRE-1** (livrable §15 du plan)
> Date : 2026-09-01T16:10+02:00
> Source : `BASELINE.md` + `AUTOMATE_TRUST_PATH.md` + `RISK_REGISTER.md`
> (même dossier), code sur disque au SHA `24b04998e2fd861711036501ad3f6e41a63f8c32`.

Pour chaque composant, on documente :
- path
- current responsibility
- current authority
- current consumers
- target responsibility
- target authority
- migration strategy
- migration milestone
- compatibility impact
- tests affected
- removal/cutover condition

Et un statut (plan §16) : `KEEP` / `EXTEND` / `REFACTOR` / `MIGRATE` /
`CONSOLIDATE` / `REPLACE` / `REMOVE` / `ABSENT_CREATE` / `ABSENT_NO_ACTION`.

**Règle** (plan §18) : ne pas inventer une responsabilité courante pour un
package absent. Statut `ABSENT_NO_ACTION` ou `ABSENT_CREATE`, jamais une
« current responsibility » fabriquée.

---

## 1. Cœur durable

### 1.1 `@unifia/workflow-runtime`

| Champ | Valeur |
|---|---|
| Path | `packages/workflow-runtime/` |
| Current responsibility | Exécuteur séquentiel de `WorkflowStep` (capability P3) avec persistance in-memory ou fichier. Validation, switch `isEngaged("workflow-automation")`, approval par step, save entre steps. |
| Current authority | L'autorité de l'état d'un `WorkflowState` pour les exécutions lancées par ce runtime. |
| Current consumers | `workbench-server` (importé dans `workbench-server/src/index.ts:5`). Aucun autre import local détecté. |
| Target responsibility | Substrate-grade : durable timer, canonicalisation, effect identity, classes d'effet, `UNKNOWN_EXTERNAL_STATE`, effet-slot, fencing, ou adapter d'un substrate externe. |
| Target authority | Une seule autorité durable par `WorkflowRun`, immutable pendant le run (plan §1, §2, §43). |
| Migration strategy | ADR-000 tranche entre (a) réécriture en kernel natif, (b) adapter d'un substrate externe (DBOS, Restate, Temporal), (c) dépréciation. Tant qu'ADR-000 n'est pas rendu, `MIGRATE` en attente. |
| Migration milestone | **M0 substrate proof** (plan §194), puis **M1 Durable Core**. |
| Compatibility impact | Le contrat observable (start, resume, cancel, approval per step) doit être préservé pour ne pas casser `workbench-server`. |
| Tests affected | `packages/workflow-runtime/test/` — 1 fichier intégré, ~30 lignes. Doit être réécrit pour les invariants substrate-grade. |
| Removal/cutover condition | ADR-000 dit REMOVE/REPLACE ; jusqu'à ADR-000, KEEP + `DEFERRED_WITH_CONTAINMENT` (le runtime ne doit pas être l'autorité durable d'un run GA). |
| Status | `MIGRATE` (en attente d'ADR-000) — **finding R-014** |
| **Composite ratio (estimé)** | reuse ≈ 30% (l'in-memory/file store et le switch restent valides comme adapter), migration ≈ 70% (substrate-grade) |

### 1.2 `@unifia/workflow-catalog`

| Champ | Valeur |
|---|---|
| Path | `packages/workflow-catalog/` |
| Current responsibility | **MESURÉE 2026-09-03 (C-PRE1-03)** : catalogue de 8 workflows initiaux (Plan V3 section 28), chaque step déclare 9 champs typés : `capability: P3Capability`, `scope: string`, `sandbox: SandboxRequirement` (none/native-restricted/docker/wsl2/lima), `costUnits: number`, `timeoutMs: number`, `retry: {attempts, backoffMs}`, `output: {name, kind: artifact/text/none}`, `approval: ApprovalRequirement` (none/required), `reversible: boolean`. |
| Current authority | **MESURÉE** : aucune (purement déclaratif, c'est un catalogue). |
| Current consumers | **MESURÉE** : import uniquement par `packages/workflow-catalog/test/catalog.test.ts` (126 LOC). Pas d'usage en production repéré (grep `workflow-catalog` dans `packages/*/src` → 0 hit hors catalog lui-même). |
| Source size | 1 fichier `index.ts` (236 LOC, 12.2 KB) + 1 fichier test (126 LOC). Compact, bien typé. |
| Manifest signed? | **NON** (grep `signature\|sign\|hash` → 0 hit dans `index.ts`). Le catalogue ne signe pas les manifests. C'est un trou si on veut l'immutabilité forte, mais pas bloquant pour V1 legacy. |
| Test coverage | 1 fichier test (catalog.test.ts) couvre 8 workflows × invariants. Pas de measure exacte, mais ≥1 test par type de step. |
| Target responsibility | Catalogue de `WorkflowDefinition` versionnées, aligné sur les contrats ADR-001 (canonicalisation) et ADR-002 (IR). |
| Target authority | Aucune — un catalogue n'est pas une autorité d'exécution. |
| Migration strategy | `KEEP` + ajout progressif de manifest signing (post-ADR-001 ratification). Pas de `MIGRATE` urgent : la cible V2 a ses propres contrats (IR schema, parseSpec, WorkflowRun), le catalogue V1 reste utile pour les définitions legacy. |
| Migration milestone | **POST-M2** (post-ADR-001 + ADR-002) — alignment avec `WorkflowVersion` publié et immuable. |
| Compatibility impact | Le catalogue ne doit pas muter silencieusement après publication. |
| Tests affected | À étendre pour couvrir le signing manifest. |
| Removal/cutover condition | KEEP + signature ajoutée en M3/post-M3 (post-ADR-001). |
| Verdict C-PRE1-03 (2026-09-03) | **KEEP** — petit, ciblé, isolé, bien testé. Migration vers V2 n'est PAS URGENTE. Présomption `MIGRATE` du tour initial était pessimiste. |
| Status | `KEEP` (cartographie C-PRE1-03 confirmée 2026-09-03) |

### 1.3 `@unifia/contracts`

| Champ | Valeur |
|---|---|
| Path | `packages/contracts/src/` (24 fichiers) |
| Current responsibility | 6 ports Plan V3 (RuntimeAdapter, WorkspacePort, CapabilityPort, ArtifactPort, SandboxPort, RemoteTransportPort) + P3 (capabilities + decision + approval) + wire protocol. |
| Current authority | Aucune — c'est un contrat, pas une autorité. |
| Current consumers | Tous les packages de la couche serveur, plus `packages/app` (wire), plus `packages/unifia` (CLI). |
| Target responsibility | Doit absorber les nouveaux contrats sans casser les 6 ports. À ajouter : `WorkflowDefinition`/`WorkflowVersion`/`WorkflowRun` (plan §43), `DigestEnvelope` (§64), `ArtifactRef`/`ArtifactRecord` (§67/§68), `AtRestProtectionEnvelope` (§74), `TriggerDefinition`/`TriggerBinding`/`TriggerRuntimeState` (§52-54). |
| Target authority | N/A. |
| Migration strategy | Ajouter des types **additivement** jusqu'à M1, retirer les anciens après M3 (migration des consommateurs). Aucun breaking change pendant M0-M1. |
| Migration milestone | **M1** (ajouts) ; **post-M3** (retraits) |
| Compatibility impact | Critique — le wire workbench (`contracts/src/workbench-wire/`) est partagé entre client et serveur. |
| Tests affected | `packages/contracts/test/` — présents (non exécutés dans ce tour). |
| Removal/cutover condition | KEEP. Renommage de fichiers interdits. |
| Status | `EXTEND` |

---

## 2. Capability / policy / secret

### 2.1 `@unifia/capability-runtime`

| Champ | Valeur |
|---|---|
| Path | `packages/capability-runtime/src/index.ts` |
| Current responsibility | Signer et vérifier des `CapabilityManifest` Ed25519. |
| Current authority | **Aucune à l'exécution** — c'est un vérificateur. L'enforcer est ailleurs. |
| Current consumers | Probablement `workbench-server` (à confirmer en PRE-1.1). |
| Target responsibility | Vérifier ET enforcer : aucun consumer ne doit pouvoir ignorer le verdict du `CapabilityRegistry`. |
| Target authority | Capability Authority (plan §9, §114-116). |
| Migration strategy | (1) `createSecureCapabilityRegistry` devient l'unique entrée de vérification. (2) Tester que les consumers ne court-circuitent pas. (3) ADR-010 pour la rotation de clé. |
| Migration milestone | **M1** (alignement) + **Security Core Track** (enforcement) |
| Compatibility impact | Faible tant qu'on ne change pas l'API publique. |
| Tests affected | Doit avoir des tests d'enforcement — à créer. |
| Removal/cutover condition | KEEP. |
| Status | `HARDEN` (renforcement) |

### 2.2 `@unifia/identity`

| Champ | Valeur |
|---|---|
| Path | `packages/identity/` |
| Current responsibility | **INFERRED** — gestion d'identités (workers, services, principals). |
| Current authority | **INFERRED** |
| Current consumers | **INFERRED** |
| Target responsibility | Identité prouvée pour `workerId` (plan §104), service identities (§214 E1). |
| Target authority | Identité n'est pas une autorité d'exécution. |
| Migration strategy | Cartographier en PRE-1, puis classer. |
| Migration milestone | post-M1 (selon profil). |
| Compatibility impact | Faible. |
| Tests affected | À mesurer. |
| Removal/cutover condition | KEEP. |
| Status | `KEEP` (présomption) |

### 2.3 Secret Broker (package dédié : **ABSENT**)

| Champ | Valeur |
|---|---|
| Path | **ABSENT** (`workbench-server/src/auth.ts` gère des `Principal` / `ScopedToken`, c'est de l'authentification, pas du secret broker) — **finding R-012** |
| Current responsibility | N/A |
| Current authority | N/A |
| Current consumers | N/A |
| Target responsibility | Secret Broker (plan §124) : resolution au plus proche de l'executor autorisé, avec `CredentialRef` / `SecretRef` / `OAuthConnectionRef` / `BrowserAuthProfileRef` (§123). |
| Target authority | Secret Broker (autorité de résolution). |
| Migration strategy | Cartographier `workbench-server/src/auth.ts` en PRE-1.1 pour décider : (a) le rôle est dans `auth.ts` et il faut le REPACKAGE en `@unifia/secret-broker`, (b) le rôle est dispersé et il faut CONSOLIDATE, (c) le rôle est absent et il faut `ABSENT_CREATE`. |
| Migration milestone | **M1** (ADR-010) |
| Compatibility impact | Critique : si on rate un consumer, des secrets fuitent en clair. |
| Tests affected | À créer (canary gate — plan §125). |
| Removal/cutover condition | ADR-010 tranche. |
| Status | **`ABSENT_CREATE` ou `MIGRATE` (à confirmer en PRE-1.1)** |

### 2.4 `@unifia/enterprise`

| Champ | Valeur |
|---|---|
| Path | `packages/enterprise/` |
| Current responsibility | RBAC, environnements, promotion, GitOps, audit, retention, KMS externe (INFERRED — non mesuré). |
| Current authority | **INFERRED** — doit **explicitement** ne pas devenir l'autorité durable d'un run. |
| Current consumers | **INFERRED** |
| Target responsibility | RBAC + GitOps + retention + KMS externe, sans toucher à `WorkflowRun.durableAuthorityId`. |
| Target authority | Aucune autorité durable. Enterprise fournit l'ownership (`OwnershipScope`) et le `DeploymentScope`, pas l'autorité d'exécution. |
| Migration strategy | ADR-020 doit explicitement rejeter le scénario « enterprise devient autorité durable » (plan §2). |
| Migration milestone | **Enterprise Track E1/E2/E3** (post-M3). |
| Compatibility impact | Faible pour la cible première (Automate Core × local). |
| Tests affected | À mesurer. |
| Removal/cutover condition | KEEP hors profil Enterprise. |
| Status | `KEEP` (avec contrainte ADR-020) |

---

## 3. Couche serveur

### 3.1 `@unifia/workbench-server`

| Champ | Valeur |
|---|---|
| Path | `packages/workbench-server/src/` (5 fichiers : `index.ts` 97 Ko, `auth.ts` 16 Ko, `bootstrap.ts` 14 Ko, `operations.ts` 3 Ko, `security.ts` 2 Ko, `workspace-events.ts` 5.7 Ko, `present-link.ts` 3.2 Ko, `logging.ts` 1.4 Ko) |
| Current responsibility | Surface serveur unique : Hono, ApprovalBroker, OperationRegistry, startWorkflow, routes d'approbation, routes d'artefact. |
| Current authority | L'autorité d'orchestration de surface — pas de l'exécution durable elle-même. |
| Current consumers | `packages/app` (wire workbench) + `packages/unifia` (CLI). |
| Target responsibility | Doit rester aligné sur les contrats ADR-001/002/004/005. Le découpage doit suivre les ADR, pas l'inverse. |
| Target authority | Aucune autorité durable — délègue à `WorkflowRuntime` (futur substrate). |
| Migration strategy | (1) Découpage en sous-modules alignés ADR. (2) Test de traversée « definition → approval → execution » par capability. (3) Vérification que `startWorkflow` ne contourne pas `Capability Authority`. |
| Migration milestone | **M1** (alignement) + continu pendant M2-M3. |
| Compatibility impact | Critique (97 Ko de logique + 5 fichiers satellites). |
| Tests affected | Tests d'intégration manquants ou à compléter. |
| Removal/cutover condition | KEEP. |
| Status | `REFACTOR` (découpage) + `HARDEN` (enforcement) |

### 3.2 `@unifia/workbench-orchestrator`

| Champ | Valeur |
|---|---|
| Path | `packages/workbench-orchestrator/src/index.ts` (7 929 octets) |
| Current responsibility | Routage multi-workspace d'un **runtime unique partagé** par `WorkspaceScope`. |
| Current authority | Aucune — c'est un routeur, pas une autorité. |
| Current consumers | (à mesurer) |
| Target responsibility | Inchangé. Vérifier que l'isolation scope est prouvée. |
| Target authority | N/A. |
| Migration strategy | Test ciblé : un workflow lancé depuis workspace A ne peut pas écrire dans workspace B. |
| Migration milestone | **M1** (test) |
| Compatibility impact | Faible. |
| Tests affected | `packages/workbench-orchestrator/test/` — présents (`bun test/orchestrator.test.ts`). |
| Removal/cutover condition | KEEP. |
| Status | `HARDEN` (test isolation scope) |

### 3.3 `@unifia/workbench-shell`

| Champ | Valeur |
|---|---|
| Path | `packages/workbench-shell/` |
| Current responsibility | `SHELL_MODES` (4 entrées : code / work / design / automate). |
| Current authority | Aucune. |
| Current consumers | `packages/app/src/context/mode.tsx`. |
| Target responsibility | Inchangé. |
| Target authority | N/A. |
| Migration strategy | Vérifier le test `check-mode-registry` (mentionné dans le commentaire `mode.tsx:6`). Si absent, créer. |
| Migration milestone | **M1** |
| Compatibility impact | Faible. |
| Tests affected | Vérification du test registry. |
| Removal/cutover condition | KEEP. |
| Status | `KEEP` |

### 3.4 `@unifia/runtime-conformance`

| Champ | Valeur |
|---|---|
| Path | `packages/runtime-conformance/` |
| Current responsibility | Suite de conformance (capabilities, contracts). |
| Current authority | Test only. |
| Current consumers | CI. |
| Target responsibility | Étendre la conformance pour couvrir ADR-001 (digest), ADR-002 (IR), ADR-004 (history), ADR-005 (artifact), ADR-010 (key). |
| Target authority | N/A. |
| Migration strategy | `EXTEND` aligné sur les ADR. |
| Migration milestone | **M1** (ajouts) |
| Compatibility impact | Faible. |
| Tests affected | À étendre. |
| Removal/cutover condition | KEEP. |
| Status | `EXTEND` |

### 3.5 `@unifia/spec-runtime`

| Champ | Valeur |
|---|---|
| Path | `packages/spec-runtime/` |
| Current responsibility | `parseSpec`, `resolveEffectiveCapabilities` (importé par `workbench-server/src/index.ts:7`). |
| Current authority | Validateur d'entrée. Pas une autorité d'exécution. |
| Current consumers | `workbench-server`. |
| Target responsibility | Validateur strict aligné sur ADR-002 (WorkflowIR). Rejeter toute `WorkflowDefinition` non conforme. |
| Target authority | N/A. |
| Migration strategy | Étendre la validation à `WorkflowDefinition` une fois ADR-002 rendu. |
| Migration milestone | **M1** (alignement) |
| Compatibility impact | Faible tant qu'on ne change pas l'API publique. |
| Tests affected | À compléter. |
| Removal/cutover condition | KEEP. |
| Status | `HARDEN` (validation stricte) |

### 3.6 `@unifia/remote-bridge`

| Champ | Valeur |
|---|---|
| Path | `packages/remote-bridge/` |
| Current responsibility | **INFERRED** — transport distant. |
| Current authority | **INFERRED** — ne doit pas devenir une autorité d'exécution. |
| Current consumers | **INFERRED** |
| Target responsibility | Transport distant traversant Network Authority + auth + Capability. |
| Target authority | N/A (transport). |
| Migration strategy | Vérifier que les appels distants traversent ADR-023 (Network Authority) et ADR-009 (Policy). |
| Migration milestone | post-M1. |
| Compatibility impact | Faible. |
| Tests affected | À mesurer. |
| Removal/cutover condition | KEEP. |
| Status | `KEEP` (présomption) |

### 3.7 `@unifia/release-hardening`

| Champ | Valeur |
|---|---|
| Path | `packages/release-hardening/` |
| Current responsibility | **INFERRED** — préparation release. |
| Current authority | N/A. |
| Current consumers | CI. |
| Target responsibility | Inchangé. |
| Target authority | N/A. |
| Migration strategy | KEEP. |
| Migration milestone | — |
| Compatibility impact | Faible. |
| Tests affected | À mesurer. |
| Removal/cutover condition | KEEP. |
| Status | `KEEP` (présomption) |

---

## 4. Surfaces Browser / Computer Use / MCP

### 4.1 `@unifia/browser-runtime`

| Champ | Valeur |
|---|---|
| Path | `packages/browser-runtime/` |
| Current responsibility | Worker navigateur + canaux. |
| Current authority | **INFERRED** — ne doit pas devenir l'autorité durable. |
| Current consumers | **INFERRED** |
| Target responsibility | Browser Worker + network sandbox + auth profiles + downloads/uploads + origin policy + live observation. |
| Target authority | N/A. |
| Migration strategy | ADR-013 / ADR-024. Doit s'appuyer sur Network Authority + OS enforcement. |
| Migration milestone | **Browser Track B1/B2** (post-M3). |
| Compatibility impact | Faible pour la cible première. |
| Tests affected | Computer Use corpus (plan §227). |
| Removal/cutover condition | KEEP. |
| Status | `KEEP` pour la cible première, `HARDEN` quand profile Browser est exposé |

### 4.2 `@unifia/computer-use-safety`

| Champ | Valeur |
|---|---|
| Path | `packages/computer-use-safety/` |
| Current responsibility | Garde-fous Computer Use. |
| Current authority | N/A. |
| Current consumers | Computer Use. |
| Target responsibility | ComputerUseProviderPort (plan §152), kill switch (§156), fail closed (§157). |
| Target authority | N/A. |
| Migration strategy | ADR-014. |
| Migration milestone | post-M3. |
| Compatibility impact | Faible. |
| Tests affected | Computer Use corpus. |
| Removal/cutover condition | KEEP. |
| Status | `KEEP` pour la cible première, `HARDEN` quand profile Computer Use est exposé |

### 4.3 `@unifia/mcp-transport` + `@unifia/mcp-ui-actions`

| Champ | Valeur |
|---|---|
| Path | `packages/mcp-transport/`, `packages/mcp-ui-actions/` |
| Current responsibility | Transport MCP et UI actions. |
| Current authority | MCP ne possède pas WorkflowRun (plan §142). |
| Current consumers | SESSION-2 confirme que la frontière MCP Design est revalidée. Reste : l'enforcer côté Automate. |
| Target responsibility | MCP distant traverse Network Authority + auth + schema + Capability + Policy (§132). MCP stdio local n'a pas accès à `process.env`, SSH agent, Git credentials, cloud credentials, user filesystem (§131). |
| Target authority | N/A. |
| Migration strategy | ADR-011. |
| Migration milestone | **M1** (premier run MCP dans un WorkflowRun). |
| Compatibility impact | Faible tant qu'on ne change pas l'API publique. |
| Tests affected | À étendre (prompt injection corpus). |
| Removal/cutover condition | KEEP. |
| Status | `HARDEN` |

---

## 5. Surfaces UI / consommateur

### 5.1 `packages/app/src/pages/workbench/automate-surface.tsx`

| Champ | Valeur |
|---|---|
| Path | `packages/app/src/pages/workbench/automate-surface.tsx` (8 164 octets) |
| Current responsibility | UI : liste des définitions, parsing, startWorkflow, gestion `approvalRequired`. |
| Current authority | Aucune (UI pure). |
| Current consumers | Le rail de `packages/app` (via `mode.tsx`). |
| Target responsibility | Inchangé fonctionnellement. Doit avoir une suite de tests. |
| Target authority | N/A. |
| Migration strategy | (1) Test unitaire par fonction exportée. (2) e2e couvrant les 8 sorties §16.3. (3) Validation de schéma avant `startWorkflow` (sous-ensemble de `parseSpec` ou nouveau validateur `WorkflowIR`). |
| Migration milestone | **M1** (avant le premier run Automate). |
| Compatibility impact | Faible. |
| Tests affected | **0 actuellement** — à créer — **finding R-013**. |
| Removal/cutover condition | KEEP. |
| Status | `HARDEN` + **bloquant M1** |

### 5.2 `packages/app/src/context/mode.tsx`

| Champ | Valeur |
|---|---|
| Path | `packages/app/src/context/mode.tsx` (5 174 octets) |
| Current responsibility | Visibilité du rail Automate selon `workflow.run`. |
| Current authority | N/A. |
| Current consumers | Toute l'app (rail). |
| Target responsibility | Inchangé. |
| Target authority | N/A. |
| Migration strategy | Décision utilisateur sur `09f1329a8d` (L1) — `HARDEN` ensuite. |
| Migration milestone | post-validation `09f1329a8d`. |
| Compatibility impact | Bloqué par R-001. |
| Tests affected | Mode tests présents. |
| Removal/cutover condition | KEEP. |
| Status | `HARDEN` (en attente de R-001) |

### 5.3 `packages/app` (global)

| Champ | Valeur |
|---|---|
| Path | `packages/app/` |
| Current responsibility | UI SolidJS. |
| Current authority | Aucune. |
| Current consumers | n/a. |
| Target responsibility | Consommateur uniquement. Pas d'autorité durable. |
| Target authority | N/A. |
| Migration strategy | KEEP. |
| Migration milestone | — |
| Compatibility impact | — |
| Tests affected | e2e + unit. |
| Removal/cutover condition | KEEP. |
| Status | `KEEP` (consommateur) |

### 5.4 `packages/unifia` (sidecar CLI)

| Champ | Valeur |
|---|---|
| Path | `packages/unifia/` |
| Current responsibility | Sidecar CLI bun-compilé. |
| Current authority | Aucune (consommateur). |
| Current consumers | Tauri desktop (`packages/desktop`). |
| Target responsibility | Inchangé. |
| Target authority | N/A. |
| Migration strategy | KEEP. |
| Migration milestone | — |
| Compatibility impact | — |
| Tests affected | Suite `test:knowledge` 892 pass + `cli-process.test.ts`. |
| Removal/cutover condition | KEEP. |
| Status | `KEEP` (consommateur) |

### 5.5 `packages/desktop`, `desktop-electron`, `mobile`

| Champ | Valeur |
|---|---|
| Path | ces dossiers |
| Current responsibility | Shells Tauri / Electron. |
| Current authority | Aucune. |
| Current consumers | Utilisateur. |
| Target responsibility | Transport + UI host. |
| Target authority | N/A. |
| Migration strategy | KEEP. ADR-020 doit garantir qu'ils ne portent pas d'autorité durable. |
| Migration milestone | — |
| Compatibility impact | — |
| Tests affected | Tauri build vert (SESSION-2 §5). Android `BLOCKED_EXTERNAL`. |
| Removal/cutover condition | KEEP. |
| Status | `KEEP` (transport) |

### 5.6 `packages/console`, `web`, `storybook`

| Champ | Valeur |
|---|---|
| Path | ces dossiers |
| Current responsibility | UI vitrine. |
| Current authority | Aucune. |
| Current consumers | n/a. |
| Target responsibility | Inchangé. |
| Target authority | N/A. |
| Migration strategy | KEEP. |
| Migration milestone | — |
| Compatibility impact | — |
| Tests affected | — |
| Removal/cutover condition | KEEP. |
| Status | `KEEP` (vitrine) |

### 5.7 `packages/ui`, `util`, `sdk`, `sdk-shared`

| Champ | Valeur |
|---|---|
| Path | ces dossiers |
| Current responsibility | Helpers / SDK. |
| Current authority | Aucune. |
| Current consumers | divers. |
| Target responsibility | Inchangé. |
| Target authority | N/A. |
| Migration strategy | KEEP. |
| Migration milestone | — |
| Compatibility impact | — |
| Tests affected | — |
| Removal/cutover condition | KEEP. |
| Status | `KEEP` (helpers) |

---

## 6. Surfaces artefact

### 6.1 `@unifia/artifact-runtime`

| Champ | Valeur |
|---|---|
| Path | `packages/artifact-runtime/` |
| Current responsibility | `ArtifactStore` (importé par `workbench-server/src/index.ts:5`). |
| Current authority | **Devrait** être l'autorité sur l'`ArtifactRecord`. |
| Current consumers | `workbench-server`. |
| Target responsibility | Store autoritaire avec `OwnershipScope` + `DeploymentScope` + `taints` + `classification` + `origin` + `retentionPolicy` + `protectionEnvelope` (plan §68). Caller ne peut pas fixer `classification` / `taint` / `ownership` / `environment` (§71). |
| Target authority | Artifact Authority (plan §248). |
| Migration strategy | (1) Refuser au caller la fixation des champs sécurité. (2) Ajouter `protectionEnvelope`. (3) Domaine de chiffrement par classe d'artefact. |
| Migration milestone | **M1** (ADR-005). |
| Compatibility impact | Moyen (le wire workbench partage des ArtifactRef). |
| Tests affected | Tests d'API store. |
| Removal/cutover condition | KEEP. |
| Status | `HARDEN` |

### 6.2 `@unifia/artifact-studio`

| Champ | Valeur |
|---|---|
| Path | `packages/artifact-studio/` |
| Current responsibility | UI de gestion d'artefacts. |
| Current authority | Aucune. |
| Current consumers | UI. |
| Target responsibility | UI de gestion. Doit respecter §71 (ne pas fixer la classification). |
| Target authority | N/A. |
| Migration strategy | Test ciblé : l'UI ne peut pas forcer une classification supérieure à celle du scope. |
| Migration milestone | **M1**. |
| Compatibility impact | Faible. |
| Tests affected | À créer. |
| Removal/cutover condition | KEEP. |
| Status | `HARDEN` (présomption) |

### 6.3 `@unifia/artifact-render`

| Champ | Valeur |
|---|---|
| Path | `packages/artifact-render/` |
| Current responsibility | Moteur de rendu. |
| Current authority | Aucune. Consommateur. |
| Current consumers | UI. |
| Target responsibility | Inchangé. Doit respecter les taints d'entrée. |
| Target authority | N/A. |
| Migration strategy | KEEP. Test : un artefact `untrusted_external` reste étiqueté tel jusqu'à declassification explicite. |
| Migration milestone | post-M1. |
| Compatibility impact | Faible. |
| Tests affected | À créer. |
| Removal/cutover condition | KEEP. |
| Status | `KEEP` (consommateur) |

---

## 7. Surfaces auxiliaires

### 7.1 `@unifia/workspace-runtime`

| Champ | Valeur |
|---|---|
| Path | `packages/workspace-runtime/` |
| Current responsibility | **INFERRED** — gestion de workspace. |
| Current authority | **INFERRED** — ne doit pas être l'autorité durable d'exécution. |
| Current consumers | **INFERRED** |
| Target responsibility | Inchangé. |
| Target authority | N/A. |
| Migration strategy | KEEP. |
| Migration milestone | — |
| Compatibility impact | — |
| Tests affected | — |
| Removal/cutover condition | KEEP. |
| Status | `KEEP` |

### 7.2 `@unifia/desktop-runtime`

| Champ | Valeur |
|---|---|
| Path | `packages/desktop-runtime/` |
| Current responsibility | **INFERRED** — runtime desktop. |
| Current authority | N/A. |
| Current consumers | desktop. |
| Target responsibility | Inchangé. |
| Target authority | N/A. |
| Migration strategy | KEEP. |
| Migration milestone | — |
| Compatibility impact | — |
| Tests affected | — |
| Removal/cutover condition | KEEP. |
| Status | `KEEP` |

### 7.3 `@unifia/sandbox-drivers`

| Champ | Valeur |
|---|---|
| Path | `packages/sandbox-drivers/` |
| Current responsibility | Backends d'isolation. |
| Current authority | N/A. |
| Current consumers | Code/Shell (§134). |
| Target responsibility | Backends d'isolation par OS. |
| Target authority | N/A. |
| Migration strategy | ADR-019 (Code/Shell) doit décider. Hors cible première. |
| Migration milestone | post-M3. |
| Compatibility impact | — |
| Tests affected | — |
| Removal/cutover condition | KEEP. |
| Status | `KEEP` (cible première), `HARDEN` quand profile Code/Shell |

### 7.4 `@unifia/plugin`

| Champ | Valeur |
|---|---|
| Path | `packages/plugin/` |
| Current responsibility | Système de plugins. |
| Current authority | N/A. |
| Current consumers | App. |
| Target responsibility | Trust classes (plan §128). |
| Target authority | N/A. |
| Migration strategy | ADR-024. |
| Migration milestone | post-M3 (untrusted extension). |
| Compatibility impact | — |
| Tests affected | — |
| Removal/cutover condition | KEEP. |
| Status | `KEEP` (cible première) |

### 7.5 `@unifia/skill-hub`, `@unifia/spec-runtime`, `@unifia/document-packs`, etc.

Statut `KEEP` (catalogue / consumer). Pas d'autorité durable. Ne pas les
toucher dans le scope PRE-1.

### 7.6 `@unifia/memory-runtime`, `@unifia/memory-governance`

| Champ | Valeur |
|---|---|
| Path | `packages/memory-runtime/`, `packages/memory-governance/` |
| Current responsibility | Mémoire long-terme. |
| Current authority | N/A (mémoire ≠ exécution). |
| Current consumers | Divers. |
| Target responsibility | Inchangé. Hors chemin Automate V2.3.1. |
| Target authority | N/A. |
| Migration strategy | KEEP, hors chemin. |
| Migration milestone | — |
| Compatibility impact | — |
| Tests affected | — |
| Removal/cutover condition | KEEP. |
| Status | `KEEP` (hors chemin) |

---

## 8. Synthèse par statut

| Statut | Compte | Packages |
|---|---|---|
| `KEEP` | 17 | workbench-shell, identity (présomption), enterprise, remote-bridge, release-hardening, app, unifia, desktop*, mobile, console, web, storybook, ui, util, sdk*, artifact-render, workspace-runtime, desktop-runtime, sandbox-drivers (cible première), plugin (cible première), memory-* |
| `EXTEND` | 2 | contracts, runtime-conformance |
| `HARDEN` | 7 | capability-runtime, workbench-orchestrator, spec-runtime, mcp-transport/ui-actions, automate-surface, mode.tsx, artifact-runtime, artifact-studio, browser-runtime (post-M3), computer-use-safety (post-M3) |
| `REFACTOR` | 1 | workbench-server (97 Ko → sous-modules) |
| `MIGRATE` | 1 | workflow-runtime (en attente ADR-000) — workflow-catalog reclassé KEEP (C-PRE1-03), Secret Broker EXISTS (R-012 résolu) |
| `REPLACE` | 0 | (ADR-000 peut en introduire) |
| `REMOVE` | 0 | (ADR-000 peut en introduire) |
| `CONSOLIDATE` | 0 | (à voir si R-012 révèle un éparpillement) |
| `ABSENT_CREATE` | 0 confirmé ; 1 présomption (Secret Broker) | — |
| `ABSENT_NO_ACTION` | 4 | workbench-sdk, workbench-contracts, workbench-core, artifact-store |

### 8.1 Ratios

- **reuse** : 17 KEEP / 50 mesurés = 34%
- **migration** : 3 MIGRATE / 50 = 6%
- **refactor** : 1 REFACTOR / 50 = 2%
- **harden** : 7 HARDEN / 50 = 14%
- **extend** : 2 EXTEND / 50 = 4%
- **absent** : 4 ABSENT_NO_ACTION / 50 = 8%
- **autres** (présomption) : 16 KEEP (cible première ou hors chemin) ≈ 32%

Ces ratios sont indicatifs. Le projet n'est **pas** « > 50% absent », donc
on n'entre pas dans le cas « entire project greenfield » du plan §19.

---

## 9. Plan de migration ordonné

| Étape | Action | Pré-requis | Bloquant |
|---|---|---|---|
| 1 | Écrire la première suite Automate (R-013) | PRE-0 = GO | M1 |
| 2 | Cartographier `workbench-server/src/auth.ts` pour R-012 | PRE-1 = COMPLETE | ADR-010 |
| 3 | Cartographier `workflow-catalog/src/` (C-PRE1-03, **DONE 2026-09-03** verdict KEEP) | PRE-0 = GO | M1 |
| 4 | ADR-000 (substrate) | R-013 résolu | M1 |
| 5 | ADR-001, 002, 003, 004, 005, 010 | ADR-000 | M1 |
| 6 | Découpage `workbench-server` (97 Ko → sous-modules) | ADR-000 (substrate connu) | M1 |
| 7 | Test isolation scope `workbench-orchestrator` | rien | M1 |
| 8 | Décision utilisateur `09f1329a8d` (R-001) | externe | M1 |

L'étape 1 est la première carte PRE-1 exécutable. Aucun code durable de
production n'est modifié tant que les 8 gates bloquantes ci-dessus ne sont
pas franchies.

---

## 10. Suite

1. `IMPLEMENTATION_CARD_INDEX.md` — index des cartes d'implémentation, par
   milestone, profil de capacité, profil d'exécution.
2. `THREAT_MODEL.md` (V1) — STRIDE + agentic AI threats + data-flow threats
   + supply-chain threats.
3. `EXECUTION_PROFILE_REQUIREMENTS.md` — 8 profils classifiés
   `MANDATORY` / `OPTIONAL` / `FUTURE_COMPATIBILITY_REQUIRED` / `UNSUPPORTED`.
4. `certification/gates.yaml` initial.
5. ADR-000 (substrate).

Aucun commit de PRE-1 n'est créé tant que la décision utilisateur (R-001) et
la résolution de R-013 (première suite Automate) ne sont pas confirmées —
le plan §193 autorise les spikes throwaway et le code de preuve ADR avant
M1, mais le commit d'un carte de l'index ne modifie pas le kernel durable
de production.
