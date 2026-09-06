<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# THREAT MODEL V1 — UNIFIA AUTOMATE

> Statut : **V1 PINNED** (livrable §22-23 du plan)
> Date : 2026-09-01T16:30+02:00
> Source : `BASELINE.md`, `AUTOMATE_TRUST_PATH.md`, `RISK_REGISTER.md`,
> `IMPLEMENTATION_CARD_INDEX.md`.
> Méthodes : STRIDE + agentic AI threats + data-flow threats +
> supply-chain threats (plan §22).

**Règles** :
- Chaque menace = `ID · STRIDE class · trust boundary · asset ·
  threat actor · attack vector · impact · likelihood · mitigation ·
  test evidence`.
- Pas d'agent d'IA comme security authority (plan §4).
- Les mitigations ne sont **pas** des promesses de GA — elles sont des
  exigences de design que les ADR doivent rendre.

---

## 0. Trust boundaries (plan §23)

Identifiés par lecture du code (`workbench-server/src/index.ts`,
`workflow-runtime/src/index.ts`, `automate-surface.tsx`, `mode.tsx`,
`p3.ts`).

| ID | Boundary | Source / côté |
|---|---|---|
| TB-1 | User | UI (`packages/app`) |
| TB-2 | Work | contexte Work (mode Work) |
| TB-3 | AI Compiler | tool de compilation (futur) |
| TB-4 | Workflow Kernel | `workflow-runtime` (à rendre substrate-grade) |
| TB-5 | Durable Substrate | le substrate choisi en ADR-000 |
| TB-6 | Worker | runtime des steps |
| TB-7 | Sandbox | isolation Code/Shell (post-M3) |
| TB-8 | Capability Authority | `capability-runtime` + enforcer |
| TB-9 | Policy | ADR-009 |
| TB-10 | Approval | `ApprovalBroker` |
| TB-11 | Secret Broker | R-012 (à confirmer) |
| TB-12 | Key Authority | R-012 (à confirmer) |
| TB-13 | Artifact Store | `artifact-runtime` |
| TB-14 | Connector | `connectors/` (INFERRED, à mesurer) |
| TB-15 | MCP Server | `mcp-transport` |
| TB-16 | LLM Provider | cloud ou local |
| TB-17 | Browser | `browser-runtime` |
| TB-18 | Website | Internet |
| TB-19 | Desktop App | `desktop-runtime` |
| TB-20 | Database | SQLite (Drizzle) — INFERRED, à mesurer |
| TB-21 | Git | (pour GitOps, post-M3) |
| TB-22 | Webhook Sender | externe |
| TB-23 | CI/CD | `unifia.yml` etc. |
| TB-24 | runtime dependencies | npm/bun |

---

## 1. STRIDE par composant

### 1.1 Workflow Kernel (TB-4 + TB-5)

| ID | Classe | Composant | Acteur | Vecteur | Impact | Likelihood | Mitigation | Test |
|---|---|---|---|---|---|---|---|---|
| TM-W-01 | **Tampering / Elevation** | `WorkflowRuntime.start` switch | opérateur hostile ou bug | `isEngaged("workflow-automation")` retourne `false` par erreur → exécute quand même | exécution non autorisée | medium | (1) ADR-000 substrate-grade : le switch doit être enforced côté kernel, pas en lecture seule. (2) Test : `isEngaged=true` lève sur `start`. | tests `workflow-runtime/test/` |
| TM-W-02 | **Repudiation** | state file (`FileWorkflowStore`) | utilisateur local | modification manuelle du fichier JSON | run redémarre dans un état incohérent | medium | (1) checksum par write (MD-? future). (2) Migration script (ADR-016 si retenu). | test corruption recovery |
| TM-W-03 | **Information Disclosure** | outputs des steps | autre tenant | fuite cross-tenant via `WorkspaceId` | lecture d'outputs d'un autre workspace | medium | (1) `WorkbenchOrchestrator` re-filtrer sur `workspaceId` après `listSessions` (déjà présent, ligne 67 du code). (2) Test isolation scope (C-PRE1-05). | C-PRE1-05 |
| TM-W-04 | **Denial of Service** | boucle infinie | auteur malveillant d'un `WorkflowDefinition` | `while` sans `maxIterations` | CPU/mémoire épuisés | high | (1) Plan §58 : `maxIterations`, `maxDuration`, `maxCost` obligatoires. (2) ADR-002 doit les rendre non-overrideable côté IA. | test bornes |
| TM-W-05 | **Elevation of Privilege** | mutation de `WorkflowVersion` | auteur malveillant | modification post-publication | workflow publié change de comportement | low (si immutable enforced) | (1) Plan §46 : `WorkflowVersion` publiée = immutable. (2) ADR-001 (digest) + ADR-002. | test published == immutable |

### 1.2 Capability Authority (TB-8)

| ID | Classe | Composant | Acteur | Vecteur | Impact | Likelihood | Mitigation | Test |
|---|---|---|---|---|---|---|---|---|
| TM-C-01 | **Spoofing** | `CapabilityRegistry` non vérifié | code malveillant | injection d'un `CapabilityManifest` non signé | capabilities accordées à un acteur non autorisé | medium | (1) `createSecureCapabilityRegistry` doit être l'unique entrée. (2) ADR-002 exige `NodeManifest`/`ExecutorManifest`/`ConnectorManifest`/`MCP Tool Contract` comme entry points. (3) `global auto approval is forbidden` doit être enforcé côté serveur, pas seulement déclaré en TS. | test absence de bypass |
| TM-C-02 | **Tampering** | clé Ed25519 du registry | attaquant local | rotation de clé silencieuse | nouveaux manifests signés par une clé compromise | low | (1) ADR-010 : rotation, révocation, log. (2) Le `keyRef` doit être typé (cf. R-012). | test rotation |
| TM-C-03 | **Elevation** | capability `workflow.run` | attaquant | grant sans approbation | un non-autorisé lance un workflow | medium | (1) ADR-009 (Policy) doit exiger une approbation explicite pour `workflow.run` la première fois. (2) Mode.tsx rail Automate visible seulement si grant. | test rail — R-001 à confirmer |

### 1.3 Approval (TB-10)

| ID | Classe | Composant | Acteur | Vecteur | Impact | Likelihood | Mitigation | Test |
|---|---|---|---|---|---|---|---|---|
| TM-A-01 | **Tampering / Elevation** | approval dans une branche parallèle | auteur de `WorkflowDefinition` | approbation dans une branche qui ne cause pas l'effet réel | approbation capturée mais effet différent exécuté | medium | (1) Plan §119 : le static validator prouve que l'approval bind l'effet exact. (2) ADR-002 (IR) + ADR-004 (history) doivent rendre cette preuve. | test static binding |
| TM-A-02 | **Repudiation** | cancel sans log | utilisateur | clic sur Cancel sans broker call | approbation pendante indéfiniment | low (corrigé) | (1) SESSION-2 §4 : `cancelApproval("apr-1")` au broker, e2e vert. (2) Pas de régression. | e2e design-approval-journey |
| TM-A-03 | **Spoofing** | approbateur = acteur | self-approval | un user approuve son propre effet | bypass de séparation | medium | (1) Plan §120 : `no self approval` obligatoire. (2) ADR-005 (artifact taint) + ADR-009 (Policy). | test self-approval refuse |

### 1.4 Secret Broker (TB-11, à confirmer R-012)

| ID | Classe | Composant | Acteur | Vecteur | Impact | Likelihood | Mitigation | Test |
|---|---|---|---|---|---|---|---|---|
| TM-S-01 | **Information Disclosure** | secret en clair dans `history` | exfiltration | `WorkflowState.outputs` contient un secret | secret persisté en clair | high (si broker absent) | (1) Plan §123 : `CredentialRef`/`SecretRef` only. (2) ADR-010 + ADR-005 (`ArtifactRef` pour gros outputs). (3) Canary gate `secret_canary` (plan §125). | canary gate |
| TM-S-02 | **Information Disclosure** | secret en clair dans `logs` | logs exfiltrés | logger écrit le credential body | secret dans les logs | medium | (1) Plan §125 : surfaces interdites = `history, logs, traces, LLM, model-visible DOM, model-visible accessibility, model-visible screenshot, artifacts, debugger, audit export`. (2) ADR-010 + redaction library. | canary gate |
| TM-S-03 | **Information Disclosure** | secret au LLM | prompt injection | `inputs` d'un step contient un secret envoyé au LLM | LLM voit le secret | high | (1) Plan §123 : workflow ne voit que les `Ref`. (2) ADR-010 enforcement. (3) Taint tracking (plan §121-122). | test no plaintext to LLM |

### 1.5 Artifact Store (TB-13)

| ID | Classe | Composant | Acteur | Vecteur | Impact | Likelihood | Mitigation | Test |
|---|---|---|---|---|---|---|---|---|
| TM-AR-01 | **Tampering** | caller fixe `classification` | caller malveillant | API store accepte `classification: "internal"` sur un artefact `secret` | artefact downgrade de classification | medium | (1) Plan §71 : caller ne peut pas fixer `classification, taint, ownership, environment`. (2) ADR-005. | test caller control refuse |
| TM-AR-02 | **Tampering** | caller forge `protectionEnvelope` | caller | API store accepte un envelope forgé | chiffrement auto-signé | medium | (1) Plan §74 + §75 : `AtRestProtectionEnvelope` doit être construit par le store, pas le caller. (2) ADR-005 + ADR-010. | test envelope forger refused |
| TM-AR-03 | **Information Disclosure** | gros output dans history | auteur | step retourne un buffer de 1 Go | history sature le disque | medium | (1) Plan §70 : `LARGE PAYLOAD RULE` (ArtifactRef au lieu de bytes). (2) ADR-005. | test threshold |

### 1.6 Network / Browser / Computer Use

| ID | Classe | Composant | Acteur | Vecteur | Impact | Likelihood | Mitigation | Test |
|---|---|---|---|---|---|---|---|---|
| TM-N-01 | **Information Disclosure** | SSRF via HTTP executor | auteur | `http://169.254.169.254/...` (cloud metadata) | exfiltration de credentials cloud | high | (1) Plan §111-112 : IPv4/IPv6/loopback/private/link-local/metadata/DNS rebinding/redirect. (2) ADR-023 (Network Authority). | SSRF corpus (plan §147) |
| TM-N-02 | **Spoofing** | redirect non revalidé | serveur | `301` vers une cible interne | SSRF après redirect | medium | (1) Plan §112 : chaque redirect revalidé comme nouvelle destination. (2) ADR-023. | test redirect revalidé |
| TM-N-03 | **Tampering** | Browser repose seulement sur Playwright | exfiltration | contournement de Playwright via les couches OS | bypass isolation | low (cible première : pas de Browser GA) | (1) Plan §144 : Kernel → Browser Worker → isolated process/container/VM → Network Authority + OS enforcement. (2) ADR-013 + ADR-024. (3) Browser GA non exigé pour la cible première. | computer use corpus (plan §227) |
| TM-N-04 | **Tampering** | prompt injection via page | LLM | page web contient une instruction hostile | LLM tente une action interdite | high | (1) Plan §150 : web content = `untrusted_external`. (2) ADR-013, ADR-014, ADR-024. | prompt injection corpus |
| TM-N-05 | **Information Disclosure** | secret dans screenshot | screenshot | page d'auth avec secret rendu | secret dans le screenshot | medium | (1) Plan §148 : secret hors LLM, model-visible DOM, accessibility snapshot, model-visible screenshot. (2) ADR-013 + ADR-024. | computer use corpus |

### 1.7 MCP / Connector (TB-14, TB-15)

| ID | Classe | Composant | Acteur | Vecteur | Impact | Likelihood | Mitigation | Test |
|---|---|---|---|---|---|---|---|---|
| TM-M-01 | **Elevation** | MCP stdio hérite de `process.env` | serveur | MCP reçoit `GITHUB_TOKEN` en env | connector utilise un token non autorisé | medium | (1) Plan §131 : MCP stdio ne reçoit PAS `process.env`, SSH agent, Git credentials, cloud credentials, user filesystem. (2) ADR-011 + ADR-024. | test env clean |
| TM-M-02 | **Tampering** | MCP distant bypass Network Authority | serveur | MCP distant ouvre une connexion non auditée | réseau non tracé | medium | (1) Plan §132 : remote MCP traverse Network Authority + auth + schema + Capability + Policy. (2) ADR-011 + ADR-023. | test MCP distant traverse |
| TM-M-03 | **Elevation** | connector auto-claim capabilities | connector | `ConnectorManifest` liste plus que ce qu'il implémente | capability sur-claim | medium | (1) Plan §140 : `ConnectorManifest` signé. (2) `ConnectorManifest.trust class` (plan §128). (3) ADR-012 + ADR-024. | test manifest honesty |

### 1.8 Code / Shell (post-M3, ADR-019)

| ID | Classe | Composant | Acteur | Vecteur | Impact | Likelihood | Mitigation | Test |
|---|---|---|---|---|---|---|---|---|
| TM-CS-01 | **Elevation** | Code node atteint host filesystem | code | import dynamique vers `/etc/passwd` | exfiltration | high (si profile Code GA) | (1) Plan §134 : filesystem = sandbox only, network = deny, secrets = explicit only. (2) ADR-019. | sandbox test |
| TM-CS-02 | **Elevation** | Code node atteint Docker socket | code | `unix:///var/run/docker.sock` | pivot root | high | (1) Plan §134 : Docker socket = unavailable. (2) ADR-019. | socket test |
| TM-CS-03 | **Tampering** | Shell interpolation | auteur | `cmd = "ls " + user_input` | injection | high | (1) Plan §136 : `no implicit interpolation`, `explicit argv`, `process-tree kill`. (2) ADR-019. | shell injection test |

### 1.9 AI Compiler (post-M3, plan §161-169)

| ID | Classe | Composant | Acteur | Vecteur | Impact | Likelihood | Mitigation | Test |
|---|---|---|---|---|---|---|---|---|
| TM-AI-01 | **Tampering** | LLM propose un outil inexistant | LLM hostile | sortie IA référence `tool.fake_thing` | exécution d'un outil non listé | high (si AI Compiler GA) | (1) Plan §168 : `hallucinated executable tool = 0`. (2) `Tool Discovery` (plan §162) catalogue réel uniquement. (3) ADR-002 (IR) : validation déterministe avant publication. (4) ADR-004 (history) : l'output IA passe par un validateur déterministe. | gold benchmark |
| TM-AI-02 | **Information Disclosure** | LLM voit taint `secret` | LLM | inputs contient un credential | LLM stocke / leak le credential | high | (1) Plan §4 : IA = compiler + assistant, NEVER security authority. (2) Plan §123 : workflow ne voit que les Refs. (3) Taint tracking (plan §121-122). | canary gate secret-to-LLM |
| TM-AI-03 | **Tampering** | LLM propose un skip d'approval | LLM hostile | sortie IA contourne un `requiresApproval` | exécution non approuvée | high | (1) Plan §4 : AI bypass deterministic validator = NO-GO immédiat (plan §238). (2) Plan §168 : `Critical approval omission = 0`. | test approval preservation |

### 1.10 Tenant / Multi-workspace

| ID | Classe | Composant | Acteur | Vecteur | Impact | Likelihood | Mitigation | Test |
|---|---|---|---|---|---|---|---|---|
| TM-T-01 | **Information Disclosure** | A lit B workflow | attaquant cross-tenant | forge `workspaceId` | fuite cross-tenant | medium | (1) `WorkbenchOrchestrator` re-filtre (déjà présent). (2) C-PRE1-05 isolation test. (3) ADR-020 (ownership scope). | C-PRE1-05 |
| TM-T-02 | **Elevation** | A utilise credential de B | attaquant | forge `CredentialRef` | utilisation cross-tenant | medium | (1) Plan §226 : `A cannot use B credential`. (2) ADR-010. (3) C-PRE1-02. | multi-tenant test |

---

## 2. Agentic AI threats (plan §4)

| ID | Threat | Mitigation | Test |
|---|---|---|---|
| TM-AG-01 | LLM becomes security authority | plan §4 interdit. Code : aucun `if (await llm.approve()) { ... }`. | grep |
| TM-AG-02 | LLM proposes forbidden action | plan §150 : `forbidden side effects = 0`. Le runtime **doit** bloquer, pas seulement détecter. | computer use corpus |
| TM-AG-03 | LLM hallucinates executable | plan §168 : `hallucinated executable tool = 0`. | gold benchmark |
| TM-AG-04 | LLM manipulates taint | plan §122 : `trusted.declassify` only, avec audit. | declassification test |
| TM-AG-05 | LLM poisoned by injected document | plan §121 : `untrusted_external` taint. | corpus injection |
| TM-AG-06 | LLM costs unbounded | plan §164 : `maxCompilerIterations`, `maxToolCalls`, `maxCost`, `maxDuration` obligatoires. | resource limit test |

---

## 3. Data-flow threats (plan §121-125, §148)

Chemins de données sensibles identifiés :

| ID | Path | Taint initial | Sink interdit | Mitigation |
|---|---|---|---|---|
| TM-DF-01 | HTTP body → `inputs` → `outputs` → `history` | `untrusted_external` (si HTTP externe) ou `internal` (si local) | secret sinks (LLM, logs, model-visible) | taint tracking |
| TM-DF-02 | Browser DOM → observation → LLM | `untrusted_external` | exfiltration | model-visible surface scrub (§148) |
| TM-DF-03 | Browser auth → `BrowserAuthProfileRef` | `secret` | exfiltration | broker only |
| TM-DF-04 | MCP response → outputs | `untrusted_external` (par défaut) | exfiltration | taint tracking |
| TM-DF-05 | User prompt → LLM | `internal` | n/a | OK |
| TM-DF-06 | `CredentialRef` → broker → executor | `secret` | logs, traces, LLM | broker isolation |
| TM-DF-07 | `ArtifactRef` (gros output) → history | depends | huge history | LARGE PAYLOAD RULE (§70) |

---

## 4. Supply-chain threats (plan §232-233)

| ID | Composant | Threat | Mitigation |
|---|---|---|---|
| TM-SC-01 | Bun lockfile | drift entre machines | `bun.lock` versionné, `bun install --frozen-lockfile` en CI |
| TM-SC-02 | Node deps | CVE | `osv-scanner --recursive .` ou `trivy fs .` en CI nightly |
| TM-SC-03 | Rust deps (Tauri) | CVE | `cargo audit` |
| TM-SC-04 | MCP servers externes | hostile | ADR-011 + ADR-024 + signature (si disponible) |
| TM-SC-05 | Connectors | hostile | ADR-012 + trust class (§128) |
| TM-SC-06 | LLM providers | drift de modèle, jailbreak | provider allowlist, version épinglée, gold dataset versionné |
| TM-SC-07 | Browser binaries | drift | version épinglée par build |
| TM-SC-08 | Local model runtimes | drift | version épinglée |
| TM-SC-09 | Tauri 2.0 | CVE | `cargo audit` + `tauri` releases trackées |

**Controls** (plan §233) : lockfiles, audit, SBOM, provenance, digest,
signature si disponible, license policy.

---

## 5. Findings existants liés au threat model

| Finding | Lien threat model | Statut |
|---|---|---|
| R-001 | TM-C-03 (elevation workflow.run) | NEEDS_EVIDENCE (décision utilisateur) |
| R-002, R-003 | n/a (a11y, pas threat) | ALREADY_COVERED |
| R-007 | TM-AG-02 (Linux baselines absentes — pas threat) | ACCEPT |
| R-008 | n/a (lint, pas threat) | NEEDS_EVIDENCE |
| R-012 | TM-S-01, TM-S-02, TM-S-03 (secret) | NEEDS_EVIDENCE (cartographie) |
| R-013 | TM-AG-02, TM-AG-03 (AI non testé) | NEEDS_EVIDENCE (suite à créer) |
| R-014 | TM-W-01..05 (substrate-grade) | NEEDS_EVIDENCE (ADR-000) |

---

## 6. Sortie attendue

Ce threat model est le **contrat** que les ADR doivent rendre. Pour
chaque ADR, on vérifie qu'il adresse au moins les threats de sa zone.

| ADR | Threats principaux adressés |
|---|---|
| ADR-000 (substrate) | TM-W-01..05 |
| ADR-001 (canonicalisation) | TM-W-02, TM-W-05 |
| ADR-002 (IR) | TM-W-04, TM-AG-01, TM-AG-03 |
| ADR-003 (expression) | TM-AG-06 (resource limits) |
| ADR-004 (history) | TM-W-02, TM-AR-03 |
| ADR-005 (artifact) | TM-AR-01, TM-AR-02, TM-AR-03 |
| ADR-009 (policy) | TM-T-01, TM-T-02 |
| ADR-010 (key/secret) | TM-S-01, TM-S-02, TM-S-03, TM-SC-06 |
| ADR-011 (MCP) | TM-M-01, TM-M-02, TM-SC-04 |
| ADR-012 (connector) | TM-M-03, TM-SC-05 |
| ADR-013 (browser) | TM-N-03, TM-N-04, TM-N-05, TM-DF-02 |
| ADR-014 (computer use) | TM-AG-02, TM-N-05 |
| ADR-019 (code/shell) | TM-CS-01, TM-CS-02, TM-CS-03 |
| ADR-020 (ownership) | TM-T-01, TM-T-02 |
| ADR-022 (timer) | TM-W-04 |
| ADR-023 (network) | TM-N-01, TM-N-02, TM-M-02, TM-DF-01 |
| ADR-024 (extension) | TM-M-01, TM-N-05, TM-AG-02, TM-SC-04 |

Aucun ADR ne peut être `DONE` tant que les threats de sa zone n'ont pas
de test concret.
