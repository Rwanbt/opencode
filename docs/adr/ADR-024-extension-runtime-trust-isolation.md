<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-024 — Extension Runtime Trust / Isolation (architectural impact)

> **Statut** : DECIDED
> **Date** : 2026-09-01
> **Source** : plan V2.3.1 §128-132, THREAT_MODEL §1.7 (TM-M-01..03).

## Status

DECIDED. ADR d'**impact architectural** (plan §197). Dépend d'ADR-000.

## Context

Plan V2.3.1 §128 fixe les trust classes :

```text
TRUSTED_BUILTIN
REVIEWED_EXTENSION
UNTRUSTED_THIRD_PARTY
REMOTE_SERVICE
```

Classification attribuée par Unifia (jamais par l'extension).

TRUSTED_BUILTIN (plan §129) : in-process possible **uniquement** si
`shipped with trusted build, repo reviewed, supply-chain controls, no
dynamic privilege widening`.

UNTRUSTED_THIRD_PARTY (plan §130) : isolé dans un worker/process/container,
clean env, no ambient secrets, no host filesystem, no Docker socket,
brokered Secret, brokered filesystem, brokered network, resource quotas,
killable.

Local MCP (plan §131) : ne reçoit PAS `process.env`, SSH agent, Git
credentials, cloud credentials, user filesystem.

Remote MCP (plan §132) : traverse Network Authority + auth + schema +
Capability Authority + Policy.

## Decision architecturale (M1, exécution après ADR-000)

1. **Aucune extension third-party pour la cible première**
   `Automate Core × local-single-node × Windows`. L'IR cible (ADR-002)
   n'a pas de `node family` "extension".

2. **Les `Connector`s et `MCP servers` sont gérés comme des
   `REVIEWED_EXTENSION` au minimum**, et `UNTRUSTED_THIRD_PARTY` par
   défaut. La classification est dans le `ConnectorManifest.trustClass`
   et `MCP Tool Contract.trustClass`.

3. **Local MCP stdio** est isolé du host :
   - `process.env` filtré (un sous-ensemble explicite).
   - Pas de SSH agent, pas de Git credentials, pas de cloud
     credentials.
   - Pas d'accès au filesystem user.
   - Network Authority obligatoire (ADR-023).

4. **Remote MCP** traverse ADR-023 (Network Authority) + ADR-011 (MCP
   compatibility) + ADR-009 (Policy).

5. **Gates** (plan §206) :
   - `ambient secret leak = 0`
   - `host filesystem escape = 0`
   - `network bypass = 0`
   - `Capability bypass = 0`
   - `Secret Broker bypass = 0`

## Consequences

- `MCP Tool Contract` et `ConnectorManifest` étendus avec
  `trustClass: TrustClass` (énuméré).
- Local MCP stdio isolé : `mcp-transport` étendu.
- ADR-011 (MCP) dépend de cet ADR.
- ADR-012 (Connector) dépend de cet ADR.
- ADR-023 (Network Authority) doit être en place avant.

## Liens

- plan V2.3.1 §128-132, §206
- THREAT_MODEL §1.7 (TM-M-01..03)
- ADR-000
- ADR-009 (policy)
- ADR-011 (MCP)
- ADR-012 (connector)
- ADR-019 (Code/Shell — livré comme extension UNTRUSTED_THIRD_PARTY)
- ADR-023 (network)
