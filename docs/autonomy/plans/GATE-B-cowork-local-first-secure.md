# Gate B — Cowork local-first sécurisé

**Carte :** P10-GATE-B
**Statut :** `BLOCKED_SECURITY_CRITICAL` — auto-revue interdite
**Date :** 2026-07-31
**Source :** Plan V3 §15 (Gate B), ADR-0016

## Définition

**Gate B** valide que la plateforme **Cowork** (Document + Artifact + Shell) est **sécurisée** et **utilisable** en mode local-first.

À Gate B, Unifia doit être capable de :
1. Installer des **Capability Packs** (DOCX, PPTX, XLSX, PDF)
2. Lancer le **Shell Unifia** (4 modes : Code/Work/Design/Automate)
3. Exécuter du code dans un **Sandbox** (multi-backend)
4. Appliquer **PolicyEngine + ApprovalBroker** sur chaque action
5. **Bloquer par défaut** les 6 combinaisons critiques

## Critères de sortie

### 0. Blocking criteria (security)

- [ ] **Audit sécurité externe** (à planifier avec Erwan)
- [ ] **0 warning** de sécurité dans penetration testing
- [ ] **Property-based testing** sur PolicyEngine (fast-check)
- [ ] **Fuzzing** sur les inputs de chaque capability
- [ ] **Threat model** documenté et validé
- [ ] **6 combinaisons critiques** bloquées par défaut (Plan V3 §15)
- [ ] **Default-deny** : 9 surfaces désactivées par défaut
- [ ] **Audit runtime** : 100% des actions sensibles tracées
- [ ] **Secret store** : keyschiffrées at-rest
- [ ] **Taint tracking** : propagation correcte validée

### 1. Capability criteria

- [ ] 4 Capability Packs : DOCX, PPTX, XLSX, PDF
- [ ] Chaque pack : manifest + schema + tests
- [ ] Capability Engine : authorize → execute → audit
- [ ] Capability Registry : load/unload/search

### 2. Shell Unifia criteria

- [ ] Mode Code : IDE + file explorer + terminal
- [ ] Mode Work : documents + artifacts + browser
- [ ] Mode Design : spec-driven (OpenDesign)
- [ ] Mode Automate : workflow engine
- [ ] Trace Panel (audit temps réel)
- [ ] Approval dialogs (Tauri modal)
- [ ] Capability Hub UI

### 3. Sandbox criteria

- [ ] NativeSandboxPort (Linux/macOS/Windows)
- [ ] DockerSandboxPort
- [ ] WslSandboxPort (Windows)
- [ ] LimaSandboxPort (macOS)
- [ ] CompositeSandboxPort (auto-sélection)
- [ ] Default-deny policy (no network, read-only fs)

### 4. Governance criteria

- [ ] PolicyEngine : JsonPolicyEngine + 6 combinaisons critiques
- [ ] ApprovalBroker : UI modal + persistence
- [ ] SecretStore : KeyringSecretStore + EncryptedFileSecretStore
- [ ] AuditRuntime : SqliteAuditRuntime + retention + compression
- [ ] TaintTracker : propagation + sanitization
- [ ] Quotas : per-workspace, per-capability
- [ ] Kill switches : per-capability, global

### 5. i18n criteria

- [ ] 21 langues + i18n utilisateur (si BD-9 levée)
- [ ] UI traduite
- [ ] Documentation traduite (21 langues × 4 fichiers)

## Process de validation

1. **Auto-validation** (par agent) : property-based tests passent
2. **Penetration testing** : un humain senior tente de bypass
3. **Threat model review** : valider THREAT-MODEL.md
4. **External security audit** : auditeur externe (à budgéter)
5. **Demo** : 60 min presentation
6. **DECISION** : GO ou NO-GO
   - NO-GO = fix sécurité jusqu'à GO
   - Pas de release Cowork possible avant Gate B GO

## Décomposition en sous-cartes

| Sous-carte | Auteur | Scope |
|---|---|---|
| GATE-B-001 | Erwan | Capability Packs (P6-C600) |
| GATE-B-002 | Erwan | Shell Unifia (P7-C700) |
| GATE-B-003 | Erwan | SandboxBroker (P8-C800) |
| GATE-B-004 | Erwan | PolicyEngine + ApprovalBroker (P3-C300b/c/d) |
| GATE-B-005 | Erwan | SecretStore + AuditRuntime (P3-C300f/i) |
| GATE-B-006 | Erwan | TaintTracker (P3-C300k) |
| GATE-B-007 | Erwan | Quotas + kill switches (P3-C300m/n) |
| GATE-B-008 | SECURITY FIRM | Penetration testing |
| GATE-B-009 | SECURITY FIRM | Audit externe |
| GATE-B-010 | Erwan | Threat model review |
| GATE-B-011 | Erwan | Demo 60 min |
| GATE-B-012 | Erwan | DECISION GO/NO-GO |

## Dépendances

- **Gate A** : passé (GO)
- **Phase 3** : Security foundation (P3-C300)
- **Phase 6** : Open Cowork skills (P6-C600)
- **Phase 7** : Shell Unifia (P7-C700)
- **Phase 8** : SandboxBroker (P8-C800)
- **ADRs Phase 3** : ADR-0006 à ADR-0012

## Risques

| Risque | Niveau | Mitigation |
|---|---|---|
| Audit security révèle des gaps | `HIGH` | Fix immédiat, re-Gate B |
| Pen-testing bypass | `CRITICAL` | Default-deny, rate limiting |
| Capability Packs utilisent des libs copyleft | `MEDIUM` | Open-source replacement |
| Sandbox escape | `CRITICAL` | Multi-layer isolation (chroot + uid + namespace) |

## Estimation

**Total : 6-8 semaines solo**, 3-4 semaines équipe 2-3

**Plus 2-4 semaines d'audit security externe** (à budgéter).

## Note opérationnelle

**Gate B est le checkpoint de sécurité**. Aucun utilisateur réel ne devrait utiliser Unifia pour des tâches sensibles avant Gate B GO.

**Auto-revue interdite** pour TOUT : SECURITY-CRITICAL × 100%.

**Implication** : cette phase demande un humain senior (Erwan) + auditeur sécurité + tests poussés. **Délai réaliste : 2-3 mois minimum**.
