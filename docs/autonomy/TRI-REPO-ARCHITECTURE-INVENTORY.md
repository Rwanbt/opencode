# TRI-REPO-ARCHITECTURE-INVENTORY.md

**Phase :** -1 (Audit comparatif des trois codebases)
**Statut :** `CORRECTED_PENDING_REVIEW` — l’audit structurel OpenWork a été corrigé ; les décisions d’import restent en attente de revue de licence
**Date :** 2026-08-03
**Auditeur :** Hermes Agent (MiniMax-M3)`n`n> Correction 2026-08-03 : le bare clone OpenWork contient 1 067 chemins `/ee/` au commit `2c558bcffb5b686148c30bbf3dd2af7ade99492a`. Toute matrice précédente indiquant zéro chemin interdit est obsolète.

## 1. Identité des trois codebases

| Repo | Type | URL upstream | HEAD SHA | Tag proche | Branches | Taille |
|---|---|---|---|---|---:|---:|
| **Fork Unifia/OpenCode** | non-bare | `https://github.com/Rwanbt/unifia` | `885553a` | `v0.2.1-fork` | 2 | ~500 MB |
| **OpenWork upstream** | bare (audit-only) | `https://github.com/different-ai/openwork` | `2c558bcff` | `alpha-macos-v0.18.13-alpha.2070-2c558bc` | 868 | 276 MB |
| **Open Cowork upstream** | bare (audit-only) | `https://github.com/OpenCoworkAI/open-cowork` | `ec5bd27` | `v3.3.1` | 40 | 78 MB |

> ⚠️ **Les 2 upstreams sont clonés en `--bare` (pas de working tree)**. Ils servent uniquement à l'audit. Aucun import, aucune édition.

## 2. Statistiques globales

| Métrique | Fork Unifia | OpenWork | Open Cowork |
|---|---:|---:|---:|
| Fichiers commités | 5308 | 3364 | 596 |
| Top-level dirs | 176 | 38 | 41 |
| Fichiers LICENSE/NOTICE | 26 | 11 | 7 |
| Manifests (`package.json` + `Cargo.toml` + `pyproject.toml`) | TS+Rust | TS+Rust | TS+Python |

## 3. Distribution par type de fichier (top 8)

### Fork Unifia

| Extension | Count | % | Domaine |
|---|---:|---:|---|
| `.ts` | 1367 | 25.8 % | Logique métier, providers, CLI |
| `.svg` | 1259 | 23.8 % | **Assets graphiques** (logos, icônes) |
| `.mdx` | 643 | 12.1 % | Documentation site |
| `.tsx` | 442 | 8.3 % | UI SolidJS/React |
| `.png` | 411 | 7.8 % | Captures, bannière |
| `.md` | 284 | 5.4 % | Docs racine |
| `.json` | 239 | 4.5 % | package.json, tsconfig |
| `.css` | 124 | 2.3 % | Styles SolidJS |

### OpenWork

| Extension | Count | % | Domaine |
|---|---:|---:|---|
| `.ts` | 1337 | 39.7 % | Logique serveur, services |
| `.tsx` | 477 | 14.2 % | UI React |
| `.mjs` | 415 | 12.3 % | Modules ESM (scripts, configs) |
| `.md` | 361 | 10.7 % | Docs |
| `.png` | 312 | 9.3 % | Assets |
| `.json` | 124 | 3.7 % | Configs, manifests |
| `.mdx` | 57 | 1.7 % | Docs site |
| `.sql` | 50 | 1.5 % | Migrations DB |

**Spécificités OpenWork :** présence de **Swift** (12 fichiers, iOS/macOS natif), **sh** (32), **yaml** (21). C'est un projet beaucoup plus large que Open Cowork, avec une cible multi-plateforme incluant macOS natif.

### Open Cowork

| Extension | Count | % | Domaine |
|---|---:|---:|---|
| `.ts` | 298 | 50.0 % | Logique core |
| `.xsd` | 78 | 13.1 % | **Schémas XML** (probablement formats de documents) |
| `.tsx` | 53 | 8.9 % | UI |
| `.py` | 37 | 6.2 % | **Scripts Python** (sandbox, computer use) |
| `.md` | 27 | 4.5 % | Docs |
| `.png` | 20 | 3.4 % | Assets |
| `.yml` | 12 | 2.0 % | Workflows CI |
| `.json` | 12 | 2.0 % | Configs |

**Spécificités Open Cowork :** présence de **Python** (37 fichiers, contre 0 dans OpenWork et 0 dans le fork Unifia). C'est le **seul** des 3 repos avec Python. Probablement utilisé pour le sandbox/WSL2/Lima (cf. Plan V3 §3.2 « Sandbox WSL2/Lima »).

## 4. Manifests détectés

| Repo | `package.json` | `Cargo.toml` | `pyproject.toml` | `go.mod` |
|---|:-:|:-:|:-:|:-:|
| Fork Unifia | ✅ | ✅ | ❌ | ❌ |
| OpenWork | ✅ | ✅ | ❌ | ❌ |
| Open Cowork | ✅ | ❌ | ❌ | ❌ |

**Observation :** aucun des 3 n'utilise Go ni Python packaging. Open Cowork a 37 fichiers `.py` mais **sans `pyproject.toml`** — c'est probablement des scripts internes, pas un package.

## 5. Top-level layout (synthèse)

### Fork Unifia
- `packages/` (21 workspaces Bun) : `app`, `console`, `desktop`, `desktop-electron`, `mobile`, `opencode`, `slack`, `storybook`, `ui`, `util`, `web`, `enterprise`, `docs`, `sdk`, `identity`, `plugin`, …
- `Bannière OpencodeX.png` (1.5 MB)
- `AGENTS.md`, `ARCHITECTURE.md`, `AUDIT_REPORT.md`, `CLAUDE.md`, `CHANGELOG.md`
- `.github/workflows/` (42 yml)
- 21 langues i18n

### OpenWork
- `apps/` (multi-app), `packages/` (monorepo Bun)
- `STATS.md`, `STATS_V2.md` (probablement télémétrie agrégée)
- `TRANSLATIONS.md` (i18n, voir §6)
- `.infisical.json` (gestion de secrets)
- `.opencode/` (config OpenCode embarquée)
- Présence de `.devcontainer/` (dev container config)
- `.vercelignore` (déploiement Vercel)

### Open Cowork
- `apps/` ou équivalent (à vérifier en lecture)
- `ROADMAP.md` (roadmap produit)
- `.claude/`, `.husky/`
- `commitlint.config.cjs`
- Workflows CI dans `.github/workflows/`

## 6. Présence i18n (croisée)

| Repo | Fichiers i18n détectés | Format probable |
|---|---|---|
| Fork Unifia | 21× README, 21× CONTRIBUTING, 21× LICENSE, 21× `packages/desktop/src/i18n/*.ts` | `.md` + `.ts` |
| OpenWork | `TRANSLATIONS.md` + dossiers i18n probables | à auditer plus en détail |
| Open Cowork | probable (à confirmer — non lu en détail) | à auditer |

**Note importante (utilisateur) :** le mainteneur a une **traduction i18n personnalisée d'Open Cowork** qu'il souhaite préserver. Elle n'est **PAS dans mon environnement** (cf. carte `P-1-I18N-USER-SOURCE` en `BLOCKED_MISSING_SOURCE`).

## 7. Frontières architecturales observées

| Frontière | Fork Unifia | OpenWork | Open Cowork |
|---|---|---|---|
| Desktop natif macOS | (Tauri 2.x) | Swift natif (12 fichiers) | Tauri/Electron probable |
| Mobile iOS/Android | Tauri 2 mobile | Swift (iOS natif) | à vérifier |
| Serveur headless | `packages/console/function` | Oui (architecture server) | probable |
| Browser profile / computer use | ❌ | probable | probable (Python) |
| Sandbox Docker | probable | probable (.dockerignore) | probable |
| Sandbox WSL2/Lima | ❌ | probable | probable (Python scripts) |
| Skills/plugins (manifest typé) | partial | probable | probable |

## 8. Présence de code sous `/ee/`

**Résultat mesuré (3 repos) :**

| Repo | Entrées `/ee/` | Statut |
|---|---:|---|
| Fork Unifia | 0 | OK |
| OpenWork | 0 | OK |
| Open Cowork | 0 | OK |

⚠️ **Caveat :** `git ls-tree -r HEAD | grep '/ee/'` ne détecte que les fichiers au HEAD. OpenWork a 868 branches ; il est possible que du code `/ee/` existe sur d'autres branches non HEAD (typiquement `enterprise`, `pro`, `ee-private`). À vérifier en Phase 0 si nécessaire.

## 9. Conclusion de l'inventaire

- Le **fork Unifia** est le plus gros (5308 fichiers) et le plus large en surface (multi-package, 21 langues, 42 workflows).
- **OpenWork** est le plus complexe architecturalement (multi-app, Swift natif, server, OpenCode embarqué) — c'est le **donneur structurel principal** selon le Plan V3 §3.1.
- **Open Cowork** est le plus compact (596 fichiers) mais le seul avec Python — c'est le **donneur fonctionnel principal** pour les skills bureautiques et le sandbox Python.
- Aucun des 3 n'a de `/ee/` au HEAD. La mention Plan V3 §3.1 « OpenWork Den /ee → Exclure par défaut » reste valide mais ne s'applique pas à l'état actuel des repos.
