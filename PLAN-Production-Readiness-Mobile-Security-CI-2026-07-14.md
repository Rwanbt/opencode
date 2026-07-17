---
project: opencode
type: roadmap
tags: [opencode, production, mobile, android, security, ci, observability]
summary: "Plan d’achèvement production pour aligner mobile et desktop, sécuriser les dépendances, fiabiliser GitHub et valider le parcours E2E."
created: 2026-07-14
updated: 2026-07-14
related: [[OpenCode/Codex|OpenCode AGENTS.md]], [[OpenCode/Plan-Convergence-CLI-Desktop-Android-Auto-Debate-Observability-2026-07-13|Plan convergence CLI/Desktop/Android]], [[OpenCode/observability|Observability]], [[INDEX]], [[LOG]]
---

# Plan — Production readiness mobile, sécurité et CI

## Statut

**In progress — validation partielle effectuée le 2026-07-14**  
Branche cible : `dev`  
Worktree cible : `D:\App\OpenCode\opencode-cache-verification`  
Règle : aucun push automatique; les commits de phase sont ciblés et les changements utilisateur sont préservés.

## Progression d’implémentation

- [x] Phase 0 — isolation et provenance/hash des artefacts Android.
- [x] Phase 2 — versions ORT/runtime et wrapper de build Android contrôlé.
- [x] Phase 3 — signature release fail-closed; keystore CI exigé, aucun keystore local disponible.
- [x] Phase 4 — vérification de parité du bundle mobile et migrations.
- [x] Phase 5 — concurrency Android/typecheck et collecte audit reproductible.
- [ ] Phase 1 — traitement des vulnérabilités high et gate sécurité GitHub.
- [ ] Phase 6 — nettoyage Knip complet et politique LOC/générés.
- [ ] Phase 7 — trois runs CI verts et E2E desktop/Android sur appareil.


## Diagnostic vérifié

- L’interface mobile importe `@opencode-ai/app`; les écrans observability desktop/mobile ont donc une source commune.
- Le backend mobile est le bundle généré depuis `packages/opencode/src/mobile-entry.ts`.
- Le bundle mobile contient les migrations observability, le stockage local, la rétention/cache et les métadonnées `OPENCODE_VERSION=1.3.15`, `OPENCODE_CHANNEL=latest`.
- CLI production et desktop production ont été buildés localement; le raccourci Windows pointe vers le binaire production du worktree cible.
- Android production a été buildé et installé avec une signature debug locale; le téléphone a lancé `ai.opencode.mobile`.
- Typechecks core/app/mobile : OK. Tests mobile : `64/64`. Tests observability ciblés : `134/134` après exécution hors sandbox.
- `bun audit` : 56 vulnérabilités transitives (`12 high`, `29 moderate`, `15 low`).
- ShellCheck : `SC2064` dans `packages/mobile/scripts/prepare-android-runtime.sh`.
- Knip : configuration comportant des entrées obsolètes et des hints de configuration.
- GitHub : échecs observés sur pushes concurrents, rate-limit du provider Pulumi Stripe et un test Windows instable.
- Les bundles générés produisent un très grand diff et des alertes de whitespace; leur politique de versionnement doit être explicitée.

## Objectif final

Obtenir une branche `dev` reproductible et publiable où :

1. desktop et mobile exposent la même interface et les mêmes contrats observability/cache;
2. les trois distributions production sont reproductibles;
3. Android utilise des bibliothèques natives et une signature release contrôlées;
4. CI ne dépend pas de pushes concurrents ni de téléchargements non fiabilisés;
5. les gates typecheck, tests, sécurité, health et E2E sont verts avant merge.

## Architecture cible

```text
                    packages/app
                 UI observability/cache
                    /           \
           packages/desktop   packages/mobile
             Tauri desktop       Tauri Android
                 |                    |
        CLI production sidecar   mobile-entry bundle
                 \                    /
              packages/opencode core/backend
                       |
             SQLite observability + cache
                       |
             exporters explicitement opt-in
```

Principes : une source de vérité pour l’UI, une source de vérité pour le backend, aucun export réseau implicite, aucune donnée sensible dans les projections exportées, artefacts natifs Android produits par un pipeline reproductible.

## Découpage d’implémentation

### Phase 0 — Préparer et isoler les artefacts

- Vérifier le worktree actif, la branche `dev`, les worktrees voisins et les changements utilisateur.
- Ne jamais modifier `D:\App\OpenCode\opencode` ni les worktrees de sauvegarde.
- Identifier les artefacts générés Android (`gen/`, `target/`, APK, bibliothèques natives) et les distinguer des fichiers versionnés.
- Documenter les versions : Bun, Rust, Tauri CLI, Android SDK/NDK, CMake, JDK, ORT et llama.cpp.
- Ajouter une checklist de provenance/hash pour chaque bibliothèque native livrée.

**Gate :** aucun fichier utilisateur perdu; provenance de chaque artefact connue.

### Phase 1 — Sécurité des dépendances et frontières observability

- Générer un rapport `bun audit` reproductible et séparer les vulnérabilités directes des transitives.
- Traiter d’abord les vulnérabilités `high`, en commençant par celles présentes dans les chemins serveur, HTTP, WebSocket, parsing et export.
- Mettre à jour les dépendances par groupes cohérents; après chaque groupe, lancer typecheck et tests concernés.
- Vérifier que les correctifs ne changent pas les contrats d’authentification, CORS, cookies, routing et validation.
- Ajouter un audit sécurité CI non bloquant lors de la première introduction, puis bloquant sur les nouvelles vulnérabilités high.
- Conserver les invariants observability : désactivé par défaut, metadata-only par défaut, opt-in explicite, HMAC des identifiants, projection sans contenu et export réseau opt-in.
- Ajouter/maintenir des tests anti-leak, anti-network, redaction, content TTL et isolation de scope.

**Gate :** zéro nouvelle vulnérabilité high; tests de frontière sécurité verts; aucune régression de l’opt-in.

### Phase 2 — Fiabiliser le runtime Android

- Remplacer la récupération implicite ORT par un artefact versionné ou une étape de téléchargement avec hash vérifié.
- Construire `libllama.so`, `libggml.so`, `libggml-base.so`, `libggml-cpu.so` et les backends optionnels depuis une source et une version explicitement épinglées.
- Supprimer la dépendance aux binaires copiés d’un autre worktree.
- Vérifier ABI `aarch64`, symboles ELF, dépendances `NEEDED`, taille minimale et chargement sur le téléphone cible.
- Corriger `SC2064` avec un trap sûr, puis exécuter ShellCheck sur tous les scripts Android concernés.
- Rendre le build indépendant de WSL lorsque les outils Windows suffisent; si WSL est requis, ajouter un diagnostic clair et un préflight.
- Passer `ORT_LIB_LOCATION`, `ORT_PREFER_DYNAMIC_LINK` et les versions natives explicitement au build Tauri/Gradle.
- Ajouter un script unique de build release Android qui produit : APK unsigned, APK signé release, hash SHA-256 et rapport de provenance.

**Gate :** build propre depuis un checkout frais, sans copie d’artefact manuel; APK vérifié avec `apksigner`; application lancée sur `aarch64`.

### Phase 3 — Signature et distribution production

- Créer/choisir le keystore release officiel et documenter son stockage hors dépôt.
- Remplacer la signature debug par une signature release dans le pipeline local/CI.
- Définir la version Android et le `versionCode` depuis une source unique liée à la version OpenCode.
- Produire APK de test et AAB de distribution; ne pas confondre l’APK de test local avec un artefact publiable.
- Ajouter une vérification qui refuse de publier un artefact signé debug.
- Documenter l’installation locale, la mise à jour sans perte de données et la procédure de rollback.

**Gate :** artefact release identifiable, signé par la bonne clé, installable en mise à jour et traçable par hash.

### Phase 4 — Parité desktop/mobile et interface

- Centraliser les contrats de données observability/cache dans les packages partagés déjà existants.
- Vérifier les écrans : activation, scope projet/tous projets, privacy/content opt-in, timeline, coût, refresh, erreurs et état vide.
- Vérifier les capacités différentes : desktop peut exporter/ouvrir des fichiers; mobile doit afficher une alternative adaptée sans bouton mort.
- Ajouter un test de compilation par cible et un test de présence des routes/SDK générés dans le bundle mobile.
- Ajouter une vérification de bundle qui compare les migrations et les signatures de routes avec la source backend.
- Tester le comportement après migration d’une base mobile existante et après expiration du contenu opt-in.

**Gate :** mêmes contrats UI/backend, aucun écran observability absent sur mobile, tests de migration et de scope verts.

### Phase 5 — CI GitHub

- Ajouter une clé `concurrency` par workflow/branche pour annuler les runs obsolètes et éviter les pushes concurrents.
- Séparer les workflows de génération, stats et déploiement des jobs qui écrivent sur `dev`.
- Interdire les pushes automatiques concurrents vers une branche partagée; préférer artefacts, PR ou bot branch dédié.
- Corriger le provider Pulumi Stripe : cache du plugin, installation versionnée, authentification GitHub ou suppression du déploiement si non nécessaire au test.
- Diagnostiquer le test Windows instable avec un rerun isolé et un artefact de logs; ne pas masquer les vrais échecs sous `continue-on-error`.
- Ajouter des retries uniquement autour des téléchargements/rate-limits, jamais autour des assertions de tests.
- Publier dans les checks : typechecks package-level, tests unitaires, security audit, shellcheck, Knip et build smoke.

**Gate :** trois runs consécutifs de `dev` verts; aucun job ne pousse implicitement dans un checkout concurrent.

### Phase 6 — Health et hygiène du dépôt

- Nettoyer `knip.json` : supprimer les exclusions mortes, corriger les entrées et conserver uniquement les points d’entrée réels.
- Décider si les bundles `opencode-cli.js` générés doivent être versionnés; si oui, documenter la génération déterministe; sinon, les produire en CI/release.
- Éviter de faire passer `git diff --check` sur un bundle minifié contenant des espaces sémantiques; appliquer le contrôle aux sources et générer un contrôle séparé pour le bundle.
- Ajouter une gate LOC et une gate de fichiers générés modifiés par erreur.
- Vérifier les scripts `bash` avec ShellCheck et `node --check`/équivalent pour les scripts JS.
- Conserver les rapports health et sécurité comme artefacts CI, sans les mélanger au code produit.

**Gate :** health reproductible, Knip sans warnings de configuration critiques, diff reviewable et aucun artefact source accidentel.

### Phase 7 — Validation E2E de bout en bout

```text
build source
   ↓
CLI production / sidecar / mobile bundle
   ↓
desktop + Android installés
   ↓
création projet → session → événement observability
   ↓
timeline/coût/scope/privacy
   ↓
purge TTL → export opt-in → redémarrage → migration
```

- Desktop : démarrer depuis le raccourci épinglé, vérifier chemin, version, icône et sidecar.
- Mobile : ouvrir l’application installée, créer/ouvrir un projet, créer une session, vérifier terminal et backend embarqué.
- Observability : vérifier health, timeline, résumé, coût, scope projet/all, privacy et purge.
- Cache : vérifier lecture après redémarrage, invalidation après changement d’agent/compaction et absence de mélange inter-projet.
- Erreurs : réseau indisponible, base verrouillée/pleine, export refusé, migration ancienne, permission Android et absence de modèle local.
- Collecter logs et captures de version sans inclure de secrets ni de contenu utilisateur.

**Gate :** parcours critique réussi sur desktop et Android; anomalies classées bloquantes/non bloquantes.

## Ordre de livraison recommandé

1. Phase 0 — isolation/provenance.
2. Phase 2 — runtime Android reproductible.
3. Phase 3 — signature/distribution Android.
4. Phase 1 — sécurité dépendances et invariants.
5. Phase 5 — CI GitHub.
6. Phase 6 — health/hygiène.
7. Phase 4 — parité UI contractuelle et tests.
8. Phase 7 — E2E final, puis review et commit.

Chaque phase doit rester buildable, testable et commitable indépendamment. Aucun push automatique ne sera effectué sans validation explicite.

## Hors périmètre

- Migration complète vers une nouvelle architecture mobile.
- Réécriture de llama.cpp ou du moteur ORT.
- Publication publique sans décision sur le keystore et le canal de distribution.
- Correction de vulnérabilités sans rapport direct avec les dépendances ou chemins activés par OpenCode, sauf exigence du policy gate.

## Risques et décisions à confirmer avant exécution

- **Keystore Android :** le keystore release officiel et sa procédure de rotation doivent être disponibles avant la phase 3.
- **Artefacts natifs :** choisir entre compilation CI depuis les sources épinglées ou artefacts internes signés; recommandation : compilation reproductible + hash.
- **Bundles générés :** recommandation : une seule source de génération, validation CI et versionnement uniquement si le runtime offline l’exige.
- **Vulnérabilités transitives :** les mises à jour peuvent modifier des APIs; chaque groupe doit être isolé avec tests et rollback.
- **CI deploy :** le provider Stripe doit être rendu déterministe ou retiré des jobs de validation OpenCode.

## Checklist d’acceptation finale

- [ ] Aucun changement de code implémenté avant validation de ce plan.
- [ ] Worktree et changements utilisateur préservés.
- [ ] Build CLI production + smoke OK.
- [ ] Build desktop production + raccourci vérifié.
- [ ] Build Android depuis checkout frais sans artefact copié manuellement.
- [ ] APK/AAB signé release, hash et provenance publiés.
- [ ] UI observability/cache vérifiée desktop et mobile.
- [ ] Typechecks et tests package-level verts.
- [ ] Audit sécurité high traité ou exception documentée.
- [ ] ShellCheck et Knip propres.
- [ ] Trois runs GitHub consécutifs verts.
- [ ] E2E desktop + Android réussi.
- [ ] Review finale effectuée.
- [ ] Commit propre puis push uniquement après accord.

## GSTACK REVIEW REPORT

| Run | Status | Findings |
|---|---|---|
| Diagnostic local du 2026-07-14 | DONE_WITH_CONCERNS | Builds locaux OK; 56 vulnérabilités transitives, SC2064, CI instable, artefacts natifs à rendre reproductibles. |
| Scope review | DONE | Phases séparées pour éviter de mélanger sécurité, distribution, CI et UX. |
| Test strategy | DONE | Typechecks, suites ciblées, tests migration/privacy/scope, build smoke et E2E explicitement couverts. |
| Distribution review | DONE_WITH_CONCERNS | Signature debug actuelle insuffisante pour publication; keystore release requis. |

**VERDICT:** plan complet recommandé, implémentation bloquée jusqu’à validation du keystore release et de la politique de versionnement des bundles générés.

NO UNRESOLVED DECISIONS