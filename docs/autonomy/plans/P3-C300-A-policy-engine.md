# P3-C300-A — PolicyEngine (interface)

**Statut :** `INTEGRATED` (interface documentée, BLOQUÉ par audit humain)
**Date :** 2026-08-01
**Parent :** P3-C300 (Security foundation)

## ⚠️ SECURITY-CRITICAL

Cette carte nécessite une **revue externe humaine** avant production.

## Objectif

Définir le **PolicyEngine** qui implémente le default-deny pour toutes les actions sensibles.

## Interface

```typescript
// packages/security/src/policy.ts
export interface PolicyEngine {
  evaluate(input: PolicyInput): Promise<PolicyDecision>
  register(policy: Policy): Promise<void>
  revoke(policyId: string): Promise<void>
  list(): Promise<Policy[]>
}

export interface PolicyInput {
  capabilityId: string
  inputs: Record<string, any>
  context: {
    workspaceId: string
    userId: string
    sessionId?: string
    riskLevel?: RiskLevel
  }
}

export type PolicyDecision =
  | { type: "allow" }
  | { type: "deny"; reason: string; policyId?: string }
  | { type: "require_approval"; approver: string; timeoutMs: number }
  | { type: "rate_limit"; retryAfterMs: number }

export interface Policy {
  id: string
  selector: {
    capabilityId?: string
    workspaceId?: string
    userId?: string
    riskLevel?: RiskLevel
  }
  action: "allow" | "deny" | "approve"
  conditions?: PolicyCondition[]
  priority: number
}

export type RiskLevel = "low" | "medium" | "high" | "critical"
```

## Default policies

| Capability | Default | Notes |
|---|---|---|
| `unifia.file.read` | allow | Lecture workspace |
| `unifia.file.write` | allow | Écriture workspace |
| `unifia.command.run` | require_approval | Commandes shell |
| `unifia.git.commit` | allow | Commit local |
| `unifia.git.push` | require_approval | Push réseau |
| `unifia.browser.automate` | require_approval | Browser automation |
| `unifia.computer.use` | require_approval | Computer control |
| `unifia.secret.read` | approve | Lecture secrets |

## Estimation

- PolicyEngine : ~500 LOC
- Default policies : ~300 LOC
- Tests : ~300 LOC
- **Total : ~1100 LOC**

## Liens

- [ADR-0006 PolicyEngine](docs/adr/0006-policy-engine.md)
- [P2-C200-C CapabilityPort](plans/P2-C200-C-capability-port.md)
- [SECURITY-INCIDENT-RESPONSE.md](../SECURITY-INCIDENT-RESPONSE.md)