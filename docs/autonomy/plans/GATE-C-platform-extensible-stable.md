# Gate C — Plateforme extensible stabilisée

**Carte :** P19-GATE-C
**Statut :** `PROPOSED` — bloqué GATE-A + GATE-B
**Date :** 2026-07-31
**Source :** Plan V3 §15 (Gate C), ADR-0016

## Définition

**Gate C** valide que la plateforme Unifia est **extensible** et **stable** pour des **utilisateurs avancés** : développeurs de skills, intégateurs, et power users.

À Gate C, Unifia doit offrir :
1. **Skill Hub** pour publier/partager des capabilities
2. **MCP UI Server** exposant 100+ capabilities
3. **OpenDesign** intégration complète
4. **Artifact Studio** (canvas)
5. **Memory System** (long-term + working)
6. **Workflow Engine** complet
7. **Computer use** (Phase 10) — après SECURITY-CRITICAL review

## Critères de sortie

### 0. Blocking criteria

- [ ] **Gate A GO** (passé)
- [ ] **Gate B GO** (passé)
- [ ] **Security audit post-Phase 10** (computer use)
- [ ] **0 régression** sur les phases précédentes
- [ ] **Documentation complète** : API reference, guides, tutorials
- [ ] **Migration scripts** : 0 breaking change pour utilisateurs existants

### 1. Skill Hub criteria

- [ ] Registry local (Phase 15)
- [ ] Registry distant (optionnel, Phase 16)
- [ ] Search : par nom, tags, capabilities
- [ ] Install : 1-click depuis le Shell
- [ ] Update : détection auto des nouvelles versions
- [ ] Trust levels : untrusted / verified / official
- [ ] Reviews : par la communauté

### 2. MCP UI Server criteria

- [ ] HTTP transport (JSON-RPC 2.0)
- [ ] STDIO transport (Claude Desktop compat)
- [ ] JWT auth + OAuth 2.0
- [ ] Rate limiting
- [ ] 100+ capabilities exposées
- [ ] Documentation OpenAPI 3.0

### 3. OpenDesign criteria

- [ ] Spec YAML → code generation
- [ ] Mermaid import/export
- [ ] Excalidraw import/export
- [ ] UI Shell Unifia mode Design
- [ ] Validation de spec

### 4. Artifact Studio criteria

- [ ] Canvas : documents, sketches, code
- [ ] Versioning : chaque modification = version
- [ ] Render : PDF, HTML, image
- [ ] Export : filesystem, S3, GitHub
- [ ] Collaboration : multi-user (optionnel)

### 5. Memory System criteria

- [ ] Session memory (ephemeral)
- [ ] Long-term memory (cross-session)
- [ ] Vector DB (semantic search)
- [ ] RGPD : forget/export/anonymisation
- [ ] Synchronisation : multi-device

### 6. Workflow Engine criteria

- [ ] YAML workflow definition
- [ ] Cron trigger (scheduled)
- [ ] Webhook trigger (HTTP)
- [ ] Manual trigger
- [ ] Retry policy (backoff exponentiel)
- [ ] Logs et status

### 7. Computer use criteria (Phase 10)

- [ ] Browser profile sandbox
- [ ] Desktop automation broker
- [ ] Screenshot redaction
- [ ] Allowlist d'applications
- [ ] Bouton d'arrêt d'urgence
- [ ] Tests d'injection visuelle
- [ ] Replay protection
- [ ] **Security audit externe**

## Process de validation

1. **Auto-validation** : conformance suite 100% pass
2. **Penetration testing** (post-Phase 10)
3. **Threat model review** (computer use)
4. **External security audit** (final)
5. **Demo** : 90 min (étendu)
6. **DECISION** : GO ou NO-GO
   - NO-GO = fix jusqu'à GO
   - Releases publiques complètes possibles après Gate C GO

## Décomposition en sous-cartes

| Sous-carte | Auteur | Scope |
|---|---|---|
| GATE-C-001 | Erwan | Skill Hub (P15) |
| GATE-C-002 | Erwan | MCP UI Server (P16) |
| GATE-C-003 | Erwan | OpenDesign (P11) |
| GATE-C-004 | Erwan | Artifact Studio (P12) |
| GATE-C-005 | Erwan | Memory System (P13) |
| GATE-C-006 | Erwan | Workflow Automation (P14) |
| GATE-C-007 | Erwan | Computer use (P10) — après security review |
| GATE-C-008 | SECURITY FIRM | Audit final post-Phase 10 |
| GATE-C-009 | Erwan | Documentation complète (API ref, guides, tutorials) |
| GATE-C-010 | Erwan | Migration scripts validés (no breaking) |
| GATE-C-011 | Erwan | Demo 90 min |
| GATE-C-012 | Erwan | DECISION GO/NO-GO |

## Dépendances

- **GATE A** : GO
- **GATE B** : GO
- **Phase 10** : P10-C1000 (computer use)
- **Phase 11-16** : OpenDesign, Artifact Studio, Memory, Workflow, MCP UI, Skill Hub
- **ADRs Phase 16+** : ADR-0016 à ADR-0020

## Risques

| Risque | Niveau | Mitigation |
|---|---|---|
| Skill Hub : supply chain attacks | `HIGH` | Trust levels, reviews, sandbox |
| MCP UI Server : vulnerabilities | `HIGH` | Audit ext, rate limiting |
| Computer use : exploitation | `CRITICAL` | Default-deny, screenshot redaction |
| Memory leak : RGPD | `HIGH` | Forget/export/ttl |
| Workflow : bugs coûteux | `MEDIUM` | Idempotence requise, dry-run |

## Estimation

**Total : 10-12 semaines solo**, 5-6 semaines équipe 2-3

**Plus 4-6 semaines d'audit security externe** (à budgéter).

## Note opérationnelle

**Gate C est le checkpoint final** : release publique complète. À Gate C GO, Unifia est considéré comme **production-ready** et peut être shippé aux utilisateurs finaux.

**Implication** : cette phase demande un humain senior (Erwan) + auditeur sécurité + dogfooding + retours utilisateurs. **Délai réaliste : 3-4 mois minimum après Gate B**.
