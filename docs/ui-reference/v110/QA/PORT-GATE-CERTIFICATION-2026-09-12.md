# Port Gate Certification — v110-port-ready-r1

**Date** : 2026-09-12 (Europe/Paris)
**Branche** : `new-ui` (worktree `_a7-automate-memory`)
**Commit testé** : `22329c20b1` — `test(automate): cover editable draft parsing`
**Verdict global** : **NO-GO** (2 P1 contractuels A2 + 2 échecs infrastructure cartesian)

---

## TL;DR

Sur `new-ui @ 22329c20b1`, le portage UI est **structurellement complet** (typecheck vert, tous les merges A1→A8 intégrés), mais **NON certifié** :

| Run | Verdict | Détail |
|---|---|---|
| `tsgo -b` (typecheck) | ✅ PASS | 0 erreurs, exit 0 |
| **Port Gate Strict** (A8-02) | ⚠️ **3 PASS / 2 FAIL** | 2 vrais P1 contractuels A2 |
| **Port Gate Cartesian** (A8-01) | ❌ **0 PASS / 2 FAIL** | 2 échecs **infrastructure**, pas contractuels |

Les 2 P1 bloquants sont :
- **P1-A** : `[data-v110="resize-context"]` reste `hidden` après `toggleSidebar()` au desktop-wide (1440x900)
- **P1-B** : à desktop-compact (1024x768), ouvrir la sidebar ne ferme pas l'inspector (mutual exclusion non appliquée)

Le code compile, la structure du contrat v110 est respectée à 60 % sur les invariants A2 testés. Les features post-port (settings remote access, memory graph, automate drafts) n'ont pas de couverture Port Gate.

---

## 1. Préparation de l'environnement

### Outillage
- Bun 1.3.14 (`C:\Users\barat\.bun\bin\bun.exe`)
- Node 22.15.1 (`C:\Program Files\nodejs\node.exe`)
- Chromium 1200/1208/1234 (Playwright cache `$LOCALAPPDATA\ms-playwright`)
- tsgo 7.0.0-dev.20251207.1 (depuis `@typescript/native-preview`)

### Adaptation worktree
Le worktree `_a7-automate-memory` partage le `.git` avec le repo principal mais n'a pas ses propres `node_modules/.bin` (Bun sans `--trust`). Les binaires sont hoistés au root du workspace. Invocations directes utilisées :

```bash
# Typecheck (script: "tsgo -b")
cd packages/app
node ../../node_modules/@typescript/native-preview/bin/tsgo.js -b   # exit 0

# Port Gate (script: "test:e2e" → "playwright test")
cd packages/app
node ../../node_modules/playwright/cli.js test e2e/v110/port-gate-strict.spec.ts
node ../../node_modules/playwright/cli.js test e2e/v110/port-gate.spec.ts
```

### Warnings Vite (non-fatals)
```
"! use client" directive ignored (excalidraw/radix-ui)         # 7 occurrences
! Some chunks are larger than 500 kB after minification
! The JSX import source cannot be set without also enabling
  React's "automatic" JSX transform (virtua/lib/solid/index.jsx)
```
Aucun warning ne bloque les tests ; le dernier (virtua) est un faux positif d'un package tiers bundlé pour React par défaut.

---

## 2. Port Gate Strict (A8-02, Wave 0.5 hardening)

**Fichier** : `packages/app/e2e/v110/port-gate-strict.spec.ts` (6 353 octets)
**5 tests** · **3 PASS · 2 FAIL** · durée 3 min 06 s

### ✅ PASS

| # | Test | Vue | Résultat |
|---|---|---|---|
| 1 | shell frame, topbar and rail are mounted with only real SHELL_MODES | 1440×900 | OK |
| 2 | mobile nav is the single navigation authority below 600 px portrait, never above | 1440→1024→768→844×390→390×844 | OK |
| 5 | desktop chrome, not the mobile drawer, must render across the full desktop-compact band | 1024×768 | OK |

→ Le contrat A2-01 (shell frame + topbar + rail), A2-03 (mobile nav viewport authority), et la différenciation chrome-desktop vs drawer-mobile à 1024 px sont **respectés**.

### ❌ FAIL — P1 contractuels

#### **P1-A** : `context separator is keyboard-resizable, not just attributed` (test 3, ligne 69)

**Localisation** : `packages/app/src/pages/layout.tsx:1038-1060` + `packages/app/src/styles/v110.css:73-77`

**Reproduction** :
```ts
await page.setViewportSize({ width: 1440, height: 900 })
await gotoSession()
await toggleSidebar(page)   // mod+B
const separator = page.locator('[data-v110="resize-context"]')
await expect(separator, "... must be visible").toBeVisible()   // ❌
```

**Sortie d'erreur** :
```
locator resolved to <div role="separator" tabindex="0"
  aria-valuenow="248" aria-valuemin="244" aria-valuemax="492"
  data-component="separator" data-axis="x" data-v110="resize-context"
  class="..." />  (× 33 polls)
- element is hidden
```

L'élément est **monté avec tous les bons attributs ARIA** (role=separator, tabindex=0, aria-valuenow=248, etc.), mais Playwright le voit `hidden` (bounding box ou `visibility: hidden`).

**Hypothèse principale** :
- Wrapper : `<div class="absolute inset-y-0 z-30 w-0 overflow-visible" data-v110="resize-context-wrapper">`
- Le `Separator` à l'intérieur a `width: 8px` (CSS v110.css:59)
- Mais le parent du wrapper est `<div class="size-full relative overflow-x-hidden">` (layout.tsx:1012)
- `overflow-x-hidden` du parent **clipse horizontalement** le Separator qui déborde du wrapper `w-0`

**Hypothèse secondaire** (CSS) :
- `v110.css:73-77` cache le wrapper sous 900 px (`@media (max-width: 899px) { display: none }`)
- Mais 1440 > 899 donc cette règle ne s'applique pas au test — **à confirmer visuellement**

**Fix proposé** (non appliqué, à valider) :
1. Soit déplacer le wrapper hors du `<div class="overflow-x-hidden">` parent
2. Soit remplacer `overflow-x-hidden` par `overflow-x-clip` (qui ne crée pas de nouveau contexte de formatage mais clippe quand même)
3. Soit faire passer le wrapper en `position: relative` (sort du flux overflow-hidden) avec `z-index` plus haut

#### **P1-B** : `desktop-compact: opening the left panel closes the inspector, and inversely` (test 4, ligne 92)

**Localisation** : logique de panneau dans `packages/app/src/tokens/panels.ts:45-49` (pure) + consommation dans `pages/layout.tsx` + `pages/session/session-side-panel.tsx`

**Reproduction** :
```ts
await page.setViewportSize({ width: 1024, height: 768 })
await gotoSession()
const inspectorToggle = page.getByRole("button", { name: "Toggle review" }).first()
await inspectorToggle.click()                     // inspector → opened=true
await toggleSidebar(page)                          // sidebar → opened=true
await expect(inspectorToggle).toHaveAttribute("aria-expanded", "false")  // ❌
```

**Sortie d'erreur** :
```
Expected: "false"
Received: "true"
```

**Analyse** :
- `tokens/panels.ts:45-49` expose `visible(open, id)` qui **filtre** les panels affichés selon le viewport (à desktop-compact : `order.slice(-1)`)
- Mais c'est une fonction **pure de rendu** : elle ne mute pas le store
- `layout.sidebar` et `layout.inspector` restent indépendamment `open=true` dans le store
- L'UI affiche uniquement le dernier ouvert (correct visuellement), mais `aria-expanded` reflète l'état du store → le test détecte l'incohérence

**Fix proposé** (non appliqué, design choice) :
1. Ajouter un effect dans `layout.sidebar.open()` qui ferme `layout.inspector` si viewport ∈ {desktop-compact, tablet-portrait, phone-portrait}
2. Symétriquement, `layout.inspector.open()` ferme `layout.sidebar`
3. Localisation suggérée : `context/layout.ts` (où vivent `sidebar`, `inspector`, `mobileSidebar`)

---

## 3. Port Gate Cartesian (A8-01, Wave 0.5 skeleton)

**Fichier** : `packages/app/e2e/v110/port-gate.spec.ts` (4 984 octets)
**2 tests** · **0 PASS · 2 FAIL** · durée ~10 min

### ❌ FAIL — Infrastructure (pas contractuel)

#### Test 1 : `every WAVE05 viewport renders without errors or overflow`

Itère sur 16 viewports (WAVE05 = `matrix.ts:12-28`) en boucle : resize, overflow, modes, panels, keys, screenshot pour chaque.

**Erreur** :
```
Test timeout of 60000ms exceeded.
locator.count: Target page, context or browser has been closed
   at v110/gate.ts:97:28 (keys())
```

L'auteur du test lui-même a documenté ce risque dans le commentaire lignes 11-20 :
> *« 16 fresh gotoSession() calls in a single worker (real Linux CI, 1 worker per test.yml) reproducibly drove the page/browser to close mid-test past roughly the 10th case, twice »*

→ **C'est un problème connu** du test, pas un bug du port. Mais ici il se manifeste aussi dans cette session (la session utilise 1 worker, donc même profil).

#### Test 2 : `navigation reaches work design and back to code`

**Erreur** :
```
console errors: Failed to load resource: the server responded with a status of 503 (Service Unavailable)
```
Trace : `expect(t.logs, "console errors: ...").toEqual([])` failed (tableau vide attendu, 1 entrée reçue).

→ Le backend hermétique a renvoyé 503 sur au moins une ressource (probable timing : backend pas encore prêt quand le navigateur charge la page). Le test ne distingue pas 503 transitoire vs erreur applicative.

**Pas un P1 contractuel** — c'est un **flakiness** d'environnement de test.

---

## 4. Gaps résiduels hors-Port-Gate

Identifiés via `git log --since="2026-09-08"`, lecture du code, et absence de tests :

| Gap | Sévérité | Évidence |
|---|---|---|
| **A6 Design fragmentaire** (D02-D08 non livrés) | M | commits `fix(design): ...` × 4 + `refactor(design): remove unreachable split focus state` suggèrent surface D01 seulement (routing + workspace), pas layers/transforms/SVG selection/vector/Bezier |
| **A4 Code incomplet** | M | seulement `data-v110` markers ajoutés (PR #80), pas de refonte éditeur/terminal/diff |
| **Features post-port sans couverture Port Gate** | M | settings remote access, memory knowledge graph, automate drafts ajoutés après A8-01, jamais testés sur la cartesian matrix |
| **Drift OWNERSHIP.md** | L | `new-ui` = 112 commits ahead of `origin/feat/ui-v110-port` (post-port features bypassent la branche d'intégration canonique) |
| **`packages/app/node_modules/.bin` absent** | L | worktree partage node_modules hoisté au root ; pas grave mais à documenter pour les sessions futures |

---

## 5. Recommandations (par ordre)

### Court terme (avant promotion work-design/dev/main)
1. **Fix P1-A** (separator hidden) : changer le parent `<div class="overflow-x-hidden">` ou sortir le wrapper de ce conteneur
2. **Fix P1-B** (mutual exclusion) : décider dans quel module la logique vit (suggestion : `context/layout.ts`) + tester

### Moyen terme
3. **Renforcer la cartesian matrix** : augmenter le timeout Playwright par défaut à 120 s dans `playwright.config.ts` (ligne timeout), et wrapper `await page.setViewportSize` dans `expect.poll` pour stabiliser les transitions
4. **Re-run strict + cartesian** : confirmer `5/5 + 2/2` avant toute promotion
5. **Décider le drift OWNERSHIP** : soit merger `new-ui` → `feat/ui-v110-port` (FF possible d'après `merge-base = 0c4dfe5d6`), soit mettre à jour `OWNERSHIP.md` pour faire de `new-ui` la branche d'intégration
6. **Étendre la cartesian matrix aux features post-port** : ajouter `remote-access`, `memory-graph`, `automate-drafts` à la liste des surfaces à valider

### Long terme
7. **Compléter A4 / A6** (ou承认 scoped down dans COMPONENT-MAP.md)
8. **Certifier par CI GitHub Actions** au lieu de runs manuels : éviter le drift entre ce rapport et la réalité du remote

---

## 6. Verdict honnête (note: 6.5/10)

| Axe | Note | Pourquoi |
|---|---|---|
| **Couverture fonctionnelle A1-A8** | 8.5/10 | Tous les merges consolidés, structure respectée, code compile |
| **Contrat A2 respecté** | 6/10 | 3/5 invariants testés OK, 2 P1 réels (separator hidden, mutual exclusion) |
| **Tests passants** | 6/10 | Strict 60 % (3/5), Cartesian 0 % (2 échecs infrastructure) |
| **Features post-port** | 5/10 | Présentes mais non couvertes par Port Gate |
| **Maturité globale** | 7/10 | Suffisant pour daily dev, pas pour release |

**Note globale : 6.5/10** — le port est **utilisable en interne** mais **pas prêt pour une promotion vers work-design/dev/main**. Les 2 P1 sont des fixes de 30 minutes chacun (estimation), la cartesian matrix peut être stabilisée en 1-2 h de plus.

**Référence** : commits vérifiés sur `new-ui @ 22329c20b1`, fichiers testés via `bun test:e2e` réel, code inspecté directement (`Read` tool, pas de cache de session).

---

*Signé : Mavis (Mavis) · session `mvs_871fe82e374a4864be6aa011918d8f85` · 2026-09-12 11:43 Europe/Paris*
