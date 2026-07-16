# Plan autonome — Viewer lecture seule : réactivité, cache et lignes dynamiques

Date : 2026-07-16
Projet : OpenCode
Statut : prêt pour review multi-IA

## Objectif

Rendre le viewer lecture seule stable et réactif après sauvegarde, avec une parité stricte desktop/Android :

- le nouveau contenu apparaît sans délai perceptible ;
- les couleurs correspondent toujours au contenu courant ;
- les hauteurs de lignes sont recalculées dynamiquement après wrap, resize et rerender ;
- les numéros restent alignés avec leurs lignes ;
- aucune boucle d’observation ni recalcul de layout inutile ne bloque le thread UI.

## Symptômes observés

```text
sauvegarde
  -> store mis à jour
  -> viewer Pierre détruit/recréé
  -> worker de coloration
  -> mutations Shadow DOM
  -> scans complets + lectures de layout
  -> corrections après plusieurs frames
  -> affichage final correct mais tardif
```

## Causes confirmées

1. `viewer-panel.tsx` utilise `source().length` comme `cacheKey`. Deux contenus différents de même longueur peuvent réutiliser le cache de tokenisation Pierre.
2. `renderViewer()` détruit l’instance actuelle, vide le conteneur et recrée le renderer à chaque changement réactif.
3. Les observers de tokens et de lignes scannent tout le Shadow DOM à chaque mutation et mélangent lectures de layout et écritures CSS.
4. La hauteur dynamique ne doit pas dépendre uniquement des mutations : un changement de largeur peut créer ou supprimer des retours à la ligne sans modifier le DOM.
5. Le calcul de lignes doit être un comportement partagé par desktop et Android ; il ne doit pas être conditionné par la plateforme.

## Solution retenue

### Phase 1 — Identité de contenu fiable

- Remplacer `cacheKey: source().length` par `checksum(contents)`.
- Calculer `contents` une seule fois par rendu.
- Ajouter un test de régression : deux contenus de même longueur doivent produire deux clés différentes et deux rendus corrects.
- Vérifier explicitement le cas fichier vide (`checksum` peut retourner `undefined`).

### Phase 2 — Lignes dynamiques desktop/Android

- Renommer le workaround pour exprimer son vrai périmètre : `watchViewerLineRows` plutôt que `watchSubgridLineRowCollapse`.
- Conserver un calcul de tracks explicites partagé pour les deux plateformes.
- Déclencher le recalcul sur :
  - insertion/remplacement des nœuds Pierre ;
  - changement de largeur via `ResizeObserver` ;
  - changement de thème si la métrique typographique change.
- Coalescer toutes les demandes dans un seul `requestAnimationFrame`.
- Dans chaque frame : lire toutes les hauteurs d’abord, puis écrire les deux listes `gridTemplateRows`.
- Ne jamais observer les attributs modifiés par le correctif lui-même afin d’éviter une boucle.
- Tester : ligne simple, ligne vide, dernière ligne, fichier vide, lignes longues wrapées, resize étroit/large, changement desktop/mobile.

### Phase 3 — Observers de tokens

- Remplacer le scan complet `querySelectorAll` à chaque mutation par une file de nœuds ajoutés.
- Coalescer la réparation dans `requestAnimationFrame`.
- Garder un scan complet uniquement lors de l’initialisation ou lorsque la mutation ne permet pas d’identifier les nœuds ajoutés.
- Vérifier que les styles inline Shiki restent présents après plusieurs rerenders.

### Phase 4 — Rendu réactif

- Éviter le teardown complet pour une simple modification de contenu si l’API Pierre permet un `render()` incrémental sur l’instance existante.
- Si Pierre impose un nouveau renderer, coalescer les changements dans une frame et ne jamais afficher un conteneur vidé entre deux rendus.
- Fusionner le rerender des annotations avec le rendu principal pour éviter la double passe `active.rerender()` puis `find.refresh()`.
- Conserver le worker pool partagé et vérifier qu’un rendu obsolète ne peut pas écraser le rendu le plus récent.

### Phase 5 — Mesure et validation

Ajouter temporairement des timestamps instrumentés autour de :

```text
save-start
write-complete
store-mirror
viewer-render-start
worker-result
layout-fix-start/end
viewer-ready
```

Critères d’acceptation :

- aucune frame blanche visible après sauvegarde ;
- le contenu courant est visible au premier rendu stable ;
- même longueur mais contenu différent correctement coloré ;
- 1000 lignes simples ne déclenchent pas un scan complet par mutation ;
- resize pendant un fichier wrapé conserve l’alignement ;
- desktop Chrome et Android WebView donnent les mêmes hauteurs et numéros ;
- aucun warning TypeScript/Biome nouveau.

## État d’exécution au 2026-07-16

- [x] Phase 1 partielle : checksum(contents) remplace la longueur comme clé de cache du viewer lecture seule.
- [x] Phase 2 partielle : alignement dynamique rendu explicitement commun desktop/Android, recalcul coalescé par
equestAnimationFrame, déclenché par mutations et resize.
- [ ] Phase 3 : réparation des tokens coalescée et limitée aux nœuds ajoutés.
- [ ] Phase 4 : teardown/rendu Pierre rendu incrémental ou coalescé.
- [ ] Phase 5 : instrumentation et validation réelle desktop + APK Android.

Validation actuelle : un typecheck app/ui, test syntax highlighting et test file-tab-scroll passés.

## Ordre de livraison

1. checksum et test de cache ;
2. scheduler partagé des lignes + ResizeObserver ;
3. réparation token coalescée ;
4. rendu Pierre incrémental ou remount coalescé ;
5. instrumentation puis validation réelle desktop/Android ;
6. review multi-IA avec ce plan et le diff final.

## Risques et garde-fous

- `ResizeObserver` peut déclencher pendant un layout : ne jamais écrire directement dans son callback, uniquement planifier une frame.
- Les fichiers virtuellement rendus ne doivent pas être mesurés comme s’ils étaient entièrement montés ; limiter le correctif aux lignes présentes.
- Les changements de thème peuvent modifier la line-height ; déclencher une nouvelle mesure sans reconstruire le renderer.
- Un contenu vide ou un langage inconnu doit rester affichable sans worker.
- Toute optimisation doit préserver sélection, annotations, recherche, scroll restoration et hover utilities.

## Brief à copier-coller pour les IA reviewers

> Revois ce plan et le diff associé comme un reviewer senior spécialisé UI réactive. Vérifie séparément : identité/cache de contenu, cycle de vie Pierre, concurrence worker, MutationObserver/ResizeObserver, forced synchronous layout, boucles de rerender, fichiers vides, très gros fichiers, virtualisation, wrap après resize, thème clair/sombre, sélection/annotations/recherche/scroll restoration, parité desktop Chrome/Android WebView et stratégie de tests. Signale chaque problème avec sévérité, fichier/lignes, scénario reproductible et correctif recommandé. Ne valide pas une optimisation qui introduit une course entre deux rendus.

## Fichiers principaux

- `packages/app/src/pages/session/viewer-panel.tsx`
- `packages/ui/src/components/file.tsx`
- `packages/ui/src/pierre/file-runtime.ts`
- `packages/util/src/encode.ts`
- tests UI/app du viewer et tests device Android

## Décision attendue après review

Le correctif ne sera considéré terminé qu’après : tests automatisés, validation desktop, build APK, installation du dernier APK sur le téléphone et vérification visuelle du même fichier wrapé sur les deux plateformes.

## Addendum review Claude — corrections intégrées

### Corrections de causalité

- **Checksum : confirmé et terminé.** Il invalide à la fois le cache de tokenisation worker et le cache de lignes brutes Pierre. Le test pertinent doit modifier deux contenus de même longueur, pas seulement vérifier que le checksum existe.
- **Resize : double mécanisme à couvrir.** Un reflow CSS peut changer les hauteurs sans mutation DOM, et le `ResizeManager` interne de Pierre peut recalculer ses métriques sans exposer une mutation observable. Le scheduler doit donc écouter la taille du host/conteneur et vérifier la stabilité après le resize interne.
- **Teardown : portée corrigée.** Le remount dominant est le démontage Solid provoqué par `<Show when={!editing()}>` dans `packages/app/src/pages/session/file-tabs.tsx`, après sortie du mode édition. `options()`/`virtual()` peuvent aussi recréer une instance, mais ne sont pas le déclencheur principal à traiter en premier.
- **Rendu obsolète : non prioritaire.** Les garde-fous existants empêchent actuellement la corruption du dernier rendu. Le risque réel à traiter est la latence et l’absence d’annulation/cleanup explicite des tâches Pierre encore pendantes.

### Angles morts ajoutés au périmètre

1. **Pipeline de sauvegarde à deux stores** : mesurer `write()` SDK, mise à jour du store éditeur, `mirror()` vers le FileStore, fermeture/réouverture de `ViewerPanel`, puis `onRendered`. Éviter de déclencher une reconstruction complète si le contenu final est déjà disponible localement.
2. **Troisième scan complet** : `notifyShadowReady()` appelle `querySelectorAll("[data-line]")` à chaque mutation jusqu’à ce que toutes les lignes soient présentes. La Phase 3 doit coalescer ce scan et arrêter l’observer dès le premier état prêt stable.
3. **Validation réaliste** : les tests actuels de syntax highlighting, navigation et typecheck ne couvrent pas la réactivité. Ajouter des tests de même longueur, save-to-viewer, sortie du mode édition, resize wrapé, observer coalescé et cleanup.

### Phase 4 révisée

1. Caractériser le remount induit par `Show when={!editing()}` avec instrumentation.
2. Conserver le viewer monté pendant la transition édition/affichage si possible, ou transférer le contenu final à l’instance existante avant de remonter.
3. Implémenter `cleanUpPendingTasks()` pour annuler les workers, observers, frames et callbacks de readiness associés à l’ancienne instance.
4. Ne pas ajouter de garde-fou de version supplémentaire tant qu’une reproduction de rendu obsolète n’existe pas.
5. Mesurer la latence réelle `save-start → write-complete → mirror → viewer-ready` sur desktop et Android.

### Verdict de review

Le plan initial était techniquement utile mais **incomplet pour une review IA** : sa validation annoncée était trop faible et sa Phase 4 ciblait le mauvais déclencheur. Après cet addendum, le plan est prêt pour review multi-IA avec une couverture correcte du cycle Solid, du pipeline de sauvegarde, de Pierre et des trois mécanismes de scan.