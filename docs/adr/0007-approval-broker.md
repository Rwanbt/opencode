---
id: 0007
title: ApprovalBroker
status: READY_FOR_REVIEW  # V3 draft (CP7 — 2026-09-03)
status_v2: READY_FOR_REVIEW  # V2 (2026-09-03 review v1.1)
status_v1: PROPOSED           # legacy 2026-07-31 V1, à archiver
date: 2026-07-31
date_v2: 2026-09-03
date_v3: 2026-09-04  # CP7 — current plan digest at resolve, requester/approver split, ApprovalHistoryEvent, cancel, real (non-scaffold) tests
---

# ADR-0007: ApprovalBroker V3 — workflow d'approbation

**Statut :** `READY_FOR_REVIEW` (V3 draft, CP7 2026-09-04)
**Date initiale :** 2026-07-31 (V1 PROPOSED, conservé pour archive)
**Date V2 :** 2026-09-03 (intègre les invariants pack gelé + ADR-033 + ADR-009)
**Date V3 :** 2026-09-04 (intègre les findings CP7 : current plan digest at resolve,
requester ≠ approver explicite, ApprovalHistoryEvent append-only, cancel,
et 18 tests réels (non scaffold) sur les deux candidats substrate-neutral)
**Décideurs :** Erwan (signature finale), Mavis (rédaction)
**Source :** Plan V3 §5/§8.3/§8.7, pack gelé §34-§35, review v1.1, CP7 (2026-09-04)

> **Cette V3 NE REMPLACE PAS** la V2 par un overwrite silencieux.
> La V2 est archivée en bas de fichier pour traçabilité.

## Changements V2 → V3 (CP7, 2026-09-04)

1. **`currentExecutionPlanDigest` à `resolve`** : le caller DOIT
   présenter le digest du plan courant au moment du resolve. Si
   le digest ne matche pas celui stocké à `provideApproval`,
   l'approval transitionne à `STALE` et le resolve est
   REJETÉ (pas de mutation d'état). C'est l'invariant
   anti-TOCTOU qui manquait en V2.
2. **`requesterPrincipalId` séparé du `actor` au resolve** : la
   V2 stockait `principal.id` mais ne le vérifiait pas contre
   l'actor du resolve. La V3 refuse explicitement le
   `SELF_APPROVAL_REJECTED` quand `actor.id == requesterPrincipalId`.
3. **`ApprovalHistoryEvent` append-only** : remplace la notion
   de "history = list of approval requests" par un journal
   d'événements (REQUESTED, APPROVED, DENIED, EXPIRED,
   CANCELLED, STALE_DIGEST_MISMATCH) avec actor + reason +
   timestamp + executionPlanDigest. Le `listHistory()` est
   devenu `approvalHistory(approvalId) → readonly ApprovalHistoryEvent[]`.
4. **`cancelApproval` ajouté** : le requester (ou un
   `SYSTEM_CANCEL`) peut annuler une approval PENDING. Un
   non-requester principal ne peut pas cancel (CANCEL_REJECTED).
5. **`ExecutionPlanDigest` brandé** : `type ExecutionPlanDigest = string & { __brand: "ExecutionPlanDigest" }` — les adapters
   ne peuvent pas silencieusement widener le type.
6. **Pas de `revokeGrant`** : la V2 avait `revokeGrant(grantId)`
   mais ne spécifiait pas la sémantique de "reusable grants".
   La V3 retire complètement la notion (suppression du code et
   du contrat). Si des reusable grants sont nécessaires dans
   le futur, ils feront l'objet d'un ADR séparé avec un contrat
   complet.
7. **18 tests réels sur les deux candidats** (CP8). Les tests
   scaffold (`expect(true).toBe(true)`) ont été remplacés par
   des assertions sur le comportement réel des adapters
   (Native + DBOS Go). Chaque test exerce le contrat
   substrate-neutral ; les deux candidats partagent le même
   oracle.

## Décision V3 (reprise, avec ajouts V3)

Adopter le pattern **ApprovalBroker V3** avec invariants stricts
(pack gelé §25-§28 + CP7) :

### API conceptuelle

```typescript
interface ApprovalBrokerV3 {
  request(req: ApprovalRequestV3): Promise<ApprovalHandleV3>
  resolve(
    approvalId: ApprovalId,
    decision: "APPROVED" | "DENIED",
    actor: Principal,             // OBLIGATOIRE
    currentResolve: ApprovalResolveInput,  // CP7 : currentExecutionPlanDigest + reason
  ): Promise<ApprovalOutcomeV3>
  cancel(                             // CP7 : nouveau
    approvalId: ApprovalId,
    actor: Principal | SYSTEM_CANCEL,  // actor must be requester
    reason: string,
  ): Promise<ApprovalOutcomeV3>
  inspect(approvalId: ApprovalId): Promise<ApprovalOutcomeV3>
  approvalHistory(                    // CP7 : remplace listHistory
    approvalId: ApprovalId,
  ): Promise<readonly ApprovalHistoryEvent[]>
  // revokeGrant(grantId) SUPPRIMÉ (CP7 §8)
}
```

**Note** : pas de `evaluate()` (séparation Policy/Approval). Pas de
`approve-once / approve-forever` non borné. Pas de reusable
grants en V3. L'API est **strictement minimale** et
substrate-neutral.

### Types principaux (V3)

```typescript
type ExecutionPlanDigest = string & { readonly __brand: "ExecutionPlanDigest" }

type ApprovalRequestV3 = {
  approvalId: ApprovalId
  workflowRunId: WorkflowRunId
  logicalInvocationId?: LogicalInvocationId
  executionPlanDigest: ExecutionPlanDigest
  requesterPrincipalId: string   // CP7 : distinct from approver
  ordinal: number
  requestGeneration: number      // CP7 : distinct approvals
  ownershipScope: OwnershipScope
  deploymentScope: DeploymentScope
  capabilityRefs: CapabilityRef[]
  resourceScope: ResourceScope
  policyDecisionRef: string
  policyVersion: string
  createdAtEpochMs: number
  expiresAtEpochMs: number       // fail-closed past
  state: "PENDING" | "APPROVED" | "DENIED" | "EXPIRED" | "CANCELLED" | "STALE"
}

type ApprovalResolveInput = {
  currentExecutionPlanDigest: ExecutionPlanDigest  // CP7 : TOCTOU guard
  reason?: string
}

type ApprovalOutcomeV3 = {
  approvalId: ApprovalId
  state: ApprovalState
  actor?: Principal
  resolvedAtEpochMs?: number
  reason?: string
}

type ApprovalState =
  | "PENDING" | "APPROVED" | "DENIED"
  | "EXPIRED" | "CANCELLED" | "STALE"

type ApprovalHistoryEventType =
  | "REQUESTED" | "APPROVED" | "DENIED"
  | "EXPIRED" | "CANCELLED"
  | "STALE_PLAN_CHANGED" | "STALE_DIGEST_MISMATCH"
  | "REPLAYED_RESOLVE"

type ApprovalHistoryEvent = {
  eventId: string
  approvalId: ApprovalId
  eventType: ApprovalHistoryEventType
  previousState: ApprovalState | null
  newState: ApprovalState
  actorId: string | null
  timestampEpochMs: number
  reason: string | null
  executionPlanDigest: ExecutionPlanDigest | null
}
```

### Invariants OBLIGATOIRES (per pack gelé §26, étendus V3)

1. `pending approval survives restart` : l'authority est durable
2. `single effective resolution` : un approval est résolu UNE
   fois. Deux appels sur le même `approvalId` sont idempotents
   (même outcome) ou **REJETÉS** (erreur `APPROVAL_ALREADY_RESOLVED`)
3. `resolve idempotent` : rejouer la même décision par le même
   actor = même résultat
4. `actor mandatory` : pas de résolution sans Principal
5. `expiry fail-closed` : `PENDING` + `expiresAtEpochMs < now` =
   `EXPIRED` (jamais exécuté)
6. `no widening` : (reusable grants retirés, voir §8)
7. `approval bound to immutable execution-plan digest` :
   `currentExecutionPlanDigest` au resolve DOIT matcher le
   `executionPlanDigest` stocké à `provideApproval`. Sinon
   `STALE` + `APPROVAL_STALE_PLAN` (CP7)
8. `changed plan → STALE` : si le plan a changé entre `request`
   et `resolve`, l'approval devient `STALE` et requiert une
   nouvelle demande (CP7)
9. `revocation explicit` : `cancelApproval` annule une approval
   PENDING ; un non-requester ne peut pas cancel
   (CANCEL_REJECTED) (CP7)
10. `history auditable` : `approvalHistory(approvalId)` retourne
    l'append-only `ApprovalHistoryEvent[]` ordonné (CP7)
11. `no ID reuse after restart` : un `approvalId` ne peut pas
    être réémis sur un approval antérieur
12. `workflow/LLM cannot self-approve` : `actor.id` DOIT être
    différent de `requesterPrincipalId` ; sinon
    `SELF_APPROVAL_REJECTED` (CP7)
13. (V3 nouveau) `cancelled approval cannot execute` :
    `cancelApproval` transitionne l'approval à `CANCELLED`,
    un resolve postérieur est REJETÉ
14. (V3 nouveau) `current plan digest at resolve` : le
    `currentExecutionPlanDigest` est REQUIRED à chaque resolve
    ; il n'est pas optional (V2 avait cette confusion)

### Séparation Policy Authority / Approval Authority

| Composant | Responsabilité |
|---|---|
| **Policy Authority** (ADR-009) | Détermine `allow / deny / require-approval` de manière déterministe, versionnée |
| **Approval Broker V3** | Matérialise et résout la décision humaine, ne réévalue PAS la policy |

L'API n'expose **plus** `evaluate()` (qui était ambiguë en V1).
La séparation est conceptuelle ET technique.

### ApprovalBroker = facade, pas une seconde authority (CP7 §9)

Le broker n'est PAS une `WorkflowRun` authority distincte. C'est
une **domain facade** sur la même authority :

```
Candidate (WorkflowRun authority)
       ↑
       | (provides state + history)
       ↓
Approval Broker (facade)
       ↑
       | (queries)
       ↓
UI / caller
```

Le broker **partage** la même `M0_STORE_DIR` et le même
authority fencing (`run_authority` table, `authorityOwnerId`)
que la WorkflowRun authority. Aucune approval ne peut muter
un run state sans le fencing token de la WorkflowRun authority.

### Anti-patterns interdits

- ❌ "Approve forever" non borné (V1 l'autorisait, V2/V3 l'interdit)
- ❌ `evaluate()` qui réévalue la policy
- ❌ Reuse d'`approvalId` après cancel/expiry
- ❌ `actor.id == requesterPrincipalId` (self-approve)
- ❌ Resolve sans `currentExecutionPlanDigest` match
- ❌ Widening implicite du scope d'un reusable grant (reusable
  grants retirés en V3)
- ❌ `revokeGrant` (supprimé en V3)
- ❌ `listHistory` qui retourne `ApprovalRequest[]` (V2) — c'est
  un `ApprovalHistoryEvent[]` append-only en V3

## Conséquences

### Positives (V3)

- ✅ **Transparence** : l'utilisateur voit le plan immutable
- ✅ **Audit complet** : `approvalHistory` retourne tous les
  événements dans l'ordre canonique
- ✅ **Expiration** : `expiresAtEpochMs` est un hard deadline
- ✅ **TOCTOU prevented** : le digest binding détecte le stale
- ✅ **Self-approve prevented** : `actor ≠ requesterPrincipalId`
- ✅ **Cancel explicite** : `cancelApproval` est une
  transition d'état, pas un flag
- ✅ **Shared authority** : le broker n'est pas une seconde
  authority — c'est une facade

### Négatives

- ❌ **Plus de friction UX** : pas d'approve-forever, chaque
  action sensible demande explicitement
- ❌ **Plus de code** : binding digest, scope checks, history
- ❌ **Pas de reusable grants** (V2 les avait partiellement) :
  si besoin, ADR séparé avec contrat complet

## Tests négatifs OBLIGATOIRES (V3)

Avant que ADR-0007 puisse être `DECIDED`, les 12 tests négatifs
suivants doivent PASS (implémentés dans
`packages/automate-m0-harness/test/approval-v2.test.ts`) :

| # | Test | V3 contract |
|---|---|---|
| 1 | expired approval cannot execute | `now > expiresAtEpochMs` → `EXPIRED` |
| 2 | different actor/scope cannot reuse approval | digest mismatch → `STALE` |
| 3 | resource widening rejected | (reusable grants retirés — N/A V3) |
| 4 | changed execution-plan digest rejected | `STALE_DIGEST_MISMATCH` |
| 5 | already resolved approval cannot mutate | `APPROVAL_ALREADY_RESOLVED` |
| 6 | cancelled approval cannot execute | `CANCELLED` + resolve REJECTED |
| 7 | unknown approval denied | (implicite : `approval not found`) |
| 8 | restart preserves pending request | (FC-31A restart path) |
| 9 | workflow/LLM cannot self-approve | `SELF_APPROVAL_REJECTED` |
| 10 | no ID reuse after restart | (à vérifier dans un test future) |
| 11 | replayable history | `approvalHistory` retourne les events |
| 12 | revocation blocks new requests | `cancelApproval` REJETTE le resolve |

**Résultat CP7 (2026-09-04)** : 18/18 tests PASS (9 cas × 2
candidats = UNIFIA_NATIVE + DBOS_GO_SQLITE) en 1.66s. Chaque
test exerce les deux candidats via le même oracle
substrate-neutral.

## Plan d'implémentation (V3)

- **Phase 1 (cette session — CP7)** : V3 dans ce fichier,
  contract V3 dans `packages/automate-m0-harness/src/qualification/contract.ts`,
  implémentation V3 dans Native + DBOS Go adapters, 18 tests
  réels dans `test/approval-v2.test.ts`. Statut actuel :
  `READY_FOR_REVIEW`.
- **Phase 2** : review par Erwan, passage à `DECIDED`
- **Phase 3** : ADR-033 peut alors être `CHANGES_REQUIRED` →
  re-préparé avec negative contract tests PASS
- **Phase 4** : ADR-008 (CanonicalTimestamp) doit être finalisé
  pour que les `expiresAtEpochMs` soient alignés sur le
  time authority boundary du substrate

## Alternatives considérées

### A. Garder la V1 (PROPOSED)
- **Rejeté** : V1 a des trous architecturaux (pas de digest binding,
  approve-forever, etc.)

### B. Approval via TOTP / 2FA
- **À reconsidérer** : pour les actions TRÈS sensibles, 2FA en plus
  de l'approval broker

### C. Approval via Slack/Feishu externe
- **Rejeté** : ne marche pas offline, dépendance externe au
  critical path

### D. Pas d'approbation (auto-approve tout)
- **Rejeté** : viole Plan V3 §8.3, ADR-033 l'exige

### E. Reusable grants comme V2
- **Rejeté (V3)** : la V2 n'a pas spécifié complètement
  la sémantique de "reusable grants" (resource widening,
  revoke semantics). V3 les retire. Si nécessaire, ADR
  séparé avec contrat complet.

## Liens

- `docs/adr/0009-audit-runtime.md` — trace chaque approval
- `docs/adr/ADR-009-policy-authority.md` — Policy Authority
- `docs/adr/ADR-024-extension-runtime-trust-isolation.md` — Capability
- `docs/adr/ADR-033-untrusted-code-shell-security.md` — exige ce contrat
- `packages/automate-m0-harness/src/qualification/contract.ts` — interface V3
- `packages/automate-m0-harness/test/approval-v2.test.ts` — 18 tests V3
- `docs/automation-v2/m0/M0_BLOCKED.md` §2 — méthodologie gaps

---

# V2 ARCHIVÉE (2026-09-03, `READY_FOR_REVIEW`)

> Conservée pour traçabilité. NE PLUS UTILISER. Voir V3 ci-dessus.

V2 exposait l'API :

```typescript
interface ApprovalBrokerV2 {
  request(req: ApprovalRequestV2): Promise<ApprovalHandleV2>
  resolve(
    approvalId: ApprovalId,
    decision: "APPROVED" | "DENIED",
    actor: Principal,
  ): Promise<ApprovalOutcomeV2>
  cancel(approvalId: ApprovalId, actor: Principal): Promise<void>
  inspect(approvalId: ApprovalId): Promise<ApprovalRequestV2>
  listPending(filter?: ApprovalFilter): Promise<ApprovalRequestV2[]>
  listHistory(filter?: ApprovalFilter): Promise<ApprovalRequestV2[]>
  revokeGrant(grantId: string, actor: Principal): Promise<void>
}
```

V2 gaps identifiés en V3 (CP7) :
1. Pas de `currentExecutionPlanDigest` à `resolve` (TOCTOU)
2. `actor` et `requester` non explicitement distincts (self-approval)
3. `listHistory` retourne `ApprovalRequest[]` (état) au lieu de
   `ApprovalHistoryEvent[]` (journal d'événements append-only)
4. `revokeGrant` sans sémantique de reusable grants
5. `cancel(actor)` autorise n'importe quel actor (V3 restreint
   au requester ou SYSTEM_CANCEL)

**V3 ci-dessus adresse tous ces gaps.**

---

# V1 ARCHIVÉE (2026-07-31, `PROPOSED`)

> Conservée pour traçabilité. NE PLUS UTILISER. Voir V3 ci-dessus.

**Statut V1 :** `PROPOSED` (legacy)

V1 exposait l'API :
```typescript
interface ApprovalBroker {
  request(request: ApprovalRequest): Promise<ApprovalHandle>
  listPending(filter?: ApprovalFilter): Promise<PendingApproval[]>
  decide(approvalId: string, decision: ApprovalDecision): Promise<ApprovalResult>
  listHistory(filter?: ApprovalHistoryFilter): Promise<ApprovalHistoryEntry[]>
  revoke(grantId: string): Promise<void>
}
```

avec `ApprovalDecision = approve / deny / approve-once` (le
"approve-once" n'était pas borné). Pas de binding digest. Pas
d'actor mandatory. Pas de durabilité au restart.

V1 gaps (post review v1.1 2026-09-03) :
1. Pas de binding ExecutionPlan immutable + canonical digest
2. Pas de séparation explicite Policy / Approval
3. Pas de durabilité au restart
4. "Approve forever" non borné
5. Pas d'expiration / revocation explicite

**V2 ci-dessus adresse tous ces gaps. V3 adresse les gaps
restants de la V2.**

## Contexte

Unifia doit gérer un **workflow d'approbation** pour les actions
sensibles. Quand un agent demande une action qui requiert
approbation (PolicyAuthority retourne `require-approval`),
l'utilisateur doit pouvoir :

- Approuver ou refuser depuis l'UI
- Approuver une fois (reusable grants strictement bornés)
- Voir l'historique des approbations
- Révoquer une approbation

**V1 gaps identifiés en review v1.1** (2026-09-03) :

1. Pas de binding explicite à un **ExecutionPlan immutable + canonical
   digest** (ADR-033 l'exige)
2. Pas de séparation explicite **Policy Authority / Approval Authority**
   (l'API `evaluate()` est ambiguë)
3. Pas de **durabilité** au restart du kernel
4. **"Approve forever"** non borné → danger
5. Pas d'**expiration / revocation** explicite

## Décision V2

Adopter le pattern **ApprovalBroker V2** avec invariants stricts
(pack gelé §25-§28) :

### API conceptuelle

```typescript
interface ApprovalBrokerV2 {
  request(req: ApprovalRequestV2): Promise<ApprovalHandleV2>
  resolve(
    approvalId: ApprovalId,
    decision: "APPROVED" | "DENIED",
    actor: Principal,             // OBLIGATOIRE
  ): Promise<ApprovalOutcomeV2>
  cancel(approvalId: ApprovalId, actor: Principal): Promise<void>
  inspect(approvalId: ApprovalId): Promise<ApprovalRequestV2>
  listPending(filter?: ApprovalFilter): Promise<ApprovalRequestV2[]>
  listHistory(filter?: ApprovalFilter): Promise<ApprovalRequestV2[]>
  revokeGrant(grantId: string, actor: Principal): Promise<void>
}
```

**Note** : pas de `evaluate()` (séparation Policy/Approval). Pas de
`approve-once / approve-forever` non borné. L'API est **strictement
minimale** et substrate-neutral.

### Types principaux

```typescript
type ApprovalRequestV2 = {
  approvalId: ApprovalId                    // deterministe
  workflowRunId: WorkflowRunId
  logicalInvocationId?: LogicalInvocationId
  executionPlanDigest: string                // BINDING to immutable plan
  principal: Principal
  ownershipScope: OwnershipScope             // org + workspace
  deploymentScope: DeploymentScope
  capabilityRefs: CapabilityRef[]            // what the plan uses
  resourceScope: ResourceScope               // what resources
  policyDecisionRef: string                  // reference to Policy Authority
  policyVersion: string                      // version of policy
  createdAtEpochMs: number
  expiresAtEpochMs: number                   // fail-closed past
  state: "PENDING" | "APPROVED" | "DENIED" | "EXPIRED" | "CANCELLED" | "STALE"
}

type ApprovalOutcomeV2 = {
  approvalId: ApprovalId
  state: ApprovalState
  actor?: Principal
  resolvedAtEpochMs?: number
  reason?: string
}

type ApprovalState = "PENDING" | "APPROVED" | "DENIED" | "EXPIRED" | "CANCELLED" | "STALE"
```

### Invariants OBLIGATOIRES (per pack gelé §26)

1. **`pending approval survives restart`** : l'authority est durable
2. **`single effective resolution`** : un approval est résolu UNE
   fois. Deux appels sur le même `approvalId` sont idempotents
   (même outcome) ou closed (erreur)
3. **`resolve idempotent`** : rejouer la même décision = même résultat
4. **`actor mandatory`** : pas de résolution sans Principal
5. **`expiry fail-closed`** : `PENDING` + `expiresAtEpochMs < now` =
   `EXPIRED` (jamais exécuté)
6. **`no widening`** : un reusable grant ne peut pas étendre sa
   scope (principal, scope, capability, resource, policy version)
   sans nouvelle approval
7. **`approval bound to immutable execution-plan digest`** : la
   résolution vérifie que `executionPlanDigest` matche le plan
   courant
8. **`changed plan` → `APPROVAL_STALE`** : si le plan a changé
   entre `request` et `resolve`, l'approval devient STALE et
   requiert une nouvelle demande
9. **`revocation explicit`** : `revokeGrant` annule un reusable
   grant ; la prochaine demande repart de zéro
10. **`history auditable`** : chaque action est loggée append-only
11. **`no ID reuse after restart`** : un `approvalId` ne peut pas
    être réémis sur un approval antérieur
12. **`workflow/LLM cannot self-approve`** : le `principal.id` ne peut
    pas être l'agent qui demande l'action

### Séparation Policy Authority / Approval Authority

| Composant | Responsabilité |
|---|---|
| **Policy Authority** (ADR-009) | Détermine `allow / deny / require-approval` de manière déterministe, versionnée |
| **Approval Broker V2** | Matérialise et résout la décision humaine, ne réévalue PAS la policy |

L'API n'expose **plus** `evaluate()` (qui était ambiguë en V1).
La séparation est conceptuelle ET technique.

### Anti-patterns interdits

- ❌ "Approve forever" non borné (V1 l'autorisait, V2 l'interdit)
- ❌ `evaluate()` qui réévalue la policy
- ❌ Reuse d'`approvalId` après cancel/expiry
- ❌ `actor.id == workflow.principalId` (self-approve)
- ❌ Resolution sans `executionPlanDigest` match
- ❌ Widening implicite du scope d'un reusable grant

## Conséquences

### Positives
- ✅ **Transparence** : l'utilisateur voit le plan immutable
  (`executionPlanDigest` = hash canonique)
- ✅ **Audit complet** : chaque action loggée, replay possible
- ✅ **Expiration** : `expiresAtEpochMs` est un hard deadline
- ✅ **Révocation** : `revokeGrant` annule un reusable grant
- ✅ **TOCTOU prevented** : digest binding détecte le stale
- ✅ **Self-approve prevented** : actor ≠ workflow principal

### Négatives
- ❌ **Plus de friction UX** : pas d'approve-forever, chaque
  action sensible demande explicitement
- ❌ **Plus de code** : binding digest, scope checks, etc.

### Neutres
- Approval Broker V2 ne décide pas la policy
- Approval Broker V2 ne trigger pas l'exécution ; c'est le runtime
  qui consulte l'outcome avant de dispatcher

## Tests négatifs OBLIGATOIRES (per pack gelé §35)

Avant que ADR-0007 puisse être `DECIDED`, les tests négatifs suivants
doivent PASS :

1. **expired approval cannot execute** : `now > expiresAtEpochMs`
   → `EXPIRED`, runtime refuse d'exécuter
2. **different actor/scope cannot reuse approval** : un autre
   principal ne peut pas resolve un approval
3. **resource widening rejected** : un reusable grant ne peut pas
   couvrir plus de ressources que l'approval initiale
4. **changed execution-plan digest rejected** : `STALE` si le
   plan a changé
5. **already resolved approval cannot mutate** : second resolve
   = idempotent ou closed (pas de re-apply silencieux)
6. **cancelled approval cannot execute** : `CANCELLED` → runtime
   refuse
7. **unknown approval denied** : `approvalId` inconnu → `DENIED`
8. **restart preserves pending request** : crash + reopen → la
   même `PENDING` approval est lisible
9. **workflow/LLM cannot self-approve** : actor check
10. **no ID reuse after restart** : nouveau `approvalId` ne peut
    pas être l'ancien
11. **replayable history** : `listHistory` retourne l'audit complet
12. **revocation blocks new requests** : un grant révoqué ne peut
    pas être réutilisé

## Plan d'implémentation

- **Phase 1 (cette session)** : draft V2 dans ce fichier, `READY_FOR_REVIEW`
- **Phase 2** : implémentation `LocalApprovalBrokerV2` (M0 harness
  déjà partielle dans `native-sqlite.ts`)
- **Phase 3** : tests négatifs dans `test/approval-v2.test.ts`
- **Phase 4** : review par Erwan, passage à `DECIDED`
- **Phase 5** : ADR-033 peut alors être `CHANGES_REQUIRED` → re-préparé
  avec negative contract tests PASS

## Alternatives considérées

### A. Garder la V1 (PROPOSED)
- **Rejeté** : V1 a des trous architecturaux (pas de digest binding,
  approve-forever, etc.)

### B. Approval via TOTP / 2FA
- **À reconsidérer** : pour les actions TRÈS sensibles, 2FA en plus
  de l'approval broker

### C. Approval via Slack/Feishu externe
- **Rejeté** : ne marche pas offline, dépendance externe au
  critical path

### D. Pas d'approbation (auto-approve tout)
- **Rejeté** : viole Plan V3 §8.3, ADR-033 l'exige

## Liens

- `docs/adr/0009-audit-runtime.md` — trace chaque approval
- `docs/adr/ADR-009-policy-authority.md` — Policy Authority
- `docs/adr/ADR-024-extension-runtime-trust-isolation.md` — Capability
- `docs/adr/ADR-033-untrusted-code-shell-security.md` — exige ce contrat
- `docs/automation-v2/m0/M0_BLOCKED.md` §2 — méthodologie gaps

---

# V1 ARCHIVÉE (2026-07-31, `PROPOSED`)

> Conservée pour traçabilité. NE PLUS UTILISER. Voir V2 ci-dessus.

**Statut V1 :** `PROPOSED` (legacy)

V1 exposait l'API :
```typescript
interface ApprovalBroker {
  request(request: ApprovalRequest): Promise<ApprovalHandle>
  listPending(filter?: ApprovalFilter): Promise<PendingApproval[]>
  decide(approvalId: string, decision: ApprovalDecision): Promise<ApprovalResult>
  listHistory(filter?: ApprovalHistoryFilter): Promise<ApprovalHistoryEntry[]>
  revoke(grantId: string): Promise<void>
}
```

avec `ApprovalDecision = approve / deny / approve-once` (le
"approve-once" n'était pas borné). Pas de binding digest. Pas
d'actor mandatory. Pas de durabilité au restart.

V1 gaps (post review v1.1 2026-09-03) :
1. Pas de binding ExecutionPlan immutable + canonical digest
2. Pas de séparation explicite Policy / Approval
3. Pas de durabilité au restart
4. "Approve forever" non borné
5. Pas d'expiration / revocation explicite

**V2 ci-dessus adresse tous ces gaps.**
