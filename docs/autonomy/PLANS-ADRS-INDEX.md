# Plans & ADRs — Unifia Workbench

**Statut :** v1.0
**Date :** 2026-08-01

## Index

### Plans détaillés (22 fichiers)

| Phase | Fichier | Sous-cartes | Statut |
|---|---|---:|---|
| 1 | [P1-C100-harness-multi-runtime](plans/P1-C100-harness-multi-runtime.md) | 5 | DEFERRED |
| 1 | [P1-C110-sbom-audit-deps](plans/P1-C110-sbom-audit-deps.md) | 5 | PARTIAL |
| 2 | [P2-C200-contracts-unifia](plans/P2-C200-contracts-unifia.md) | 9 | DEFERRED |
| 3 | [P3-C300-security-foundation](plans/P3-C300-security-foundation.md) | 15 | BLOCKED_SECURITY_CRITICAL |
| 4 | [P4-C400-workspace-runtime](plans/P4-C400-workspace-runtime.md) | 8 | DEFERRED |
| 5 | [P5-C500-openwork-extraction](plans/P5-C500-openwork-extraction.md) | 6 | DEFERRED |
| 6 | [P6-C600-open-cowork-skills](plans/P6-C600-open-cowork-skills.md) | 8 | DEFERRED |
| 7 | [P7-C700-shell-unifia](plans/P7-C700-shell-unifia.md) | 15 | DEFERRED |
| 8 | [P8-C800-sandbox-broker](plans/P8-C800-sandbox-broker.md) | 8 | DEFERRED |
| 9 | [P9-C900-remote-bridges](plans/P9-C900-remote-bridges.md) | 6 | DEFERRED |
| 10 | [P10-C1000-computer-use](plans/P10-C1000-computer-use.md) | 8 | DEFERRED |
| 11 | [P11-C1100-spec-driven](plans/P11-C1100-spec-driven.md) | 8 | DEFERRED |
| 12 | [P12-C1200-artifact-studio](plans/P12-C1200-artifact-studio.md) | 10 | DEFERRED |
| 13 | [P13-C1300-memory](plans/P13-C1300-memory.md) | 8 | DEFERRED |
| 14 | [P14-C1400-workflow](plans/P14-C1400-workflow.md) | 8 | DEFERRED |
| 15 | [P15-C1500-skill-hub](plans/P15-C1500-skill-hub.md) | 10 | DEFERRED |
| 16 | [P16-C1600-mcp-ui](plans/P16-C1600-mcp-ui.md) | 8 | DEFERRED |
| 17 | [P17-C1700-release-hardening](plans/P17-C1700-release-hardening.md) | 10 | DEFERRED |
| 18 | [P18-C1800-release](plans/P18-C1800-release.md) | 8 | DEFERRED |
| Gate A | [GATE-A-workbench-headless-stable](plans/GATE-A-workbench-headless-stable.md) | 11 | DEFERRED |
| Gate B | [GATE-B-cowork-local-first-secure](plans/GATE-B-cowork-local-first-secure.md) | 12 | BLOCKED_SECURITY_CRITICAL |
| Gate C | [GATE-C-platform-extensible-stable](plans/GATE-C-platform-extensible-stable.md) | 12 | DEFERRED |

**Total : 22 plans, 200 sous-cartes détaillées**

### ADRs (30 fichiers)

#### Core architecture (0001-0005)
- [ADR-0001: RuntimeAdapter](adr/0001-runtime-adapter.md) — abstraction sur le runtime
- [ADR-0002: WorkspacePort](adr/0002-workspace-port.md) — abstraction sur le storage
- [ADR-0003: CapabilityPort](adr/0003-capability-port.md) — abstraction sur les capabilities
- [ADR-0004: ArtifactPort](adr/0004-artifact-port.md) — abstraction sur les artefacts
- [ADR-0005: SandboxPort](adr/0005-sandbox-port.md) — abstraction sur les backends

#### Governance (0006-0010)
- [ADR-0006: PolicyEngine](adr/0006-policy-engine.md) — default-deny
- [ADR-0007: ApprovalBroker](adr/0007-approval-broker.md) — workflow d'approbation
- [ADR-0008: SecretStore](adr/0008-secret-store.md) — stockage chiffré
- [ADR-0009: AuditRuntime](adr/0009-audit-runtime.md) — journal d'audit
- [ADR-0010: TaintTracker](adr/0010-taint-tracker.md) — marquage données sensibles

#### Transition (0011-0015)
- [ADR-0011: Migration non-breaking](adr/0011-migration-non-breaking.md)
- [ADR-0012: Provenance et exclusion /ee/](adr/0012-provenance-ee-exclusion.md)
- [ADR-0013: Dépréciation desktop-electron](adr/0013-desktop-electron-deprecation.md)
- [ADR-0014: Provider unifia natif](adr/0014-provider-unifia-native.md)
- [ADR-0015: i18n 21 langues](adr/0015-i18n-21-languages.md)

#### Strategy (0016-0020)
- [ADR-0016: Critères de Gate](adr/0016-gate-criteria.md)
- [ADR-0017: OpenDesign et Spec-Driven](adr/0017-opendesign-integration.md)
- [ADR-0018: Memory System](adr/0018-memory-system.md)
- [ADR-0019: Workflow Automation](adr/0019-workflow-automation.md)
- [ADR-0020: MCP UI Server](adr/0020-mcp-ui-server.md)

#### Operational (0021-0025)
- [ADR-0021: Spec-Driven Development](adr/0021-spec-driven-development.md)
- [ADR-0022: Org Model (BDFL)](adr/0022-org-model-strategy.md)
- [ADR-0023: Licensing Strategy](adr/0023-licensing-strategy.md)
- [ADR-0024: Roadmap Strategy](adr/0024-roadmap-strategy.md)
- [ADR-0025: Community Strategy](adr/0025-community-strategy.md)

#### Policies (0026-0030)
- [ADR-0026: Workflow de contribution](adr/0026-contribution-workflow.md)
- [ADR-0027: Stratégie de release](adr/0027-release-strategy.md)
- [ADR-0028: Implémentation des Contrats](adr/0028-contracts-implementation.md)
- [ADR-0029: Politique de dette technique](adr/0029-tech-debt-policy.md)
- [ADR-0030: Compatibilité et rupture](adr/0030-compatibility-policy.md)

**Total : 30 ADRs**

## Comment lire

1. **Commencer par le PLAN V3** : `docs/autonomy/PLAN-DIRECTEUR-V3.md`
2. **TASK-GRAPH v2.0** : `docs/autonomy/TASK-GRAPH-v2.0.yaml` (102 cartes)
3. **ADRs Core (0001-0005)** : pour comprendre les 6 ports
4. **ADRs Governance (0006-0010)** : pour comprendre la sécurité
5. **Plans détaillés** : pour comprendre l'implémentation

## Statistiques

| Catégorie | Nombre |
|---|---:|
| Plans détaillés | 22 |
| Sous-cartes détaillées | 200 |
| ADRs Core | 5 |
| ADRs Governance | 5 |
| ADRs Transition | 5 |
| ADRs Strategy | 5 |
| ADRs Operational | 5 |
| ADRs Policies | 5 |
| **Total ADRs** | **30** |
