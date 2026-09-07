<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-018 — Rolling Upgrade Compatibility

> **Statut** : DECIDED
> **Date** : 2026-09-01
> **Source** : plan V2.3.1 §176-177, ADR-004, ADR-017, ADR-022.

## Status

DECIDED. Couvre le Distributed Server Track (post-M3, plan §209).

## Context

Plan V2.3.1 §176 : « Définit control-plane protocol, worker protocol,
min/max compatible versions, IR compatibility, history compatibility,
connector compatibility. »

§177 : migration pattern = `expand -> compatible rollout -> migrate ->
contract`.

## Decision

### Compatibilité des versions

- Min compatible = N-1 (un worker N-1 peut parler à un control plane N).
- Max compatible = N+1 (un control plane N+1 peut piloter un worker N).
- IR compatibility : un `WorkflowVersion` publié en N reste lisible en
  N+1 (digest ADR-001 vérifié).
- History compatibility : un substrate history en N est lisible en N+1
  (migrations de schéma versionnées).
- Connector compatibility : un `ConnectorManifest` signé en N est
  chargeable en N+1.

### Pattern de migration (plan §177)

```text
expand:
  - N+1 lit les IR/history/connector N (backward compatible)

compatible rollout:
  - control plane N+1 déployé en premier
  - workers N continuent à fonctionner (ils parlent N au control plane N+1
    via min compatibility)
  - nouveaux workers N+1 sont ajoutés
  - tout est vert

migrate:
  - arrêt des workers N (drain des leases)
  - tous les workers deviennent N+1
  - IR/history en lecture seule N, et en lecture/écriture N+1

contract:
  - ancienne version N retirée
  - nouveau code N+1 uniquement
```

### Tests obligatoires

- Old worker + new control plane.
- New worker + old control plane.
- IR publié en N, exécuté en N+1.
- History N lu en N+1.
- Connector N chargé en N+1.

### Drain des leases (plan §105)

```ts
// Avant arrêt d'un worker N, le control plane:
// 1. Refuse les nouvelles leases N
// 2. Attend que les leases en cours expirent
// 3. Vérifie que tous les leases N sont expirés
// 4. Marque le worker N comme drained
// 5. Worker N peut être arrêté sans perte
```

### ADR-022 (Timer) interaction

Les `durable timer` actifs en N doivent continuer à firer en N+1. Le
substrate (ADR-000) gère la persistance des timers.

## Consequences

- `protocol` versionné dans `contracts/` (déjà partiellement).
- Tests E2E obligatoires avant chaque release.
- `VERSION` fichier à la racine du repo (cf. pratiques habituelles).

## Liens

- plan V2.3.1 §176-177, §209
- ADR-000, ADR-004, ADR-008 (lease), ADR-017 (legacy), ADR-022 (timer)
