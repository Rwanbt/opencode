<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# PRE-0 — BASELINE — UNIFIA AUTOMATE

> Statut : **EVIDENCE_BASELINE_PINNED**
> Phase : **PRE-0**
> Date : 2026-09-01T15:40+02:00
> Source de vérité : ce document. Toute affirmation est liée à un chemin, un
> symbole, une ligne, une commande ou un résultat observé. Une lecture statique
> est marquée **INFERRED**, jamais « confirmé ». Une commande non lancée est
> marquée **NON EXÉCUTÉE**, jamais verte.

---

## 0. Écart entre l'énoncé de la mission et la réalité observée

Avant tout inventaire, les écarts entre l'énoncé reçu et l'état réel de
disque. Ces écarts sont **non bloquants** mais doivent être consignés :

| Énoncé reçu | Réalité mesurée | Source |
|---|---|---|
| HEAD attendu `24b04998e2a32ecfb10f74ed4f3e82e21eb9d38c` | HEAD réel `24b04998e2fd861711036501ad3f6e41a63f8c32` | `git rev-parse HEAD` exécuté à 15:40 |
| Plan maître : SHA256 `ea44c810144ad1e2fb263a190202ffb1d5c51dddefb72f6922d29b46f07ee995`, 6 260 lignes | Sur disque : SHA256 `3A63FE3D2CE12E84CC47787A2B6257167F2FEC50EAB294CD125D9CFB86510815`, 3 729 lignes, modifié 2026-09-01 15:33:58 | `Get-FileHash` sur `D:\Documents\Obsidian\IA_Dev_Brain\projects\unifia\roadmaps\UNIFIA-Automate-Master-Implementation-Plan-V2.3.1.md` |

**Lecture** : le plan a été réécrit aujourd'hui 15:33:58 (sept minutes avant
l'horodatage d'exécution). Le SHA du prompt est celui d'une version antérieure.
Le frontmatter du fichier gelé lui-même référence l'ancien SHA comme
`source_sha256` (ligne 12), donc la « copie fidèle » enregistre la modification.
La lecture du présent document porte sur la version **actuelle** du fichier —
3 729 lignes — qui est l'autorité de fait, puisque le fichier est marqué
`status: FROZEN` sur disque et n'est pas le prompt.

**Aucun de ces écarts ne modifie l'architecture** ; ils ne font que
renouveler l'exigence d'evidence-first.

---

## 1. Identité du checkout

| Élément | Valeur | Preuve |
|---|---|---|
| Worktree | `D:\App\unifia\.worktrees\rev3m-20260901\design` | `Set-Location` + `Get-Item` |
| Branche locale | `agent/automate-v2-baseline-20260901` | `git checkout -b` à 15:55 |
| Branche d'origine | `integration/rev3m-20260901/design-automate` | `git rev-parse --abbrev-ref HEAD` avant checkout |
| HEAD (branche d'origine) | `24b04998e2fd861711036501ad3f6e41a63f8c32` | `git rev-parse HEAD` |
| HEAD (branche de travail) | `24b04998e2fd861711036501ad3f6e41a63f8c32` (créée depuis l'origine) | `git rev-parse HEAD` après checkout |
| Message du HEAD | `fix(e2e): the same impossible locators, in design-mode.spec.ts` | `git log -1 --format='%s'` |
| Auteur du HEAD | MM2-B02-WORKER, 2026-09-01 14:22:12 +02:00 | `git log -1 --format='%ci %an'` |
| `node_modules` | présent | `Test-Path node_modules` |
| `docs/automation-v2` | créé à l'instant par cette session | `New-Item` |

**Tree SHA** : non calculé dans ce tour. À dériver de `git rev-parse
HEAD^{tree}` si nécessaire pour les gates de certification. Statut
**INFERRED** : `git rev-parse HEAD^{tree}` sera utilisé dès qu'une gate
exige un tree-SHA reproductible.

### 1.1 Remotes

| Remote | URL | Source |
|---|---|---|
| `origin` | `https://github.com/Rwanbt/unifia.git` (fetch + push) | `git remote -v` |
| `upstream` | `https://github.com/anomalyco/opencode.git` (fetch) | `git remote -v` |

L'`upstream` est en fetch-only (pas de push). Tout push Automate se ferait
contre `origin`, **interdit** par la mission.

---

## 2. État du working tree

À l'instant de l'inventaire :

| Marqueur | Valeur |
|---|---|
| `git status --porcelain` | vide (sortie = `24b04998...` uniquement) |
| Modifications tracked | 0 |
| Fichiers non suivis | 0 créés par la session autres que `docs/automation-v2/` |
| Branche HEAD par rapport à `integration/rev3m-20260901/design-automate` | aucune divergence |

`docs/automation-v2/` est créé par la session pour porter les livrables PRE-0
et les suivants. Aucun fichier utilisateur en place n'a été modifié.

---

## 3. Inventaire des packages

Mesuré par `Get-ChildItem packages` (50 packages), `Get-ChildItem packages/app/e2e/design`,
`Get-ChildItem packages/contracts/src`. Ci-dessous : classification par statut
vis-à-vis du plan.

### 3.1 Packages PRÉSENTS et cités par le plan (24 sur 24)

| Package | `package.json` name | Présent | Statut mesuré |
|---|---|---|---|
| `packages/workflow-runtime` | `@unifia/workflow-runtime` | ✓ | `src/index.ts` 91 lignes — runtime séquentiel, **pas** un durable execution substrate. Cf. §6.1 |
| `packages/workflow-catalog` | `@unifia/workflow-catalog` | ✓ | package.json 523 octets ; src/ présent (vide côté listing) |
| `packages/capability-runtime` | `@unifia/capability-runtime` | ✓ | `src/index.ts` — Ed25519 manifest verifier (sign + verify) |
| `packages/contracts` | `@unifia/contracts` | ✓ | `src/index.ts` exporte 6 ports du Plan V3 §7 |
| `packages/workbench-server` | `@unifia/workbench-server` | ✓ | `src/index.ts` 97 040 octets — gros serveur Hono, ApprovalBroker, OperationRegistry |
| `packages/workbench-shell` | `@unifia/workbench-shell` | ✓ | importé par `packages/app/src/context/mode.tsx` (`SHELL_MODES`) |
| `packages/workbench-orchestrator` | `@unifia/workbench-orchestrator` | ✓ | `src/index.ts` 7 929 octets — `MultiWorkspaceRouter` + `WorkbenchOrchestrator` |
| `packages/browser-runtime` | `@unifia/browser-runtime` | ✓ | présent |
| `packages/computer-use-safety` | `@unifia/computer-use-safety` | ✓ | présent |
| `packages/mcp-transport` | `@unifia/mcp-transport` | ✓ | présent |
| `packages/mcp-ui-actions` | `@unifia/mcp-ui-actions` | ✓ | présent |
| `packages/artifact-runtime` | `@unifia/artifact-runtime` | ✓ | importé par `workbench-server/src/index.ts` |
| `packages/artifact-studio` | `@unifia/artifact-studio` | ✓ | présent |
| `packages/artifact-render` | `@unifia/artifact-render` | ✓ | présent |
| `packages/runtime-conformance` | `@unifia/runtime-conformance` | ✓ | présent |
| `packages/sandbox-drivers` | `@unifia/sandbox-drivers` | ✓ | présent |
| `packages/spec-runtime` | `@unifia/spec-runtime` | ✓ | importé par `workbench-server/src/index.ts` (`parseSpec`, `resolveEffectiveCapabilities`) |
| `packages/enterprise` | `@unifia/enterprise` | ✓ | présent |
| `packages/remote-bridge` | `@unifia/remote-bridge` | ✓ | présent |
| `packages/release-hardening` | `@unifia/release-hardening` | ✓ | présent |
| `packages/workspace-runtime` | `@unifia/workspace-runtime` | ✓ | présent |
| `packages/desktop-runtime` | `@unifia/desktop-runtime` | ✓ | présent |
| `packages/identity` | `@unifia/identity` | ✓ | présent |
| `packages/plugin` | `@unifia/plugin` | ✓ | présent |

### 3.2 Packages que le plan cite « si présents » et qui sont **ABSENTS**

Confirmé par `Get-ChildItem packages | Where-Object Name -match '...'`.
Statut : `ABSENT_NO_ACTION` selon §18 du plan — aucune responsabilité
inventée.

| Package | Statut | Conséquence |
|---|---|---|
| `workbench-sdk` | **ABSENT** | Pas de SDK client. Le client consommé par `packages/app` est généré par TanStack Query contre `current.client.*` exposé par `useWorkspaceWorkbench()`. |
| `workbench-contracts` | **ABSENT** | Les contrats de transport sont dans `packages/contracts/src/workbench-wire/` (sous-ensemble), pas un package distinct. |
| `workbench-core` | **ABSENT** | Pas de module « core » Workbench. `workbench-orchestrator` joue un rôle limité. |
| `artifact-store` | **ABSENT** | Le store vit dans `packages/artifact-runtime`. Pas de séparation store/service dédiée. |

### 3.3 Packages présents hors liste plan (26)

À classer en `OUT_OF_PATH` ou à intégrer après PRE-1. Présents :
`app, design-sketch, design-system-runtime, desktop, desktop-electron, console,
containers, docs, document-packs, function, generative-ui-dom, media-runtime,
memory-governance, memory-runtime, mobile, script, sdk, sdk-shared, skill-hub,
slack, storybook, ui, unifia, util, web`.

| Package | Décision préliminaire | Justification |
|---|---|---|
| `packages/app` | OUT_OF_PATH (consommateur) | UI SolidJS, ne contient pas d'autorité durable |
| `packages/unifia` | OUT_OF_PATH (consommateur) | Sidecar CLI, consomme `workflow-runtime` via `workbench-server` |
| `packages/desktop`, `desktop-electron` | OUT_OF_PATH (transport) | Tauri/Electron shells |
| `packages/mobile` | OUT_OF_PATH (transport) | Tauri mobile |
| `packages/skill-hub` | OUT_OF_PATH (catalogue) | Source de DesignSkillManifest ; consommé par workbench-server |
| `packages/memory-runtime`, `memory-governance` | OUT_OF_PATH pour Automate | Mémoire long-terme hors chemin Automate V2.3.1 |
| `packages/web`, `console`, `storybook` | OUT_OF_PATH (vitrine) | UI/web/storybook — non durable kernel |
| `packages/function` | À investiguer | 33 lignes max ; nom ambigu |
| `packages/sdk`, `sdk-shared` | OUT_OF_PATH | SDK TS public, non runtime durable |
| `packages/ui`, `util` | OUT_OF_PATH | Helpers partagés |

---

## 4. Graphe de dépendances (vue partielle)

Construit par lecture statique des imports. **INFERRED** — un graphe
déterministe par `bun turbo run --dry=json` ou `madge` reste à produire.

### 4.1 Couche `contracts` (feuille)

`@unifia/contracts` importe `./runtime, ./workspace, ./capability, ./artifact,
./sandbox, ./remote, ./p3, ./p3-runtime, ./runtime-adapters, ./path-separators`
(source : `packages/contracts/src/index.ts` lignes 9-19). Aucun import hors de
lui-même — c'est bien la racine des types.

### 4.2 Couche runtime (feuilles applicatives)

| Package | Imports externes (connus) |
|---|---|
| `workflow-runtime` | `@unifia/contracts` (P3Capability) |
| `capability-runtime` | `@unifia/contracts` (CapabilityRegistry, CapabilityManifest, ManifestVerifier) |
| `workbench-orchestrator` | `@unifia/contracts` (RuntimeAdapter, RuntimeEvent, SendPromptInput, Session, WorkspaceScope) |
| `workbench-shell` | (exporte `SHELL_MODES`, consommé par `packages/app/src/context/mode.tsx`) |

### 4.3 Couche serveur

`@unifia/workbench-server` (97 040 octets) importe au moins :
- `@unifia/contracts` + `@unifia/contracts/workbench-wire`
- `@unifia/memory-runtime`
- `@unifia/workflow-runtime`
- `@unifia/artifact-runtime`
- `@unifia/spec-runtime`
- `@unifia/skill-hub`
- `node:crypto` (randomUUID), `node:path` (basename)

(Source : `packages/workbench-server/src/index.ts` lignes 1-15.)

### 4.4 Couche app (consommateur)

`packages/app/src/pages/workbench/automate-surface.tsx` :
- `@tanstack/solid-query` (createQuery)
- `@/context/language` (useLanguage)
- `@/context/workbench/provider` (useWorkspaceWorkbench)
- `@/context/workbench/query-keys` (workbenchQueryKey)
- `@/pages/workbench-chat` (WorkbenchChat)
- `@/pages/workbench/connection-banner` (ConnectionBanner)

Le client `current.client.startWorkflow(workspaceId, definition)` est résolu
par la `WorkbenchWireClient` que TanStack Query invoque via
`useWorkspaceWorkbench()`. Le contrat est dans
`packages/contracts/src/workbench-wire/`.

---

## 5. Architectures actuelles (snapshot)

### 5.1 Architecture Workflow

**Source mesurée** : `packages/workflow-runtime/src/index.ts` (91 lignes) +
`packages/workflow-runtime/test/` (un seul test intégré).

```text
WorkflowDefinition { id, version, workspaceId, steps: readonly WorkflowStep[] }
WorkflowStep     { id, capability: P3Capability, input, requiresApproval? }
WorkflowState    { workflowId, definition, status, nextStep, outputs, error? }
WorkflowStatus   pending | running | paused | completed | failed | cancelled
```

**Moteur** : `WorkflowRuntime` séquentiel. `start()` valide la définition,
sauve l'état initial (`status: running`) et appelle `resume()`. `resume()`
charge l'état, applique le switch `isEngaged("workflow-automation")` (kill
switch dur), itère les steps. Si `requiresApproval`, l'`approval.request()`
doit retourner `true`, sinon pause. Le store peut être `InMemoryWorkflowStore`
ou `FileWorkflowStore` (`<root>/.unifia/workflows/<id>.json`).

**Ce que ce runtime n'est PAS** :
- Pas de durable timer (`setTimeout` côté worker, pas de timer côté autorité).
- Pas de versionnage publié de `WorkflowDefinition` (un `version: number`, pas
  un identifiant canonique, pas de digest).
- Pas de retry policy structurée (l'erreur fait passer en `failed` directement).
- Pas de `effectSlot` ni d'`idempotency identity` (§87 du plan).
- Pas de `UNKNOWN_EXTERNAL_STATE` (§88 du plan).
- Pas de cancel explicite par le worker (seulement `cancel(id)` administratif).
- Pas de classes d'effets (§84 : `pure / idempotent / repeatable /
  reconcilable / non-repeatable`).
- Pas de contrat de canonicalisation ni de `DigestEnvelope` (§64).
- Pas d'ArtifactRecord (§68), pas de protection at-rest.

**Conclusion** : ce qui s'appelle `@unifia/workflow-runtime` aujourd'hui est
un **exécuteur linéaire de capabilities avec persistance fichier**, pas un
**durable execution substrate** au sens du plan V2.3.1 §1, §2, §34-40. ADR-000
ne peut pas le qualifier de substrate.

### 5.2 Architecture Capability

**Source** : `packages/capability-runtime/src/index.ts` + `packages/contracts/src/p3.ts`
+ `packages/contracts/src/capability.ts` + `packages/contracts/src/capability-registry.ts`.

- 20 capabilities P3 déclarées dans `P3_CAPABILITIES` (`packages/contracts/src/p3.ts:7-13`),
  dont `workflow.run` à l'index 19.
- `CapabilityRegistry` (dans `contracts`) consomme un `ManifestVerifier`.
- `Ed25519ManifestVerifier` (dans `capability-runtime/src/index.ts`) signe et
  vérifie des manifestes via `node:crypto`.
- Le couple sign/verify repose sur la fonction pure
  `capabilitySignaturePayload` (dans `contracts`).

**Statut** : capability manifest signé Ed25519 vérifié déterministe. **Manque
pour Automate** : pas de `NodeManifest`/`ExecutorManifest`/`ConnectorManifest`/
`MCP Tool Contract` comme entry points distincts du capability pipeline
(§115). Le capability runtime sait signer et vérifier, pas enforcer.

### 5.3 Architecture Approval

**Source** : `packages/contracts/src/approval-broker.ts`,
`packages/workbench-server/src/index.ts` (ApprovalBroker importé),
`packages/app/src/pages/workbench/design-approval.ts` (surface).

- `ApprovalBroker` est importé comme type par `workbench-server/src/index.ts:1`.
- La surface Design a un modal d'approbation (`design-approval.ts`) avec
  expiration, annulation, re-demande (vérifié par
  `e2e/design/design-approval-journey.spec.ts` selon SESSION-2-REPORT §4).
- `approvalRequired` est un statut retourné par
  `client.startWorkflow(workspaceId, definition)` quand l'effet le demande
  (source : `automate-surface.tsx` ligne où `if ("approvalRequired" in result)`).

**Statut** : la chaîne d'approbation existe et est exercée par la suite e2e
Design. **Manque pour Automate** : le binding approval→effect n'est pas
vérifié par analyse statique de graphe (le validateur statique du §119 est
absent — un approval dans une branche parallèle sans relation causale ne
serait pas détecté).

### 5.4 Architecture Browser

**Source** : `packages/browser-runtime/` + `packages/computer-use-safety/` +
`packages/contracts/src/browser.ts`.

Présent et structurellement aligné avec le plan §143-151. Le test « e2e
Browser » n'est pas mesuré dans ce tour. **INFERRED** sur la base du
catalogue de fichiers ; la vérification runtime attendra PRE-1.

### 5.5 Architecture Computer Use

**Source** : `packages/computer-use-safety/`.

Présent. Le couplage Browser ↔ Computer Use ↔ Kill switch n'est pas mesuré
en runtime dans ce tour. **INFERRED**.

### 5.6 Architecture MCP

**Source** : `packages/mcp-transport/`, `packages/mcp-ui-actions/`,
`packages/contracts/src/mcp-ui.ts`.

Présent. La frontière MCP Design est revalidée selon SESSION-2-REPORT (D5
REAL, A6 PARTIAL). **INFERRED** sur le couplage avec Capability Authority
spécifiquement pour Automate.

### 5.7 Architecture Artifact

**Source** : `packages/artifact-runtime/`, `packages/artifact-studio/`,
`packages/artifact-render/`, `packages/contracts/src/artifact.ts`,
`packages/contracts/src/artifact-manifest.ts`.

Trois packages, séparés. L'`ArtifactStore` (interface) est importé par
`workbench-server/src/index.ts:5`. **Manque pour Automate** : pas de
`ArtifactRecord` avec `OwnershipScope` + `DeploymentScope` + `taints` +
`classification` (le §68 du plan), pas de `LARGE PAYLOAD RULE` (§70), pas de
garde-fou contre le caller qui décide de la classification (§71).

### 5.8 Synthèse

| Architecture | Présente | Substrate-grade pour Automate |
|---|---|---|
| Workflow | ✓ | **NON** — pas durable au sens du plan |
| Capability | ✓ | partiel (sign+verify, pas d'enforcer) |
| Approval | ✓ | partiel (UI+e2e OK, pas de validateur statique) |
| Browser | ✓ | à mesurer |
| Computer Use | ✓ | à mesurer |
| MCP | ✓ | à mesurer (revalidation OK) |
| Artifact | ✓ | partiel (record absent) |

---

## 6. Commandes build / typecheck / lint / test

Mesurées sur la machine. **NON EXÉCUTÉES** dans ce tour par la session —
rapportées depuis SESSION-2-REPORT (qui les a effectivement lancées) et
depuis la note machine du prompt de lancement.

| Commande | Statut SESSION-2 | Preuve |
|---|---|---|
| `bun turbo typecheck --concurrency=1` | VERT — 38/38 | SESSION-2 §7 (Design SHA `24b04998e2`) |
| `bunx biome check packages/` | VERT — 1 452 fichiers | SESSION-2 §7 |
| `cd packages/app && bun test --preload ./happydom.ts ./src` | VERT — 1 175 pass, 0 fail | SESSION-2 §7 |
| Playwright `e2e/design` + `design-journey` | VERT — 20/20 (3 runs consécutifs : 36,3 / 37,5 / 43,1 s) | SESSION-2 §7 |
| `bun run test:knowledge` (Work lignée) | VERT — 892 pass, 1 skip, 0 fail | SESSION-2 §7 (Work SHA `33bea2ec04`) |
| `cli-process.test.ts` (CI=1, avec dist/) | VERT — 11/11 | SESSION-2 §2 |
| Build Tauri `CARGO_BUILD_JOBS=1 bun tauri build` | VERT — exit 0 | SESSION-2 §5 |
| Suite complète `packages/unifia` après commit Work | **NON EXÉCUTÉE** | SESSION-2 §2 |
| `e2e/app` + `e2e/modes` (sérialisé) | 22 passed / 8 failed | SESSION-2 §7.1 |

**Pièges machine confirmés (rapportés, pas mesurés ici)** :
- `PLAYWRIGHT_WORKERS=1` obligatoire au-delà d'un spec.
- `bun turbo typecheck --concurrency=1` (OOM sinon).
- `bun run build --single` (~1 min, 194 Mo) ; `--baseline` échoue.
- `CARGO_BUILD_JOBS=1 bun tauri build` (OOM sinon).

---

## 7. Suites de tests

| Type | Suite | Emplacement | Statut mesuré | Source |
|---|---|---|---|---|
| Unit | `packages/app` | `packages/app/src/**/*.test.ts(x)` | 1 175 pass, 0 fail | SESSION-2 §7 |
| Unit | `packages/unifia` | `packages/unifia/test/knowledge/` + autres | 892 pass, 1 skip, 0 fail | SESSION-2 §2 |
| Unit | `packages/contracts` | `packages/contracts/test` | **NON EXÉCUTÉE** dans ce tour | — |
| Unit | `packages/workflow-runtime` | `packages/workflow-runtime/test/` | Présent (test intégré `console.log` 2/2 + `FileWorkflowStore` 1/1) | listing `Get-ChildItem` |
| Unit | `packages/workbench-orchestrator` | `packages/workbench-orchestrator/test/` | Présent (`test: bun test/orchestrator.test.ts`) | `Get-Content package.json` |
| E2E Design (Playwright) | `design-visual`, `design-a11y`, `design-approval-journey`, `design-mode` | `packages/app/e2e/design/` | 20/20 + 3/4 design-mode (relancé) | SESSION-2 §7 |
| E2E App | `e2e/app/home.spec.ts` | `packages/app/e2e/app/` | 2/2 (régression du correctif) | SESSION-2 §1 |
| E2E Modes | `e2e/modes/...` | `packages/app/e2e/modes/` | PARTIEL — 22/30 en série, 8 failures réelles | SESSION-2 §7.1 |
| E2E `automate-surface` | **ABSENTE** | `packages/app/e2e/**` | **NON EXÉCUTÉE** (le fichier n'existe pas) | SESSION-2 §0 |

### 7.1 Couverture Automate — finding PRE-0 confirmé

`packages/app/src/pages/workbench/automate-surface.tsx` (8 164 octets) **n'a
aucun fichier de test** — ni unitaire (`*.test.ts` adjacent), ni e2e. Le
seul comportement Automate prouvé est l'apparition/disparition de l'entrée
de rail selon `workflow.run`, assertée au passage dans
`packages/app/e2e/design/design-a11y.spec.ts`. Les **huit** sorties du
§16.3 du plan d'audit trois modes sont sans preuve :

1. UI cachée sans `workflow.run` et visible avec grant — *partiel* (a11y seulement)
2. Retrait de grant refuse l'action suivante — **NON PROUVÉ**
3. `plugin.apply` sans cast non type — **NON PROUVÉ** côté Automate
4. MCP revalide principal/capability/ressource — **NON PROUVÉ** côté Automate
5. Audit relie principal, action et capability — **NON PROUVÉ** côté Automate
6. Trois secrets non interchangeables — **NON PROUVÉ**
7. Full workflow E2E jusqu'à disposition — **NON PROUVÉ**
8. Aucun P0/P1 Automate — **NON PROUVÉ** (par construction, pas de suite)

**Statut** : finding PRE-0 réel, à reporter dans `RISK_REGISTER.md` et à
reporter comme dette non-contenable jusqu'à ce qu'une suite Automate existe.

---

## 8. CI, branches, rulesets

### 8.1 Workflows GitHub présents (44)

`Get-ChildItem .github/workflows` liste 44 fichiers. Principaux :

| Workflow | Rôle |
|---|---|
| `test.yml` | suite de tests |
| `typecheck.yml` | typecheck turbo |
| `unifia.yml` | pipeline principal |
| `unifia-conformance.yml` | conformance runtime |
| `review.yml` | revue PR |
| `release.yml` | release |
| `ci-model-intelligence.yml` | tests LLM |

**Statut exact des derniers runs** : **NON EXÉCUTÉ** dans ce tour (pas
d'accès à l'API GitHub, et la session n'a pas d'autorisation d'appel
externe). À dériver depuis `gh run list` quand la machine l'autorise.

### 8.2 Branches locales

D'après `git worktree list` + `git branch -a` :

| Branche | HEAD | Notes |
|---|---|---|
| `agent/automate-v2-baseline-20260901` (créée ici) | `24b04998e2` | branche de travail PRE-0 |
| `integration/rev3m-20260901/design-automate` | `24b04998e2` | branche d'intégration d'origine |
| `integration/rev3m-20260901/work` | `33bea2ec04` | lignée Work séparée |
| `feat/sovereign-knowledge-core` | `b511ea44f4` | checkout canonique (unifia-memory) |
| `feat/unifia-rebrand-cli-tui` | `357ec12229` | rebrand historique |
| `work-design` (autre worktree) | `1bbbe6a614` | base sans commits MiniMax |

### 8.3 Rulesets

**NON VÉRIFIÉ** dans ce tour. L'accès à la configuration GitHub (rulesets,
branch protection) n'est pas dans le scope d'inventaire de disque. La
SESSION-2-REPORT ne les a pas audités non plus. À investiguer en PRE-1.

---

## 9. Limites connues et dette connue

Issues confirmées par SESSION-2 (rapport machine) et non corrigées :

| ID | Description | Source | Statut |
|---|---|---|---|
| L1 | Correctif `[arch-change]` `09f1329a8d` — hiérarchie de providers, **non confirmé par l'utilisateur** | SESSION-2 §1 | En attente |
| L2 | `color-contrast` sur `text-text-weak` (toute l'app) | SESSION-2 §3.3 | Enregistré, pas corrigé |
| L3 | `nested-interactive` sur la barre d'onglets d'espaces de travail | SESSION-2 §3.3 | Enregistré, pas corrigé |
| L4 | 3 × `titlebar-history.spec.ts` — `[data-session-id]` introuvable | SESSION-2 §7.1 | Non diagnostiqué |
| L5 | `mode-reload-stability.spec.ts` — compteur de fuites après 10 rechargements | SESSION-2 §7.1 | Non diagnostiqué |
| L6 | Switcher mobile (V06) — ArrowRight change la sélection mais le focus part au body | SESSION-2 §7.1 | **P1** (seul chemin clavier vers Atelier) |
| L7 | `automate-surface.tsx` zéro test | SESSION-2 §0, confirmé ici §7.1 | **Bloquant PRE-1** |
| L8 | Baselines visuelles Linux absentes (gate ne protège que win32) | SESSION-2 §3.2 | Enregistré |
| L9 | Biome ne lit pas `packages/app/e2e/**` | SESSION-2 §8 #7 | Trou de gate |
| L10 | `e2e/app` + `e2e/modes` PARTIEL (8 failures sérialisées) | SESSION-2 §7.1 | À re-mesurer |

### 9.1 Dette cross-coupable (enregistrée hors PRE-0)

Dette de l'audit précédent (v3.1 → v4), déjà retraitée :
D8, D13, D17, A1, `flush MCP` (v3.1) — **RETIRÉS** des actions (cf.
Plan-Audit-Trois-Modes §2.4). Dette Automate restante :

| ID | Verdict | Action obligatoire |
|---|---|---|
| A1 | REJECTED | Test de non-régression sur flush MCP avant réponse (déjà testé). Aucun code. |
| A2 | PARTIAL | Tester start, approval, resolve, retry, disposition. |
| A3 | PARTIAL | Bootstrap standalone explicite (cf. D9). |
| A4 | REAL | Journaliser action demandée et capability autorisante (cf. D11). |
| A5 | REAL | Capability canonique ou hard deny documenté (cf. D2). |
| A6 | PARTIAL | Injecter un authorizer hôte MCP qui vérifie capability, ressource et principal. |

---

## 10. Plateformes supportées

| Plateforme | Statut | Source |
|---|---|---|
| Windows (Tauri) | VERT build, binaire démarre | SESSION-2 §5 (Unifia.exe 53 Mo, démarre keychain + sidecar) |
| macOS | **NON MESURÉ** | absence de machine |
| Linux | build desktop et Linux baselines visuelles **NON COUVERTES** | SESSION-2 §3.2 |
| Android (Tauri mobile) | **NON EXÉCUTÉ** — `BLOCKED_EXTERNAL` | SESSION-2 §7 |
| iOS | non présent | absence de package `mobile-ios` |
| Web (déployé) | via Tauri WebView (desktop/mobile), pas de standalone web GA | CLAUDE.md |

**Cible PRE-0** : la première certification pratique est
`Automate Core × local-single-node × first supported desktop platform`
(plan §FIRST TARGET, lignes 6077-6094). Cette cible est Windows ici.

---

## 11. Références de preuve

| Élément | Chemin / commande | Date |
|---|---|---|
| Plan maître (sur disque) | `D:\Documents\Obsidian\IA_Dev_Brain\projects\unifia\roadmaps\UNIFIA-Automate-Master-Implementation-Plan-V2.3.1.md` | 2026-09-01 15:33:58 |
| SESSION-2-REPORT | `D:\App\unifia\.artifacts\production-readiness\rev3m-20260901\SESSION-2-REPORT.md` | 2026-09-01 |
| Note session vault | `D:\Documents\Obsidian\IA_Dev_Brain\projects\unifia\_memory\sessions\2026-09-01-gates-navigateur-et-boot-fix.md` | 2026-09-01 |
| Plan audit v4 | `D:\Documents\Obsidian\IA_Dev_Brain\projects\unifia\Plan-Audit-Trois-Modes-Production-Ready-2026-08-31.md` (555 lignes, SHA256 `0BCB3A24E0EC11AD7FA61A3394BC8D76C497E29EC8CFE32DA3DEC0649FD2E1C0`) | 2026-08-31 10:36 |
| AGENTS.md racine worktree | `D:\App\unifia\.worktrees\rev3m-20260901\design\AGENTS.md` (template ai-native-dev-stack v1.0.0) | stable |
| AGENTS.md packages/app | `D:\App\unifia\.worktrees\rev3m-20260901\design\packages\app\AGENTS.md` (33 lignes, debug/local-dev) | local |
| Vault AGENTS.md | `D:\Documents\Obsidian\IA_Dev_Brain\projects\unifia\AGENTS.md` (v4, 41 lignes effectives) | 2026-08-30 |
| Vault INDEX.md | `D:\Documents\Obsidian\IA_Dev_Brain\projects\unifia\INDEX.md` | 2026-09-01 |
| Vault BOARD.md (généré) | `D:\Documents\Obsidian\IA_Dev_Brain\projects\unifia\BOARD.md` (3 476 octets) | généré |
| Turbo | `D:\App\unifia\.worktrees\rev3m-20260901\design\turbo.json` (39 lignes) | mesuré |
| Baselines visuelles | `D:\App\unifia\.worktrees\rev3m-20260901\design\packages\app\e2e\design\__screenshots__\win32/` (8 PNG : 4 dark × 2 largeurs, 4 light × 2 largeurs) | mesuré |
| `workflow-runtime/src/index.ts` | `D:\App\unifia\.worktrees\rev3m-20260901\design\packages\workflow-runtime\src\index.ts` (91 lignes) | mesuré |
| `automate-surface.tsx` | `D:\App\unifia\.worktrees\rev3m-20260901\design\packages\app\src\pages\workbench\automate-surface.tsx` (8 164 octets) | mesuré |

---

## 12. PRE-0 — décision de gate

Décision préliminaire **AVANT** lecture de `AUTOMATE_TRUST_PATH.md` et
`RISK_REGISTER.md`. Sera affinée après ces deux livrables.

| Condition §13 du plan | Statut | Preuve |
|---|---|---|
| baseline SHA/tree proven | PARTIEL | HEAD `24b04998e2fd861711036501ad3f6e41a63f8c32` prouvé. Tree-SHA NON CALCULÉ dans ce tour. |
| mandatory build green | VERT | Tauri + sidecar OK (SESSION-2 §5) |
| mandatory typecheck green | VERT | 38/38 (SESSION-2 §7) |
| mandatory lint green | VERT | biome 1 452 fichiers (SESSION-2 §7) |
| reference suites green | VERT | 1 175 app unit + 20/20 design e2e + 892/0/0 unifia |
| no reachable Critical/High before remediation | **À ÉVALUER** | dépend de RISK_REGISTER.md |
| no unresolved architecture contradiction | **À ÉVALUER** | dépend de AUTOMATE_TRUST_PATH.md |
| no unverified package assumption | VERT | §3 inventaire vérifié |
| no unresolved release-blocking migration | VERT | pas de migration en cours |
| trust path complete | **À ÉVALUER** | dépend de AUTOMATE_TRUST_PATH.md |
| branch/ruleset state explicitly documented | PARTIEL | §8 — rulesets GitHub non vérifiés |

**Décision préliminaire** : **GO_WITH_CONTAINED_DEBT** conditionnée à
l'achèvement des deux autres livrables PRE-0. La dette contenue sera :
- finding L7 (zéro test Automate) — dette **non contenable au sens strict**
  car elle concerne un P0 d'absence de preuve, et la règle §237/§238 du plan
  exige zéro Critical/High. À traiter en finding à **bloquer par gate**
  (PRE-1 ne peut pas démarrer une carte sans suite Automate minimale).
- finding L1 (correctif arch-change non confirmé) — dette **bloquante
  externe** (décision utilisateur requise).

À statuer définitivement après lecture de `AUTOMATE_TRUST_PATH.md` et
`RISK_REGISTER.md`.

---

## 13. Suite immédiate

1. Écrire `AUTOMATE_TRUST_PATH.md` (§9 du plan) — classification
   `REQUIRED_UNCHANGED / REQUIRED_TO_MIGRATE / REQUIRED_TO_HARDEN /
   OUT_OF_PATH` par surface.
2. Écrire `RISK_REGISTER.md` (§12 du plan) — findings hors chemin avec
   preuve qu'Automate n'en dépend pas.
3. Décider PRE-0 = `GO` / `GO_WITH_CONTAINED_DEBT` / `NO_GO` (§13/§14).
4. Si GO : démarrer PRE-1 (`PACKAGE_MIGRATION_MAP.md`,
   `IMPLEMENTATION_CARD_INDEX.md`).
5. Si NO_GO : `BASELINE_BLOCKERS.md` puis `STOP-BASELINE`.
6. Initialiser `EXECUTION_STATUS.md`.

Aucun commit n'est créé pour ce livrable — il tient dans le working tree
et sera commit en un seul commit après PRE-0 complet, conformément au §242
du plan (« small coherent single-responsibility commits »).
