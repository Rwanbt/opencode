# GOVERNANCE.md — Unifia Workbench Governance

**Statut :** `v1.0` — créé P0-C009
**Date :** 2026-07-31
**Référence :** Plan V3 §12 (Phase 0 livrable GOVERNANCE.md)

## 1. Identité

| Champ | Valeur |
|---|---|
| Nom | Unifia Workbench |
| Origine | Fork de [Rwanbt/unifia](https://github.com/Rwanbt/unifia) (lui-même fork d'anomalyco/opencode) |
| Statut upstream | Fork non-officiel maintenu indépendamment |
| Repository cible | `Rwanbt/unifia` (à confirmer BD-7) |
| Branche de référence | `dev` (héritée d'upstream) |
| CLI | `unifia` (binaire, anciennement `unifia`) |
| Package root | `unifia-workbench` |
| Brand | Unifia (logos dans `brand/unifia/`) |

## 2. Architecture (résumé)

Unifia est structuré en 5 couches d'autorité (cf. Plan V3 §5) :

```
┌─────────────────────────────────────────────────────────────┐
│ UNIFIA SHELL        (Phase 7)                               │
│   Code │ Work │ Design │ Automate │ Mobile/Remote Client    │
├─────────────────────────────────────────────────────────────┤
│ UNIFIA WORKBENCH    (Phase 5+)                              │
│   Documents │ Artifacts │ Browser │ Computer Use           │
│   Remote Bridges │ Search │ Capability Hub │ Trace         │
├─────────────────────────────────────────────────────────────┤
│ APPLICATION SERVICES (Phase 4+)                             │
│   WorkspaceRuntime │ ArtifactRuntime │ WorkflowRuntime      │
│   MemoryRuntime │ CapabilityRegistry │ RemoteRuntime       │
│   DesktopAutomationBroker                                    │
├─────────────────────────────────────────────────────────────┤
│ UNIFIA CORE        (Phase 1-2)                               │
│   AgentRuntime │ SessionRuntime │ ToolRuntime               │
│   ProviderRuntime │ MCPRuntime │ ModelRouter                │
│   ContextRuntime │ EventRuntime                             │
├─────────────────────────────────────────────────────────────┤
│ TRUST AND GOVERNANCE (Phase 3)                              │
│   PolicyEngine │ ApprovalBroker │ SecretStore              │
│   AuditRuntime │ CapabilityEngine │ TaintTracker            │
│   Quotas │ KillSwitches                                       │
└─────────────────────────────────────────────────────────────┘
```

**Règle d'or (Plan V3 §5) :**
```
aucun module importé ne conserve sa propre autorité parallèle.
```

## 3. Stratégie de branches

### 3.1 Branches protégées (ne jamais toucher directement)

| Branche | Rôle |
|---|---|
| `main` | Branche principale stable |
| `dev` | Branche de développement par défaut |
| `Team` | Branche collaboration équipe |
| `release/*` | Préparation releases |
| `upstream-sync/*` | Synchronisation upstream (Phase 0+) |

### 3.2 Branches de travail (utilisation standard)

| Pattern | Usage |
|---|---|
| `agent/integration` | Branche d'intégration des commits atomiques |
| `agent/<phase>/<CARD-ID>-<slug>` | Implémentation d'une carte |
| `agent/review/<CARD-ID>-<cycle>` | Revue par sub-agent read-only |

### 3.3 Workflow de merge

```
agent/<phase>/<CARD-ID>  --(self-check + reviewer fresh-context)-->
  agent/review/<CARD-ID>  --(APPROVED)-->
    agent/integration  --(merge --no-ff)-->
      PR vers origin/dev  --(review utilisateur)-->
        origin/dev
```

## 4. Conventions de nommage

### 4.1 Packages

```
@unifia/<package-name>     # anciennement @unifia-ai/<package-name>
unifia-workbench           # package root, anciennement "unifia"
unifia                     # binaire CLI, anciennement "unifia"
```

### 4.2 Tauri identifiers

```
ai.unifia.workbench.dev    # anciennement ai.opencode.desktop.dev
ai.unifia.workbench.beta   # anciennement ai.opencode.desktop.beta
unifia                     # URL scheme, anciennement "unifia"
unifia-cli                 # sidecar externalBin, anciennement "opencode-cli"
```

### 4.3 Fichiers de code

- **snake_case** : noms de variables/fonctions courts, single-word privilégiés (cf. AGENTS.md)
- **kebab-case** : noms de fichiers
- **PascalCase** : composants React/Solid
- **UPPER_SNAKE_CASE** : constantes, env vars

## 5. Stratégie d'authentification (Provenance)

Tout code source doit avoir :

1. **Header SPDX** dans le fichier (cf. `docs/autonomy/ATTRIBUTION-TEMPLATE.md`)
2. **Trailer commit** `Upstream-Repo/Commit/Path/License`
3. **Card ID** dans le trailer `Unifia-Card`

Hook pre-commit bloque tout fichier sans :
- header SPDX (pour les nouveaux fichiers TS/TSX/RS/MD)
- chemin `**/ee/**` (DO-NOT-IMPORT)
- `.env*` (sécurité)

## 6. Politique de merge

| Condition | Action |
|---|---|
| Carte READY → IN_PROGRESS | Merge dans `agent/integration` après `VERIFIED` |
| 3 cycles échoués | Carte `BLOCKED_AFTER_3_CYCLES` |
| Gate critique sans revue externe | `NEEDS_EXTERNAL_E2` |
| Problème de licence | `BLOCKED_LICENSE` |
| 3 dépendances cassées | `BLOCKED_DEPENDENCY` |

## 7. Sécurité

- **Default deny** sur toutes les surfaces (computer use, remote, browser, secrets, network)
- **Aucune** suppression de tests, gates, ou safeguards pour faire passer un build
- **Kill switches** sur chaque surface sensible (Phase 3)
- **Audit** de toute action sensible via `AuditRuntime`

## 8. Versions et cycles de release

| Phase | Sortie | Statut |
|---|---|---|
| Phase 0 | Rebrand cosmétique | ✅ DONE |
| Phase 1 | CI + tests + harness | ✅ PARTIEL (P1-C110/120/010/020) |
| Phase 2 | Contrats | DEFERRED |
| Phase 3 | Security foundation | DEFERRED |
| Phase 5-10 | Workbench fonctionnel | DEFERRED |
| Phase 17 | Release hardening | DEFERRED |
| Phase 18 | Release publique | DEFERRED |

## 9. Responsabilités

| Acteur | Responsabilité |
|---|---|
| Utilisateur (Erwan) | Décisions produit, validation des gates externes, revue finale |
| Hermes Agent (MiniMax M3) | Audit, exécution carte par carte, conformité protocole |
| Reviewer fresh-context | Revue read-only de chaque carte avant merge |
| GitHub (remotes) | Stockage, CI, releases (post-P0) |

## 10. Références

- `docs/autonomy/PLAN-DIRECTEUR-V3.md` — Plan directeur (22 phases)
- `docs/autonomy/TASK-GRAPH-v1.0.yaml` — Graphe de tâches
- `docs/autonomy/BLOCKED-DECISIONS.md` — Décisions en attente
- `docs/autonomy/ATTRIBUTION-TEMPLATE.md` — Modèle d'en-tête SPDX
- `docs/autonomy/UPSTREAM-SOURCES.lock.json` — Sources upstream verrouillées
- `docs/autonomy/DO-NOT-IMPORT.md` — Liste des interdictions d'import
- `docs/autonomy/SBOM-cyclonedx.json` — Software Bill of Materials