# FEATURE-OWNERSHIP-MATRIX.md

**Phase :** -1 (Audit comparatif)
**Statut :** `VERIFIED_LOCAL` — assignations basées sur l'inspection des README et architectures
**Date :** 2026-07-31


## Correctif M1 — règle de preuve

Les mentions UNVERIFIED, UNVERIFIED ou ssumed ne sont pas des preuves. Les décisions historiques restent non exécutables tant que le dépôt, le commit, le chemin exact, la licence et le comportement n'ont pas été vérifiés. Inventaires vérifiés : OpenWork pps/server/ (171 chemins), OpenWork pps/desktop/electron/ (60), Open Cowork src/main/remote/ (16), src/main/sandbox/ (17), et src/main/skills/ + .claude/skills/ (143). OpenWork /ee reste EXCLUDE (1 067 chemins Fair Source). i18n utilisateur reste BLOCKED_MISSING_SOURCE.

## 1. Légende des autorités (Plan V3 §5)

| Code | Autorité |
|---|---|
| **CORE** | Unifia Core (AgentRuntime, SessionRuntime, ToolRuntime, ProviderRuntime, MCPRuntime, ModelRouter, ContextRuntime, EventRuntime) |
| **WB** | Unifia Workbench (Workspace UI, Documents, Artifacts, Browser, Computer Use, Remote Bridges, Search, Capability Hub, Trace, Approvals) |
| **APP** | Application services (WorkspaceRuntime, ArtifactRuntime, WorkflowRuntime, MemoryRuntime, CapabilityRegistry, RemoteRuntime, DesktopAutomationBroker) |
| **GOV** | Trust and Governance (PolicyEngine, ApprovalBroker, SecretStore, AuditRuntime, CapabilityEngine, TaintTracker, Quotas, KillSwitches) |
| **BACK** | Execution backends (Native restricted, Docker, WSL2, Lima, Browser profile, Document workers, External MCP, Local models) |

## 2. Matrice feature → propriétaire canonique

| Domaine | Fork Unifia (Rwanbt) | OpenWork (upstream) | Open Cowork (upstream) | Autorité cible Unifia |
|---|---|---|---|---|
| **Runtime agentique (boucle)** | `packages/unifia/src/runtime/` (existant) | `apps/server/` + côté OpenCode embarqué | `agent runner` (NE PAS reprendre — Plan V3 §3.2) | **CORE** |
| **Session manager** | `packages/unifia/src/session/` | `apps/server/sessions` | NE PAS reprendre | **CORE** |
| **Provider routing** | `packages/unifia/src/provider/` (10 fichiers TS) | UNVERIFIED côté OpenCode | NE PAS reprendre | **CORE** |
| **Provider MiniMax (M3)** | à ajouter | ❌ | ❌ | **CORE** (BD-6) |
| **Tools (MCP, registry)** | `packages/unifia/src/tool/`, `mcp/` | `apps/server/mcp` | UNVERIFIED | **CORE** |
| **Memory** | `packages/unifia/src/memory/` (à confirmer) | `apps/server/memory` | NE PAS reprendre tel quel → migrer idées vers MemoryRuntime | **APP** (MemoryRuntime) |
| **Workspace identity** | `packages/unifia/src/workspace/` (à confirmer) | `apps/server/workspaces` | `ROADMAP.md` mentionne workspaces | **APP** (WorkspaceRuntime) |
| **File sessions** | UNVERIFIED | `apps/server/file-sessions` | ❌ | **APP** (WorkspaceRuntime) |
| **Multi-workspace** | ❌ (mono) | ✅ (multi-app + workspaces) | UNVERIFIED | **APP** (WorkspaceRuntime) |
| **Artifacts (DOCX, PPTX, XLSX, PDF)** | ❌ (XSD 78 fichiers dans Open Cowork, pas dans Unifia) | UNVERIFIED (XSD-like) | ✅ (78 `.xsd` = schémas de docs) | **APP** (ArtifactRuntime) + **Capability Packs** |
| **Skills (manifest typé)** | `packages/unifia/src/skill/` (à confirmer) | `apps/server/skills` | UNVERIFIED | **APP** (CapabilityRegistry) |
| **Permissions / Policy** | `packages/unifia/src/permission/` | UNVERIFIED | UNVERIFIED | **GOV** (PolicyEngine) |
| **Approvals** | `packages/unifia/src/approval/` (à confirmer) | `apps/server/approvals` | UNVERIFIED | **GOV** (ApprovalBroker) |
| **Secrets** | UNVERIFIED | `.infisical.json` (externe) | UNVERIFIED | **GOV** (SecretStore) |
| **Audit / EventLog** | UNVERIFIED | `STATS.md` (télémétrie) | UNVERIFIED | **GOV** (AuditRuntime) |
| **Trace Panel** | UNVERIFIED | `apps/desktop/` UI | UNVERIFIED (sandbox) | **WB** (Trace UI alimenté par EventLog) |
| **Permission dialogs** | UNVERIFIED | `apps/desktop/permission-dialog` | UNVERIFIED | **WB** (ApprovalBroker UI) |
| **Browser profile** | ❌ | UNVERIFIED | UNVERIFIED | **BACK** (Browser profile) |
| **Computer use** | ❌ | UNVERIFIED | UNVERIFIED (Python scripts) | **WB** (Computer Use) + **BACK** (DesktopAutomationBroker) |
| **Sandbox Docker** | UNVERIFIED (`.github/workflows/containers.yml`) | UNVERIFIED | UNVERIFIED | **BACK** (SandboxBroker) |
| **Sandbox WSL2/Lima** | ❌ | UNVERIFIED | UNVERIFIED (Python) | **BACK** (SandboxBroker) |
| **Remote bridges (Slack/Feishu)** | `packages/slack/` (1 package) | UNVERIFIED (Slack UNVERIFIED) | `eigent-ai/eigent` mentionne Feishu | **WB** (RemoteRuntime) |
| **Remote commands authorization** | UNVERIFIED | `apps/server/remote` | UNVERIFIED | **GOV** (RemoteTransport) |
| **Desktop shell (UI)** | `packages/app/` (SolidJS), `packages/desktop/` (Tauri), `packages/desktop-electron/` (legacy) | `apps/desktop/` | UNVERIFIED | **WB** (Shell Unifia) |
| **CLI** | `packages/unifia/bin/opencode` | UNVERIFIED | UNVERIFIED | **WB** (CLI Unifia) |
| **i18n** | 21 langues (en, fr, de, …) dans `packages/desktop/src/i18n/*.ts` + racine | `TRANSLATIONS.md` UNVERIFIED | UNVERIFIED (à vérifier) | **WB** (Shell i18n) — cf. `P-1-I18N-USER-SOURCE` |
| **Mobile iOS/Android** | `packages/mobile/` (Tauri 2) | Swift natif (12 fichiers) | UNVERIFIED | **WB** (mobile) |
| **macOS natif** | (Tauri) | Swift natif | UNVERIFIED | **WB** (Tauri préféré) |
| **Test harness / conformance** | `bun test`, `turbo typecheck` | UNVERIFIED (Turborepo) | UNVERIFIED (vite build) | **CORE** (Conformance suite Phase 1) |
| **CI workflows** | 42 `.github/workflows/*.yml` | UNVERIFIED | 12 `.yml` | **CORE** (CI Unifia) |

## 3. Doublons fonctionnels détectés (à arbitrer en Phase 2)

| Domaine | Fork Unifia | OpenWork | Open Cowork | Décision |
|---|---|---|---|---|
| Server headless | ❌ (pas dans Rwanbt) | ✅ `apps/server/` | ❌ | **ADOPT** OpenWork |
| Agent loop | `packages/unifia/src/runtime/` | ✅ OpenCode embarqué | ❌ | **ADAPT** (Unifia RuntimeAdapter) |
| Provider management | `packages/unifia/src/provider/` | UNVERIFIED | ❌ | **CORE** (unifier dans Unifia Core) |
| Skills/plugins | `packages/unifia/src/skill/` | `apps/server/skills` | UNVERIFIED | **ADOPT** OpenWork + Capability Packs |
| Remote transport | ❌ | `apps/server/remote` | Feishu/Slack | **ADOPT** OpenWork + **ADAPT** Open Cowork |
| Browser control | ❌ | UNVERIFIED | UNVERIFIED | **ADAPT** tardif (Phase 10) |
| Computer use | ❌ | UNVERIFIED | UNVERIFIED (Python) | **ADAPT** tardif (Phase 10) avec broker |
| Tauri vs Electron | **DOUBLON** : Tauri (`desktop/`) + Electron (`desktop-electron/`) | Tauri UNVERIFIED | Electron UNVERIFIED | **DEPRECATE** desktop-electron (BD-3) |
| macOS natif (Swift) | ❌ | ✅ | ❌ | **DEFER** (post Phase 19) |

## 4. Hiérarchie d'autorité finale (à implémenter Phase 2-3)

```text
CORE (Unifia Core)
├── AgentRuntime (un seul — Unifia Core)
├── SessionRuntime
├── ToolRuntime
├── ProviderRuntime (inclut MiniMax M3, OpenAI, Anthropic, etc.)
├── MCPRuntime
├── ModelRouter
├── ContextRuntime
├── EventRuntime
└── RuntimeAdapter (3 impls : Unifia, OpenCode legacy, Fake)
    ↓ interface vers Workbench

APP (Application services)
├── WorkspaceRuntime
├── ArtifactRuntime
├── WorkflowRuntime
├── MemoryRuntime
├── CapabilityRegistry (Porte d'entrée pour les skills)
├── RemoteRuntime
└── DesktopAutomationBroker
    ↓ interface vers UI

GOV (Trust and Governance)
├── PolicyEngine
├── ApprovalBroker
├── SecretStore
├── AuditRuntime
├── CapabilityEngine
├── TaintTracker
├── Quotas
└── KillSwitches
    ↓ applique default-deny

WB (Workbench)
├── Shell Unifia (Code | Work | Design | Automate)
├── Documents / Artifacts
├── Browser profile
├── Computer Use
├── Remote Bridges
├── Trace Panel
├── Approval UI
└── Capability Hub
    ↓ interface utilisateur

BACK (Execution backends)
├── Native restricted
├── Docker
├── WSL2 / Lima
├── Browser profile
├── Document workers
├── External MCP
└── Local models
```

## 5. Règle d'autorité (rappel Plan V3 §5)

```text
aucun module importé ne conserve sa propre autorité parallèle.
```

Conséquence concrète : tout import OpenWork ou Open Cowork doit **refactorer** les autorités en doublon pour les rattacher à l'autorité canonique Unifia.
