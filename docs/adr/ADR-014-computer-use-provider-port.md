<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-014 — Computer Use Provider Port

> **Statut** : DECIDED
> **Date** : 2026-09-01
> **Source** : plan V2.3.1 §152-157, ADR-013, ADR-024, ADR-009.

## Status

DECIDED 2026-09-01. Dépend d'ADR-013 (browser), ADR-024 (extension),
ADR-009 (policy). Couvre le Browser Track B2 (post-M3).
Implémentation Computer Use différée à post-M3 (Browser B2) ; pour
la première certification, pas de Computer Use. Décision tranchée
sur la base de `AUTOMATE_TRUST_PATH §D.2`.

## Context

Plan V2.3.1 §152 : ports `ModelProviderPort`, `ComputerUseProviderPort`,
`BrowserExecutionPort`, `DesktopExecutionPort`.

§153 loop : `OBSERVE -> MODEL PROPOSES -> SCHEMA VALIDATION -> POLICY ->
CAPABILITY -> APPROVAL -> EXECUTE -> AUDIT -> OBSERVE`.

§154 preference order : `1 API, 2 MCP, 3 deterministic Browser, 4 AI
Browser Computer Use, 5 Desktop Computer Use`.

§155 human takeover : `pause -> invalidate model pending actions ->
human control -> new observation -> optional resume`.

§156 kill switch : scopes `global / organization / workspace / run /
browser / desktop`, durable.

§157 fail closed : worker incapable de revalider authorization au-delà
TTL -> `NO NEW SIDE EFFECT`.

## Decision

### Loop (plan §153)

```text
1. OBSERVE: Browser/Desktop observation -> Taint untrusted_external
2. MODEL PROPOSES: LLM propose une action
3. SCHEMA VALIDATION: action conforme au tool manifest
4. POLICY: NetworkPolicy + DataClassificationPolicy
5. CAPABILITY: Capability Authority grant
6. APPROVAL: si effet irreversible, approval obligatoire
7. EXECUTE: dispatcher exécute
8. AUDIT: append-only record
9. OBSERVE: nouvelle observation, retour a 1
```

### Preference order (plan §154)

- API first (structured, deterministic, auditable).
- MCP second.
- Deterministic Browser third.
- AI Browser Computer Use fourth.
- Desktop Computer Use last (best-effort).

### Takeover (plan §155)

```text
pause(): stop new dispatches
invalidateModelActions(): clear pending LLM actions
humanControl(): user takes over (UI shows control state)
newObservation(): after human action, capture new observation
optionalResume(): user can resume model control
```

### Kill switch (plan §156)

```ts
type KillSwitchScope = "global" | "organization" | "workspace" | "run" | "browser" | "desktop";

interface KillSwitch {
  scope: KillSwitchScope;
  scopeId: string;
  enabled: boolean;
  reason: string;
  enabledBy: string;        // actor
  enabledAt: number;        // ms epoch
  durable: true;            // persists in substrate
}

// Disable > TTL = expired
```

### Fail closed (plan §157)

```text
Si le worker ne peut pas revalider l'authorization au-delà du TTL:
  - No new side effect
  - Run échoue avec status UNAUTHORIZED
  - L'event est audité
```

## Consequences

- `@unifia/computer-use-safety/` (présent) implémente le port.
- `KillSwitch` type dans `contracts/desktop.ts` (étendu) ou
  `contracts/computer-use.ts` (nouveau).
- ADR-013 fournit `BrowserExecutionPort`.
- `DesktopExecutionPort` (plan §158-160) défini plus tard.

## Security impact

- TM-AG-02 (forbidden side effect) : addressé par §157 fail closed.
- TM-N-04 (prompt injection) : addressé par §150.
- TM-N-05 (secret in screenshot) : addressé par §148.

## Liens

- plan V2.3.1 §152-157
- THREAT_MODEL §1.6, §2
- ADR-009, ADR-013, ADR-024
