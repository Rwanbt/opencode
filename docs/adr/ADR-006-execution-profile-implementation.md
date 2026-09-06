<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-006 — Execution Profile Implementation

> **Statut** : DECIDED
> **Date** : 2026-09-01
> **Source** : plan V2.3.1 §186-191, §194, EXECUTION_PROFILE_REQUIREMENTS.md,
> BASELINE.md §10, SESSION-2-REPORT §5.

## Status

DECIDED. Dépend d'ADR-000 (substrate). Cible le **premier profile de
certification** : `Automate Core × local-single-node × Windows`
(plan §FIRST TARGET, ligne 6074-6094).

## Context

Plan V2.3.1 §186 fixe la certification comme un triplet :

```text
Capability Profile × Execution Profile × Platform
```

§187 liste les capability profiles cibles : `Automate Core / Browser /
AI / Enterprise / Desktop`.

§189 décrit la cible « Local GA » :
> Profil complet à surface réduite. Pas MVP. Peut inclure : durable
> execution, graph, side effects, timers, cancellation, manual,
> schedule, secure webhook if claimed, Capability Authority, Policy,
> approval, Secret Broker, HTTP, MCP subset if claimed, observability,
> migration.

§190 fixe ce que **n'est pas** la Local GA :
> server cluster, HA, distributed worker fleet, Browser GA, AI Compiler
> GA, Desktop Computer Use GA, third-party extension support, Code/Shell
> unless certified.

## Decision

### Decision

Premier profil de certification : `Automate Core × local-single-node ×
Windows`. Topologie : Tauri shell (`Unifia.exe`, 53 Mo) + Sidecar CLI
(`unifia-cli.exe`, 194 Mo) + Workflow Kernel + Capability + Policy +
Secret Broker + Network Authority + Audit. Stockage : SQLite (Drizzle) +
File store + OS secure storage (DPAPI).

**Evidence** :

- `EXECUTION_PROFILE_REQUIREMENTS.md` §1.1.
- `SESSION-2-REPORT` §5 (build Tauri, sha256 sidecar).
- `BASELINE.md` §10 (plateformes supportées).
- Plan V2.3.1 §186-191 (capability profile).

**Migration strategy** :

- CSP `packages/desktop/` whitelist le port du sidecar.
- `packages/app/` pointe sur `http://127.0.0.1:<port>`.
- `packages/unifia/` (sidecar CLI) testé pour démarrer et écouter un
  port.
- Le substrate doit tourner dans un process Bun standalone.
- `WorkbenchOrchestrator` route sans devenir autorité.
- Procédure backup / restore E2E automatisée en CI.

**Profile de première certification** : `Automate Core × local-single-node × Windows`.

### Capabilities incluses (plan §189 + ADR-002)

| Capability | Inclus dans Local GA |
|---|---|
| durable execution (kernel natif ou DBOS/Temporal — ADR-000) | OUI |
| graph (DAG + 6 node families ADR-002) | OUI |
| side effects (HTTP, Approval, Wait) | OUI |
| timers (durable) | OUI |
| cancellation | OUI |
| trigger.manual | OUI |
| trigger.schedule | OUI |
| Capability Authority | OUI (ADR) |
| Policy | OUI (ADR-009) |
| Approval (effect-bound) | OUI (ADR-002, ADR-005) |
| Secret Broker | OUI (ADR-010) |
| HTTP executor | OUI (ADR-023) |
| MCP subset if claimed | non pour cible première (ADR-011) |
| observability | OUI |
| migration (V1 → V2) | OUI (ADR-017) |
| secure webhook | non — webhook externe est après Security Core (plan §138) |

### Capabilities exclues (plan §190)

- server cluster / HA / distributed worker fleet (post-M3 Distributed
  Server Track)
- Browser GA (post-M3 Browser Track)
- AI Compiler GA (post-M3 AI Track)
- Desktop Computer Use GA (post-M3 Desktop Track)
- third-party extension support (ADR-024, post-M3 Connectors/MCP Track)
- Code / Shell (ADR-019, sauf certification explicite post-M1)

### Topologie process / storage (M1 gate requirement, plan §197)

```text
OS Windows
├── Process 1 : Tauri shell (Unifia.exe, 53 Mo)
│   ├── WebView2 (SolidJS app)
│   ├── Tauri commands (TLS, speech, local-llm)
│   └── keychain endpoint (OS secure storage)
├── Process 2 : Sidecar CLI (unifia-cli.exe, 194 Mo)
│   ├── Hono server (workbench-server, port 4096)
│   ├── Workflow Kernel (substrate ADR-000)
│   ├── Capability Authority
│   ├── Policy (ADR-009)
│   ├── Secret Broker (ADR-010)
│   ├── Network Authority (ADR-023)
│   └── Audit Runtime
└── Storage local
    ├── SQLite (Drizzle) — durable history (substrate)
    ├── File store — Artefacts (ArtifactRecord)
    ├── OS secure storage — Root key (ADR-010)
    └── File store — WorkflowVersion, Approval records, Audit log
```

### Processus d'orchestration

1. `Unifia.exe` démarre, génère un `RemoteConfig` (UUID + password), écoute
   un port local.
2. Le WebView2 charge `http://127.0.0.1:<port>` (cf. CSP `connect-src`
   `http://ipc.localhost` et `http://asset.localhost` du CLAUDE.md).
3. Le WebView2 envoie un `boot` event au Tauri backend, qui démarre le
   sidecar `unifia-cli.exe` (cf. SESSION-2 §5 : `Spawning sidecar`).
4. Le sidecar ouvre le port `4096` (Hono + SSE).
5. Le WebView2 se connecte à `http://127.0.0.1:4096` pour le wire
   workbench.
6. Le user peut désormais : créer un workflow, l'exécuter, l'arrêter,
   etc.

### Storage

| Donnée | Backend | Chiffrement |
|---|---|---|
| `WorkflowVersion` (published) | SQLite | digest ADR-001 + envelope ADR-010 |
| `WorkflowRun` history | SQLite (substrate) | digest ADR-001 + envelope ADR-010 |
| `ArtifactRecord` | File store (filesystem) | envelope ADR-005 + ADR-010 |
| `CredentialRef` material | OS secure storage (DPAPI) | natif OS |
| Audit log | SQLite append-only | digest + envelope |
| `OwnershipScope` / `DeploymentScope` index | SQLite | — |

### Single authority per run (plan §1, §2)

Le `Workflow Kernel` (substrate ADR-000) est l'autorité durable. Aucun
autre runtime (`enterprise`, `workbench-orchestrator`, `UI`) ne peut
devenir une autorité parallèle. Le `workbench-orchestrator` route
uniquement ; l'`enterprise` gère RBAC, environnements, promotion,
GitOps, audit, retention, KMS externe — **pas** l'autorité d'exécution.

### Backup / restore (plan §80, ADR-010)

```text
Backup: export chiffré de :
  - SQLite database (history + workflow versions)
  - Artefacts (File store)
  - Audit log
  - Wrapped DEK (par domaine de chiffrement)
  - Root key export chiffré par mot de passe utilisateur OU HSM

Restore procedure (E2E test obligatoire avant GA):
  1. Restaurer SQLite
  2. Restaurer artefacts
  3. Restaurer wrapped DEK
  4. Restaurer root key (via mot de passe ou HSM)
  5. Décrypter un artefact arbitraire
  6. Vérifier le digest ADR-001

Si une étape échoue, le backup n'est PAS une sauvegarde restaurable.
```

## Consequences

- `packages/desktop/` (Tauri shell) : inchangé fonctionnellement, mais le
  CSP doit whitelister le port du sidecar.
- `packages/unifia/` (sidecar CLI) : doit être testé pour démarrer et
  écouter un port (cf. SESSION-2 §2).
- `packages/app/` (WebView2) : doit pointer sur `http://127.0.0.1:<port>`.
- Le substrate (ADR-000) doit fonctionner dans un process Bun standalone.
- `WorkbenchOrchestrator` doit router sans devenir autorité (plan §2).

## Trade-offs

| Trade-off | Local GA (cette décision) | Server GA (post-M3) |
|---|---|---|
| Simplicité | Maximale | Minimale |
| HA | Non | Oui |
| Multi-tenant | Oui (par workspace) | Oui |
| Operations | Locale | Cluster |
| Network egress | Optionnel | Standard |

## Rejected alternatives

- **Server GA comme cible première** : rejeté (plan §189 explicite
  Local GA pour cible première).
- **Cible mobile** : rejetée (post-M3, REQ-5 mobile-local-execution
  `FUTURE_COMPATIBILITY_REQUIRED`).
- **Sans Capability Authority / Secret Broker** : rejeté (plan §189
  explicite).

## Security impact

- TM-T-01, TM-T-02 (multi-tenant) : addressés par ADR-020.
- TM-S-01..03 (secret) : addressés par ADR-010.
- TM-N-01..05 (network) : addressés par ADR-023.
- TM-W-01..05 (substrate) : addressés par ADR-000 + ADR-004.

## Migration impact

- Le `WorkflowRuntime` actuel est remplacé ou réécrit (ADR-000).
- Le wire workbench expose `durableAuthorityId` + `durableAuthorityKind`
  (ADR-004).
- `WorkbenchOrchestrator` re-filtrage multi-tenant (C-PRE1-05).

## Testing strategy

1. **M1 tests** (plan §196) : canonicalization, determinism, restart,
   reconstruction, authority uniqueness, scope isolation, historical
   schema read, artifact contract, digest verification, crypto envelope
   migration.
2. **M2 tests** (plan §199) : graph property, fan-out/in, parallel race,
   bounded loops, dynamic identity, stable map keys.
3. **M3 tests** (plan §201) : crash matrix.
4. **Backup/restore E2E** : procédure ci-dessus, automatisée en CI.
5. **Capability profile complet** : 1 parcours end-to-end, avec
   `trigger.manual` → `tool.http` → `human.approval` → `wait` → terminé.

## Rollback / exit strategy

- Le feature flag `legacy: true` permet de retomber sur l'ancien
  `WorkflowRuntime` en attendant.
- Aucun WorkflowRun GA tant que M0-01 n'est pas passé et que
  C-PRE1-01 (suite Automate minimale) n'est pas verte.

## Liens

- plan V2.3.1 §186-191, §194, §197 (M1 gate)
- EXECUTION_PROFILE_REQUIREMENTS.md §1.1, §4
- THREAT_MODEL.md §1.10
- BASELINE.md §10 (plateformes supportées)
- SESSION-2-REPORT §5 (build desktop Tauri, sha256 sidecar)
- ADR-000, ADR-002, ADR-004, ADR-005, ADR-009, ADR-010, ADR-020,
  ADR-022, ADR-023
