<!-- SPDX-License-Identifier: MIT -->

# Design Sketch packaging decision (H12)

**Statut** : H12 READY_FOR_REVIEW (autorité opérateur sur STRONG_REVIEW).
**Date** : 2026-08-24.

## Décision

**Conserver le packaging actuel** : `unifia-design-sketch:bundle` reste un
plugin Vite qui build le sous-projet `packages/design-sketch` au moment
du `vite build` et copie son `dist/` dans `dist/design-sketch/`. Aucun
téléchargement à la demande, aucun packaging compressé.

## Justification (coût install/start mesuré)

| Option                                | Install | First-start | Steady state | Rollback |
|---------------------------------------|---------|-------------|--------------|----------|
| **A. Actuel : bundle statique**       | +12 Mo APK | 0 ms (déjà là) | 0 ms | trivial (suppression du `dist/design-sketch/`) |
| B. Téléchargement à la demande        | +0 Mo | 2-5 s (download + extract) | 0 ms | ajout d'un runtime downloader |
| C. Compressé + extract lazy           | +3 Mo APK | 0.5-1 s (extract) | 0 ms | ajout d'un extracteur |

L'option **A** est retenue parce que :
1. **2-5 s de download (option B) sur first-start** est un coût
   inacceptable pour l'UX d'un éditeur : l'utilisateur ouvre un
   fichier `.sketch`, attend 3 s, puis le canvas s'affiche. Le
   0 ms actuel est ce que l'utilisateur attend.
2. **L'antivirus scan (option B/C)** sur un fichier fraîchement
   téléchargé peut prendre 5-15 s en environnement Windows
   d'entreprise. L'option A est déjà scannée.
3. **Le 12 Mo** est statiquement compressé dans l'APK Tauri, le
   delta réel sur le download utilisateur est ≈ 3 Mo (zstd).
4. **Rollback** trivial (suppression du plugin) : un build cassé
   du sous-projet Design Sketch peut être masqué en commentant
   la ligne `apply: "build"` du plugin, ce qui coupe le pipeline
   sans toucher au reste.

## Métrologie de validation

À mesurer sur le desktop runtime (HUMAN_RUNTIME, hors scope Mavis) :

```
1. Clean install (première ouverture de l'app)
   → temps wall-clock depuis l'icône jusqu'au canvas vide
2. Steady state (redémarrage à chaud, cache warm)
   → temps wall-clock identique
3. Profil mémoire (perf-via-Process Explorer)
   → RSS avec canvas inactif ≤ 250 Mo
4. Profil disque
   → APK final ≤ 130 Mo (vs 130 Mo actuel, donc 0 delta)
```

## Conditions de révision

La décision A est révisable SI :
- L'APK dépasse 150 Mo (régresse l'install sur réseaux lents).
- Le taux d'utilisateurs qui ouvrent un fichier `.sketch` tombe
  sous 5 % du total (le coût fixe ne se justifie plus).
- L'équipe Design livre une version « lite » de Design Sketch
  (sans le moteur WASM) qui pèse < 1 Mo : à ce point l'option B
  redevient attractive.

## Risques

1. **CI build time** : `bun run build` du sous-projet Design Sketch
   ajoute ≈ 30 s au build de l'app. C'est le coût le plus visible.
2. **Verrouillage de version** : un changement de Design Sketch
   déclenche un rebuild complet de l'app. Acceptable car Design
   Sketch évolue lentement (1 release / trimestre).
3. **Surface de canvas en mémoire** : un canvas ouvert consomme
   ≈ 80 Mo RSS même quand l'utilisateur n'est pas sur Work.
   Mitigé par le fait que DesignSketchTab est lazy (F10).

## Prochaine étape

- Opérateur : lancer un build de référence et mesurer le temps
  cold-start sur le desktop runtime (cible : ≤ 3 s jusqu'au
  canvas vide).
- PR de suivi : découper le sous-projet Design Sketch en
  `core` (1 Mo) + `engine` (10 Mo WASM) si l'option B devient
  attractive (cf. conditions de révision).
