# P3-C300-B — ApprovalBroker

**Statut :** `INTEGRATED` (interface documentée, BLOQUÉ par audit humain)
**Date :** 2026-08-01
**Parent :** P3-C300 (Security foundation)

## ⚠️ SECURITY-CRITICAL

Cette carte nécessite une **revue externe humaine** avant production.

## Objectif

Implémenter le **workflow d'approbation** quand une policy retourne `require_approval`.

## Workflow

```
[Capability demandée]
     ↓
[PolicyEngine.evaluate] → require_approval
     ↓
[ApprovalBroker.request]
     ↓
[Notifie les approvers (Slack/email/UI)]
     ↓
[Wait for response (timeout)]
     ↓
   [Approved] → Execute
   [Denied]   → Cancel
   [Timeout]   → Cancel
```

## Interface

```typescript
export interface ApprovalBroker {
  request(input: ApprovalRequest): Promise<ApprovalResult>
  cancel(requestId: string): Promise<void>
  subscribe(approver: string): AsyncIterable<ApprovalRequest>
  respond(requestId: string, response: ApprovalResponse): Promise<void>
}

export interface ApprovalRequest {
  id: string
  capabilityId: string
  inputs: Record<string, any>
  context: PolicyInput["context"]
  approver: string  // who can approve
  timeoutMs: number
  createdAt: number
}

export interface ApprovalResponse {
  approved: boolean
  approver: string
  reason?: string
  timestamp: number
}

export type ApprovalResult =
  | { type: "approved"; approver: string }
  | { type: "denied"; approver: string; reason?: string }
  | { type: "timeout" }
  | { type: "cancelled" }
```

## Stratégies d'approbation

- **Single approver** : 1 personne suffit
- **Multi-approver** (N-of-M) : N personnes parmi M
- **Timeout-based** : auto-deny après X minutes
- **Risk-based** : risk > high → approver spécifique

## Canaux de notification

- Slack : webhook + DM
- Email : SMTP
- UI : WebSocket push

## Estimation

- ApprovalBroker : ~400 LOC
- Channels : ~300 LOC (Slack, Email, UI)
- Tests : ~200 LOC
- **Total : ~900 LOC**

## Liens

- [ADR-0007 ApprovalBroker](docs/adr/0007-approval-broker.md)
- [P3-C300-A PolicyEngine](plans/P3-C300-A-policy-engine.md)
- [ADR-0006 PolicyEngine](docs/adr/0006-policy-engine.md)