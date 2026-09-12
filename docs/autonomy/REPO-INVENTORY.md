# Inventaire réel du repo — Rwanbt/unifia (snapshot 2026-07-31)

**Source :** `git ls-remote` + `git clone --depth 1` + lecture locale du clone jetable
**Statut :** `VERIFIED_LOCAL` — toutes les métriques sont mesurées, pas extrapolées
**Cible :** base du rebrand « Unifia Workbench »

## A. Identité externe

| Champ | Valeur | Source |
|---|---|---|
| URL upstream fork | `https://github.com/Rwanbt/unifia` | `git remote -v` |
| URL upstream original | `https://github.com/anomalyco/opencode` | `README.md` |
| HEAD `main` | `207ff452b8056ae11d1f71e23198e520835f70ed` | `git rev-parse HEAD` |
| Branche `Dev` | `e21b7389fa12334835f9cfd64e0718443e148e76` | `git ls-remote` (non checkoutée, depth-1) |
| PR fusionnée #16 | `Merge pull request #16 from Rwanbt/dev` | `git log -1` |
| Status | fork non-officiel reconnu dans README | `README.md` ligne « Unofficial fork notice » |

## B. Statistiques globales (mesurées)

| Métrique | Valeur |
|---|---|
| Fichiers commités | 5295 |
| Lignes totales | 462 701 |
| Branches locales (HEAD + agent) | 2 |
| Tags distants | 1 |
| Workflows CI | 42 |

## C. Distribution par type de fichier

| Type | Compte | % approx | Commentaire rebrand |
|---|---:|---:|---|
| `.ts` | 1367 | 25.8 % | Logique métier, providers, CLI — rebrand = renames + strings |
| `.svg` | 1259 | 23.8 % | Logos, icônes, illustrations — rebrand = ASSETS à remplacer |
| `.mdx` | 643 | 12.1 % | Documentation site — rebrand = noms de produit, URLs |
| `.tsx` | 442 | 8.3 % | UI SolidJS/React — rebrand = labels, titre app |
| `.png` | 411 | 7.8 % | Captures, bannière — rebrand = `Bannière OpencodeX.png` à virer |
| `.md` | 274 | 5.2 % | Docs racine (AGENTS, ARCHITECTURE, AUDIT, …) — rebrand = `AGENTS.md`, `README.md` |
| `.json` | 238 | 4.5 % | package.json, tsconfig, manifestes — rebrand = `name`, `description` |
| `.css` | 124 | 2.3 % | Styles SolidJS |
| `.sql` | 78 | 1.5 % | Migrations DB |
| `.yml` | 52 | 1.0 % | Workflows GitHub, configs |
| `.rs` | 42 | 0.8 % | Rust/Tauri core |
| `.h` | 23 | 0.4 % | Headers C natif (Tauri sidecar) |
| autres (txt, aac, xml, mjs, toml, lua, c, cpp) | 342 | 6.4 % | divers |

**Implication rebrand :** le coût d'un rebrand complet n'est PAS linéaire dans le LOC — c'est dominé par :
1. **assets graphiques** (1670 fichiers binaires/SVG) → remplacer par kit Unifia
2. **package.json** (238 fichiers) → renommer les 22 packages `@opencode-ai/*` → `@unifia/*`
3. **i18n strings** (21 langues × 5 fichiers) → 105 fichiers à éditer
4. **TS/TSX** (1809 fichiers) → recherche/remplacement guidé par scope

## D. Workspaces Bun (22 packages)

| Package | Rôle rebrand |
|---|---|
| `packages/opencode` | CLI core (binaire `opencode`) — **nommage critique** |
| `packages/app` | App web SolidJS — UI publique |
| `packages/desktop` | Tauri 2 desktop (identifier `ai.opencode.desktop.dev`) |
| `packages/desktop-electron` | Variante Electron (legacy ?) |
| `packages/mobile` | Tauri 2 mobile (iOS + Android) |
| `packages/console/app` | Console webapp |
| `packages/console/core` | Backend console |
| `packages/console/function` | Cloudflare Function |
| `packages/console/mail` | Service mail |
| `packages/console/resource` | Service ressources |
| `packages/containers` | Images Docker |
| `packages/docs` | Documentation site (MDX) |
| `packages/enterprise` | Édition enterprise (RBAC, SSO ?) |
| `packages/extensions` | Plugin SDK extensions |
| `packages/function` | Cloudflare Worker générique |
| `packages/identity` | Auth/identity |
| `packages/plugin` | SDK plugin |
| `packages/script` | Scripts internes |
| `packages/sdk` + `packages/sdk-shared` | SDK JS public |
| `packages/slack` | Intégration Slack |
| `packages/storybook` | Design system |
| `packages/ui` | Bibliothèque de composants |
| `packages/util` | Utilitaires partagés |
| `packages/web` | Site web public |

**Packages non-Bun :** Tauri (Rust) vit dans `packages/desktop/src-tauri/` et `packages/mobile/src-tauri/` (non comptés comme workspaces Bun mais sont des crates Cargo).

## E. Couche Tauri (desktop)

| Champ | Valeur | Action rebrand |
|---|---|---|
| Tauri version | 2.9.5 | OK |
| Identifier | `ai.opencode.desktop.dev` | → `ai.unifia.workbench.dev` (carte dédiée, NS critique) |
| externalBin | `sidecars/opencode-cli` | → `sidecars/unifia-cli` |
| URL scheme | `opencode` | → `unifia` (peut casser les deep links existants) |
| capabilities dir | `packages/desktop/src-tauri/capabilities/` | vérifier mentions « opencode » |
| Plugins Tauri | opener, deep-link, shell, dialog, updater, process, store, window-state | aucun renommage requis |

## F. Couche i18n (21 langues)

Langues détectées dans `README.*.md`, `CONTRIBUTING.*.md`, `LICENSE.*.md`, `SECURITY.*.md` :

`ar, bn, br, bs, da, de, es, fr, gr, it, ja, ko, no, pl, ru, th, tr, uk, vi, zh, zht`

Note : pas de `nl`, pas de `sv`, pas de `fi`, pas de `cs` — la couverture linguistique est partielle. À garder en tête pour toute carte i18n (ne pas introduire de fichiers dans des langues absentes).

## G. Présence « opencode » comme nom de marque (à quantifier)

| Zone | Fichiers contenant « opencode » | Action rebrand |
|---|---:|---|
| `packages/app/src/` | 185 | renames ciblés (UI strings, identifiants produit) |
| `packages/desktop/src/` | 21 | renames + i18n |
| `packages/opencode/` | quasi-total | renames (nom de package, binary, imports internes) |
| `packages/console/` | (à compter) | renames |
| `packages/mobile/` | (à compter) | renames |
| i18n (21 langues) | 21×4 = 84 | renames via script de remplacement contrôlé |
| `.github/workflows/` | (à compter) | renames dans les noms de jobs, URLs artifacts |
| racine | ~10 (README, AGENTS, CLAUDE, ARCHITECTURE…) | édition manuelle |

**Cible pour un rebrand complet** : estimation haute **1500-2200 fichiers touchés** sur 5295 (28-42 %). C'est pour ça que le pack impose la règle des **≤ 400 lignes / carte, ≤ 8 fichiers / carte** — sinon ça explose.

## H. Frontières architecturales identifiées

1. **Electron vs Tauri** : coexistence de `desktop/` (Tauri) et `desktop-electron/` (Electron). Le rebrand doit-il couvrir les deux ? À décider en Phase 0.
2. **iOS + Android** : `mobile/` Tauri, deux targets séparés.
3. **Console** : 5 sous-packages webapp/backend → risque de couplage fort, rebrand doit être progressif.
4. **Enterprise** : `packages/enterprise/` peut contenir de la licence propriétaire → **EXCLUDE par défaut** sauf validation utilisateur.

## I. Risques identifiés dès l'inventaire

| Risque | Niveau | Mitigation |
|---|---|---|
| Tauri identifier change = perte de signatures/notarisations macOS | `HIGH` | Carte dédiée avec revue MiniMax + `NEEDS_EXTERNAL_E2` |
| `opencode-cli` sidecar = artefacts de release existants | `HIGH` | Décider de la politique release avant |
| 1670 assets graphiques = pas de renommage possible sans kit de remplacement | `MEDIUM` | Carte « design system Unifia » séparée, livrée en amont |
| Couverture i18n partielle = ne pas tout traduire | `LOW` | Limiter le rebrand aux libellés en-US, traduction = phase ultérieure |
| `Bannière OpencodeX.png` à la racine = 1.5 MB binaire | `LOW` | Suppression simple mais doit être listée |
| `packages/enterprise/` = possible code propriétaire upstream | `MEDIUM` | Marquer `EXCLUDE` sauf audit explicite |
| `AGENTS.md` racine du fork = déjà orienté « opencode » | `LOW` | Réécriture complète, le fork a déjà ses propres AGENTS.md |

## J. Décisions implicites à clarifier (à pousser dans `BLOCKED-DECISIONS.md`)

1. **Desktop-electron :** à rebrand-er ou à déprécier ? (réponse implicite attendue : déprécier)
2. **Provider « minimax » (MiniMax M3) :** Unifia doit-il devenir un provider de premier plan dans `packages/opencode/src/provider/` ou rester un provider externe ? Si premier plan, le binaire CLI doit pouvoir le charger.
3. **Site public `packages/web/ :** rebrand URL ? (Rwanbt/unifia → unifia.com ?)
4. **Identifiant Tauri macOS :** faut-il acheter un nouveau Developer ID ? (sinon, garder `ai.opencode.desktop.dev` ?)
5. **Enterprise :** fork officiel ou rester upstream ?
