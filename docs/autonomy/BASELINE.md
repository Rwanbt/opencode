# Baseline — Unifia Workbench V3 (clone jetable)

**Généré par :** Hermes Agent (modèle MiniMax-M3)
**Date (UTC) :** 2026-07-31
**Statut :** `VERIFIED` — préflight OK, verrous en place, push techniquement impossible

## Identité du clone

| Champ | Valeur |
|---|---|
| Repository | `https://github.com/Rwanbt/unifia.git` |
| Branche de référence | `main` (default HEAD au clone ; la branche `Dev` n'a PAS été ramenée par le clone shallow) |
| Baseline SHA | `207ff452b8056ae11d1f71e23198e520835f70ed` |
| Commit sujet | `Merge pull request #16 from Rwanbt/dev` |
| Branche de travail | `agent/unifia-workbench-v3-20260731-082811-207ff452` |
| Sandbox root | `/opt/data/work/unifia-sandbox` (monté côté Windows sous `D:\AI-Workspace\hermes-data\.hermes\work\unifia-sandbox`) |
| Handoff root | `/opt/data/work/unifia-sandbox/handoff` |
| Mode clone | `--depth 1` (lecture seule rapide, pas de tags distants) |
| Files total | 5295 |
| LOC total | 462 701 |

## Verrous anti-push (3 couches, vérifiées)

| # | Mécanisme | Vérification |
|---|---|---|
| 1 | `core.hooksPath` local = `.git/hooks/pre-push` | Script sh qui echo `REMOTE PUSH DISABLED` + `exit 1` |
| 2 | `remote.origin.pushurl` = `https://invalid.local/PUSH-DISABLED.git` | `git push --dry-run origin HEAD` → exit 128 « Could not resolve host: invalid.local » ✅ |
| 3 | `remote.origin.pushurl` bloque aussi la suppression de ref | `git push origin :test-ne-pas-creer` → exit 128 ✅ |
| Bonus | `push.default = nothing` + `credential.helper = ""` | Empêche push accidentel implicite et fuite de creds |

**Conclusion sécurité :** l'agent peut faire des commits, branches, tags locaux et bundles. Il ne peut pas publier. C'est conforme à `02-PROTECTION-GITHUB.md`.

## Environnement d'exécution

| Outil | Version | Source de détection |
|---|---|---|
| Git | présent | `git --version` (à vérifier au préflight carte) |
| Bun | requis (packageManager `bun@1.3.11`) | `package.json` ligne `packageManager` |
| Node | non requis directement (runtime Bun) | — |
| Rust/Tauri | requis pour `packages/desktop` | `packages/desktop/src-tauri/Cargo.toml` |
| Python | non requis | — |
| Docker | NON disponible dans ce conteneur | `docker ps` → « Cannot connect to the Docker daemon » |

⚠️ **Implication :** la baseline de tests Bun et le typecheck peuvent tourner dans le conteneur. Le build Tauri (compilation Cargo de la desktop) ne pourra PAS tourner ici — il faudra le valider côté Windows. À marquer `ENV_BLOCKED` dans les cartes concernées.

## Topologie du repo

| Métrique | Valeur |
|---|---|
| Workspaces Bun | 21 packages sous `packages/*` + 5 sous `packages/console/*` |
| Packages i18n (README) | 21 langues |
| Packages i18n (CONTRIBUTING, LICENSE, SECURITY) | 21 langues chacun |
| Workflows GitHub | 42 fichiers `.yml` |
| Fichiers TS/TSX | 1809 (1367 `.ts` + 442 `.tsx`) |
| Fichiers MDX | 643 |
| SVG | 1259 |
| Rust (.rs) | 42 |
| Tauri (Cargo.toml) | présent dans `packages/desktop/src-tauri/` |
| AGENTS.md imbriqués | 5 (root + 4 packages) |
| Providers (TS) | 10 fichiers sous `packages/opencode/src/provider/` |
| Binaire CLI | `packages/opencode/bin/opencode` (entry `bin.opencode`) |
| Tauri identifier | `ai.opencode.desktop.dev` |
| Tauri scheme | `opencode` |
| Tauri externalBin | `sidecars/opencode-cli` |

## Commandes réelles détectées (à confirmer au préflight carte)

### Racine
- `bun install` (catalogue)
- `bun turbo typecheck`
- `bunx biome check .` (lint)
- `bunx knip --no-progress` (dead code)
- `bun test:opencode` = `cd packages/opencode && bun test`
- `bun test:session` = `cd packages/opencode && bun test --filter session`

### Package `opencode` (CLI)
- `typecheck`: `tsgo --noEmit`
- `test`: `bun test --timeout 180000`
- `build`: `bun run script/build.ts`
- `lint`: `bun test --coverage` (⚠️ non standard — à vérifier, semble être un alias de test)

### Package `desktop` (Tauri)
- `typecheck`: `tsgo -b`
- `build`: `bun run typecheck && vite build` (UI) + `cargo` via Tauri (binaire)

### Package `app` (SolidJS web)
- `typecheck`: `tsgo -b`
- `build`: `vite build`
- `test`: `bun run test:unit`

## Fichiers de référence déjà présents (à respecter, ne pas dupliquer)

Le fork a déjà des artefacts de gouvernance substantiels :

- `AGENTS.md` (racine, 3.4k) — instructions agent
- `CLAUDE.md` (8.4k) — overrides Claude Code
- `ARCHITECTURE.md` (2.6k)
- `AUDIT_REPORT.md` (19.7k) — **audit existant, à consulter AVANT tout TASK-GRAPH**
- `EXECUTION_PLAN.md` — plan d'exécution en cours
- `IMPLEMENTATION_PLAN_AI_OPTIMIZATION.md`
- `PROMPT_SYSTEM_COMPLETE.md`
- `ROADMAP.md`
- `KNOWN_ISSUES.md`
- `NEXT_SESSION_PLAN.md`

**Conséquence directe :** avant de proposer un TASK-GRAPH V3 pour le rebrand Unifia, je DOIS lire `AUDIT_REPORT.md` + `EXECUTION_PLAN.md` pour éviter de contredire ou dupliquer des décisions déjà prises. C'est un blocage soft — pas de plan V3 = pas de graph final, mais l'audit existant peut fournir 60-70% du contexte.

## Statut des phases pack V3

| Phase pack | Statut | Note |
|---|---|---|
| Phase -2 (inventaire distant) | `DONE` | voir `REPO-INVENTORY.md` |
| Phase -1 (audit local) | `PARTIAL` | AUDIT_REPORT.md existe mais n'est pas un Plan Directeur V3 Unifia |
| Phase 0 (preflight) | `VERIFIED` | ce fichier |
| Phase 1 (décomposition cartes) | `BLOCKED_MISSING_PLAN_V3` | tant que le Plan Directeur V3 Unifia n'est pas fourni |
| Phase 2+ (exécution) | `HOLD` | dépend de la phase 1 |

## Honnêteté épistémique

- `BLOCKED_MISSING_PLAN_V3` : le pack attend un document « Plan directeur V3 — Unifia Workbench » qui n'est pas dans le pack (`COPY-PLAN-HERE.txt` est vide). Sans lui, je ne peux pas générer un `TASK-GRAPH.yaml` complet — seulement un draft à valider.
- `BLOCKED_DOCKER_IN_CONTAINER` : pas de daemon Docker ici. L'image `unifia-hermes-runner:1.0` du pack ne peut pas être construite dans ce conteneur. Le conteneur actuel **EST** déjà un sandbox ; les verrous sont donc redondants mais cumulés.
- `BLOCKED_NO_DESKTOP_BUILD` : pas de toolchain Rust/Tauri dans ce conteneur. Builds desktop marqués `ENV_BLOCKED` tant qu'on n'est pas côté Windows.
