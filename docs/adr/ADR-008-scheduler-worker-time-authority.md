<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-008 — Scheduler / Worker / Time Authority

> **Statut** : DECIDED
> **Date** : 2026-09-01
> **Source** : plan V2.3.1 §100-107, ADR-004, ADR-022.

## Status

DECIDED 2026-09-01. Dépend d'ADR-000 (substrate), ADR-004 (history),
ADR-022 (timer). Couvre M2-M3. Décision tranchée sur la base de
`docs/automation-v2/spikes/M0-01-EVIDENCE.md` (absence confirmée de
worker identity / lease / fencing dans le runtime actuel).

## Context

Plan V2.3.1 §100 définit le scheduler/worker/time authority. Plan §100
énumère :

```text
IANA timezone
DST ambiguous time
DST nonexistent time
missed execution
catch-up policy
maximum catch-up
overlap policy
duplicate firing
clock jump
restart behavior
```

§101 : overlap policy = `ALLOW / FORBID / QUEUE / REPLACE`.

§102 : lease/timer expiry utilise le **durable/control-plane time
authority**. **Jamais l'horloge déclarée du worker.**

§103 : tests = `worker +5min`, `worker -5min`, `NTP jump`, `control
plane restart`, `lease renewal races`.

§104-107 : worker identity, lease, zombie test, fairness.

## Decision

### Worker identity (plan §104)

```ts
type WorkerId = {
  workerId: string;            // unique
  identityProof: string;       // signed by ADR-010 key
  version: string;
  platform: string;            // OS + arch
  capabilities: string[];      // node families supported
  executionProfiles: ExecutionProfile[];
  resourceClass: string;       // e.g. "small" | "medium" | "large"
};
```

### Lease (plan §105)

```ts
type Lease = {
  workerId: WorkerId;
  leaseGeneration: number;     // monotonically increasing
  leaseToken: string;          // opaque, signed by control plane
  expiresAt: number;           // ms epoch
};

// Fencing: stale commit rejected if leaseToken doesn't match current
```

### Time authority (plan §102, §103)

```ts
// Toutes les decisions de timer/lease utilisent le control-plane clock.
// Worker clock n'est PAS autoritaire.
// Tests obligatoires: worker+5min, worker-5min, NTP jump, control plane
// restart, lease renewal races.
```

### Schedule policies (plan §101)

```ts
type OverlapPolicy = "allow" | "forbid" | "queue" | "replace";
type CatchUpPolicy = "skip" | "fire-once" | "fire-each-missed";
// Maximum catch-up: configurable (default 24h)
```

### Zombie test (plan §106)

```text
A gets lease
A freezes
lease expires
B receives newer lease
B commits
A returns
A stale commit rejected
```

### Fairness (plan §107)

```text
- Tenant starvation prevention: per-tenant quota + max-pending
- Workflow starvation prevention: max-pending per workflow
- One-user monopolization prevention: per-user quota
```

## Consequences

- Le `Workflow Kernel` (substrate) gère leases et time authority.
- `Capability Authority` est consultée pour `workerId.identityProof`.
- ADR-022 (Timer) consomme le time authority.
- M2 tests obligatoires (plan §199) : fan-out/fan-in, parallel race.

## Security impact

- TM-T-01 (A lit B workflow) : addressé par `OwnershipScope` sur lease.
- TM-W-01 (switch désactivé) : addressé par lease revocation.

## Liens

- plan V2.3.1 §100-107
- ADR-000, ADR-004, ADR-022
