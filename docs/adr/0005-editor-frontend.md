# ADR-0005 : Éditeur de fichiers frontend (Phase 1b IDE)

**Date** : 2026-06-19 | **Statut** : Accepté | **Dépend de** : [ADR-0004](0004-file-write-api.md)

## Contexte

PR 1a a livré l'API backend d'écriture (`File.write/readRaw/rename/move/remove`,
conflit hash sha256, écriture atomique). PR 1b rend l'éditeur **éditable** côté
frontend, dans `packages/ui` (composant partagé desktop + mobile + iOS).

L'app ouvre déjà les fichiers en onglets : `file-tree.tsx` (clic) → `openTab()`
→ `SessionSidePanel` (Tabs Kobalte) → `FileTabContent` (`file-tabs.tsx`) qui rend
aujourd'hui le **viewer read-only** `packages/ui/src/components/file.tsx`.

## Décision

1. **Entrée en édition = clic-pour-éditer par onglet.** Un crayon "Edit" dans le
   header de `FileTabContent` (+ double-clic dans le contenu) bascule **cet
   onglet** du viewer read-only vers un **CodeMirror 6** éditable. **Pas de toggle
   global Agent⇄IDE, pas de réglage `general.viewMode`** — ceci supersede la
   prémisse "dual-mode toggle global" de la roadmap initiale.

2. **Navigation chat ⇄ éditeur = mécanisme de panneau existant.** Desktop : chat
   et panneau fichiers côte à côte. Mobile : panneau fichiers en overlay 50vh ;
   le fermer ramène au chat. Le **buffer d'édition persiste** au repli du panneau
   (dirty préservé, pas de save forcée) ; sur mobile, fermer **blur** l'éditeur
   (clavier dismissé). Avertissement de sauvegarde **uniquement à la fermeture
   réelle de l'onglet**.

3. **Store éditeur séparé** (nouveau contexte `editor`, distinct du cache de
   lecture `context/file.tsx`). Par fichier ouvert : `buffer` courant, `baseline
   {content, hash}` (chargé via `File.readRaw`), `dirty = buffer !== baseline`,
   undo/redo (CM natif), `save`, `discard` (revert baseline), `reload` (re-readRaw),
   détection conflit, find/replace (CM natif), sélection tactile.

4. **Save** = `File.write({path, content, expectedHash: baseline.hash, format})`.
   Au succès : maj `baseline` depuis le stamp retourné, et **reconciliation du
   buffer** sur le contenu final (si format a changé le disque), curseur préservé.
   Déclencheurs : Cmd/Ctrl+S + bouton + point dirty sur l'onglet.

5. **Format-on-save** : ajouter `format?: boolean` au backend `File.write`
   (écrit brut → `Format.file` best-effort → relit le disque → renvoie contenu
   final + stamp). Réglage `editor.formatOnSave` (défaut **ON**) persisté dans
   `settings.tsx`. Petite réouverture de 1a, justifiée (le format n'a de sens
   qu'avec la reconciliation de buffer côté éditeur).

6. **Conflit 409** : bannière "Le fichier a changé sur disque" avec deux actions
   explicites — **Reload** (abandonner mes modifs, re-readRaw) et **Overwrite**
   (garder les miennes, re-save avec le hash disque actuel). **Pas de merge
   auto** (3-voies différé).

7. **Gros fichiers** : au-delà d'un seuil (~1 Mo), onglet **read-only** sans
   crayon Edit (CodeMirror + buffer en mémoire deviennent coûteux ; édition non
   garantie sur mobile).

8. **SDK** régénéré depuis l'OpenAPI (les routes 1a portent `operationId` /
   `describeRoute`) pour exposer `GET /file/raw` + `POST /file/write`.

9. **CodeMirror 6** dans `packages/ui` ; **langages lazy-loadés** (bundle mobile).
   Éditeur > 500 LOC → décomposé en modules (composant CM setup, store
   buffer/save/conflict, find-replace), chacun < 500 LOC.

## Alternatives rejetées

- **Toggle global Agent⇄IDE / `general.viewMode`** (roadmap initiale) : remplacé
  par le clic-pour-éditer par onglet (décision utilisateur). Plus simple, pas de
  fork de layout.
- **Nav dédiée "retour chat"** : duplique le toggle de panneau existant. Rejeté.
- **Format côté client (prettier navigateur)** : pas de rustfmt/gofmt, alourdit
  le bundle, résultat ≠ formateur agent. Rejeté au profit du param backend.
- **Reload-only sur conflit** : perte d'edits sans recours. Rejeté.
- **Merge 3-voies** : gros chantier UI, différé après 1b.
- **Étendre `context/file.tsx`** pour l'édition : mélange cache de lecture et
  buffers d'édition (concerns différents). Rejeté au profit d'un store séparé.

## Conséquences

- ✅ Édition par onglet sans mode global ; nav chat⇄éditeur sans nouvelle infra.
- ✅ Pas de perte de données : conflit explicite (reload/overwrite), dirty
  persistant au repli, save atomique (1a).
- ✅ Composant éditeur mutualisé desktop + mobile + iOS.
- ⚠️ Réouverture backend 1a (param `format` sur `File.write`) — petit, testé.
- ⚠️ Intégration SolidJS ⇄ CodeMirror : une seule source de vérité (l'état CM),
  le store dérive le dirty/baseline — éviter le double-binding réactif.
- ⚠️ Course watcher (`File.Event.Updated`) ⇄ buffer dirty ouvert : un changement
  disque externe sur un fichier en édition doit alimenter la détection de conflit
  (au save), pas écraser le buffer en direct.
- ⚠️ Bundle mobile : langages CM lazy-loadés ; seuil gros fichiers read-only.

## Découpage (CMT-1) + corrections outside-voice (codex, 2026-06-19)

1b est un épic → **slicé** :

- **1b-core** (desktop-validé, composant partagé donc atterrit aussi sur mobile) :
  backend(format + retour contenu) + SDK + store state-machine + CodeMirror +
  crayon/intégration `FileTabContent` + conflit reload/overwrite + garde-fous +
  tests.
- **1b-mobile** (différé) : durcissement WebView — IME/composition, clavier +
  `visualViewport`, sélection tactile, lazy-load de CM lui-même + budget bundle,
  tests sur **device réel** (pas seulement Playwright desktop).

Corrections codex **vérifiées dans le code**, intégrées au contrat 1b-core :

1. **Source de vérité unique** : CodeMirror possède le document vivant. Le store
   ne stocke PAS le buffer comme string réactive — seulement `baseline {content,
   hash}`, `dirty`, `stale`, `saving`, `conflict`. Évite les boucles
   `createEffect → dispatch → onUpdate → setStore` et le coût mémoire/perf.
2. **Protocole watcher (anti-perte de données)** — `invalidateFromWatcher`
   (`context/file.tsx`) recharge aujourd'hui les fichiers ouverts. En édition :
   - **clean + change disque** → reload buffer + baseline.
   - **dirty + change disque** → **marquer `stale`, ne JAMAIS toucher le doc CM**
     (le conflit se résout au save).
   - **save en cours / event de notre propre write** → corréler/ignorer.
   - **event du Format.file backend** → attendre la réponse, pas l'event.
3. **Contrat backend étendu** : `File.write` accepte `format?: boolean` et
   **retourne `{ content, stamp, formatted, formatError? }`** (le contenu final,
   pas juste le stamp) pour permettre la reconciliation post-format. Format exécuté
   **sous le même `withLock`** que l'écriture (atomicité write→format→reread).
4. **Store keyé par `directory + path`**, pas par onglet : 2 onglets du même
   fichier partagent un seul buffer/baseline (sinon baselines divergents).
5. **`dirty`** via flag transactionnel CM + recalcul debouncé (détecter
   "undo jusqu'au propre"), pas une comparaison de string entière à chaque frappe.
6. **Intégration `FileTabContent`** : en mode édition, **bypasser le `ScrollView`
   externe + le scroll-sync** (CM a son scroller) et **router `Cmd/Ctrl+F`** vers
   l'extension search de CM (sinon le handler global du viewer la masque).
7. **Reconcile post-format** : transaction `changes` avec `addToHistory:false`,
   sélection mappée via `ChangeDesc` ; accepter des sauts de position sur reformat
   massif.
8. **Overwrite (409)** : re-readRaw d'abord, et **indiquer explicitement** que ça
   écrase les changements disque (un agent/watcher a écrit) — aperçu minimal.
9. **delete/rename externe d'un fichier dirty** : état dédié distinct du conflit —
   actions **discard / save-as (recréer) / close** (ni Reload ni Overwrite-hash
   stale ne fonctionnent).
10. **Garde crayon Edit** : caché pour binaire, UTF-8 invalide, NUL bytes, media,
    gros fichiers, fichiers protégés. **BOM/CRLF** : préservés ou documentés non
    supportés.
11. **Comments / sélection de lignes-vers-prompt** du viewer : **désactivés en
    mode édition** pour 1b-core (ce sont des affordances de lecture Mode Agent) ;
    réévaluer plus tard (extensions CM).

**Séquençage 1b-core** : (1) contrat backend `format` + retour contenu + tests →
(2) régénérer SDK (typecheck casse si méthodes absentes) → (3) store éditeur
state-machine + protocole watcher → (4) composant CM (doc non Solid-contrôlé) →
(5) intégration `FileTabContent` (bypass scroll/search) → (6) conflit + garde-fous.
