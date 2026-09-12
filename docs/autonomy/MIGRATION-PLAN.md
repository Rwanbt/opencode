# MIGRATION-PLAN — Migration des identifiants persistants opencode → unifia

**Date :** 2026-07-31
**Statut :** `DRAFT` — proposition, à valider utilisateur
**Cible :** migration non-breaking des installations existantes

## 1. Contexte

Le rebrand Unifia a été appliqué à **tous les labels visibles** (UI, marketing, CLI display name) MAIS **PAS** aux **identifiants techniques persistants** :
- Chemins DB : `~/.config/opencode/opencode.db`
- Fichiers config : `opencode.jsonc`, `opencode.json`
- User-Agent HTTP : `User-Agent: opencode`
- Attributs d'observability : `opencode.trace`
- localStorage keys : `opencode.global.dat:language`, `opencode-theme-id`, etc.
- Theme IDs : `opencode.json` (theme par défaut)

**Pourquoi ?** Ces identifiants sont **persistants** (sur disque, dans la DB, dans les logs, dans les configs). Un rebrand brutal **casserait** toutes les installations existantes.

## 2. Stratégie : dual-support avec migration progressive

**Phase 1 (déjà fait)** : nouveau code utilise `unifia` (ex. `unifia.db` créé à l'install).
**Phase 2 (proposition)** : le code **accepte les deux** pendant une période de transition, avec **préférence pour `unifia`**.
**Phase 3 (futur, v2.0)** : suppression du support `opencode`, **uniquement `unifia`**.

## 3. Mapping des identifiants

| Identifiant opencode | Identifiant unifia | Type | Persistant ? |
|---|---|---|---|
| `~/.config/opencode/opencode.db` | `~/.config/unifia/unifia.db` | SQLite DB | OUI (sur disque) |
| `opencode.jsonc` | `unifia.jsonc` | Config file | OUI (sur disque) |
| `opencode.json` (theme) | `unifia.json` (theme) | Theme ID | OUI (preset) |
| `opencode.global.dat:language` | `unifia.global.dat:language` | localStorage key | OUI (browser) |
| `opencode-theme-id` | `unifia-theme-id` | localStorage key | OUI (browser) |
| `opencode-theme-css-light` | `unifia-theme-css-light` | localStorage key | OUI (browser) |
| `opencode-theme-css-dark` | `unifia-theme-css-dark` | localStorage key | OUI (browser) |
| `opencode-model-config` | `unifia-model-config` | localStorage key | OUI (browser) |
| `User-Agent: opencode` | `User-Agent: unifia/1.0` | HTTP header | OUI (logs serveur) |
| `opencode.trace` (Langfuse attr) | `unifia.trace` | Observability attr | OUI (dashboards) |
| `scriptName("opencode")` (yargs) | `scriptName("unifia")` | CLI display | NON (cosmétique) |
| `opencode-cli` (sidecar filename) | `unifia-cli` | Binary | OUI (release artifact) |
| `@unifia/*` (package scope) | `@unifia/*` | Package name | OUI (NPM) |

## 4. Plan de migration (code)

### 4.1 DB path (storage/db.ts)

**Code actuel** : utilise `Global.Path.data + "opencode.db"`
**Stratégie** : helper qui accepte les deux paths, avec préférence unifia.

```typescript
// Avant (P0-C004 partial)
const dbPath = path.join(Global.Path.data, "opencode.db");

// Après (proposition)
function getDbPath(): string {
  const unifiaPath = path.join(Global.Path.data, "unifia.db");
  const opencodePath = path.join(Global.Path.data, "opencode.db");
  // Préférence : unifia si existe, sinon opencode (pour migration transparente)
  if (await Filesystem.exists(unifiaPath)) return unifiaPath;
  if (await Filesystem.exists(opencodePath)) {
    // Migration one-shot : renommer l'ancien fichier
    await Filesystem.rename(opencodePath, unifiaPath);
    return unifiaPath;
  }
  return unifiaPath; // nouveau : crée unifia.db
}
```

### 4.2 Config file (config/paths.ts)

**Même stratégie** : helper qui accepte `unifia.jsonc` (priorité) et `opencode.jsonc` (legacy).

```typescript
function getConfigPath(): string {
  const unifiaPath = path.join(Global.Path.config, "unifia.jsonc");
  const opencodePath = path.join(Global.Path.config, "opencode.jsonc");
  if (existsSync(unifiaPath)) return unifiaPath;
  if (existsSync(opencodePath)) return opencodePath; // legacy OK
  return unifiaPath; // nouveau
}
```

### 4.3 localStorage keys (app/src/context/language.tsx)

**Stratégie** : read-write dual-key, migration one-shot.

```typescript
// Lecture
function getStoredLanguage() {
  // Try unifia first
  const unifiaKey = localStorage.getItem("unifia.global.dat:language");
  if (unifiaKey) return JSON.parse(unifiaKey);
  // Fallback to opencode
  const opencodeKey = localStorage.getItem("opencode.global.dat:language");
  if (opencodeKey) {
    // Migration one-shot
    localStorage.setItem("unifia.global.dat:language", opencodeKey);
    localStorage.removeItem("opencode.global.dat:language");
    return JSON.parse(opencodeKey);
  }
  return null; // default
}
```

### 4.4 User-Agent (tool/webfetch.ts)

**Stratégie** : utiliser `unifia/1.0` + ancien identifiant en commentaire.

```typescript
const userAgent = `unifia/1.0 (compatible; opencode/${version})`;
```

### 4.5 Observability attributes (observability/exporters/langfuse.ts)

**Stratégie** : ajouter un attribut `unifia.trace` + garder `opencode.trace` en alias.

```typescript
span.setAttribute("unifia.trace", traceId);
span.setAttribute("opencode.trace", traceId); // legacy compat
```

## 5. Plan de migration (utilisateur)

### 5.1 Pour les utilisateurs existants (déjà installés)

**Option A : migration automatique (recommandée)**
- Au premier lancement de la v1.0, l'app détecte les anciens fichiers `opencode.*` et les renomme automatiquement.
- Le `unifia-agent-result.bundle` (handoff) contient les scripts de migration.
- Aucune action utilisateur requise.

**Option B : migration manuelle**
- Renommer manuellement `~/.config/opencode/` → `~/.config/unifia/`
- Renommer `opencode.db` → `unifia.db`
- Renommer `opencode.jsonc` → `unifia.jsonc`
- Clear browser localStorage (les themes seront recréés avec ID `unifia`)

### 5.2 Pour les nouveaux utilisateurs

- Install propre → crée `~/.config/unifia/`, `unifia.db`, `unifia.jsonc`
- Aucun fichier `opencode.*` n'est créé
- Aucune migration nécessaire

## 6. Plan de release (3 phases)

| Phase | Version | Comportement |
|---|---|---|
| **v1.0 (release actuelle)** | 1.0.0-unifia | Dual-support : accepte les deux, préfère unifia. Auto-migration. |
| **v1.5 (LTS)** | 1.5.0-unifia | Idem v1.0, plus de retours utilisateurs. |
| **v2.0 (cleanup)** | 2.0.0-unifia | Suppression du support `opencode.*`. Setup-only `unifia.*`. |

## 7. Tests de migration

### 7.1 Tests automatisés à ajouter (Phase 1+)

```typescript
// packages/opencode/src/storage/migration.test.ts
test("migrate opencode.db → unifia.db", async () => {
  await setupLegacyDb();
  const path = await getDbPath();
  expect(path).toContain("unifia.db");
  expect(await Filesystem.exists("opencode.db")).toBe(false);
});

test("prefer unifia.db over opencode.db", async () => {
  await setupBothDbs();
  const path = await getDbPath();
  expect(path).toContain("unifia.db");
});

test("create unifia.db if no legacy", async () => {
  const path = await getDbPath();
  expect(path).toContain("unifia.db");
});
```

### 7.2 Tests manuels (Windows)

```bash
# Install v0.x (opencode)
cd D:\App\Unifia-Hermes-Sandbox\repo
git checkout 207ff452
bun install && bun run build
# Run once, create ~/.config/opencode/opencode.db
bun packages/opencode/bin/opencode --version

# Upgrade to v1.0 (unifia)
git checkout agent/integration
bun install && bun run build
# Run once, should auto-migrate
bun packages/opencode/bin/unifia --version
# Verify : ~/.config/unifia/unifia.db exists, ~/.config/opencode/ does not
ls ~/.config/unifia/  # OK
ls ~/.config/opencode/  # does not exist (or empty)
```

## 8. Rollback

Si la migration pose problème :

```bash
# Rollback to legacy
mv ~/.config/unifia/unifia.db ~/.config/opencode/opencode.db
mv ~/.config/unifia/unifia.jsonc ~/.config/opencode/opencode.jsonc
# Run v0.x
git checkout 207ff452 && bun install
```

## 9. Risques et mitigations

| Risque | Niveau | Mitigation |
|---|---|---|
| Auto-migration casse des installations | `MEDIUM` | Tests automatisés obligatoires avant release |
| Utilisateurs perdent leurs configs | `MEDIUM` | Backup `opencode.*` avant rename |
| Theme `opencode` (preset) introuvable | `LOW` | Bundler les themes dans l'app |
| User-Agent `opencode` dans dashboards | `LOW` | Dual-tag pendant v1.x |
| `opencode.trace` dans dashboards Grafana/Langfuse | `MEDIUM` | Dual-tag pendant v1.x |

## 10. Statut

**Cette migration n'est PAS exécutée** dans la session actuelle. C'est une **proposition de plan** pour la release v1.0.

**Prochaines actions** :
1. Valider ce plan avec l'utilisateur
2. Implémenter les helpers de migration (Phase 1+, code TS)
3. Écrire les tests de migration
4. Tester sur une installation réelle
5. Documenter dans le release notes

## 11. Références

- `docs/autonomy/PLAN-DIRECTEUR-V3.md` — Plan V3 (Phase 17 Release hardening)
- `docs/autonomy/I18N-USER-INVENTORY.md` — inventaire i18n utilisateur
- `docs/autonomy/ATTRIBUTION-TEMPLATE.md` — modèle d'en-tête SPDX
- `docs/autonomy/DO-NOT-IMPORT.md` — interdictions d'import
- `docs/autonomy/reports/GATE-PHASE-0.md`, `GATE-PHASE-1.md` — gates précédents


## 12. Timeline d'adoption (recommandée)

| Phase | Période | Action |
|---|---|---|
| **v1.0.0** | J0 | Release initiale. Dual-support actif. |
| **v1.0.x** | J0-30 | Patchs urgents. Support des deux formats. |
| **v1.1.0** | J+30 | Première release mineure. Renforcement audit. |
| **v1.5.0** | J+90 | LTS. Migration considérée stable. |
| **v2.0.0** | J+180 | Suppression du support `opencode.*` (breaking) |

**Stratégie de communication** :
- v1.0 : message de release
- v1.5 : email aux utilisateurs connus
- v2.0 : annonce 6 mois à l'avance

## 13. Métriques de succès

- **% d'utilisateurs migrés** : 80 % d'ici v1.5
- **% d'erreurs post-migration** : < 5 % (signaux de support)
- **% de tickets liés au rebrand** : < 2 % du volume total
- **% de forks communautaires** : < 5 % (preuve d'adoption directe)

## 14. Cas particuliers

### Utilisateur sans DB opencode

Si l'utilisateur est sur une fresh install Unifia :
- `unifia-migrate.sh` retourne "Aucun legacy" → exit 0
- Aucun risque de perte de données

### Utilisateur mixte

Si l'utilisateur a des données opencode ET unifia (migration partielle) :
- `unifia-migrate.sh --apply` : migre seulement les legacy
- Préserve les unifia déjà créés

### Utilisateur Windows natif (cmd.exe)

Si l'utilisateur est sur Windows natif :
- `scripts\\unifia-migrate.cmd` au lieu de `.sh`
- Paths Windows : `%APPDATA%\\unifia` au lieu de `~/.config/unifia`

### Utilisateur WSL2

Si l'utilisateur est sur WSL2 :
- Utiliser `unifia-migrate.sh` (Linux paths)
- Les paths WSL2 montent sur Windows : `~/.config/unifia` = `C:\\Users\\...\\AppData\\Local\\Packages\\...\\LocalState\\rootfs\\home\\...\\.config\\unifia`

### Utilisateur avec données chiffrées

Si l'utilisateur a des secrets opencode chiffrés :
- `unifia secrets migrate <legacy-file>` à exécuter manuellement
- Avant v2.0 : compatible avec l'ancien format
- À v2.0 : ré-encryptage avec le format Unifia

### Utilisateur Enterprise

Si l'utilisateur est en environnement enterprise :
- `unifia-migrate.sh` accepte un flag `--batch` pour les déploiements automatisés
- `--config` pour un fichier de config de migration
- `--dry-run` pour la validation
