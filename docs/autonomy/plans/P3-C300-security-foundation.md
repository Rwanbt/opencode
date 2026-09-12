# P3-C300 — Plan détaillé : Security foundation (PolicyEngine + ApprovalBroker + SecretStore + AuditRuntime)

**Carte parente :** P3-C300 (Phase 3, DEFERRED → DETAILED)
**Statut :** `BLOCKED_SECURITY_CRITICAL` — auto-revue interdite par pack
**Date :** 2026-07-31
**Source :** Plan V3 §15 « Security foundation, capabilities et ApprovalBroker »

## ⚠️ Statut spécial

**Cette phase est SECURITY-CRITICAL.** Le pack v1.0 §05-MASTER-PROMPT dit :

> *"For security, licensing, migrations, remote control, computer use, sandbox, secrets, authentication and release cards, same-model review is advisory only. Mark the gate `NEEDS_EXTERNAL_E2` and do not claim production approval."*

**Conséquence** : un humain doit **valider** chaque carte de cette phase. L'agent ne peut PAS auto-approuver.

## Contexte

Phase 3 implémente la **gouvernance** (Plan V3 §5) :
- Default-deny sur 9 surfaces
- 6 combinaisons critiques bloquées
- Approbation humaine pour actions sensibles
- Audit complet

## Découpage en sous-cartes (15+)

### Core governance
- **P3-C300a** : Package `@unifia/governance` structure (~100 lignes)
- **P3-C300b** : `PolicyEngine` interface + JsonPolicyEngine (~300 lignes)
- **P3-C300c** : 6 combinaisons critiques encodées comme rules (~200 lignes)
- **P3-C300d** : `ApprovalBroker` interface + LocalApprovalBroker (~250 lignes)
- **P3-C300e** : UI Tauri modal pour approbation (~300 lignes Tauri+TSX)
- **P3-C300f** : `SecretStore` interface + KeyringSecretStore (~200 lignes)
- **P3-C300g** : `SecretStore` EncryptedFileSecretStore fallback (~150 lignes)
- **P3-C300h** : `unifia-migrate.sh migrate-secrets` étape additionnelle (~50 lignes)
- **P3-C300i** : `AuditRuntime` interface + SqliteAuditRuntime (~300 lignes)
- **P3-C300j** : AuditRuntime retention + compression (~100 lignes)
- **P3-C300k** : `TaintTracker` interface + InMemoryTaintTracker (~200 lignes)
- **P3-C300l** : TaintTracker integration avec SecretStore (~100 lignes)
- **P3-C300m** : Quotas (per-workspace, per-capability) (~150 lignes)
- **P3-C300n** : Kill switches (per-capability, global) (~150 lignes)
- **P3-C300o** : Security conformance suite (validation) (~400 lignes)

## Critères de sortie Plan V3 §15

- [ ] Default deny
- [ ] Toute action sensible passe par PolicyEngine
- [ ] Toute confirmation passe par ApprovalBroker
- [ ] Toute action sensible est auditée
- [ ] Les grants expirent et sont révocables
- [ ] Les secrets sont redacted
- [ ] Les 6 combinaisons critiques sont bloquées ou confirmées JIT

## Tests obligatoires avant merge

- [ ] **Penetration testing** : un humain tente de bypass PolicyEngine
- [ ] **Fuzzing** : property-based testing sur les inputs PolicyEngine
- [ ] **Taint tracking** : simulation de fuite de secret via network
- [ ] **Approval expiration** : test que les grants expirent
- [ ] **Audit completeness** : vérification que toutes les actions sont tracées

## Processus de validation humaine

1. **Code review** : 2 reviewers senior (Erwan + 1 autre)
2. **Penetration test** : documenter les tentatives
3. **Threat model review** : valider THREAT-MODEL.md
4. **Approval explicite** : marquer la gate `VERIFIED_BY_HUMAN` (pas `VERIFIED_AUTO`)

## Dépendances

- **P2-C200** (Contrats) doit être fait en premier
- **ADR-0006 à ADR-0010** : définissent les décisions

## Estimation

- **Core governance (a-o)** : 4-6 semaines solo, 2-3 semaines équipe 2-3
- **Tests + validation humaine** : +1-2 semaines
- **Total** : **6-8 semaines** minimum (Plan V3 §15)

## Note opérationnelle

**Cette phase ne peut pas être exécutée dans le conteneur actuel** car :
- Demande compilation TS stricte (tooling absent)
- Demande tests d'intégration runtime (bun test + cargo test)
- **Demande validation humaine pour SECURITY-CRITICAL**

À planifier dans une session avec :
- Tooling complet
- Humain senior disponible pour review
- Threat model à jour
