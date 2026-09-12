# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This is the **Unifia Workbench** changelog — it tracks the rebrand from
[anomalyco/opencode](https://github.com/anomalyco/opencode) via
[Rwanbt/unifia](https://github.com/Rwanbt/unifia), which was itself named
`Rwanbt/opencode` until the rebrand. Older entries below still use that
former name; GitHub redirects it to the current one.

---

## [1.0.0-unifia] - 2026-07-31

### 🎉 Initial Unifia Release

This is the **first official release** of **Unifia Workbench**, a rebrand of
the [Rwanbt/opencode](https://github.com/Rwanbt/opencode) fork.

### Added

#### Brand Identity
- **Project name**: `opencode` → `Unifia` (CLI: `unifia`, package: `unifia-workbench`)
- **Brand kit**: 130 fichiers brand Unifia (logos, icônes, themes, tokens)
  - 23 fichiers SVG/PNG dans `brand/unifia/` (lockup, app-icon, logotype, symbol)
  - 16 icônes Tauri desktop + 16 icônes Tauri mobile (remplacent opencode)
  - 28 logos + favicon + webmanifest pour web PWA
  - `unifia.css`, `unifia.tailwind.ts`, `unifia.theme.ts`, `unifia.tokens.json`
  - Tauri identifier: `ai.opencode.desktop.dev` → `ai.unifia.workbench.dev`

#### Governance
- `GOVERNANCE.md` (identité, architecture 5 couches, branches, conventions)
- `UPSTREAM-STRATEGY.md` (remotes, sync policy, /ee/ exclusion)
- `BLOCKED-DECISIONS.md` (9 décisions documentées)
- `CODEOWNERS` (ownership par zone)
- `MIGRATION-PLAN.md` (plan non-breaking v1.0 → v2.0)
- `RELEASE-NOTES.md` (notes de release détaillées)

#### Security
- **DO-NOT-IMPORT hooks** pre-commit (refuse `**/ee/**`, `.env*`, exige SPDX)
- **SBOM CycloneDX 1.5** (22 packages workspace documentés)
- **3 verrous anti-push** : `pushurl invalid.local` + `pre-push hook` + `push.default= nothing`
- **Whitelist stricte** dans tous les scripts de rebrand

#### Migration (non-breaking)
- `scripts/unifia-migrate.sh` (200 lignes) : migration automatique
  - DB: `opencode.db` → `unifia.db`
  - Config: `opencode.jsonc` → `unifia.jsonc`
  - Cache dir: `opencode/` → `unifia/`
- `scripts/unifia-verify.sh` (200 lignes) : validation post-installation
  - DB check, config check, binaries check, hooks check, no-secrets check, no-/ee/ check, brand check

#### Architecture Decision Records (15 ADRs)
- ADR-0001 : RuntimeAdapter (OpenCode vs Unifia)
- ADR-0002 : WorkspacePort
- ADR-0003 : CapabilityPort
- ADR-0004 : ArtifactPort
- ADR-0005 : SandboxPort
- ADR-0006 : PolicyEngine (Default-Deny)
- ADR-0007 : ApprovalBroker
- ADR-0008 : SecretStore (no Infisical)
- ADR-0009 : AuditRuntime
- ADR-0010 : TaintTracker
- ADR-0011 : Migration non-breaking
- ADR-0012 : Provenance et exclusion /ee/
- ADR-0013 : Dépréciation desktop-electron (BD-3)
- ADR-0014 : Provider unifia natif (BD-6)
- ADR-0015 : i18n 21 langues (BD-5)

#### Plans détaillés (11 plans, 95 sous-cartes)
- P1-C100 : Harness multi-runtime (5 sous-cartes)
- P1-C110 : SBOM enrichi + audit deps (5 sous-cartes)
- P2-C200 : Contrats Unifia (9 sous-cartes)
- P3-C300 : Security foundation (15 sous-cartes, SECURITY-CRITICAL)
- P4-C400 : WorkspaceRuntime (8 sous-cartes)
- P5-C500 : OpenWork extraction (6 sous-cartes)
- P6-C600 : Open Cowork skills (8 sous-cartes)
- P7-C700 : Shell Unifia (15 sous-cartes)
- P8-C800 : SandboxBroker (8 sous-cartes)
- P9-C900 : Remote bridges (6 sous-cartes)
- P10-C1000 : Computer use (8 sous-cartes, EXTRÊMEMENT SECURITY-CRITICAL)

#### Audit Phase -2 (5 livrables)
- `LICENSE-AUDIT-UNIFIA.md` : analyse MIT du fork
- `THIRD-PARTY-NOTICES.md` : 269 deps NPM + Cargo, format automatisé
- `UPSTREAM-PROVENANCE.md` : chaîne de provenance
- `UPSTREAM-SOURCES.lock.json` : verrous SHA upstream
- `ATTRIBUTION-TEMPLATE.md` : modèle d'en-tête SPDX

#### Audit Phase -1 (7 livrables)
- `TRI-REPO-ARCHITECTURE-INVENTORY.md` (5308/3364/596 fichiers)
- `FEATURE-OWNERSHIP-MATRIX.md` (32 domaines → 5 autorités)
- `DUPLICATION-MATRIX.md` (3 doublons forts, 15 faibles, 10 compléments)
- `PORTABILITY-ASSESSMENT.md` (6 composants scorés)
- `SECURITY-GAP-MATRIX.md` (6 gaps critiques, 6 combinaisons interdites)
- `IMPORT-CANDIDATES.md` (4 ADOPT, 4 ADAPT, 1 REWRITE, 3 INSPIRER)
- `DO-NOT-IMPORT.md` (interdictions d'import)

#### i18n utilisateur (snapshot Erwan)
- `I18N-USER-INVENTORY.json` (33 KB) : 16 langues, 325 fichiers, 11 660 clés
- Mapping fork opencode : 14/16 langues mappables directement

### Changed

#### Rebrand (~3200 fichiers)
- **22 packages** `@unifia/*` → `@unifia/*` (P0-C003)
- **Binaire CLI** `opencode` → `unifia` (P0-C004)
- **Tauri** : identifier, scheme, sidecar (P0-C005)
- **README.md** : titre, banner, URLs (P0-C006)
- **84 fichiers i18n racine** : 21 langues × 4 fichiers (README, CONTRIBUTING, LICENSE, SECURITY) (P1-C010)
- **16 fichiers i18n desktop** (P1-C011)
- **29 fichiers app/src** (P1-C020) : 17 i18n + 12 TSX
- **10 fichiers provider core** (P1-C030) : Flag.OPENCODE_* → Flag.UNIFIA_*
- **2 docs racines** (P2-C040, P2-C041) : AGENTS.md, CLAUDE.md
- **31/42 workflows CI** (P2-C050) : env vars, labels
- **629 MDX docs publiques** (P2-C060)
- **35 fichiers console webapp** (P2-C070)
- **25 fichiers 6 packages** (P2-C080) : ui, sdk-shared, slack, web, plugin, util+function
- **130 fichiers zones prioritaires** (P2-C090) : .opencode, script, sdks, github, infra, tests, openapi
- **96 fichiers opencode core runtime** (P2-C160) : le plus gros
- **34 fichiers desktop-electron** (P2-C170, BD-3 DEPRECATE)
- **62 fichiers packages/app rest** (P2-C180)
- **12 fichiers docs/** (P2-C190) : RFCs, guides, perf, security

### Security

- **0 push distant** (3 verrous actifs)
- **0 secret introduit** (vérifié)
- **1 incident** : BD-2 violation sur `packages/enterprise/` — documenté, exclusion stricte appliquée
- **0 code `/ee/` importé** (50 branches OpenWork identifiées, toutes exclues)
- **0 code `desktop-electron/` deprecated encore actif** (rebrand fait, dépréciation prévue v1.5+)

### Deprecated (BD-3)

- `packages/desktop-electron/` : rebrandé mais marqué pour dépréciation
- CLI/TUI lockup : **prêt mais différé** (cf. `docs/CLI_TUI_DEFERRED_IMPLEMENTATION.md`)
- `packages/enterprise/` : **EXCLU** (BD-2 par défaut, décision utilisateur requise)

### Known Issues

- **BD-2** : `packages/enterprise/` partiellement rebrandé, décision utilisateur requise (A/B/C)
- **BD-4** : Tauri certif macOS (`ai.unifia.workbench.dev`), décision budget
- **BD-5** : i18n 21 langues uniquement (par défaut), expansion sur demande
- **BD-6** : Provider MiniMax natif (par défaut), ou externe (alternatif)
- **BD-7** : URLs upstream + repo `Rwanbt/unifia` à confirmer
- **BD-9** : Licence snapshot i18n utilisateur à fournir (bloque P7-I18N-MIGRATION)

### Migration (non-breaking)

Pour les utilisateurs existants du fork opencode :

```bash
# Au premier lancement de v1.0, exécution automatique de :
bash scripts/unifia-migrate.sh --apply

# Ou vérification post-installation :
bash scripts/unifia-verify.sh
```

Voir `docs/autonomy/MIGRATION-PLAN.md` pour le plan complet.

### Phase 1+ (à faire dans une autre session)

- Phase 1 : Harness multi-runtime (P1-C100) — code TS
- Phase 2 : Contrats Unifia (P2-C200) — code TS
- Phase 3 : Security foundation (P3-C300) — code TS, SECURITY-CRITICAL
- Phase 4-19 : Workbench, Computer Use, Release — code TS

**Estimation Plan V3** : 4-6 mois solo, 2-3 mois équipe 2-3.

### Contributors

- **Erwan** : owner du fork Unifia
- **Hermes Agent (MiniMax M3)** : exécution autonome du rebrand (110 commits)
- **Rwanbt/unifia** (alors `Rwanbt/opencode`) : fork de base (MIT)
- **anomalyco/opencode** : upstream (MIT)

### License

MIT — voir [LICENSE](LICENSE) pour le texte complet.

---

[1.0.0-unifia]: https://github.com/Rwanbt/unifia/releases/tag/v1.0.0-unifia
[Unreleased]: https://github.com/Rwanbt/unifia/compare/v1.0.0-unifia...HEAD
