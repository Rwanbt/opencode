---
id: 0016
title: Gate criteria
status: PROPOSED
date: 2026-07-31
---

# ADR-0016: Critères de Gate (A/B/C)

**Statut :** `PROPOSED`
**Date :** 2026-07-31
**Décideurs :** Erwan, Hermes Agent (MiniMax M3)
**Source :** Plan V3 §15 (« Gates A, B, C »)

## Contexte

Le Plan V3 prévoit **3 gates** qui ponctuent la progression de Phase 1 à Phase 19 :

- **Gate A** (§15) : Workbench headless stable (post-Phase 2)
- **Gate B** (après Phase 10) : Cowork local-first sécurisé
- **Gate C** (après Phase 16) : Plateforme extensible stabilisée

Un **gate** est un point de validation où l'équipe vérifie que les phases précédentes ont livré la valeur attendue avant de passer à la suite.

## Décision

Adopter les **critères de gate** suivants (Plan V3 §15) :

### Gate A — Workbench headless stable

**Livré** :
- [ ] Workbench peut démarrer sans UI (CLI)
- [ ] Au moins 1 runtime marche (OpenCode legacy ou Unifia)
- [ ] Conformance suite passe à 100% (P1-C100)
- [ ] SBOM CycloneDX validé
- [ ] 0 secret dans le repo
- [ ] 0 code `/ee/` importé
- [ ] Mock runtime (FakeRuntime) pour tests

**Non livré à Gate A** (volontairement) :
- Capability Packs (Phase 6)
- Shell UI (Phase 7)
- Workbench GUI (Phase 11)

### Gate B — Cowork local-first sécurisé

**Livré** :
- [ ] Gate A passé
- [ ] Capability Packs installés (docx, pptx, xlsx, pdf)
- [ ] Shell Unifia démarrable (4 modes)
- [ ] SandboxBroker fonctionnel (multi-backend)
- [ ] PolicyEngine + ApprovalBroker + SecretStore + AuditRuntime opérationnels
- [ ] 6 combinaisons critiques bloquées par défaut
- [ ] 0 warning de sécurité

**Non livré à Gate B** (volontairement) :
- Computer use (Phase 10)
- Remote bridges (Phase 9)
- Workflow automation (Phase 14)

### Gate C — Plateforme extensible stabilisée

**Livré** :
- [ ] Gate B passé
- [ ] Skill Hub opérationnel
- [ ] MCP UI Server exposant 100+ capabilities
- [ ] OpenDesign intégration
- [ ] Artifact Studio (canvas)
- [ ] Memory system (long-term + working)
- [ ] Workflow automation
- [ ] Computer use (Phase 10) — **après SECURITY-CRITICAL review**

**Non livré à Gate C** (volontairement) :
- Modules stratégiques post-production (Phase 19)

## Process de validation de gate

1. **Auto-validation** : l'agent vérifie les critères techniques (scripts, tests, audits)
2. **Pre-commit review** : 2 reviewers senior (Erwan + 1 autre)
3. **External audit** : pour Gate B et C (security + release readiness)
4. **Demo** : 30 min de présentation des features livrées
5. **DECISION** : GO ou NO-GO (NO-GO = fix jusqu'à GO)

## Conséquences

### Positives
- ✅ **Validation progressive** : pas de "big bang" release
- ✅ **Critères clairs** : pas de débat sur ce qui est "prêt"
- ✅ **Réversibilité** : un NO-GO peut annuler la dernière phase sans casser le reste
- ✅ **Stakeholder confidence** : demos régulières montrent la progression

### Négatives
- ❌ **Friction** : 3 gates = 3 checkpoints obligatoires
- ❌ **Délai** : NO-GO peut repousser le planning de plusieurs jours
- ❌ **Subjectivité** : les critères peuvent être interprétés différemment

### Neutres
- Les gates sont **permissives** (criteria-based, pas test-based)

## Alternatives considérées

### A. Pas de gates (release big-bang à la fin)
- **Rejeté** : trop risqué, pas de feedback loop

### B. Gates traditionnels (test pass %)
- **Rejeté** : trop laxiste, on mesure la valeur pas la couverture

### C. Gates à critères (cette décision)
- **Adopté** : alignement avec Plan V3

## Plan d'implémentation

- **Phase 2** : cette ADR documentée
- **Phase 2** : Gate A plan détaillé (sous-cartes par phase)
- **Phase 3+** : Gate B plan détaillé
- **Phase 16+** : Gate C plan détaillé

## Liens

- Plan V3 §15 (Gates A, B, C)
- ADR-0001 (RuntimeAdapter) — Gate A
- ADR-0006 (PolicyEngine) — Gate B
- ADR-0003 (CapabilityPort) — Gate C
- ADR-0012 (Provenance /ee/) — toutes les gates
