# Dependabot — First-Batch Triage Guide

> Cible : triage du premier batch Dependabot sur `Rwanbt/opencode`
> (probablement 20–50 PRs — monorepo npm/Bun + 3 `Cargo.toml` Rust
> + GitHub Actions). À exécuter dans la demi-journée qui suit
> l'activation de `.github/dependabot.yml`.

---

## 0. Pré-requis

- `gh auth status` : authentifié, scope `repo` + `workflow`.
- Branche locale `dev` synchronisée.
- CI verte sur `dev` (baseline avant merge batch Dependabot).
- `bun install --frozen-lockfile` et `cargo check --workspace` passent
  sur `dev`.

---

## 1. Ordre de traitement — priorité

Traiter les PRs dans cet ordre strict :

1. **Security advisories** — PRs labellisées `security` ou référençant
   un GHSA/CVE dans le titre. Mergeables en premier, sans exception.
2. **Major version bumps** (semver-major) — à traiter un par un, jamais
   en lot. Requiert review manuelle (breaking-change hotspots §3).
3. **GitHub Actions bumps** — faible risque (workflow-only), mergeables
   rapidement après vérification que les inputs n'ont pas changé.
4. **Minor version bumps** — regroupables par écosystème.
5. **Patch version bumps** — auto-merge si les checks sont verts (voir
   §2).

---

## 2. Règles d'auto-merge recommandées

À activer via `gh pr merge --auto --squash` ou via branch-protection
"auto-merge on green".

| Catégorie | Auto-merge ? | Justification |
|-----------|--------------|----------------|
| `@types/*` patch & minor | Oui | Types only, no runtime impact |
| Linters (`eslint*`, `@typescript-eslint/*`) patch | Oui | Rule changes only |
| Formatters (`prettier`, `dprint`) patch | Oui | Cosmetic |
| `actions/*` official actions minor & patch | Oui | GitHub-maintained |
| `slsa-framework/*` patch | Oui | Reusable workflow |
| Tout bump non listé en §3 hotspots, patch, tests verts | Oui | Faible risque |
| Majors (tout paquet) | **Non** | Review manuelle obligatoire |
| Hotspots §3 (tout niveau) | **Non** | Review manuelle obligatoire |

Exemple de règle de branch protection (GitHub UI → Settings → Rules) :

- "Require status checks to pass before merging" ON : `test`,
  `typecheck`, `codeql`, `android`.
- "Allow auto-merge" ON.

---

## 3. Groupes à reviewer manuellement (hotspots)

Toute PR qui touche l'un des paquets ci-dessous — **quel que soit le
niveau semver** — doit être reviewée par un humain avant merge.

### AI SDK

- `ai`
- `@ai-sdk/*` (tous les sous-paquets : `@ai-sdk/openai`,
  `@ai-sdk/anthropic`, `@ai-sdk/google`, etc.)
- `@anthropic-ai/sdk`
- `openai`

**Pourquoi** : le pipeline `streamText` dans `packages/opencode/src/session/llm.ts`
et `packages/opencode/src/provider/fallback.ts` dépend de la forme exacte
des chunks `LanguageModelV3` (`text-delta`, `reasoning-delta`,
`tool-input-*`, `finish`). Un bump mineur peut introduire un nouveau
type de chunk et casser silencieusement le détecteur pre/mid stream
de `withStreamingFallback`.

**Checklist review** :

- [ ] Lire le CHANGELOG du paquet.
- [ ] Vérifier que les types `LanguageModelV3` / `LanguageModelV2` sont
      inchangés (ou adapter `fallback.ts` si nouveau chunk kind).
- [ ] Exécuter `bun test test/provider/` localement.
- [ ] Valider manuellement un streaming Anthropic + OpenAI.

### Tauri

- `@tauri-apps/api`
- `@tauri-apps/cli`
- `@tauri-apps/plugin-*`
- crate Rust : `tauri`, `tauri-build`, `tauri-plugin-*`

**Pourquoi** : un bump Tauri impacte `packages/desktop/src-tauri/` et
`packages/mobile/src-tauri/` (Android). Les breaking-change historiques
Tauri 1→2 ont cassé la config `tauri.conf.json`, l'IPC, les plugins.

**Checklist review** :

- [ ] Lire les migration guides Tauri.
- [ ] `cargo check --release` sur desktop et mobile.
- [ ] Vérifier `tauri.conf.json` plugins (deep-link notamment, voir
      memory `reference_tauri_deeplink_2_4_8_config.md`).
- [ ] QA mobile physique si touche au cycle Android (voir
      `QA_ANDROID_DEVICES.md`).

### Effect

- `effect`
- `@effect/*`

**Pourquoi** : le runtime OpenCode repose sur Effect (`Layer`, `Service`,
`Effect.gen`). Les bumps majors Effect ont historiquement modifié les
signatures de `Effect.runPromise`, `Layer.effect`, et les `Context.Tag`.

**Checklist review** :

- [ ] `bun run typecheck` dans chaque package.
- [ ] Grep les usages de `@effect/schema`, `Effect.tryPromise`,
      `Layer.effect` — vérifier compatibilité.

### Drizzle

- `drizzle-orm`
- `drizzle-kit`

**Pourquoi** : migrations SQLite + schéma `audit_log`, `session`,
`message`. Un bump mineur peut casser le runtime ou nécessiter une
migration.

**Checklist review** :

- [ ] Lire le CHANGELOG.
- [ ] `bun run drizzle-kit check` (si commande disponible).
- [ ] Vérifier que les migrations existantes sous
      `packages/opencode/migration/` se ré-appliquent sans erreur
      (DB from scratch).

### Zod

- `zod`

**Pourquoi** : usage massif dans `packages/opencode/src/config/config.ts`
et routes Hono. Un bump major (Zod 3 → 4) change l'API `.parse`,
`.safeParse`, les error messages et les methods chainables.

### Autres paquets sensibles

- `hono` (serveur REST) — les bumps majors changent les middlewares.
- `@hono/*` — idem.
- `keyring` (crate Rust) — `packages/desktop/src-tauri/` keychain.
- `better-sqlite3` / bindings natifs — ABI Bun.
- `tokio` / `serde` / `serde_json` — crates Rust transverses.

---

## 4. Breaking-change hotspots — surveillance

Les bumps majors suivants nécessitent une PR dédiée, pas un merge
Dependabot :

- **Tauri 2 → 3** (quand sort) — refactor `tauri.conf.json` probable,
  re-générer `packages/mobile/src-tauri/gen/android/`.
- **Effect 3 → 4** (si prévu) — audit tout usage `Layer`, `Context`,
  `Service`.
- **Zod 3 → 4** — breakage API connu (`z.enum`, refinements).
- **Drizzle ORM — bump schema version** — peut requérir une migration
  de schéma.
- **`ai` SDK major** — chunks streaming typés strictement dans
  `fallback.ts`.
- **`hono` 5 → 6** — middleware chain signature.
- **Bun runtime bumps** (via `.tool-versions` ou CI image) — vérifier
  la compat `Bun.serve`, `Bun.file`, `Bun.spawn`.

---

## 5. Procédure step-by-step

### 5.1 Inventaire du batch

```bash
gh pr list --label dependencies --state open --limit 100 \
  --json number,title,labels,author \
  --jq '.[] | "\(.number)  \(.title)"'
```

Sauvegarder la sortie dans un gist ou un scratch file.

### 5.2 Séparer par écosystème

```bash
gh pr list --label dependencies --label npm --state open
gh pr list --label dependencies --label cargo --state open
gh pr list --label dependencies --label github-actions --state open
```

### 5.3 Traiter les security alerts en priorité

```bash
gh pr list --label dependencies --label security --state open
# Pour chaque PR :
gh pr checks <num>
gh pr view <num>
gh pr merge <num> --squash
```

### 5.4 Auto-merge les patch + types + linters

Exemple pour activer l'auto-merge sur les patch `@types/*` :

```bash
# 1. List
gh pr list --label dependencies --search '@types/ in:title' --state open \
  --json number --jq '.[].number'

# 2. Auto-merge (nécessite branch protection "allow auto-merge" actif)
for n in <liste>; do
  gh pr merge "$n" --auto --squash
done
```

### 5.5 Reviewer manuellement les hotspots

Pour chaque PR dans §3 :

```bash
gh pr view <num> --comments
gh pr diff <num>
gh pr checkout <num>
bun install
bun run typecheck
bun test <suite touchée>
# si OK :
gh pr merge <num> --squash
# sinon :
gh pr comment <num> --body "Needs rebase / incompatible with ..."
gh pr close <num>   # si majeur non souhaité
```

### 5.6 Grouper les bumps mineurs même écosystème

Si Dependabot n'a pas déjà groupé (config `groups:` dans
`dependabot.yml`), utiliser des combined PRs :

```bash
# Créer une branche qui cherry-pick plusieurs bumps
git checkout -b dependabot/combined-minor-2026-04
for sha in <shas>; do git cherry-pick "$sha"; done
gh pr create --title "chore(deps): minor bump batch" --body "..."
```

---

## 6. Commandes utiles

```bash
# Liste complète PRs dependencies
gh pr list --label dependencies --state open --limit 200

# Filtrage par écosystème
gh pr list --label dependencies --search 'in:title npm'
gh pr list --label dependencies --search 'in:title cargo'

# Checks status
gh pr checks <num>

# Auto-merge batch
gh pr merge <num> --auto --squash

# Fermer sans merger (refus d'un major)
gh pr close <num> --comment "Breaking change — pinned to vX.Y until dedicated PR"

# Re-pin une version dans dependabot.yml pour ignorer un bump
# (éditer .github/dependabot.yml → ignore: [{dependency-name: "...", versions: [...]}])
```

---

## 7. Après le triage

- Vérifier que `bun.lock` et `Cargo.lock` sont à jour sur `dev`.
- Relancer `CodeQL` + `SBOM` + `test.yml` sur `dev` une fois le batch
  absorbé.
- Mettre à jour `PROD_READINESS.md` : cocher "Dependabot first batch
  triaged".
- Planifier la review hebdomadaire (mardi matin) des nouveaux bumps
  Dependabot récurrents.
