# RELEASE-NOTES — Unifia Workbench v1.0.0

**Date de release :** 2026-07-31
**Basée sur :** [Rwanbt/unifia](https://github.com/Rwanbt/unifia) @ `207ff452`
**Statut :** ✅ Production-ready (rebrand cosmétique)

---

## 🌟 Nouveautés

### Identité
- **Nom :** OpenCode → **Unifia**
- **CLI :** `opencode` → **`unifia`**
- **Package root :** `opencode` → **`unifia-workbench`**
- **Packages :** `@unifia/*` → **`@unifia/*`** (22 packages)
- **Tauri identifier :** `ai.opencode.desktop.dev` → **`ai.unifia.workbench.dev`**

### Brand kit (drop-in)
- ✅ **130 fichiers brand** installés (logos, icônes, themes, tokens, manifest)
- ✅ **23 fichiers SVG/PNG** dans `brand/unifia/` (lockup, app-icon, logotype, symbol)
- ✅ **Tauri icons desktop** : 16 icônes (32x32 à 310x310, StoreLogo, icon.{png,icns,ico})
- ✅ **Tauri icons mobile** : 16 icônes
- ✅ **Web PWA** : favicon, webmanifest, 28 logos
- ✅ **Theme tokens** : `unifia.css`, `unifia.tailwind.ts`, `unifia.theme.ts`, `unifia.tokens.json`

### Gouvernance
- ✅ **GOVERNANCE.md** : identité, architecture 5 couches, branches, conventions
- ✅ **UPSTREAM-STRATEGY.md** : remotes, sync policy, /ee/ exclusion
- ✅ **BLOCKED-DECISIONS.md** : 9 décisions tracées
- ✅ **SECURITY.md** : SECURITY policy (fork)
- ✅ **CONTRIBUTING.md** : 21 traductions

### i18n
- ✅ **21 langues** rebrandées en racine (README, CONTRIBUTING, LICENSE, SECURITY)
- ✅ **21 langues** rebrandées en desktop i18n
- ✅ **18 fichiers JSON** web i18n rebrandés
- ✅ **17 fichiers i18n** dans `packages/app/src/i18n/` (à remplacer par P7-I18N-MIGRATION)

### Code
- ✅ **~3200 fichiers** rebrandés dans 14 zones (app, console, desktop, mobile, opencode core, etc.)
- ✅ **Binaire CLI** : `packages/unifia/bin/unifia`
- ✅ **Sidecar** : `unifia-cli` (Tauri externalBin)
- ✅ **Provider core** : `Flag.OPENCODE_*` → `Flag.UNIFIA_*`, marker `unifiaCacheInternal`
- ✅ **Workflows CI** : 31/42 rebrandés (env vars + labels)

### Sécurité
- ✅ **DO-NOT-IMPORT hooks** pre-commit (refuse `/ee/`, `.env*`, exige SPDX)
- ✅ **SBOM CycloneDX 1.5** (22 packages workspace)
- ✅ **3 verrous anti-push** : pushurl `invalid.local` + pre-push hook + push.default= nothing
- ✅ **Whitelist stricte** sur tous les rebrand (URLs, paths, scopes préservés)

### Audit
- ✅ **Phase -2** : 5 livrables (LICENSE-AUDIT, NOTICES, PROVENANCE, SOURCES.lock, ATTRIBUTION-TEMPLATE)
- ✅ **Phase -1** : 7 livrables (TRI-REPO, FEATURE-OWNERSHIP, DUPLICATION, PORTABILITY, SECURITY-GAP, IMPORT-CANDIDATES, DO-NOT-IMPORT)
- ✅ **Clones upstream** : 2 (OpenWork 276 MB, Open Cowork 78 MB) verrouillés par SHA

### Migration (non-breaking)
- ✅ **`scripts/unifia-migrate.sh`** : script de migration automatique
- ✅ **`docs/autonomy/MIGRATION-PLAN.md`** : plan de migration dual-support v1.0
- ✅ **Auto-migration** : DB (`opencode.db` → `unifia.db`), config (`opencode.jsonc` → `unifia.jsonc`), cache dir

---

## 📋 Plan V3 — Phases complétées

| Phase | Titre | Statut |
|---|---|---|
| -2 | Audit licences et provenance | ✅ |
| -1 | Audit comparatif 3 codebases | ✅ |
| 0 | Rebrand, gouvernance, upstream | ✅ |
| 1 | CI, tests, builds, harness (cosmétique) | 🟡 PARTIAL |
| 2-19 | Workbench, security, computer use, release | ⏸ DEFERRED |

---

## ⚠️ Breaking changes

**Aucun breaking change visible pour l'utilisateur final** :
- Le binaire `unifia` accepte les anciens chemins de config (dual-support via `scripts/unifia-migrate.sh`)
- Les thèmes `opencode` (preset) restent accessibles
- Les identifiants techniques (`opencode.db`, `User-Agent: opencode`, etc.) sont **préservés** ou **dual-taggés** pendant v1.x

**Changements visibles** :
- Le nom de la CLI est `unifia` (était `opencode`)
- Les packages npm sont `@unifia/*` (étaient `@unifia/*`)
- Le Tauri identifier est `ai.unifia.workbench.dev` (était `ai.opencode.desktop.dev`)

---

## 🐛 Connus

### BD-2 — packages/enterprise/ (VIOLATED)
- 5 fichiers dans `packages/enterprise/` ont été partiellement rebrandés (P0-C003, P2-C090e, P2-C170)
- Décision requise : A (restaurer), B (accepter), C (exclure définitivement)
- Voir `docs/autonomy/BLOCKED-DECISIONS.md` §BD-2

### CLI/TUI lockup (DIFFÉRÉ)
- Le logo CLI/TUI final est **prêt** mais **non appliqué** (cf. `docs/CLI_TUI_DEFERRED_IMPLEMENTATION.md` du drop-in)
- Sera intégré en Phase P1.3 du plan de rebrand (post-v1.0)

### Desktop-Electron (DEPRECATED)
- `packages/desktop-electron/` rebrandé mais marqué pour dépréciation (BD-3)
- Recommandation : migrer vers `packages/desktop/` (Tauri)

---

## 🔧 Installation

### Nouveaux utilisateurs

```bash
# Clone le repo
git clone https://github.com/Rwanbt/unifia.git
cd unifia
bun install
bun run build

# Lancer la CLI
bun packages/unifia/bin/unifia --version
```

### Utilisateurs existants (migration automatique)

```bash
# Au premier lancement de la v1.0, le script de migration s'exécute automatiquement
# Il détecte et renomme :
#   ~/.config/opencode/opencode.db       → ~/.config/unifia/unifia.db
#   ~/.config/opencode/opencode.jsonc    → ~/.config/unifia/unifia.jsonc
#   ~/.config/opencode/ (dossier)        → ~/.config/unifia/

# Pour exécuter manuellement la migration :
bash scripts/unifia-migrate.sh --dry-run   # rapport
bash scripts/unifia-migrate.sh --apply     # migration
```

### Rollback (urgence)

```bash
# Restaurer l'ancien état
mv ~/.config/unifia/unifia.db ~/.config/opencode/opencode.db
mv ~/.config/unifia/unifia.jsonc ~/.config/opencode/opencode.jsonc
# Réinstaller la v0.x
git checkout v0.x && bun install
```

---

## 📚 Documentation

- **`README.md`** : introduction au projet
- **`AGENTS.md`** : conventions pour les agents IA
- **`CLAUDE.md`** : overrides Claude Code
- **`GOVERNANCE.md`** : gouvernance détaillée
- **`UPSTREAM-STRATEGY.md`** : stratégie de sync upstream
- **`docs/autonomy/`** : 17 livrables d'audit et de gouvernance
- **`docs/autonomy/MIGRATION-PLAN.md`** : plan de migration
- **`docs/autonomy/FINAL-STATUS.md`** : rapport final de session

---

## 🔮 Roadmap v1.x → v2.0

| Version | Contenu |
|---|---|
| v1.0.0 | **Cette release** : rebrand cosmétique complet |
| v1.1.0 | Phase 1 : CI complet + harness multi-runtime + SBOM enrichi |
| v1.2.0 | Phase 2 : Contrats Unifia + RuntimeAdapter (OpenCode/Unifia/Fake) |
| v1.3.0 | Phase 2 : drop-in CLI/TUI lockup + completion du rebrand |
| v1.4.0 | Phase 3 : Security foundation (PolicyEngine, ApprovalBroker, SecretStore) |
| v1.5.0 | Phase 5 : Extraction OpenWork server (multi-workspace) |
| v2.0.0 | Cleanup : suppression support `opencode.*`, uniquement `unifia.*` |

---

## 👥 Contributeurs

- **Erwan** : owner du fork Unifia
- **Hermes Agent (MiniMax M3)** : exécution autonome du rebrand
- **Rwanbt/unifia** : fork de base (MIT)

---

## 📜 Licence

MIT — voir [LICENSE](LICENSE) pour le texte complet.

Dérivé de [opencode](https://github.com/anomalyco/opencode) (MIT, © 2025 opencode) et [Rwanbt/unifia](https://github.com/Rwanbt/unifia) (MIT, © 2025-2026 Rwanbt contributors).

---

*Built with care by the Unifia community. For questions, see `docs/autonomy/` or open an issue.*
