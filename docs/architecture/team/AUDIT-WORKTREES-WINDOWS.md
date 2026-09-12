# AUDIT-WORKTREES-WINDOWS — `D:\App\OpenCode\.team-worktrees\A04-e275d1da\`

> **Carte :** TEAM-A04 (Lot A, Gate T0)
> **Worktree :** `D:\App\OpenCode\.team-worktrees\A04-e275d1da`
> **SHA de base :** `97af4743ef5e9d9cda442744078841675c6285ed` (Team post-A03 cherry-pick)
> **Branche :** `c-A04/e275d1da`
> **Date UTC :** 2026-07-20 (v1, MiniMax-M3) + addendum 2026-07-21 (Claude Sonnet 5, orchestrateur)
> **Auteur :** MiniMax-M3 (E0/E1, DISCOVER read-only, §0-4/§7 v1) + Claude Sonnet 5 (§1/§4/§5/§8 : correction F-A04-2, ajout F-A04-5/6/7/8/9, re-vérification par commandes reproduites 2026-07-21)
> **Statut :** VERIFIED — verdict E2 Claude-Opus-4.8-E2 : `APPROVED_WITH_FOLLOWUP` (confiance 90, 2026-07-21T00:55:00Z). 5 followups non bloquants (FU-1 à FU-5) corrigés en place le 2026-07-21 (voir marqueurs inline). Verdict archivé : `Execution/Reviews/A04-E2-REVIEW-RESPONSE.md`.
> **Instance hash :** alias e275d1da / canonique dérivé e275d1da
> **Distingue :** FAIT PROUVÉ / ABSENCE PROUVÉE / HYPOTHÈSE / RECOMMANDATION / DÉCISION À REPORTER.

---

## 0. Méthode

Lecture seule du worktree A04 (sans modification). Inspections :

1. SHA HEAD du worktree A04 vs Team post-A03.
2. Statut Git du worktree (`git status`).
3. Configuration `core.longpaths` (global + local).
4. Contenu de `.git/hooks/` (scripts personnalisés, hors samples).
5. Présence de `.gitattributes` (line endings, filter).
6. Présence de `.gitmodules` (submodules).
7. Inventaire de `scripts/` (build, eval, smoke, security).
8. Création d'un worktree fixture de test (worktree add/remove) — sans commit de production.

---

## 1. Inventaire des composants Git/worktrees

| Composant | Présent ? | Détail |
|---|---|---|
| HEAD A04 | OUI | `97af4743ef5e9d9cda442744078841675c6285ed` (Team post-A03 cherry-pick) |
| `git status` (A04) | clean (sauf `?? docs/architecture/team/AUDIT-WORKTREES-WINDOWS.md`) | aucun fichier modifié, aucun commit de production |
| `.git/hooks/` (sans samples) | **NON** | Aucun hook personnalisé activé (les `*.sample` sont exclus par convention) |
| `.gitattributes` | **OUI** (⚠️ F-A04-2 v1 était FAUX, corrigé ci-dessous) | Présent et tracké, 643 octets, `* text=auto eol=lf` + liste de binaires. Preuve : `test -f .gitattributes` → vrai ; `git ls-files .gitattributes` → tracké ; `cat .gitattributes` lu intégralement. |
| `.gitmodules` | **NON** | Pas de submodules (FAIT PROUVÉ : `Test-Path` = False) |
| `core.longpaths` (config Git) | **NON** (vide) | `git config --get core.longpaths` = vide (ni global ni local) |
| `scripts/` | OUI | 14 scripts (build, eval, smoke, security, etc.) |
| `package.json` racine | OUI | présent (mais non lu pour A04, audit non demandé) |

**Total** : 14 scripts, 0 hook personnalisé actif dans `.git/hooks/` (mais `core.hooksPath` redirige vers `.husky/_`, cf. F-A04-5), 0 submodule, 1 `.gitattributes` (tracké, `eol=lf`), 0 `core.longpaths` configuré, `core.ignorecase=true`, 0 stash propre à A04 (5 stashes pré-existants sans rapport, datés 2026-07-14, partagés via le dépôt commun).

---

## 2. Configuration des long paths (Windows)

**FAIT PROUVÉ (F-A04-1) :** `git config --get core.longpaths` retourne vide.
La racine A04 est `D:\App\OpenCode\.team-worktrees\A04-e275d1da` (~55 chars), bien
sous le seuil Windows par défaut de 260 chars. Mais les paths internes
peuvent dépasser (e.g. `node_modules`, `.git/objects/...`).

**CORRECTION (ex-F-A04-2, REJECTED)** : le brouillon v1 affirmait l'absence de
`.gitattributes` (« Test-Path = False »). Re-vérification (2026-07-21,
`test -f .gitattributes` + `git ls-files .gitattributes` + `cat .gitattributes`
depuis `D:\App\OpenCode\.team-worktrees\A04-e275d1da`) prouve le contraire :
le fichier existe, est tracké, et contient déjà `* text=auto eol=lf` — exactement
la recommandation que ce brouillon s'apprêtait à faire. La cause probable de
l'erreur v1 est un test exécuté depuis un mauvais répertoire de travail (non
reproduit ici, non essentiel à documenter — seul le résultat corrigé compte).
Voir F-A04-2-CORRECTED en section 8.

**FAIT PROUVÉ (inventaire, non numéroté — corrigé 2026-07-21 suite review Claude-Opus-4.8-E2 FU-1) :**
aucun submodule (`.gitmodules` absent, `Test-Path` = False). Pas de hooks
submodules à tester. (v1 référençait à tort ce fait comme « F-A04-3 », en
collision avec le F-A04-3 du tableau §8 qui désigne l'antivirus — corrigé.)

---

## 3. Test fixture (lecture seule, hors A04)

Test de création d'un worktree de fixture pour valider la procédure
canonique du plan V3 §12.3 :

```text
$ git -C D:\App\OpenCode\.team-worktrees\A04-e275d1da worktree add
   D:\App\OpenCode\.team-worktrees\A04-fixture-test
   97af4743ef5e9d9cda442744078841675c6285ed
Preparing worktree (detached HEAD 97af4743ef)
HEAD is now at 97af4743ef [TEAM-A03][VERIFIED] audit debate substrate
and multi-model ADR

(worktree fixture créé OK)

$ git -C D:\App\OpenCode\.team-worktrees\A04-fixture-test status --short
(vide — clean)

$ git -C D:\App\OpenCode\.team-worktrees\A04-e275d1da worktree remove
   --force D:\App\OpenCode\.team-worktrees\A04-fixture-test

(worktree fixture supprimé OK ; aucune erreur)

$ git -C D:\App\OpenCode\.team-worktrees\A04-e275d1da worktree list --porcelain
  D:/App/OpenCode/opencode  4be4385979  dev
  D:/App/OpenCode/.team-worktrees/A01-7d80a3f1  a8b48077a8  c-A01/7d80a3f1
  D:/App/OpenCode/.team-worktrees/A02-015e1c84  6959470dc5  c-A02/015e1c84
  D:/App/OpenCode/.team-worktrees/A03-9a25e1d2  a7c431313e  c-A03/9a25e1d2
  D:/App/OpenCode/.team-worktrees/A04-e275d1da  97af4743ef  c-A04/e275d1da
  D:/App/OpenCode/.team-worktrees/integration  97af4743ef  Team
  D:/App/OpenCode/opencode-build-opti-ui  79c4183227  (detached) (hors scope)
```

**FAIT PROUVÉ (F-A04-4) :** création et suppression d'un worktree de fixture
fonctionnent sous Windows PowerShell 5.1 + Git for Windows. Le plan V3
§12.3 (worktree par carte de tâche) est exécutable.

---

## 4. Scénarios d'échec identifiés

| Scénario | Risque | Détection | Mitigation |
|---|---|---|---|
| **E-A04-1** Mauvaise branche | Medium | Worktree A04 sur `c-A04/e275d1da` vérifié à `97af4743ef` (Team post-A03 cherry-pick). Toute référence à une autre branche doit être refusée. | Scope Monitor : seuls `docs/architecture/team/AUDIT-WORKTREES-WINDOWS.md` autorisé. |
| **E-A04-2** Worktree partagé | Low | Un seul A04 worktree à la fois. `git worktree list` doit inclure A04 une seule fois. | A04 vérifié : 1 worktree (A04-e275d1da). Pas de partage accidentel. |
| **E-A04-3** Commit de mauvaise base | Low | HEAD A04 = 97af4743ef. Toute tentative de cherry-pick doit vérifier la base. | Vérification systématique `git merge-base` avant cherry-pick. |
| **E-A04-4** Perte de changements non suivis | Low | `git status` clean sauf fichier attendu. Scope strict. | Pre-commit hook (à créer) bloquant les fichiers hors scope. |
| **E-A04-5** Contournement de lease/fencing | Low | Lease + fencing token dans la metadata de la carte. Vérification à chaque opération. | Scope Monitor + ledger. |
| **E-A04-6** Toucher main/dev/opti-ui | High | `git worktree list` ne doit pas inclure main/dev/opti-ui/Team-build-opti-ui. | A04 vérifié : main/dev/opti-ui/Team-build-opti-ui NON modifiés. |
| **E-A04-7** Conflits Windows (long paths) | High | `core.longpaths` non configuré. | **Recommandation : configurer `core.longpaths = true` globalement** (R-A04-1). |
| **E-A04-8** Conflits line endings | **Low (résolu)** | `.gitattributes` présent et tracké, `* text=auto eol=lf` déjà en place (corrigé, cf. ex-F-A04-2). Le risque résiduel est seulement l'écart entre le CRLF du working-copy local (`autocrlf=true`) et le LF stocké en blob — normalisé par Git à chaque commit, sans action requise. | Aucune action requise ; R-A04-2 reclassée FERMÉE (déjà implémentée). |
| **E-A04-9** Antivirus (Defender) verrouille | Low | Pas de test direct ; documentation nécessaire. | **Recommandation : ExclusionPath `D:\App\OpenCode\`** dans la politique IT (R-A04-3). |
| **E-A04-10** Worktree dirty après crash | Low | `git status` clean après chaque commit. Procédure de recovery documentée. | Worktree fixture de test OK. |
| **E-A04-11** Pre-commit hooks silencieusement contournés | **High** | `core.hooksPath=.husky/_` est une config repo (partagée, `--worktree` refusé : `worktreeConfig` non activé). `.husky/_` (généré par `bun install` / `husky install`, **non tracké** — absent de `git ls-tree`) est présent uniquement dans `opencode/` (checkout principal) et **absent des 5 worktrees** A01–A04 + `integration`. Git ne signale aucune erreur quand `core.hooksPath` pointe vers un dossier absent — le hook est simplement un no-op silencieux. **Conséquence prouvée : tous les commits produits par les cartes A01–A04 (dont `a7c431313e`, `97af4743ef`) ont contourné le gate `biome check` / `shellcheck` sans qu'aucune alerte ne soit émise.** | **Recommandation : `bun install` (ou `husky install`) dans chaque worktree créé par le pipeline, avant tout commit de carte** (R-A04-4). |
| **E-A04-12** `core.autocrlf=true` (système, corrigé 2026-07-21 — v1 disait « global » ; `git config --show-origin` confirme `file:C:/Program Files/Git/etc/gitconfig`, pas `~/.gitconfig`. Cf. review Claude-Opus-4.8-E2 FU-3.) | **Low (mitigé)** | `git config --get core.autocrlf` = `true` (config partagée, non isolable par worktree sans `worktreeConfig`). Correction post-vérification : `.gitattributes` (`* text=auto eol=lf`) est déjà présent et tracké — Git normalise donc les blobs en LF au commit indépendamment de `core.autocrlf` local. Le risque de patch non déterministe entre machines est fermé pour les fichiers texte couverts par `text=auto`. Risque résiduel : un fichier nouvellement ajouté sans extension reconnue par une règle `.gitattributes` explicite suit l'heuristique `text=auto` (détection binaire par Git), non garantie à 100 % sur tous les types de contenu. | Aucune action bloquante. Risque résiduel faible routé en observation → A06. |

---

## 5. Recommandations (R-A04-1, R-A04-2, R-A04-3)

| ID | Recommandation | Owner | Carte cible | Gate |
|---|---|---|---|---|
| **R-A04-1** Configurer `core.longpaths = true` (global ou par worktree) | A04 / A06 (politique) | A06 + Lot B | T0 / A06 |
| **R-A04-2** ~~Ajouter `.gitattributes`~~ **FERMÉE — déjà implémentée** (`.gitattributes` présent, tracké, `* text=auto eol=lf`, vérifié 2026-07-21) | — | — | — |
| **R-A04-3** Documenter `ExclusionPath` Windows Defender pour `D:\App\OpenCode\` (corrigé 2026-07-21 — v1 écrivait à tort `D:\App\Code\`, cf. review Claude-Opus-4.8-E2 FU-2) | A05 (licences + IT) | A05 | T0 / A05 |
| **R-A04-4** `bun install` obligatoire dans chaque worktree de carte avant premier commit (installe `.husky/_`, restaure le gate pre-commit) — ou vérification explicite `test -d .husky/_` dans le script de création de worktree, échec bloquant sinon | A06 (orchestrateur) | A06 + Lot B | T0 / A06 |
| **R-A04-5** Créer un fichier-lock réel par lease (`Execution/Locks/<lease_id>.lock` contenant owner, worktree, fencing_token, expiry) au moment de la claim, supprimé à la clôture de la carte ; script de vérification de scope (Scope Monitor réel) exécuté avant tout commit de carte, comparant les fichiers stagés à `allowed_files` de l'instance | A06 (orchestrateur) | A06 + Lot B | T0 / A06 |

---

## 6. Procédure fail-closed (proposition)

```
1. Avant tout cherry-pick d'une carte A, vérifier :
   - SHA base attendu = HEAD du worktree de la carte
   - parent du commit local = base attendue
   - parent du commit Team post-A02 = base attendue (cas de la carte A03)
   - `git diff --check` vide (pas de conflict markers)
2. Après cherry-pick, vérifier :
   - scope exact (seuls les fichiers déclarés dans target_manifest)
   - `git status` clean
   - `git worktree list` n'inclut pas main/dev/opti-ui modifiés
3. Avant COMMIT local, vérifier :
   - scope exact
   - absence de TODO/FIXME
   - absence de secret
   - manifestes fichiers conformes
4. Si une vérification échoue :
   - ARRÊT immédiat
   - RAPPORT du DAG exact
   - NE PAS corriger via rebase/amend/force-push
   - NE PAS démarrer de carte aval
```

---

## 7. Compatibilité Windows (PowerShell 5.1 + Git for Windows)

**FAIT PROUVÉ (F-A04-4) :** test fixture de worktree add/remove réussi sous
Windows PowerShell 5.1 + Git for Windows. Aucune erreur de paths
(notamment pas d'erreur "filename too long" car les paths restent < 260 chars).
(Corrigé 2026-07-21 — v1 référençait ce fait comme « F-A04-5 », en collision
avec le F-A04-5 §8, qui désigne le contournement des hooks Husky — cf. review
Claude-Opus-4.8-E2 FU-1.)

**FAIT PROUVÉ (F-A04-10, nouveau — review Claude-Opus-4.8-E2 FU-5) :**
`core.symlinks=false`, explicitement défini au niveau du dépôt local
(`git config --show-origin --get core.symlinks` → `file:D:/App/OpenCode/opencode/.git/config false`),
pas seulement le défaut Windows implicite. Les symlinks créés par un outil
externe (ex. `node_modules/.bin/*`) seront donc checkout comme fichiers texte
contenant le chemin cible plutôt que comme vrais symlinks NTFS. Noms de
fichiers réservés Windows (`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9`)
non testés en conditions réelles — HYPOTHÈSE non vérifiée que le plan V3 n'en
génère jamais (aucun nom de ce type observé dans l'inventaire `scripts/` ni
`docs/architecture/team/`).

**HYPOTHÈSE :** Git for Windows (version utilisée ?) gère correctement les
long paths SI `core.longpaths = true` est configuré. Sans configuration,
le seuil de 260 chars par défaut s'applique. À valider en A04 phase
d'instrumentation (hors scope A04 audit).

---

## 8. Findings A04

| ID | Sévérité | Description | Routage |
|---|---|---|---|
| **F-A04-1** | high | `core.longpaths` non configuré (Windows), ni global ni local. | R-A04-1 → A06 / Lot B |
| **F-A04-2-CORRECTED** | (n/a — REJECTED) | v1 affirmait à tort l'absence de `.gitattributes`. Re-vérifié 2026-07-21 : présent, tracké, `* text=auto eol=lf`. Aucune action requise. | R-A04-2 FERMÉE |
| **F-A04-3** | low | Documentation antivirus Windows Defender manquante. | R-A04-3 → A05 |
| **F-A04-4** | low | Test fixture worktree add/remove OK (créé puis supprimé, `git worktree list --porcelain` cohérent avant/après). | (none) |
| **F-A04-5** | **high** | `core.hooksPath=.husky/_` (config repo partagée, `git config --get core.hooksPath` = `.husky/_`) mais `.husky/_` (non tracké — absent de `git ls-files`, généré par `bun install`/`husky install`) est **absent des 5 worktrees** A01–A04 + `integration` (vérifié par `test -d .husky/_` sur les 6 checkouts, 2026-07-21) — présent seulement dans `opencode/`. Git ne signale aucune erreur quand `core.hooksPath` pointe vers un répertoire absent : le hook (`bunx biome check --changed` + `shellcheck` sur les `.sh` staged, lu dans `.husky/pre-commit`) est un no-op silencieux. **Conséquence — HYPOTHÈSE INFÉRÉE, pas fait prouvé (corrigé 2026-07-21, review Claude-Opus-4.8-E2 FU-4) : le mécanisme de gate (`.husky/_` absent) est prouvé no-op pour ces commits, mais dire qu'ils ont "contourné" un contrôle qui les aurait bloqués est une inférence non vérifiée — les commits en question ne modifient que des fichiers `.md` sous `docs/architecture/team/`, hors du périmètre `bunx biome check --changed` / `shellcheck *.sh` : rien ne prouve que le hook, actif, aurait produit un résultat différent sur ces commits précis. Le risque réel est structurel (le gate serait no-op pour n'importe quel futur commit touchant du code, pas seulement ces commits passés), pas rétroactif.** | R-A04-4 → A06 |
| **F-A04-6-REVISED** | low | `core.autocrlf=true` (système — `C:/Program Files/Git/etc/gitconfig`, pas `~/.gitconfig` ; corrigé 2026-07-21 FU-3 ; partagé entre worktrees, `worktreeConfig` non activé). Risque de non-déterminisme LF/CRLF entre machines **déjà mitigé** par `.gitattributes` (`text=auto eol=lf`, cf. F-A04-2-CORRECTED) — Git normalise en LF au commit indépendamment de `core.autocrlf` local. Risque résiduel : fichiers hors couverture explicite de règle `.gitattributes` dépendent de l'heuristique `text=auto`. | Observation seule → A06, non bloquant |
| **F-A04-7** | info | `core.ignorecase=true` (Windows/NTFS). Deux fichiers ne différant que par la casse dans le même répertoire sont indistinguables pour Git — risque de collision silencieuse si une carte crée un fichier dont le nom ne diffère d'un existant que par la casse. Aucune occurrence détectée actuellement. | Observation → A06 (règle de nommage) |
| **F-A04-8** | info | 5 stashes présents dans le dépôt commun (`git stash list`), tous antérieurs et sans rapport avec le programme Team V3 (datés 2026-07-14, worktrees `security-fix`/`observability`/`cache-archive`/`cli_auto`). Le stash est un magasin unique partagé par tous les worktrees d'un même dépôt — une carte qui exécuterait `git stash` par erreur agirait sur ce même magasin partagé, visible/purgeable par n'importe quel autre worktree. | Observation → A06 (ne jamais utiliser `git stash` dans un worktree de carte) |
| **F-A04-9** | **high** | Les leases et fencing tokens (ex. `LEASE-A04-20260720232500-team-a04-readonly`, `FT-00004-A04-git-worktrees-windows`) ne sont **déclarés que dans le YAML de la carte et le handoff** — aucun fichier lock correspondant n'existe dans `Execution/Locks/` (vérifié : répertoire vide, `ls` → 0 fichier). De même, aucun script "Scope Monitor" automatisé n'a été localisé dans le dépôt (`scripts/check-provider-scope.ps1` existe mais audite les Providers SolidJS, sujet sans rapport). **Conséquence : rien n'empêche mécaniquement deux exécuteurs de réclamer le même worktree/lease simultanément, ni de committer hors du `allowed_files` déclaré — la seule protection actuelle est la discipline de l'exécuteur qui lit et respecte le YAML.** | R-A04-5 → A06 (implémenter un fichier-lock réel sous `Execution/Locks/<lease_id>.lock` + un script de vérification de scope exécuté avant chaque commit de carte) |

**Findings inchangés** : aucun à préserver hors A04. **Corrections apportées à ce passage** : F-A04-2 (v1) REJECTED et remplacé par F-A04-2-CORRECTED ; F-A04-6 (première rédaction de ce passage) révisé en F-A04-6-REVISED après découverte de `.gitattributes`.

---

## 9. Limites du présent audit

1. Audit **read-only** strict. Aucun fichier de code modifié.
2. Test fixture worktree add/remove créé en `D:\App\OpenCode\.team-worktrees\A04-fixture-test` puis supprimé immédiatement (cf. §3).
3. `core.longpaths` non testé en condition réelle (path > 260 chars).
4. Pas de mesure d'impact antivirus (Defender) en condition réelle.
5. Pas d'audit des hooks submodules (aucun submodule).
6. Pas d'audit des permissions NTFS (lecture/écriture/exécution).

---

_Fin du rapport d'audit A04. Code réel vérifié au SHA `97af4743ef`. Aucun fichier
de code production modifié. 9 findings au total (F-A04-1 à F-A04-9), dont 1 correction
d'un faux positif v1 (ex-F-A04-2) et 5 findings nouveaux (F-A04-5 à F-A04-9) issus de
la re-vérification du 2026-07-21. v1 MiniMax-M3 conservé et corrigé en place (pas de
V2 séparée — aucune régression, uniquement des ajouts/corrections traçables) ;
une V2 séparée sera produite uniquement si le reviewer E2 rend `CHANGES_REQUESTED`._
