---
project: opencode
type: roadmap
tags: [fork, distribution, updater, android, desktop, csp, testing]
summary: "Plan de correction fondé sur les builds dev, l’installation Android réelle et l’audit des chemins de distribution du fork."
created: 2026-07-16
updated: 2026-07-16
related: [[OpenCode/AGENTS|OpenCode AGENTS.md]], [[OpenCode/INDEX|OpenCode INDEX]], [[OpenCode/Agent-DAG-System|Agent-DAG-System]]
---

# Plan — distribution et corrections de production du fork

## État vérifié

- Branche : `dev`, HEAD `cfdf9233c9`.
- Les modifications de Claude sont non commitées et doivent rester intactes.
- Typechecks et tests ciblés précédemment verts : UI, app, opencode, desktop, Electron ; CodeMirror 3/3 et preload thème 3/3.
- Desktop Tauri compilé en release avec Vite, typecheck et Rust Tauri réussis.
- Android ARM64 compilé après configuration explicite de `ORT_LIB_LOCATION=D:\tmp\ort-android`.
- APK signé v2/v3 et installé sur le téléphone `b7163823` ; `lastUpdateTime` confirmé à `2026-07-16 12:17:44`.
- La commande `opencode.exe --version` du binaire généré n’a pas terminé et doit être diagnostiquée avant de considérer le CLI validé.

## Artefacts validés

| Cible | Artefact | Résultat |
|---|---|---|
| CLI Windows x64 | `packages/opencode/dist/opencode-windows-x64/bin/opencode.exe` | Généré, 198038528 octets, SHA-256 `DD35E685A487B2CDFBB1943A637F08D42B03BF05E463CC4817B39F76D98058D7` |
| Desktop Tauri Windows | `packages/desktop/src-tauri/target/release/OpenCode.exe` | Généré, 50454528 octets, SHA-256 `42BD47A88A10D196D4BA957582DCA81AFD94B04283B4B8EB299670ED9A5A304A` |
| Sidecar desktop | `packages/desktop/src-tauri/sidecars/opencode-cli-x86_64-pc-windows-msvc.exe` | Même SHA-256 que le CLI, donc sidecar rafraîchi |
| Android ARM64 | `app-dev-20260716-signed.apk` | Signature v2/v3 valide, SHA-256 `EAFA2855A26E9533C3D517039B87514793635FA6EAB7091CDF2FDD495E629923` |

## P0 — rendre la distribution du fork réellement cohérente

1. Créer une source unique de provenance : owner `Rwanbt`, repo de release, repo beta, nom de produit futur, canaux et format de version. Normaliser les tags `vX.Y.Z-fork[.N]` côté CLI, desktop et mobile afin d’éviter les faux updates permanents.
2. Corriger le resolver CLI pour toutes les méthodes reconnues. Les chemins curl/npm/bun/pnpm/brew/choco/scoop pointent encore vers l’installation officielle ou le registre officiel ; soit ils deviennent fork-native, soit ils déclarent explicitement leur méthode non supportée et proposent le tarball GitHub du fork.
3. Rendre l’updater Tauri installable : signer les releases, publier `latest.json` et les signatures attendues par Tauri, aligner la clé publique, le repo production et le repo beta. Un binaire « unsigned » ne peut pas satisfaire le flux updater actuel.
4. Décider et implémenter la distribution Electron : publier les artefacts et `latest.yml` dans le repo fork, avec un canal beta cohérent. Le code Electron vise déjà le fork mais le workflow fork ne construit pas Electron.
5. Définir l’update Android séparément : version dynamique au lieu de `0.1.0`, endpoint/release fork, vérification de checksum/signature et UX de mise à jour. Tant qu’il n’y a pas de mécanisme de distribution Android choisi, documenter clairement « téléchargement manuel depuis GitHub ».
6. Corriger l’action GitHub d’installation : sélectionner OS/architecture au lieu de forcer `opencode-linux-x64.tar.gz`, puis vérifier que chaque URL vise le fork.

## P1 — supprimer les références officielles restantes

- Scanner le dépôt, les locales, le site et les workflows pour `anomalyco/opencode`, `anomalyco/opencode-beta`, `opencode.ai/install` et le Discord officiel.
- Remplacer les liens d’aide par le GitHub du fork, en gardant une mention explicite « fork non officiel » au début des README.
- Tester les traductions et les pages d’erreur desktop, Electron, mobile, CLI et web.
- Ajouter un test CI qui échoue si une URL de distribution officielle reste dans un chemin runtime ou de documentation utilisateur.

## P1 — CSP, thèmes et animation

- Maintenir le test CodeMirror édition/lecture seule pour JS/TS/Python/Rust, y compris les noms de fonctions et méthodes.
- Ajouter une matrice Android WebView réelle : changement de thème, redémarrage, thème sombre/clair, réglages mobile, édition et viewer.
- Ajouter un test desktop WebView2 réel pour l’animation `text-shimmer`. Le `translateZ(0)` est défensif mais ne prouve pas la cause racine ; capturer console, préférence Windows d’animation et état DOM/CSS.
- Vérifier que les fixes ne réintroduisent pas de styles dynamiques bloqués par CSP et que le preload reste idempotent.

## P2 — observabilité et hygiène de build

- Ajouter au build un manifeste contenant branche, commit, version, cible, hash du bundle et hash du sidecar/APK.
- Faire échouer le packaging si le sidecar ne correspond pas au CLI fraîchement généré.
- Faire échouer la release si les métadonnées updater, signatures, checksums ou assets attendus manquent.
- Séparer artefacts générés, `.build-temp` et `.artifacts` des modifications métier ; ne jamais confondre un ancien APK avec le build courant.
- Auditer `bun.lock` et les fichiers générés modifiés pendant le build avant tout commit.

## Tests d’acceptation

1. CLI : `--version` termine, affiche la version du fork, et le chemin upgrade ne contacte aucun endpoint officiel.
2. Tauri : lancement de l’EXE fraîchement daté ; aide vers GitHub fork ; thèmes ; édition/viewer ; animation ; update signé depuis une release de test.
3. Electron : même parcours, y compris `latest.yml` et canal beta.
4. Android : installation de l’APK courant, lancement, thème après redémarrage, CSP édition/viewer, aide GitHub, extraction runtime et absence de crash logcat.
5. CI : matrice OS/architecture, artefacts nommés, checksums, métadonnées updater et test anti-références officielles.
6. Régression : typechecks des cinq packages, tests ciblés UI/app, tests mobile, puis tests d’intégration release.

## Ordre d’implémentation

```text
Provenance/version -> CLI updater -> Tauri/Electron release metadata
       -> Android update/versioning -> GitHub Action et docs
       -> tests anti-références -> validation desktop + téléphone
```

## Hors périmètre immédiat

- Changer le nom du fork : préparer les constantes et URLs, mais attendre le nouveau nom définitif.
- Publier sur `main` ou pousser des commits : aucune autorisation donnée dans cette session.
- Affirmer que l’animation desktop est corrigée : seule la compilation est prouvée, pas le comportement WebView2 manuel.

## GSTACK REVIEW REPORT

| Runs | Status | Findings |
|---|---|---|
| Build CLI Windows x64 | PASS_WITH_CONCERN | Artefact généré ; `--version` reste bloqué |
| Build desktop Tauri release | PASS | Vite, typecheck et Rust terminés |
| Build Android ARM64 | PASS_AFTER_ENV | Nécessite `ORT_LIB_LOCATION` |
| Signature/installation Android | PASS | Signature v2/v3, installation et `lastUpdateTime` confirmés |
| Audit distribution fork | OPEN | Updaters CLI/Tauri/Android/Electron encore incohérents |

VERDICT: le terrain de test est disponible sur desktop et Android, mais la distribution production du fork et la validation CLI restent bloquées par les écarts listés ci-dessus.

NO UNRESOLVED DECISIONS
