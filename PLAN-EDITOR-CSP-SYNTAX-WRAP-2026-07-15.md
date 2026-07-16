---
project: opencode
type: roadmap
tags: [codemirror, mobile, csp, syntax-highlighting, line-wrapping]
summary: "Plan corrige pour restaurer la coloration CodeMirror sous CSP mobile et cadrer le wrap sans regressions de numerotation."
created: 2026-07-15
updated: 2026-07-15
related: [[OpenCode/CLAUDE|OpenCode CLAUDE.md]], [[OpenCode/Plan-Editeur-IDE-Definitif-2026-06-25|Plan Editeur IDE Definitif]], [[OpenCode/Roadmap-IDE-Android-Dual-Mode|Roadmap IDE Android]], [[OpenCode/_memory/memory|Memory OpenCode]]
---

# Plan — Editeur CodeMirror : coloration CSP et wrap des longues lignes

## Statut

- [x] Diagnostic source et revue contradictoire termines.
- [x] Perimetre decoupe : coloration d'abord, wrap et Bug 2 apres validation appareil.
- [x] Implementer la coloration syntaxique sans `style` runtime.
- [x] Reparer les styles inline du viewer Pierre sous Android WebView.
- [ ] Valider desktop, mobile et la parite clair/sombre.
  - APK reconstruite et installee sur Android ; verification visuelle finale du viewer a refaire apres reconnexion au serveur.
- [ ] Reconfirmer le Bug 2 sur appareil reel avant tout nouveau correctif de numerotation.
- [ ] Ajouter le toggle de wrap dans Parametres generaux, apres preuve device.

## Constats verifies

### Bug 1 — coloration uniforme sur mobile

`packages/ui/src/components/code-mirror.tsx` utilise `syntaxHighlighting(defaultHighlightStyle, { fallback: true })`. `defaultHighlightStyle` est un `HighlightStyle` de CodeMirror : la librairie genere un `StyleModule`, donc un `<style>` injecte dynamiquement. Le mecanisme est incompatible avec la contrainte CSP mobile deja documentee dans `code-mirror.css`.

Le viewer readonly n'est pas une preuve contraire : `@pierre/diffs` utilise Shiki, qui produit ses couleurs dans le HTML genere.

### Correction retenue

- Remplacer `defaultHighlightStyle` par `classHighlighter` de `@lezer/highlight`.
- Declarer `@lezer/highlight` comme dependance directe de `packages/ui` ; sa presence transitive seule n'est pas un contrat de build.
- Ne pas conserver `fallback: true` : `classHighlighter` est un highlighter par classes, pas un `HighlightStyle` runtime.
- Ajouter les regles `.tok-*` dans le CSS statique partage, sous le scope `.cm-opencode`.
- Reparer les styles inline du viewer Pierre via un watcher de mutation limite aux spans de tokens.
- Reutiliser les variables `--syntax-*` existantes pour conserver la parite des themes.

### Viewer readonly — styles inline Android

Le viewer Pierre genere les couleurs dans l attribut `style` des spans. Android WebView conserve cet attribut mais n active pas la declaration lorsque Pierre affecte `element.style = string`. Le runtime UI recopie donc explicitement la valeur dans `span.style.cssText`, apres le rendu et lors de l ajout de lignes virtualisees.

### Bug 2 — numerotation et wrap

Le composant utilise `lineNumbers()` natif ; aucune logique locale de calcul de numero n'a ete retrouvee. Le scroll horizontal dans le viewer readonly est un choix explicite. La numerotation ne doit donc pas etre recodee avant une reproduction sur appareil reel.

Le wrap a un piege independant : `EditorView.lineWrapping` ajoute seulement `.cm-lineWrapping`. Les regles visuelles de wrap du `baseTheme` de CodeMirror sont elles aussi injectees par `StyleModule`, donc elles doivent etre recopiees dans le CSS statique mobile. Le `flex-shrink: 0` actuel de `.cm-content` doit etre surcharge uniquement en mode wrap.

## Implementation par etapes

### Etape 1 — coloration CSP-safe

- Modifier `packages/ui/src/components/code-mirror.tsx`.
- Ajouter `@lezer/highlight` directement a `packages/ui/package.json` et synchroniser `bun.lock`.
- Ajouter dans `packages/ui/src/components/code-mirror.css` les classes `tok-*` utilisees par `classHighlighter`, avec variables `--syntax-*` et fallback `currentColor`.
- Couvrir au minimum commentaires, chaines, regex, mots-cles, nombres/atomes, variables, proprietes, types, operateurs, ponctuation, liens, emphase, gras, insertions, suppressions et tokens invalides.
- Ne pas modifier la CSP et ne pas ajouter de `<style>` runtime.

### Etape 2 — tests et verification de la coloration

- Ajouter un test deterministe du contrat `classHighlighter` et des selecteurs CSS essentiels.
- Executer le typecheck UI et le test cible.
- Verifier `git diff --check` et rechercher les usages restants de `defaultHighlightStyle` dans l'editeur.
- Valider desktop puis Android sur appareil reel ; verifier clair/sombre, code vide, code long, tokens inconnus et fichiers volumineux.

### Etape 3 — reproduction du Bug 2

- Reproduire sur appareil reel avec lignes longues, lignes vides, fichier vide, scroll vertical, scroll horizontal et changement de fichier.
- Comparer la gouttiere et le contenu pendant le scroll, l'edition, l'undo/redo et le changement de wrap.
- Si aucune desynchronisation n'est reproduite, clore le diagnostic sans logique de numerotation custom.

### Etape 4 — toggle de wrap, separe du fix couleur

- Ajouter `wrapLongLines: boolean` dans `Settings.general`, avec valeur par defaut `false` et compatibilite des settings persistants existants.
- Ajouter le controle dans `settings-general.tsx` avec les traductions necessaires.
- Utiliser une `Compartment` CodeMirror pour reconfigurer `EditorView.lineWrapping` sans recreer l'editeur.
- Ajouter les regles CSS statiques `.cm-lineWrapping` dans le scope `.cm-opencode`, sans affecter le viewer readonly ni les blocs hors editeur.
- Tester desktop/mobile, clair/sombre, grandes lignes, tabulations, lignes sans espaces, gutter et resize.

## Risques et garde-fous

- `@lezer/highlight` ne doit pas rester transitive : dependance directe obligatoire.
- Les classes `tok-*` n'ont aucune couleur par defaut : une absence de selecteur doit etre detectee par test CSS et revue visuelle.
- Une regle `.tok-*` globale pourrait recolorer un autre composant : scope strict `.cm-opencode`.
- `lineWrapping` sans CSS statique est inoperant sous CSP : ne pas livrer le toggle sans les regles de layout.
- Le toggle ne doit pas reutiliser le scroll/wrap de `@pierre/diffs`, dont les contraintes sont differentes.
- La validation navigateur desktop ne suffit pas a clore le bug CSP mobile ; la preuve finale doit venir de l'appareil reel.

## Definition of done

- Coloration visible dans CodeMirror sur desktop et Android, clair et sombre.
- Aucun `HighlightStyle` runtime utilise pour l'editeur.
- Typecheck, tests cibles et diff checks verts.
- Bug 2 confirme ou corrige avec preuve appareil ; aucun recalcul custom de numerotation sans reproduction.
- Toggle de wrap persistant, reversible et limite a l'editeur CodeMirror.
