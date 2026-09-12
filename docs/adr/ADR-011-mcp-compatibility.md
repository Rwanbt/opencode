<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-011 — MCP Compatibility

> **Statut** : DECIDED
> **Date** : 2026-09-01
> **Source** : plan V2.3.1 §141-142, ADR-024, ADR-009.

## Status

DECIDED 2026-09-01. Dépend d'ADR-024 (extension isolation) et
ADR-009 (Policy). Couvre le Connectors/MCP Track (post-M3).
Implémentation MCP spec différée à M2+ ; pour la première
certification, MCP est hors scope (uniquement les 6 familles de
nodes d'ADR-002). Décision tranchée sur la base de
`AUTOMATE_TRUST_PATH §D.3`.

## Context

Plan V2.3.1 §141 : « ADR-011 doit utiliser la spec réellement courante
au moment de l'implémentation. » (vérifier MCP spec au moment de
l'implémentation).

§142 :

```text
NodeAttempt
-> external MCP task
-> observation
-> NodeAttempt completion
```

MCP ne possède pas WorkflowRun.

## Decision

### Spec MCP

- Cible : MCP spec courante au moment de l'implémentation.
- TS SDK : `@modelcontextprotocol/sdk`.
- Transport : stdio (local) et HTTP (distant).
- Auth : OAuth (cf. ADR-010 + ADR-009).

### Intégration

```text
WorkflowVersion.IR contient des nodes "tool.mcp" (post-M1, extension).

Pour chaque tool.mcp:
  - ToolManifest signe (ADR-024 trust class)
  - Capability requise (network.request si remote, file system scope si local)
  - Schema validation (input/output)
  - Retry policy (ADR-007)
  - Timeout (ADR-022)

MCP server lifecycle:
  - Local: subprocess demarre par le worker, env filtre (ADR-024 §131)
  - Remote: HTTP+auth via Network Authority (ADR-023 §132)
```

### Sécurité

- ADR-024 : MCP stdio ne reçoit PAS `process.env`, SSH agent, Git
  credentials, cloud credentials, user filesystem.
- ADR-024 : MCP distant traverse `Network Authority + auth + schema
  validation + Capability + Policy`.
- TM-M-01 (stdio env leak) : covered.
- TM-M-02 (remote bypass) : covered.
- TM-M-03 (manifest over-claim) : covered par signature + trust class.

### `NodeAttempt` (plan §142)

```text
MCP tool call:
  1. Workflow Kernel dispatch NodeAttempt
  2. NodeAttempt -> external MCP task
  3. Observation (response or progress)
  4. NodeAttempt completion (success/error)

MCP ne possède jamais le WorkflowRun.
```

## Consequences

- `@unifia/mcp-transport/` étendu avec client + server.
- `@unifia/mcp-ui-actions/` (présent) : pour les UI actions MCP.
- `MCP Tool Contract` type dans `contracts/mcp-ui.ts` (étendu).
- Capability Authority étendu pour valider MCP tools.

## Trade-offs

| Trade-off | MCP | Custom RPC |
|---|---|---|
| Standard | Oui (Model Context Protocol) | Non |
| Adoption | Large | Limitée |
| Sécurité | Spec à appliquer strictement | À construire |

## Liens

- plan V2.3.1 §141-142
- THREAT_MODEL §1.7 (TM-M-01..03)
- ADR-009 (Policy)
- ADR-023 (Network)
- ADR-024 (Extension)
