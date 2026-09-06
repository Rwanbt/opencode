<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# M0-06 EVIDENCE — capability-authority spike (ADR-002)

> Statut : **EVIDENCE_PINNED** (primitives validated, enforcer MISSING)
> Date : 2026-09-01T17:35+02:00
> Source : `docs/automation-v2/spikes/m0-06-capability-enforcement.ts`

## 0. Cadrage

Ce spike valide les **primitives cryptographiques** et le **registre
de capabilities** qui sous-tendent ADR-002 (Capability Authority,
plan §114-116) et ADR-008 (TrustClass).

**Code de production modifié** : aucun. Le spike n'utilise que
`node:crypto` (Bun standard).

**Commande de reproduction** :

```bash
cd D:\App\unifia\.worktrees\rev3m-20260901\design
bun docs/automation-v2/spikes/m0-06-capability-enforcement.ts
```

**Dernière exécution** : 2026-09-01, 6 PASS / 0 FAIL / 1 MISSING.

## 1. Verdict par vecteur

| # | Vecteur | Verdict | Évidence |
|---|---|---|---|
| 1 | P3_CAPABILITIES = 20 entrées uniques | **PASS** | 20 capabilities |
| 2 | `workflow.run` présent | **PASS** | trouvé dans P3_CAPABILITIES |
| 3 | Ed25519 sign + verify round-trip | **PASS** | signature valide |
| 4 | Ed25519 message tamperé rejeté | **PASS** | verification = false |
| 5 | TrustClass enum (4 valeurs) | **PASS** | TRUSTED_BUILTIN, REVIEWED_EXTENSION, UNTRUSTED_THIRD_PARTY, REMOTE_SERVICE |
| 6 | NodeManifest declaration | **PASS** | tool.http → network.request (REVIEWED_EXTENSION) |
| 7 | Capability Authority comme **enforcer** | **MISSING** | capability-runtime actuel = verifier seul. ADR-002 demande un enforcer ; M1 work (C-AR-01 dans MULTI_REVIEW.md). |

## 2. Verdict agrégé

```text
PASS     6
FAIL     0
MISSING  1
```

## 3. Conclusion pour ADR-002

Les **primitives** sont validées :
- Ed25519 sign + verify : OK
- P3_CAPABILITIES (20) : OK
- TrustClass (4 valeurs) : OK
- NodeManifest : OK

Le **seul trou** est exactement celui déjà identifié dans la
multi-review (C-AR-01) : le `capability-runtime` actuel est un
**vérificateur**, pas un **enforcer**. Il sait signer et vérifier,
mais il ne sait pas refuser une exécution.

**Recommandation** : `@unifia/capability-runtime/` doit être étendu
en M1 avec une couche d'enforcement. Le pipeline devient :

```text
WorkflowIR
  -> trusted manifest (signed, ADR-002)
  -> Capability Authority (verify + enforce)   <-- M1: add enforce
  -> Policy (ADR-009)
  -> short-lived grant
  -> executor
```

L'enforcer refuse l'exécution si :
- Le manifest n'est pas signé
- Le trust class est trop bas pour le scope
- La capability n'est pas dans principal.scopes
- Le scope (ADR-020) n'est pas dans la chain OwnershipScope → DeploymentScope

## 4. Statut

| Élément | Statut |
|---|---|
| Code de production modifié | **NON** |
| Primitives cryptographiques | **VALIDÉES** |
| Enforcer | **M1** (C-AR-01) |
| Décision ADR-002 | **DÉJÀ RENDUE** (DECIDED) |

## Liens

- `docs/automation-v2/spikes/m0-06-capability-enforcement.ts`
- `docs/adr/ADR-002-workflow-definition-version-ir.md` (DECIDED)
- `docs/automation-v2/MULTI_REVIEW.md` (C-AR-01)
- `docs/automation-v2/RISK_REGISTER.md`
- plan V2.3.1 §114-116
- ADR-001 (canonicalization) spike → `M0-02-EVIDENCE.md`
- ADR-003 (expression) spike → `M0-03-EVIDENCE.md`
- ADR-010 (secure storage) spike → `M0-04-EVIDENCE.md`
- ADR-023 (network) spike → `M0-05-EVIDENCE.md`
- ADR-000 (substrate) spike → `M0-01-EVIDENCE.md`
