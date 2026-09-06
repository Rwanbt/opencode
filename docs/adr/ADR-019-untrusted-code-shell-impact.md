<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-019 — Untrusted Code / Shell Execution (architectural impact)

> **Statut** : DECIDED
> **Date** : 2026-09-01
> **Source** : plan V2.3.1 §133-136, THREAT_MODEL §1.8 (TM-CS-01..03),
> ADR-002, ADR-024.

## Status

DECIDED. ADR d'**impact architectural** (plan §197). Dépend d'ADR-000
(substrate) et d'ADR-002 (IR). L'implémentation obligatoire seulement
**avant** un profile exposant Code/Shell (plan §133).

## Context

Plan V2.3.1 §134 fixe le default Code :

```text
filesystem = sandbox only
network    = deny
secrets    = explicit only
environment = clean
host filesystem = unavailable
Docker socket = unavailable
exports = ArtifactRef
```

§135 : quotas CPU / memory / wall time / process count / disk / file
count / stdout-stderr.

§136 : Shell — `sandbox cwd`, `explicit argv`, `no implicit interpolation`,
`clean env`, `process-tree kill`, `network deny by default`.

## Decision architecturale (M1, exécution après ADR-000)

1. **Pas d'exécution Code/Shell pour la cible première**
   `Automate Core × local-single-node × Windows` (cf.
   `EXECUTION_PROFILE_REQUIREMENTS.md §1.1`). L'IR cible (ADR-002) ne
   déclare pas `tool.code.javascript/typescript/python` ni
   `tool.shell` dans ses 6 `node families`.

2. **ADR ouvert pour extension post-M1**. Si un profile `Automate Code`
   ou `Automate Shell` est ajouté, cet ADR sera ré-ouvert pour fixer :
   - Le sandbox runtime : `sandbox-drivers/` (présent, à mesurer).
   - L'enforcement côté `WorkbenchOrchestrator` et `Capability Authority`.
   - Les quotas par run.
   - Le `process-tree kill` (signaux par OS).

3. **Aucun code Code/Shell GA** tant que cet ADR n'est pas rendu
   pour le profile cible.

## Consequences

- Les `node families` Code/Shell sont **explicitement absentes** de
  l'IR cible (ADR-002 §6 families).
- `sandbox-drivers/` est `KEEP` pour cible première ; `HARDEN` quand
  profile Code/Shell est exposé.
- THREAT_MODEL §1.8 (TM-CS-01..03) documenté, à implémenter quand le
  profile l'exige.

## Liens

- plan V2.3.1 §133-136
- THREAT_MODEL §1.8
- ADR-000, ADR-002
- ADR-024 (extension isolation — Code/Shell livré comme extension
  UNTRUSTED_THIRD_PARTY est isolé)
