# ADR-0006 : Connexion de compte GitHub (OAuth Device Flow)

**Date** : 2026-07-21 | **Statut** : Accepté

## Contexte

Le fork (bientôt renommé **Unifia**) veut une section **GitHub** dans les
paramètres, au-dessus de **Remote Access**, permettant de connecter un compte
GitHub, voir son identité, tester ses capacités (API/Git HTTPS/dépôts privés),
et authentifier automatiquement `git push`/`pull`/`fetch` — sans coller de PAT
dans un terminal.

Deux mécanismes existaient déjà et ont été délibérément **réutilisés, pas
dupliqués** :

1. `packages/opencode/src/git/credentials.ts` + `settings-git-auth.tsx` —
   configuration manuelle (n'importe quel host) HTTPS token / clé SSH, stockée
   en clair (0o600) dans `git-credentials.json`. Reste inchangée ; le nouveau
   flux GitHub est un **fallback**, utilisé uniquement quand aucune credential
   manuelle n'est configurée.
2. `packages/opencode/src/auth/index.ts` — stockage sécurisé multi-backend déjà
   construit pour les clés API fournisseurs LLM (`KeychainStorage` via
   `keyring` Rust — Windows Credential Manager / macOS Keychain / libsecret ;
   `encrypted-file` AES-256-GCM par défaut sur mobile).

## Décision

### 1. Namespace de stockage séparé, mécanisme réutilisé

`Auth.all()` (le store `auth/index.ts`) est consommé par du code qui traite
**chaque entrée comme un fournisseur LLM** (`provider-discovery.ts`,
`cli/cmd/providers.ts`, l'export GDPR). Y ajouter une entrée `"github"` aurait
silencieusement corrompu ces listes — trouvé par audit avant tout code écrit.

Précédent existant dans le repo : `packages/opencode/src/mcp/auth.ts`
(`McpAuth`) est déjà un store **séparé** pour les credentials MCP, même
principe. `github/auth.ts` suit ce patron : son propre fichier
(`github-auth.json` / `github-auth.enc.json`), mais en réutilisant le
**mécanisme** `KeychainStorage` — paramétré par un `service` désormais
configurable (`new KeychainStorage("github")` vs le défaut `"auth"`),
namespace OS-keychain `opencode.github` totalement isolé de `opencode.auth`.
Changement minimal sur `KeychainStorage` : constructeur accepte `service`,
ajout d'un `delete(key)` unitaire (le endpoint Rust `DELETE /kc/:service/:key`
existait déjà, seul le wrapper TS manquait).

### 2. Injection credential scoped à `github.com`, jamais globale

`git/credentials.ts` (manuel) injecte `http.extraheader` **non scoped** — 
acceptable car explicitement configuré par l'utilisateur pour un usage
particulier. La session GitHub OAuth est **fallback automatique** : elle doit
strictement ne jamais fuiter vers un autre host. `github/credentials.ts`
utilise `http.https://github.com/.extraheader` (scope d'URL natif de git),
vérifié par test qu'un remote non-github.com ne reçoit jamais le header.

Point d'intégration : `git/index.ts::getAuthEnv(cwd, remote)` — essaie d'abord
la credential manuelle (`readCredentials`), et seulement si `type: "none"`,
retombe sur `buildGithubAuthEnv(cwd, remote)`.

### 3. Fix transport Android confirmé réel (pas déjà résolu)

Audit de `packages/mobile/src-tauri/src/runtime/toolchain.rs::prepare_toolchain_wrappers`
a confirmé que `git` n'était **pas** dans la liste `elf_tools` (rustc/python/
gdb/php/... le sont), et que le wrap des binaires `libexec` ne couvrait que
`usr/libexec/gcc/*`, jamais `usr/libexec/git-core/*` (où vivent
`git-remote-https`/`git-remote-http`, spawnés par chemin absolu — même
mécanisme que `cc1`/`collect2` déjà géré). Sans ce fix, `git clone/push/pull`
sur Android crashe en `SIGSYS` ("Bad system call") ou `EACCES` — exactement le
symptôme documenté par la mission d'origine. Fix : ajout de `git` à
`elf_tools`, duplication du bloc de wrap `usr/libexec/gcc` pour
`usr/libexec/git-core`. Vérifié par `cargo check --target aarch64-linux-android`
(type-check réel, pas juste parsing) ; validation comportementale sur device
reste à faire (voir Limites).

### 4. Redaction centralisée réutilisée

`packages/opencode/src/security/dlp.ts::redact()` existait déjà avec une règle
`github-token` (formats `ghp_`/`gho_`/`ghu_`/`ghs_`/`github_pat_`). Réutilisée
telle quelle dans `github/client.ts`, `github/auth.ts`, `github/diagnostics.ts`
pour toute erreur réseau/git avant retour à l'appelant — pas de nouvelle regex.

### 5. Diagnostics Git séparés de l'identité API

`github/diagnostics.ts` ne dépend d'aucune session — sonde en lecture seule
(`git --version`, `--exec-path`, présence + mode exécutable de
`git-remote-https`, `git ls-remote` sur un dépôt public). La fonction de sonde
réseau est injectable (`probeNetwork`) pour permettre des tests unitaires sans
appel réseau réel (AGENTS.md interdit la dépendance réseau en test unitaire).
`server/routes/github.ts::/test-connection` (authentifié) et `/diagnostics`
(non authentifié) sont deux routes distinctes — jamais un seul verdict
"GitHub opérationnel" dérivé de la seule joignabilité API.

## Conséquences

- Nouveau module `packages/opencode/src/github/{schema,client,auth,credentials,diagnostics}.ts`.
- Nouvelle route `packages/opencode/src/server/routes/github.ts`, montée sur
  `/github` dans `server/instance.ts`.
- `packages/opencode/src/auth/index.ts` : `KeychainStorage` paramétrée par
  `service` + méthode `delete()` (rétrocompatible, défaut inchangé).
- `packages/opencode/src/git/index.ts::getAuthEnv` prend `(cwd, remote)` au
  lieu de `()` — fallback GitHub uniquement si aucune credential manuelle.
- `packages/mobile/src-tauri/src/runtime/toolchain.rs` : `git` + section
  git-core ajoutés au wrap.
- `packages/app/src/components/settings-github-auth.tsx`, montée juste
  au-dessus de `SettingsRemoteAccess` dans `settings-general.tsx` (partagée
  Desktop + Mobile, aucun composant séparé nécessaire).
- 33 clés i18n × 17 locales (`settings.fork.githubAuth.*`), test de parité
  passant (`src/i18n/parity.test.ts`).
- Tests unitaires : `test/github/{auth,credentials,diagnostics}.test.ts`
  (22 tests) + suite complète du package (2608 pass / 1 fail pré-existant et
  non lié — flake `util.flock` sous contention Windows).

## Limites connues (non résolues dans cette itération)

- Validation comportementale réelle sur device Android (`git clone`/`push`
  après authentification) pas encore exécutée — nécessite build + install +
  test manuel, prévu en suite de cette session.
- SSH via session GitHub OAuth non implémenté (les tokens OAuth GitHub sont
  HTTPS-only ; une clé SSH est un mécanisme distinct, hors scope demandé).
- GitHub Enterprise non géré (host hardcodé `github.com`).
- Pas de refresh automatique du token en tâche de fond ; `expiresAt` est
  stocké mais la session n'est pas re-vérifiée avant expiration — un token
  expiré donnera un échec explicite au prochain `git push`/`test-connection`.
