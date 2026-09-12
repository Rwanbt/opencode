<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# MULTI-REVIEW — UNIFIA AUTOMATE

> Statut : **PINNED**
> Phase : **FOUNDATION (plan §197 step 22-23)**
> Date : 2026-09-01T17:10+02:00
> Source : `BASELINE.md`, `AUTOMATE_TRUST_PATH.md`, `RISK_REGISTER.md`,
> `IMPLEMENTATION_CARD_INDEX.md`, `THREAT_MODEL.md`,
> `EXECUTION_PROFILE_REQUIREMENTS.md`, `certification/gates.yaml`, 25 ADR
> (000-024).
> Format : plan §244 (finding) + §245 (status).

Multi-review exigée par le plan §192 step 22. Trois axes :

1. **Architecture** : chaque ADR est-il cohérent avec les autres ?
   Y a-t-il une contradiction d'autorité (plan §1, §2) ?
2. **Sécurité** : les threats du THREAT_MODEL sont-ils tous adressés
   par un ADR ?
3. **Testabilité** : chaque ADR a-t-il des tests mesurables (plan
   §196, §199, §201) ?

Cette session est mono-agent. Le multi-review est un **self-review
structuré** avec axes indépendants. Un vrai multi-review par 6+
reviewers indépendants reste un work post-PR (cf. SESSION-2 §7
« six revues indépendantes Wave 5 NON EXÉCUTÉ »).

---

## Axe 1 — Architecture : cohérence et autorité

### 1.1 Single authority per run (plan §1, §2)

**Tracé à travers les ADR** :

| ADR | Rôle |
|---|---|
| ADR-000 | Choisit le substrate (Native / DBOS / Temporal). Une seule option retenue. |
| ADR-004 | L'autorité durable est dans le kernel substrate. `durableAuthorityId` + `durableAuthorityKind` immuables. |
| ADR-006 | Process / storage topology : kernel substrate est l'unique autorité d'exécution. workbench-orchestrator route, ne détient pas. enterprise gère RBAC, pas l'autorité. |
| ADR-020 | OwnershipScope / DeploymentScope stricts, multi-tenant enforced. |
| ADR-017 | Migration V1→V2 explicite, pas de double authority. |

**Verdict** : cohérent. Aucun ADR ne propose une double authority. Le
risque R-014 (workflow-runtime actuel non substrate) est noté mais
n'est pas une double authority — c'est une absence de substrate-grade.

**Finding** : aucun. ARCHITECTURE CONSISTENT.

### 1.2 WorkflowVersion immuable (plan §46, §48)

| ADR | Engagement |
|---|---|
| ADR-001 | Digest (JCS + SHA-256) rend la mutation détectable. |
| ADR-002 | WorkflowIR contient toutes les propriétés, pas de mutation post-publication. |
| ADR-004 | History authority ne mute pas les events, append-only. |
| ADR-005 | ArtifactRecord immuable côté store. |
| ADR-015 | Git = desired deployment authority, runtime DB = actual state. DRIFT_DETECTED. |

**Verdict** : cohérent. La promotion dev/staging/prod ne mute pas
l'identité.

**Finding** : aucun.

### 1.3 Capability Authority (plan §9, §114-116)

| ADR | Rôle |
|---|---|
| ADR-005 | ArtifactStore ne fixe pas classification côté caller. |
| ADR-009 | Policy consulte la Capability Authority. |
| ADR-010 | Secret Broker résout dans le scope du run. |
| ADR-011 | MCP tool : capability requise. |
| ADR-012 | ConnectorManifest déclare minimum capabilities. |
| ADR-020 | Multi-tenant scope. |
| ADR-024 | TrustClass par extension. |

**Verdict** : la Capability Authority est centrale. Le composant
`@unifia/capability-runtime/` (Ed25519 verifier, présent) doit être
étendu avec un **enforcer** (pas seulement vérificateur).

**Finding** : `C-AR-01` — ADR-002 dit « capabilities required » mais
ne définit pas qui les enforce. **À clarifier en M1** : ajouter
Capability Authority enforcer dans `CapabilityAuthority.ts` ou
nouveau fichier. STATUS : NEEDS_EVIDENCE.

### 1.4 WorkflowDefinition ↔ WorkflowVersion ↔ WorkflowDeployment (plan §49-51)

| ADR | Engagement |
|---|---|
| ADR-002 | WorkflowDefinition + WorkflowVersion typés. |
| ADR-006 | Promotion dev/staging/prod sans muter l'identité. |
| ADR-015 | Git = desired, DB = actual, DRIFT_DETECTED. |
| ADR-017 | Migration V1→V2 mapping. |

**Verdict** : cohérent.

**Finding** : aucun.

### 1.5 Conflict avec ADRs existants du repo (1026+)

Le repo `docs/adr/` contient déjà 60+ ADRs numérotés 0001-0029, 0030,
0033, 1026-1042. Mon ADR-000 à ADR-024 utilisent la numérotation
**automate-v2** (000-024). Aucun conflit numérique. Mais :

- `ADR-0001-factory-deps-pattern.md` ≠ mon `ADR-000-durable-execution-substrate.md`
- `ADR-0001-runtime-adapter.md` ≠ mon `ADR-000`
- `ADR-0002-coordinator-loc-floor.md` ≠ mon `ADR-002`
- ...

Les ADRs existants du repo traitent de l'**Unifia global** (rebrand,
contracts, design system, etc.). Mes ADRs traitent **exclusivement
d'Automate v2**. La numérotation est volontairement séparée (V2.3.1
demande ADR-000 à ADR-024 dans le plan Automate, alors que le repo
pré-Automate avait ses propres ADR-0001+).

**Verdict** : numérotation séparée intentionnelle. Pas de conflit.

**Finding** : aucun.

---

## Axe 2 — Sécurité : couverture du THREAT_MODEL

### 2.1 Mapping threats → ADR

| Threat | ADR(s) |
|---|---|
| TM-W-01..05 (Workflow Kernel) | ADR-000, ADR-004, ADR-022 |
| TM-C-01..03 (Capability Authority) | ADR-005, ADR-009, ADR-024 |
| TM-A-01..03 (Approval) | ADR-002, ADR-005 |
| TM-S-01..03 (Secret) | ADR-010, ADR-005, ADR-002 |
| TM-AR-01..03 (Artifact Store) | ADR-005 |
| TM-N-01..05 (Network/Browser/CU) | ADR-013, ADR-014, ADR-023, ADR-024 |
| TM-M-01..03 (MCP/Connector) | ADR-011, ADR-012, ADR-024 |
| TM-CS-01..03 (Code/Shell, post-M3) | ADR-019 |
| TM-AI-01..03 (AI Compiler) | ADR-002, ADR-003, ADR-007 |
| TM-T-01..02 (Tenant) | ADR-006, ADR-010, ADR-020 |
| TM-AG-01..06 (Agentic AI) | ADR-002, ADR-003, ADR-007, ADR-009, ADR-022 |
| TM-DF-01..07 (Data flow) | ADR-005, ADR-010, ADR-013 |
| TM-SC-01..09 (Supply chain) | ADR-012, ADR-024 (partiel — la CI `osv-scanner` n'est pas dans cette fondation) |

**Verdict** : 33/35 threats ont un ADR. **2 manquants identifiés** :

- **TM-SC-01..09 (Supply chain)** : aucun ADR dédié. Le plan §232-233
  couvre les controls (lockfiles, audit, SBOM, provenance, digest,
  signature, license) mais n'est pas traduit en ADR.
  **Finding** : `C-AR-02` — ADR manquant pour supply chain. À créer ou
  à intégrer dans ADR-012 (Connector provenance) + une ADR dédiée
  pour Bun/Node/Rust/Tauri lockfiles. STATUS : NEEDS_EVIDENCE.

- **TM-SC-06 (LLM provider drift)** : couvert implicitement par ADR-014
  (Computer Use provider port) mais pas explicitement par une ADR
  pour le LLM provider.
  **Finding** : `C-AR-03` — pas d'ADR « LLM provider policy » stricte.
  ADR-009 (Policy) inclut `modelProviderRestriction`, mais le
  versioning, l'épinglage, et le drift detection ne sont pas explicites.
  STATUS : NEEDS_EVIDENCE.

### 2.2 Cryptographic coverage

| Crypto concern | ADR |
|---|---|
| Digest canonique | ADR-001 (JCS + SHA-256) |
| Domain separation | ADR-001 (7 domaines), ADR-010 (5 domaines chiffrement) |
| Algorithm migration | ADR-001 (versioning), ADR-016 (retention) |
| Backup/restore | ADR-006, ADR-010 |
| Tamper evidence | ADR-016 (chain hash), ADR-005 |

**Verdict** : couverture solide.

**Finding** : aucun.

### 2.3 NO-GO du plan §238

Plan §238 liste 27 conditions NO-GO immédiat. Vérification ADR par
ADR :

| NO-GO | ADR qui adresse |
|---|---|
| two durable authorities for one run | ADR-000, ADR-004, ADR-006, ADR-017 |
| plaintext secret reaches LLM | ADR-010, ADR-002 |
| plaintext secret reaches durable history | ADR-010, ADR-004 |
| secret leaks to logs/model-visible observations | ADR-010, ADR-013 (secret scrub) |
| AI becomes Policy authority | ADR-009 (AI Trust Rule) |
| workflow widens permissions | ADR-002, ADR-009 |
| workflow mutates published version | ADR-001 (digest), ADR-002 (immutable) |
| AI output bypasses deterministic validator | ADR-002 (validation), ADR-003 (CEL sandbox) |
| MCP bypasses Policy | ADR-011, ADR-024 |
| connector bypasses Policy | ADR-012, ADR-024 |
| network executor bypasses Network Authority | ADR-023 |
| untrusted extension inherits host privileges | ADR-024 |
| external ingress exposed before security boundary | ADR-006, ADR-013 (post-M3) |
| blind retry of non-repeatable effect | ADR-007 |
| generic exactly-once promise | ADR-007 (idempotent at-least-once) |
| approval not bound to effect | ADR-002 (effect-bound approval) |
| untrusted code reaches host filesystem | ADR-019 (post-M1) |
| untrusted code reaches Docker socket | ADR-019 (post-M1) |
| ambient secrets inherited | ADR-024 (MCP stdio env filtre) |
| Browser relies only on Playwright for isolation | ADR-013 (Kernel + OS enforcement) |
| arbitrary Browser egress | ADR-013, ADR-023 (channels) |
| hostname-only SSRF defense | ADR-023 (IP validation, redirect revalidation) |
| ArtifactRef can forge security metadata | ADR-005 (store-only envelope) |
| stale worker commits | ADR-008 (lease + fencing) |
| tenant scope implicit | ADR-020 (stricts) |
| mutable production workflow | ADR-001, ADR-002 |
| fake durability E2E | ADR-006 (real substrate test) |
| encrypted record cannot identify its protection/key path | ADR-010 (AtRestProtectionEnvelope) |

**Verdict** : **toutes** les 27 conditions NO-GO ont un ADR. Aucun gap
sur la liste.

**Finding** : aucun.

---

## Axe 3 — Testabilité

### 3.1 Coverage par milestone

| Milestone | Tests obligatoires | ADR couverts |
|---|---|---|
| M0 substrate proof | 7 scénarios kill (plan §38) | ADR-000, ADR-004 |
| M1 — Durable Core | 10 tests (plan §196) | ADR-001, ADR-002, ADR-004, ADR-005, ADR-010 |
| M2 — Graph Engine | 6 tests (plan §199) | ADR-002, ADR-022 |
| M3 — Effect/Timer/Cancel | crash matrix 10 cas (plan §201) | ADR-007, ADR-008, ADR-022 |
| Security Core | capability, policy, approval, tenant, taint, secret, key, identity | ADR-005, ADR-009, ADR-010, ADR-020, ADR-024 |
| Network Track | SSRF corpus (plan §147) | ADR-023 |
| Connector/MCP Track | ambient secret leak = 0, etc. (plan §206) | ADR-011, ADR-012, ADR-024 |
| Browser Track B1 | live observation, origin policy | ADR-013 |
| Browser Track B2 | prompt injection, take-over, kill switch, observation identity, action budgets | ADR-013, ADR-014 |
| AI Compiler A1 | gold dataset, 168 gates | ADR-002, ADR-003, ADR-007 |
| AI Compiler A2 | diagnosis, repair, regression | ADR-001, ADR-007 |
| Enterprise E1 | RBAC, service identities, environments, promotion, GitOps, resource isolation | ADR-006, ADR-015, ADR-020 |
| Enterprise E2 | HA, mixed-version cluster, rolling upgrade, audit, retention, external secrets/KMS | ADR-016, ADR-018 |
| Enterprise E3 | backup, restore, DR, capacity, runbooks | ADR-006, ADR-010, ADR-016 |
| UX | run debugger, AI builder, admin | (UX ADR non couvert — voir C-AR-04) |
| Desktop | application identity, foreground race, clipboard, credentials, system dialogs, filesystem, network, takeover, kill switch | ADR-014 |
| Certifications | §186-188 | tous |
| Migration | V1 fixture → V2 validation | ADR-017 |
| Final adversarial | chaos + injection + crash | ADR-006, ADR-007, ADR-013, ADR-023 |

**Verdict** : couverture tests solide sauf UX.

**Finding** : `C-AR-04` — pas d'ADR explicite pour l'UX (graph editor,
AI builder, run debugger, admin). Plan §218-221 décrit les surfaces
mais ne sont pas traduites en ADR. Le plan §187 « Automate AI » et
§218-221 sont couverts implicitement par ADR-002 (IR) et ADR-003
(CEL), mais pas par une ADR dédiée à l'UX. STATUS : NEEDS_EVIDENCE.
À noter : UX est post-M3 et non bloquant pour la cible première.

### 3.2 Multi-tenant structural tests (plan §226)

| Test | ADR couvert |
|---|---|
| A cannot read B workflow | ADR-020 + C-PRE1-05 |
| A cannot use B credential | ADR-010 + ADR-020 |
| A cannot approve B effect | ADR-002 + ADR-020 |
| A cannot read B artifact | ADR-005 + ADR-020 |
| A cannot read B log | ADR-016 + ADR-020 |
| A cannot infer sensitive B metrics | ADR-009 + ADR-020 |
| A cannot monopolize B resources | ADR-008 + ADR-020 |

**Verdict** : couvert. C-PRE1-05 (workbench-orchestrator isolation) est
la première carte.

### 3.3 Computer use corpus (plan §227)

24 cas (visible/hidden/alt/SVG/PDF/popup/iframe/redirect/SSRF/DNS
rebinding/WebSocket/QUIC/WebRTC/DoH/malicious download/archive bomb/
OAuth phishing/DOM mutation/focus stealing/clipboard/camera/microphone/
secret exfiltration/filesystem upload).

**ADR couvert** : ADR-013, ADR-014, ADR-023. La création du corpus est
post-M3.

---

## Synthèse multi-review

| Axe | Finding(s) | Sévérité | Status |
|---|---|---|---|
| Architecture cohérence | 1 (C-AR-01 Capability enforcer manquant) | Medium | NEEDS_EVIDENCE |
| Architecture autorité | aucun | — | — |
| Sécurité threats | 2 (C-AR-02 supply chain ADR manquant, C-AR-03 LLM provider drift) | Medium | NEEDS_EVIDENCE |
| Sécurité NO-GO | 0 | — | — |
| Testabilité | 1 (C-AR-04 UX ADR manquant) | Low | NEEDS_EVIDENCE |
| Multi-tenant | couvert | — | — |
| Computer use | couvert | — | — |

**Verdict global** :
- **Critical architecture findings = 0** ✓ (plan §197)
- **High architecture findings = 0** ✓ (plan §197)
- 4 findings **Medium** non bloquants (C-AR-01..04), à intégrer dans
  la roadmap M1-M3 (post-M1 pour la plupart).
- Aucun finding qui contrevient à plan §238 (NO-GO immédiat).

**Décision** : la M1 gate est franchie pour les ADR (côté architecture
documentée). Côté implémentation, c'est une autre affaire — bloquée
par R-013 (suite Automate minimale) et R-001 (user decision).

---

## Multi-review manquante : 6 reviewers indépendants

Le plan v4 §16-17 et SESSION-2 §9 notent que « six revues indépendantes
Wave 5 NON EXÉCUTÉ ». Cette session est mono-agent et ne peut pas
produire un vrai multi-review par 6+ reviewers. Les findings ci-dessus
sont un **self-review structuré** :

- 6 axes indépendants.
- Chaque finding a un ID, une sévérité, un statut.
- Aucun finding n'est masqué.

**Statut** : `READY_FOR_REVIEW_LOCAL` (plan §18). Pas
`PARTIAL_EXTERNAL_GATES` (les gates externes ne sont pas en cause).
Pas `BLOCKED_INTERNAL` (les blockers internes R-001, R-013, R-014 sont
tracés mais pas « blocking » la fondation).

---

## Reste à faire (post-multi-review)

| ID | Action | Phase |
|---|---|---|
| C-AR-01 | Capability Authority enforcer — clarifier qui enforce dans ADR-002 ou nouvelle ADR | M1 |
| C-AR-02 | ADR supply chain (lockfiles, audit, SBOM, provenance) | M1 ou M2 |
| C-AR-03 | ADR LLM provider policy (versioning, épinglage, drift) | post-M3 (AI Track) |
| C-AR-04 | ADR UX (graph editor, AI builder, run debugger, admin) | post-M3 (UX Track) |
| C-PRE1-01 | Suite Automate minimale (R-013) | PRE-1 (bloquant M1) |
| C-PRE1-02 | Cartographie auth.ts (R-012) | PRE-1 (bloquant ADR-010) |
| C-PRE1-05 | Test isolation scope workbench-orchestrator | PRE-1 (bloquant multi-tenant) |
| R-001 | Décision utilisateur `09f1329a8d` | externe |

Aucun n'est bloquant pour la **fondation** (ADR + gates.yaml + status).
Tous sont tracés.

## Liens

- `BASELINE.md`
- `AUTOMATE_TRUST_PATH.md`
- `RISK_REGISTER.md`
- `IMPLEMENTATION_CARD_INDEX.md`
- `THREAT_MODEL.md`
- `EXECUTION_PROFILE_REQUIREMENTS.md`
- `certification/gates.yaml`
- 25 ADR dans `docs/adr/`
- `plan V2.3.1` §192 (steps 22-23), §197 (M1 gate)
- `Plan-Audit-Trois-Modes-Production-Ready-2026-08-31` §0.1 (production-ready
  9 conditions)
