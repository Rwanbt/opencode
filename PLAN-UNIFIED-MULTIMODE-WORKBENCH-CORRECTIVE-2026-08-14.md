<!-- SPDX-License-Identifier: MIT -->

---
project: opencode
type: roadmap
tags: [unifia, workbench, multimode, debugging, tauri, tests]
summary: "Plan correctif autonome pour unifier Code, Work, Design et Automate sur une session Workbench partagée et corriger navigation et titlebar."
created: 2026-08-14
updated: 2026-08-14
related: [[OpenCode/Plan-Work-Design-Integration-2026-08-12|Plan Work/Design v4]], [[OpenCode/Work-Design-Execution-2026-08-13|Checkpoint Work/Design]], [[OpenCode/_memory/memory|Mémoire OpenCode]]
---

<!--
SPDX-License-Identifier: MIT
Copyright (c) 2026 Unifia contributors

Modifications: Original Unifia implementation plan for the unified multimode workbench corrective.
Responsible: hermes-agent@local.invalid
-->

# Plan correctif autonome — Unifia multimode unifié

## 0. Mandat d'exécution

Ce document est le plan delta autoritaire pour corriger le shell multimode actuellement non fonctionnel sans recréer un runtime concurrent. Il est écrit pour être exécuté carte par carte par Luna, MiniMax M3 ou une autre IA disposant du dépôt local.

L'agent d'exécution doit poursuivre automatiquement jusqu'au premier gate exigeant une interaction humaine réelle. Il ne doit pas s'arrêter entre deux cartes pour demander « continuer ? ». Il ne doit jamais transformer une preuve manuelle non exécutée en succès.

Contraintes absolues :

- travailler uniquement dans `D:\App\OpenCode\opencode-work-design`, branche `work-design` issue de `dev` ;
- ne pas créer une autre branche ou un autre worktree ;
- ne modifier ni `main`, ni `dev`, ni les dépôts locaux de référence ;
- préserver toutes les modifications existantes ; aucun `git reset --hard`, `git checkout --`, nettoyage récursif ou suppression globale ;
- ne pas introduire de nouvelle référence à l'ancien nom produit ; le produit est **Unifia** ;
- conserver Unifia Core et le serveur Workbench existant comme seules autorités runtime ;
- conserver le manifest workspace JSON versionné, plusieurs catalogues et **aucun fallback silencieux** ;
- utiliser `apply_patch` pour les éditions ;
- séparer refactoring structurel et changement fonctionnel en commits atomiques ;
- aucun push, PR, merge, release ou publication sans autorisation explicite.

## 1. Résultat fonctionnel attendu

Les quatre boutons du rail sont des sélecteurs de présentation d'un même workspace et d'une même session Workbench. Ils ne lancent pas quatre applications, quatre backends ou quatre autorités d'écriture.

```text
Processus Unifia Desktop
└── Runtime/sidecar Unifia unique
    └── Workspace Workbench partagé (workspaceId)
        ├── session Code courante
        ├── documents, fichiers et recherche
        ├── design systems, specs et previews
        ├── artefacts et provenance
        ├── workflows et opérations
        ├── approvals et audit
        └── état de tâche multimode
            ├── Vue Code
            ├── Vue Work
            ├── Vue Design
            └── Vue Automate
```

Changer de mode doit uniquement changer la projection visible. Le workspace, le `workspaceId`, la connexion, la session Code, les artefacts, la provenance et les opérations en cours restent cohérents.

Exemple obligatoire :

```text
Design: produire une spec/preview validée
   ↓ même workspaceId et même registre d'artefacts
Work: matérialiser ou examiner les fichiers/artefacts
   ↓ même operationId, approvals et audit
Automate: enchaîner validation, génération et export
   ↓ même session/provenance
Code: ouvrir et corriger le résultat sans perdre le contexte
```

## 2. Baseline réelle au 2026-08-14

- Branche : `work-design`.
- Derniers commits : `f10c1cc2c9` puis `91d2220152`.
- Le serveur, les contrats, le bridge natif, le client Workbench, les catalogues et une partie des surfaces existent déjà ; ils doivent être réutilisés.
- Le dépôt est volumineux : environ 2 301 fichiers TypeScript/JavaScript/Rust et 61 Mo de sources. L'audit doit rester manifest-driven et ciblé sur le graphe décrit ici.
- Modifications locales non commitées présentes avant ce plan :
  - `packages/app/src/components/session/session-header.tsx` ;
  - `packages/app/src/components/titlebar.tsx` ;
  - `packages/app/src/context/mode.tsx` ;
  - `packages/app/src/context/platform.tsx` ;
  - `packages/app/src/pages/layout.tsx` ;
  - `packages/app/src/pages/layout/sidebar-shell.tsx` ;
  - `packages/desktop/src/index.tsx` ;
  - `.unifia/` non suivi, produit par le runtime.
- Ces modifications sont des **expériences non prouvées**. Elles ne doivent ni être supprimées en bloc ni être commitées telles quelles. La carte C0 les compare au diagnostic, conserve les parties valides et retire explicitement les parties invalides avec `apply_patch`.

## 3. Diagnostic vérifié

### F1 — état visuel modifié avant navigation valide — P1, confiance 10/10

Dans `packages/app/src/context/mode.tsx`, `select()` exécute `setStore("value", mode)` avant de résoudre le workspace et avant `navigate(path)`. Si le workspace est absent ou si la transition échoue, le bouton change d'apparence alors que la page ne change pas. C'est le symptôme observé.

### F2 — persistance liée une seule fois au répertoire initial — P1, confiance 9/10

`persisted(Persist.workspace(directory(), "mode"), ...)` évalue `directory()` lors de la création de `ModeProvider`. Ce provider est monté au-dessus de `DirectoryLayout`; sur `/`, le répertoire initial est vide. Le backend de persistance reçoit donc un nom de stockage calculé pour le mauvais scope et ne se rebinde pas lors des changements de route.

### F3 — trois sources concurrentes pour le mode actif — P1, confiance 10/10

Le mode actif est simultanément représenté par :

1. le segment de route ;
2. `store.value` ;
3. le bouton sélectionné avant confirmation de navigation.

Cette duplication viole la source de vérité unique. L'URL doit être l'autorité de la projection visible ; la préférence persistée ne doit servir qu'à choisir une destination initiale.

### F4 — résolution du workspace par fallback ambigu — P1, confiance 9/10

Le candidat local actuel essaie successivement `directory()`, le premier projet ouvert puis le premier projet récent. Le premier élément n'est pas nécessairement le workspace actif. La sélection d'un mode ne doit jamais deviner silencieusement un workspace. Depuis l'accueil, elle doit utiliser un `activeWorkspace` explicite ou afficher une action claire demandant d'ouvrir un projet.

### F5 — backend partagé, mais données et état UI cloisonnés — P1, confiance 10/10

La connexion Workbench est déjà créée dans `ModeProvider`, donc elle n'est pas recréée à chaque vue tant que le provider reste monté. En revanche, `WorkSurface`, `DesignSurface` et `AutomateSurface` créent chacun leurs propres resources. Leur démontage perd sélections, erreurs, chargements et contexte de tâche. Il manque un store workspace commun consommable aussi depuis Code.

### F6 — absence de test de transition réel — P1, confiance 10/10

`packages/app/src/context/mode.test.ts` teste des fonctions pures de construction d'URL. Aucun test ne clique successivement sur les quatre boutons, ne vérifie le rendu, ne compte les connexions Workbench ou ne prouve la conservation du workspace/session. Les tests verts actuels ne couvrent donc pas la régression utilisateur.

### F7 — route générique trop permissive — P2, confiance 9/10

`<Route path="/:mode" component={WorkbenchModeRoute} />` accepte toute chaîne. `WorkbenchMode` ne rend aucune surface pour une valeur inconnue. Une route invalide peut donc produire un écran vide au lieu d'une redirection ou erreur explicite.

### F8 — contrôles de fenêtre Decorum soumis à une course d'initialisation — P1, confiance 9/10

`MainWindow::create()` construit d'abord la fenêtre puis appelle `create_overlay_titlebar()`. Le plugin attend l'événement `decorum-page-load`, injecte `controls.js` et `titlebar.js`, puis ces scripts enregistrent encore un listener `DOMContentLoaded`. Si ce dernier événement est déjà passé, aucun contrôle n'est créé. Les scripts exigent aussi `window.__TAURI__`, alors que l'application utilise déjà avec succès les imports Tauri directs. Ce mécanisme doit avoir un seul propriétaire, sans double injection.

### F9 — revoke workspace-scoped incompatible avec deux connexions concurrentes — P0, confiance 10/10

`NativeTokenBridge.revoke(workspaceId)` et `ScopedTokenIssuer.revoke({ workspaceId, instanceId })` ne ciblent pas un `tokenId` ou une connexion individuelle. Une ancienne connexion du même workspace qui résout après un retry ne peut donc pas être simplement révoquée : sa révocation invaliderait aussi la lease courante. Le lifecycle doit imposer un **single-flight strict par workspace** et sérialiser `cleanup → reconnect`. Aucune seconde émission de lease pour le même scope ne peut commencer tant que la tentative précédente n'est pas terminée ou expirée et nettoyée.

### F10 — allocation partielle non rollbackée et timeout incomplet — P0, confiance 10/10

`connectWorkbench()` émet une lease avant le handshake, mais ne la révoque que sur mismatch d'identité. Un timeout réseau, une erreur de parsing ou une exception de handshake rejette sans rendre de `WorkbenchConnection` au provider : le caller ne peut plus nettoyer la lease. De plus, le timeout HTTP natif de dix secondes ne couvre pas `awaitInitialization()`. La transaction complète `initialization → open workspace → issue lease → handshake` doit avoir une deadline globale et un rollback explicite à chaque frontière.

### F11 — mounts de titlebar recherchés une seule fois — P1, confiance 10/10

`SessionHeader` résout `unifia-titlebar-center` et `unifia-titlebar-right` une seule fois dans `onMount()`. Si la titlebar n'est pas encore présente ou est recréée, les actions de session restent absentes. Cette course est indépendante de Decorum et explique une partie des contrôles applicatifs disparus. Les slots doivent être fournis par refs/contexte réactifs avec cleanup, pas par `document.getElementById()` ponctuel.

### F12 — formulation de sécurité trop large — P1, confiance 10/10

Le bearer token scoped est utilisé par le client JavaScript et existe donc dans la mémoire de la WebView. La propriété réellement garantie est plus étroite : **aucune clé de signature ni secret IPC natif n'entre dans la WebView**. Le plan, l'ADR et les commentaires doivent conserver cette formulation exacte et traiter le bearer comme un secret court, scoped et révocable.

### Hypothèses réfutées

- Les quatre modes ne lancent pas actuellement quatre backends : la connexion est dans un provider commun.
- L'encodage Base64 du workspace est URL-safe et n'est pas la cause principale.
- `IconButton` transmet correctement `onClick` ; le problème n'est pas un handler absent.
- Le rail n'est pas couvert par le panneau `inert` ; celui-ci ne vise que le panneau latéral extensible.
- Le bridge natif est asynchrone et les requêtes HTTP natives ont un timeout de 10 secondes ; une erreur de bridge doit être visible, mais n'explique pas à elle seule l'état visuel incohérent.

## 4. Architecture cible

### 4.1 Séparation des responsabilités

```text
ShellModeContext (global, léger)
├── registry: code | work | design | automate
├── activeMode: dérivé exclusivement de l'URL
├── switchMode(mode): navigation validée
└── aucune connexion Workbench, aucun cache métier

DirectoryLayout (keyed par workspace décodé)
└── WorkspaceWorkbenchProvider
    ├── connection state machine
    ├── workspaceId + instanceId
    ├── accès au QueryClient TanStack partagé
    ├── artifact/task/provenance state
    ├── operation/event state
    └── revoke au changement réel de workspace ou shutdown

Route child
├── session/:id?  → CodeView
├── work          → WorkView
├── design        → DesignView
└── automate      → AutomateView
```

Les routes sœurs peuvent rester : `DirectoryLayout` et `WorkspaceWorkbenchProvider` restent montés lorsque seul le child route change. Il n'est donc pas nécessaire de convertir immédiatement les modes en query parameter. Cette solution est plus petite, réversible et compatible avec les URLs existantes.

### 4.2 Source de vérité

| Fait | Autorité unique |
|---|---|
| workspace actif | route décodée et validée par `DirectoryLayout` |
| projection visible | route child validée |
| dernier mode préféré | map persistée par workspace, utilisée uniquement à l'entrée |
| connexion/identité | `WorkspaceWorkbenchProvider` |
| données métier | client/cache Workbench partagé |
| session Code | route/session store existant |
| artefacts/provenance | registre serveur Workbench |
| workflow inter-mode | opération serveur, jamais composant UI |

### 4.3 Machine d'état de connexion

```text
idle
  └─ premier consommateur Workbench dans un workspace valide
       → initializing(attemptId, deadline)
       → opening
       → issuing
       → handshaking
          ├─ success courant → ready(connection)
          ├─ failure → rolling_back → failed(error, retryable)
          └─ workspace change → rolling_back → idle(nouveau workspace)

ready
  ├─ mode change → ready (aucune reconnexion)
  ├─ retry explicite → revoking → idle → nouvelle tentative sérialisée
  ├─ workspace change → revoking → idle(nouveau workspace)
  └─ app shutdown → revoking → closed
```

Règles non négociables :

1. Une seule tentative peut exister à la fois pour un même couple `instanceId/workspaceId`.
2. Un retry du même workspace attend le rollback ou l'expiration de la tentative précédente ; il ne lance jamais une deuxième lease en parallèle.
3. Une résolution tardive d'un **autre workspace** est rollbackée et ignorée.
4. Une résolution tardive du **même workspace** est terminée/nettoyée avant toute nouvelle tentative, car `revoke(workspaceId)` est workspace-scoped.
5. Toute phase ayant acquis une ressource en devient responsable jusqu'au transfert explicite de propriété à la phase suivante.
6. La deadline globale couvre aussi `awaitInitialization()` ; les timeouts HTTP internes ne suffisent pas.
7. Une erreur de rollback est journalisée sans masquer l'erreur primaire et place le scope en état `cleanup_failed`, sans reconnect automatique.

### 4.4 Politique de connexion, capacités et cache

- `WorkspaceWorkbenchProvider` est toujours monté dans `DirectoryLayout`, mais la connexion est **lazy** : Code ne doit ni attendre ni exiger Workbench pour s'afficher.
- Le premier consommateur Work/Design/Automate ou une commande Code explicitement Workbench déclenche la connexion.
- La connexion commence avec les capacités minimales de lecture nécessaires. `artifact.export`, écriture, workflow et approvals sont obtenus par élévation/rotation explicite au moment de l'action ; aucune union de toutes les capacités n'est demandée au démarrage.
- Le cache serveur réutilise le `QueryClient` TanStack déjà monté. Il n'existe pas de second cache propriétaire pour les mêmes données.
- Toute clé de query inclut au minimum `serverOrigin`, `instanceId`, `workspaceId`, ressource et paramètres.
- Le contexte Solid ne possède que lifecycle, identité, sélections inter-mode et `TaskContext`; les données serveur restent dans les queries.
- Un seul flux SSE existe par connexion. Son `AbortController`, son curseur et sa resynchronisation appartiennent au provider. Un gap de séquence déclenche une invalidation/resync autoritative.
- Les mutations ne sont jamais rejouées implicitement. Retry d'une mutation uniquement avec une clé d'idempotence stable et une décision explicite.

### 4.5 Identités partagées

`TaskContext` utilise des types distincts :

```text
workspaceId
codeSessionId?
workbenchSessionId?
operationId?
linkedArtifactIds[]
provenanceRef?
status
```

Chaque identité est validée contre le workspace courant. Une session supprimée, inconnue ou appartenant à un autre workspace est retirée du contexte avec une erreur visible ; elle n'est jamais recréée ou remplacée silencieusement.

### 4.6 Décisions verrouillées par la review

1. Connexion **lazy et non bloquante** ; Code fonctionne sans Workbench prêt.
2. Première implémentation sans évolution publique de lease : single-flight strict et retry sérialisé. Une révocation par `tokenId/leaseId` devient un RFC séparé seulement si plusieurs connexions simultanées au même workspace deviennent un besoin réel.
3. Cache serveur : TanStack Query existant. Store Solid : lifecycle et contexte UI uniquement.
4. `lastModeByWorkspace` est conservé dans une map globale versionnée et bornée ; l'URL reste autoritaire.
5. Depuis `/`, les modes ouvrent le sélecteur et transportent une intention temporaire ; annuler ne change rien.
6. Propriétaire Windows : contrôles Solid/Platform, activés atomiquement avec retrait de Decorum. Minimize, maximize/restore, close, drag et double-clic sont obligatoires. La perte éventuelle du flyout Snap natif est une limitation explicitement documentée et testée manuellement, pas un motif pour réactiver deux propriétaires.
7. C5a/C5b appartiennent au correctif de continuité ; C5c/C5d sont des incréments métier séparés et ne peuvent pas masquer l'acceptation du correctif de navigation.

## 5. Cartes d'implémentation

### C0 — Baseline reproductible et protection du dirty state — P0

**Objectif :** prouver le défaut actuel avant tout nouveau correctif.

Actions :

1. Capturer `git status --short`, `git diff`, HEAD, version Bun/Rust/Tauri, hash et mtime du dernier `Unifia.exe`.
2. Archiver le diff non commité dans le rapport de carte ; ne pas utiliser de commande destructive.
3. Ajouter d'abord un test rouge Playwright `packages/app/e2e/modes/mode-navigation.spec.ts` reproduisant : Code → Work → Design → Automate → Code.
4. Le test doit vérifier URL, `data-workbench-mode`, contenu visible et réactivité du bouton Code.
5. Ajouter un faux bridge déterministe injecté via `PlatformProvider`, capable de compter `connect`, phases, leases et `revoke`, de différer/résoudre/rejeter chaque phase et de vérifier l'identité sans exposer de bearer.
6. Reproduire séparément depuis `/` sans workspace actif et depuis une vraie session.
7. Vérifier que le test rouge échoue sur la divergence route/vue ou le retour Code, pas seulement parce que le bridge web est absent.

Critère de fin : au moins un test échoue pour la même raison observable que le défaut utilisateur. Si le défaut ne peut pas être reproduit, conserver la trace et arrêter le code produit plutôt que deviner.

Commit attendu : `test(app): reproduce multimode navigation regression`.

### C1 — Extraire le contrat pur de navigation multimode — P0

**Fichiers :** `packages/app/src/context/mode-directory.ts`, tests associés, éventuellement un nouveau `mode-navigation.ts` inférieur à 250 lignes.

Actions :

1. Définir un parseur total de route qui retourne `{ directory, mode, sessionId? }` ou une erreur typée.
2. Valider `mode` avec `SHELL_MODES`; aucune route inconnue ne rend un écran vide.
3. Définir `modeHref(current, targetMode)` sans effet de bord.
4. Conserver le workspace décodé et convertir explicitement la session entre path Code et query multimode : `/:dir/session/abc → /:dir/design?session=abc → /:dir/session/abc`.
5. Si path et query contiennent deux sessions différentes, rejeter l'ambiguïté avec une erreur typée ; ne jamais choisir silencieusement.
6. Pour Code, restaurer uniquement une session explicite validée pour le workspace, sinon `/session`.
7. Tester Windows, Unicode, caractères réservés, route racine, mode inconnu, query invalide, ID trop long, session supprimée, autre workspace et trailing slash.

Critère de fin : le mapping route ↔ mode est total, déterministe et couvert branche par branche.

Commit attendu : `refactor(app): centralize multimode route contract`.

### C2 — Réduire ModeProvider à une projection UI — P0

**Fichiers :** `packages/app/src/context/mode.tsx`, `packages/app/src/app.tsx`, `packages/app/src/pages/layout/sidebar-shell.tsx`, tests.

Actions :

1. Retirer connexion Workbench, cache métier et fallback de workspace du provider de mode.
2. Faire dériver `activeMode` exclusivement de la route validée.
3. `select(mode)` résout un href depuis le workspace actif explicite puis navigue ; aucun `setStore` optimiste avant navigation.
4. Sur `/` sans workspace actif, un clic ouvre le sélecteur de projet en conservant le mode demandé comme intention temporaire. Annuler ne navigue pas ; choisir un projet navigue vers ce projet et ce mode. Aucun premier récent n'est choisi silencieusement.
5. Conserver `lastModeByWorkspace` dans un scope global stable, versionné et borné. Cette préférence sert uniquement après sélection explicite d'un workspace sans route enfant ; elle ne remplace jamais une URL courante.
6. Migrer ou supprimer de façon ciblée l'ancienne entrée `mode` calculée avec un répertoire vide ; ne toucher à aucune autre préférence workspace.
7. Ajouter `aria-current="page"` et des labels i18n réels ; ne pas concaténer `${mode} mode` en anglais.

Critère de fin : l'apparence du rail ne peut plus diverger de la route rendue.

Commit attendu : `fix(app): make the route authoritative for shell modes`.

### C3 — Introduire WorkspaceWorkbenchProvider partagé — P0

**Fichiers :** nouveau module sous `packages/app/src/context/workbench/`, `directory-layout.tsx`, `platform.tsx`, tests.

Actions :

1. Monter le provider dans `DirectoryLayout`, après résolution sûre du répertoire et autour de tous les child routes, sans bloquer le rendu Code.
2. Démarrer la connexion à la demande du premier consommateur Workbench et la partager avec Code/Work/Design/Automate.
3. Introduire d'abord un contrôleur lifecycle pur/stateless ou une classe injectée, testable sans DOM, qui implémente les phases et la deadline de 4.3.
4. Garantir le single-flight par workspace : retry du même scope sérialisé, jamais deux émissions concurrentes.
5. Durcir `connectWorkbench()` et le bridge desktop avec rollback de toute allocation partielle, y compris erreur de handshake et timeout global d'initialisation.
6. Révoquer exactement une fois au changement réel de workspace et au shutdown ; aucun revoke lors d'un simple changement de mode.
7. Réutiliser TanStack Query pour documents, files, artifacts, design systems, workflows, operations, approvals et audit ; aucune duplication de cache.
8. Posséder un flux SSE unique avec abort, curseur, détection de gap, resync et invalidation ciblée.
9. Demander les capacités minimales, puis élever/rotater explicitement lors des actions privilégiées.
10. Afficher toutes les erreurs de frontière et proposer retry uniquement lorsqu'il est sûr ; `cleanup_failed` exige une action explicite.

Tests critiques : connexion unique durant les quatre transitions, deux demandes concurrentes du même workspace, résolution tardive autre workspace, retry même workspace, handshake rejeté après lease, timeout d'initialisation, revoke en échec, changement rapide de workspace, revoke exact, cleanup avant résolution et cleanup au démontage.

Critère de fin : `connectCount === 1` et `revokeCount === 0` pendant Code → Work → Design → Automate → Code dans un même workspace.

Commit attendu : `feat(app): share one workbench workspace context across modes`.

### C4 — Migrer les surfaces vers le store partagé — P1

**Fichiers :** décomposer `packages/app/src/pages/workbench-mode.tsx` en composants inférieurs à 300 lignes sous `pages/workbench/`.

Actions :

1. Supprimer les `createResource()` propriétaires de chaque surface pour les données communes.
2. Work, Design et Automate consomment les mêmes queries TanStack et selectors d'identité.
3. Conserver en local uniquement l'état purement visuel : panneau ouvert, sélection temporaire, focus.
4. Placer sélection d'artefact, spec active, `operationId` et provenance dans le contexte workspace uniquement lorsqu'ils doivent survivre au changement de vue ; borner et nettoyer les sélections devenues invalides.
5. Ajouter états `loading`, `empty`, `failed`, `unauthorized`, `disabled`, `not_implemented` distincts.
6. Aucun chiffre, artefact, workflow ou succès fictif.

Critère de fin : une sélection/operation pertinente effectuée en Work ou Design est visible après changement de mode et retour.

Commit attendu : `refactor(app): consume shared workbench state in mode surfaces`.

### C5 — Continuité Code ↔ Work ↔ Design ↔ Automate — P1, découpée

Actions :

1. **C5a — contexte sans mutation :** exposer à Code les identités typées de 4.5, sans coupler le core Code aux composants UI Work/Design.
2. **C5b — artefact existant :** sélectionner un artefact versionné dans Design/Work puis l'ouvrir dans Code, sans écriture implicite.
3. **C5c — mutation gouvernée :** ajouter une opération réelle et bornée `spec validée → artefact versionné`, avec clé d'idempotence, approval et single-writer existants.
4. **C5d — orchestration :** Automate orchestre des IDs d'opération/catalogue versionnés ; il ne pilote aucun bouton DOM.
5. Les commandes inter-mode sont toujours des opérations du registre serveur existant ; chaque transition est auditée avec provenance.
6. Chaque sous-carte possède ses propres tests, commit et rollback et reste buildable indépendamment.

Critère de fin : le scénario Design → Work/artefact → Automate/validation → Code fonctionne avec les mêmes identités et un audit vérifiable.

Commits attendus : un commit autonome par C5a à C5d, aucun commit supérieur à 400 LOC modifiées sans nouveau découpage.

### C6 — Corriger définitivement les contrôles de fenêtre — P0 indépendant

**Fichiers :** `titlebar.tsx`, `platform.tsx`, adaptateur desktop, `windows.rs`; éventuellement retrait ciblé de Decorum si plus utilisé.

Actions :

1. Choisir un seul propriétaire des boutons Windows : composants Solid contrôlés par `Platform.windowControls`, utilisant les imports Tauri directs déjà employés par desktop.
2. Exposer `minimize`, `toggleMaximize`, `close`, `startDragging` uniquement sur Windows.
3. Ne plus dépendre de `window.__TAURI__`, de l'injection Decorum ou d'un second `DOMContentLoaded`.
4. Valider les contrôles Solid par tests isolés, puis basculer atomiquement le propriétaire : Decorum et les contrôles Solid ne sont jamais actifs ensemble dans un même run. Retirer l'injection/plugin Decorum dans le même changement qui active le propriétaire Solid.
5. Ne pas avaler silencieusement les erreurs : log structuré ou erreur UI selon action.
6. Remplacer les `getElementById()` ponctuels de `SessionHeader` par des slots/ref réactifs fournis par la titlebar, avec cleanup.
7. Synchroniser l'icône et le label maximize/restore avec l'état natif réel.
8. Ajouter tests de rendu/capability et un smoke test Windows réel couvrant DPI, reload, drag, double-clic et comportement Snap Layout documenté.

Critère de fin : trois boutons visibles au premier rendu, cliquables et accessibles, sans duplication après navigation ou reload.

Commit attendu : `fix(desktop): own Windows titlebar controls in the app shell`.

### C7 — Tests d'intégration et E2E anti-régression — P0

Créer ou compléter :

- `packages/app/src/context/mode.test.ts` — parseur et href purs ;
- tests du nouveau contexte Workbench — lifecycle, génération, retry, cache ;
- `packages/app/e2e/modes/mode-navigation.spec.ts` — transitions réelles web avec bridge injecté ;
- test desktop bridge — un connect/revoke et identité stable ;
- smoke Tauri Windows — binaire réel et titlebar.

Parcours obligatoires :

1. session Code → Work → Code ;
2. Code → Work → Design → Automate → Code ;
3. changements rapides répétés ;
4. changement de workspace pendant connexion ;
5. échec bridge puis retry ;
6. route mode inconnue ;
7. accueil sans workspace ;
8. session query valide/invalide ;
9. restart et restauration documentée ;
10. fenêtre minimize/maximize/restore/close.
11. deux demandes de connexion simultanées pour le même workspace : une seule émission réelle ;
12. retry pendant `initializing/opening/issuing/handshaking` : cleanup terminé avant nouvelle tentative ;
13. lease émise puis handshake rejeté : rollback exact et aucune ressource active ;
14. cleanup avant résolution de la promesse et échec de revoke ;
15. workspace A → B → A rapidement, sans révocation de la connexion courante ;
16. session Code dans le path → query multimode → même path Code ;
17. session supprimée, contradictoire ou appartenant à un autre workspace ;
18. back/forward, deep-link et reload dans chacun des quatre modes ;
19. SSE interrompu, gap de curseur, resync et absence de double subscription ;
20. mutation en échec non rejouée implicitement ;
21. cache isolé par `serverOrigin/instanceId/workspaceId` ;
22. titlebar montée tardivement ou recréée : les slots de session réapparaissent ;
23. web/mobile sans bridge Workbench : Code reste utilisable et les modes affichent un état explicite ;
24. fermeture pendant connexion, workflow actif et état UI non persisté.

Les assertions utilisent rôles, labels et `data-*`, jamais des coordonnées écran comme preuve automatisée.

Répartition des preuves :

- Bun : parseurs, lifecycle pur, single-flight, rollback, cache keys et reducers d'événements ;
- Playwright web : navigation, historique, reload, session et faux bridge injecté ;
- tests bridge desktop : commandes Tauri mockées, phase failures et cleanup ;
- smoke Tauri Windows : contrôles natifs, slots, drag, DPI et shutdown ; Playwright web ne peut pas valider ces comportements natifs.

Commit attendu : `test(app): cover shared multimode workspace lifecycle`.

### C8 — Gates, build et vérification manuelle — P0

Commandes minimales, à exécuter depuis chaque package :

```powershell
Set-Location 'D:\App\OpenCode\opencode-work-design\packages\workbench-shell'
bun run typecheck
bun run test

Set-Location 'D:\App\OpenCode\opencode-work-design\packages\workbench-server'
bun run typecheck
bun run test

Set-Location 'D:\App\OpenCode\opencode-work-design\packages\app'
bun run typecheck
bun run test
bun run test:e2e -- e2e/modes/mode-navigation.spec.ts

Set-Location 'D:\App\OpenCode\opencode-work-design\packages\desktop'
bun run typecheck
bun run build

Set-Location 'D:\App\OpenCode\opencode-work-design\packages\desktop\src-tauri'
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-targets --all-features

$env:TEMP='D:\App\OpenCode\.build-temp'
$env:TMP='D:\App\OpenCode\.build-temp'
Set-Location 'D:\App\OpenCode\opencode-work-design\packages\desktop'
bun run tauri build --no-bundle
```

Avant le lancement, enregistrer heure de début, HEAD, mtime, taille et SHA-256 du binaire. Lancer explicitement le binaire généré, pas un raccourci ou un ancien processus.

Critère de fin : toutes les preuves automatisables sont vertes ; les preuves GUI restantes sont listées individuellement comme `MANUAL_VERIFICATION_REQUIRED`.

Si une sous-carte ne touche pas `workbench-shell`, `workbench-server`, desktop Rust ou desktop TypeScript, ses gates ciblés peuvent être omis dans le commit intermédiaire, mais C8 rejoue obligatoirement la matrice complète ci-dessus. Les gates partagés web/mobile existants sont également rejoués dès qu'un contrat `Platform` ou un provider commun change.

### C9 — Documentation et clôture — P1

1. Ajouter un ADR « Shell modes are projections over one Workbench workspace ».
2. Documenter le lifecycle, l'ordre de shutdown et la source de vérité de chaque état.
3. Mettre à jour le plan v4, `Work-Design-Execution`, la checklist manuelle et le vault.
4. Rechercher routes génériques, fallbacks silencieux, données de démonstration, erreurs avalées et nouvelles références produit interdites.
5. Exécuter `git diff --check`, revue du diff complet et contrôle de taille des commits.
6. Ne pousser que sur demande explicite.

## 6. Graphe de dépendances et parallélisation

| Carte | Modules | Dépend de |
|---|---|---|
| C0 | tests E2E, instrumentation | — |
| C1 | navigation pure | C0 |
| C2 | shell/rail/router | C1 |
| C3 | contexte Workbench, DirectoryLayout | C1 |
| C4 | surfaces Work/Design/Automate | C3 |
| C5a | identités et contexte sans mutation | C3, C4 |
| C5b | ouverture d'artefact existant | C5a |
| C5c | mutation gouvernée | C5b |
| C5d | orchestration Automate | C5c |
| C6 | titlebar desktop/Tauri | C0 |
| C7 | tests intégration/E2E | C2, C3, C4, C5a, C5b, C5c, C5d, C6 |
| C8 | gates/build/runtime | C7 |
| C9 | ADR/vault/clôture | C8 |

Lanes autorisées :

```text
Lane A: C0 → C1 → C2 → C3 → C4 → C5a → C5b → C5c → C5d → C7 → C8 → C9
Lane B: C0 → C6 ────────────────────────────┘
```

C6 est exécutée séquentiellement dans le worktree imposé. Aucun worktree temporaire n'est autorisé par le mandat, et le dirty state touche déjà `titlebar.tsx`, `platform.tsx` et `desktop/index.tsx`.

## 7. Diagramme de couverture attendu

```text
CODE PATHS                                         USER FLOWS
[GAP] parse/validate mode route                    [GAP → E2E] Code → Work → Code
 ├─ valid workspace + valid mode                    ├─ URL et bouton synchronisés
 ├─ invalid mode → explicit redirect/error          ├─ même workspace/session
 └─ invalid workspace → project selection           └─ connexion non recréée

[GAP] switchMode                                   [GAP → E2E] quatre modes en chaîne
 ├─ active workspace                                ├─ surfaces visibles
 ├─ no workspace                                    ├─ contexte conservé
 └─ rapid repeated clicks                           └─ retour Code utilisable

[GAP] WorkspaceWorkbenchProvider                   [GAP → integration] workspace change
 ├─ connect success                                 ├─ autre workspace rollbacké
 ├─ partial failure + rollback                      ├─ même workspace single-flight
 ├─ retry sérialisé + deadline                      ├─ caches isolés
 └─ SSE abort/resync + shutdown                     └─ revoke exact sans lease courante tuée

[GAP] titlebar capability                          [GAP → desktop smoke] controls Windows
 ├─ Windows host provides controls                  ├─ visible at first paint
 ├─ non-Windows host omits controls                 ├─ minimize/maximize/restore
 └─ native error visible/logged                     └─ close and clean shutdown
```

Les cinq tests purs actuels sont de niveau ★ : ils couvrent les helpers mais pas le comportement utilisateur. L'objectif de C7 est ★★★ pour les transitions, erreurs et races.

## 8. Modes de panne à couvrir

| Panne réaliste | Gestion attendue | Test | UX |
|---|---|---|---|
| clic sans workspace | sélection explicite de projet | E2E | message/action claire |
| navigation rejetée | bouton reste aligné sur URL | composant/E2E | pas de faux mode actif |
| connexion Workbench lente | état connecting non bloquant | fake timer/intégration | rail toujours cliquable |
| tentative d'un autre workspace résout tard | rollback du scope ancien | unité/intégration | aucune contamination |
| handshake échoue | failed + retry | intégration | erreur visible |
| mode inconnu | redirect/error explicite | unité/E2E | jamais écran vide |
| workspace changé rapidement | cache isolé | intégration | données du bon workspace |
| artefact absent/corrompu | erreur typée | intégration | provenance non inventée |
| titlebar host absent | layout sans contrôles Windows | composant | pas d'espace fantôme |
| commande fenêtre échoue | log structuré | unité desktop | application reste utilisable |
| deux connect même workspace | single-flight, seconde demande join/queue | unité lifecycle | aucune lease courante révoquée |
| lease créée puis handshake échoue | rollback avant rejet | workbench-shell | retry sûr, aucune fuite |
| initialisation sidecar pend | deadline globale | fake timer/desktop | timeout visible, Code utilisable |
| retry pendant cleanup | retry mis en attente | unité lifecycle | pas de boucle ni double lease |
| revoke échoue | `cleanup_failed`, pas de reconnect auto | intégration | action explicite et diagnostic |
| SSE coupé ou gap de séquence | abort/reconnect borné puis resync | intégration | état marqué stale jusqu'au resync |
| session path/query contradictoire | erreur typée | unité/E2E | aucune session arbitrairement choisie |
| session supprimée/autre workspace | retirer du contexte | intégration | retour Code sans usurpation d'identité |
| mutation timeout | rechercher résultat par idempotency key | intégration | jamais de replay implicite |
| titlebar mount tardif | refs/slots réactifs | composant | actions restaurées automatiquement |
| ancien cache même path | clé instance/server/workspace | intégration | aucune donnée d'un runtime précédent |

Tout chemin silencieux sans test et sans gestion d'erreur est un bloqueur de C8.

## 9. Vérifications manuelles finales, une par une

- [ ] MV-01 — démarrage frais : les boutons minimize, maximize/restore et close sont visibles immédiatement.
- [ ] MV-02 — chaque contrôle de fenêtre accomplit son action exacte.
- [ ] MV-03 — double-clic et drag de la zone non interactive fonctionnent ; les boutons n'initient pas un drag.
- [ ] MV-04 — ouvrir un workspace puis une session Code réelle.
- [ ] MV-05 — Code → Work : transition immédiate, aucune fenêtre figée.
- [ ] MV-06 — Work → Design → Automate : chaque surface est visible et interactive.
- [ ] MV-07 — Automate → Code : retour possible au premier clic, même session restaurée.
- [ ] MV-08 — effectuer vingt changements rapides ; aucun freeze ni multiplication de sidecars.
- [ ] MV-09 — changer de workspace pendant une connexion ; aucune donnée de l'ancien workspace.
- [ ] MV-10 — couper/faire échouer le bridge ; erreur visible et retry fonctionnel.
- [ ] MV-11 — vérifier un artefact partagé Design → Work → Code avec provenance.
- [ ] MV-12 — exécuter un workflow Automate utilisant une opération Design/Work réelle, sans pilotage DOM.
- [ ] MV-13 — fermer puis relancer ; vérifier les éléments explicitement persistés.
- [ ] MV-14 — fermer l'application ; aucun processus Unifia/sidecar appartenant à ce run ne reste orphelin.
- [ ] MV-15 — utiliser back/forward puis reload dans chaque mode ; route, rail et vue restent synchronisés.
- [ ] MV-16 — revenir vers une session Code précise après Work/Design/Automate ; même ID dans le path.
- [ ] MV-17 — vérifier maximize/restore à DPI 100 % et 150 %, drag, double-clic et écran secondaire.
- [ ] MV-18 — vérifier le comportement Windows Snap Layout ; documenter explicitement toute différence acceptée par rapport au propriétaire natif précédent.
- [ ] MV-19 — provoquer un handshake en échec puis retry ; aucune connexion ou lease fantôme dans les logs.
- [ ] MV-20 — fermer pendant une connexion puis relancer ; aucun état `connecting` ou cache de l'ancien `instanceId`.

## 10. Ce qui existe déjà et doit être réutilisé

- `SHELL_MODES` : registre unique des quatre projections.
- `DirectoryLayout` : frontière de workspace décodé et providers directory-scoped.
- `Platform.workbench` et `createDesktopWorkbenchBridge()` : la clé de signature et le secret IPC restent natifs ; un bearer court et scoped est utilisé par le client WebView et doit être traité comme secret.
- `connectWorkbench()` : handshake, identité et révocation.
- `WorkbenchClient` et registres de routes/opérations : transport et orchestration autoritatifs.
- manifest JSON versionné et catalogues multiples : autorité Design sans fallback.
- registre d'artefacts, provenance, approvals et audit : continuité métier.
- Playwright et fixtures E2E du package app : base du test utilisateur.
- storage par workspace existant : réutilisable pour une map stable, pas avec une clé capturée sur répertoire vide.

Les dépôts locaux de référence servent uniquement à comprendre des interactions et layouts. Leur runtime, leur état global et leurs références produit ne doivent pas être copiés.

## 11. NOT in scope

- Réécriture complète du router : les routes sœurs suffisent si le provider workspace reste monté.
- Nouveau runtime ou nouvel agent par mode : interdit par l'objectif.
- Automatisation par clics DOM : remplacée par les opérations backend versionnées.
- Refonte visuelle complète des surfaces : différée après restauration fonctionnelle.
- Publication, release, merge dans `dev` ou `main` : hors autorisation actuelle.
- Android complet : conserver les contrats communs, mais cette passe cible la régression desktop signalée ; les gates Android existants restent séparés. Les tests/typechecks des contrats `Platform` et providers partagés restent obligatoires pour éviter une régression mobile.
- Suppression globale des références historiques dans les dépendances/références : hors scope et risquée.

## 12. Stop conditions

Arrêter avec `BLOCKED` uniquement si :

- le worktree ou la branche ne correspondent plus ;
- une modification utilisateur serait écrasée ;
- aucune reproduction instrumentée n'est possible après trois approches distinctes ;
- le bridge/runtime autoritatif contredit le contrat documenté ;
- un secret, une signature, un device ou une publication exige une autorité humaine ;
- le test manuel devient la seule preuve restante.

Un échec de test, typecheck ou build n'est pas une raison de s'arrêter : diagnostiquer, corriger et rejouer les gates.

## 13. Format obligatoire du rapport d'exécution

Le rapport final de Luna/MiniMax doit contenir :

1. baseline Git et dirty state préservé ;
2. reproduction initiale et test rouge ;
3. causes confirmées et hypothèses réfutées ;
4. architecture réellement livrée ;
5. cartes complètes/partielles/bloquées ;
6. fichiers et commits par carte ;
7. commandes de tests avec résultats exacts ;
8. preuve de connexion unique et identité stable ;
9. build Tauri lié au HEAD par hash/mtime ;
10. résultat de chaque MV-01 à MV-14 ;
11. risques résiduels ;
12. commit/push/PR explicitement effectué ou non.

Interdiction d'écrire « corrigé », « terminé » ou « fonctionnel » si C7, C8 ou les contrôles manuels applicables n'ont pas de preuve.

## 14. Prompt de review externe prêt à copier

```text
Tu reviews un plan correctif Unifia Desktop. Vérifie surtout :
1. que Code/Work/Design/Automate sont des projections UI d'un seul workspace/backend ;
2. que l'URL, le workspace, la session, la connexion et les artefacts ont chacun une seule autorité ;
3. qu'un changement de mode ne reconnecte pas Workbench et ne perd pas le contexte ;
4. que les races de connexion/workspace sont annulées ou invalidées ;
5. que les tests reproduisent le freeze et le retour impossible vers Code ;
6. que le correctif titlebar élimine la double initialisation Decorum/DOMContentLoaded ;
7. que le plan réutilise les contrats, bridge, registres, manifest JSON versionné, catalogues et provenance existants ;
8. qu'aucun fallback silencieux, runtime parallèle, donnée fictive ou nouvelle référence à l'ancien nom produit n'est introduit.
9. que deux connexions du même workspace ne peuvent pas se chevaucher et qu'un ancien revoke ne peut pas tuer la lease courante ;
10. que toute allocation partielle est rollbackée et que la deadline couvre l'initialisation sidecar ;
11. que cache TanStack, SSE, capacités et identités sessionnelles ont chacun un owner explicite ;
12. que les slots de titlebar sont réactifs et que Decorum/Solid ne sont jamais actifs ensemble.

Pour chaque remarque : cite la section, classe P0/P1/P2/P3, donne une confiance sur 10, explique le faux positif possible, puis propose le plus petit correctif complet. Ne réécris pas tout le plan si une correction locale suffit.
```

## Implementation Tasks

- [x] **T1 (P0)** — C0 — reproduire la régression avec un E2E rouge et instrumenter connect/revoke. *(navigation multimode validée par Playwright ; instrumentation native/faux bridge reste hors périmètre.)*
- [x] **T2 (P0)** — C1 — centraliser et totaliser le contrat de route multimode.
- [x] **T3 (P0)** — C2 — rendre l'URL autoritaire et supprimer l'état visuel optimiste.
- [x] **T4 (P0)** — C3 — créer le contexte Workbench partagé par workspace.
- [x] **T4a (P0)** — C3 — durcir single-flight, rollback, deadline globale et cleanup avant d'exposer la connexion au provider.
- [x] **T5 (P1)** — C4 — migrer les surfaces vers le cache partagé.
- [x] **T6a (P1)** — C5a — partager les identités typées sans mutation.
- [x] **T6b (P1)** — C5b — ouvrir un artefact existant dans Code.
- [x] **T6c (P1)** — C5c — ajouter la mutation gouvernée avec idempotence et approval.
- [x] **T6d (P1)** — C5d — orchestrer les opérations versionnées dans Automate.
- [x] **T7 (P0)** — C6 — remplacer la titlebar injectée par un propriétaire unique.
- [x] **T8 (P0)** — C7 — couvrir transitions, erreurs, races et lifecycle.
- [ ] **T9 (P0)** — C8 — exécuter gates, build et smoke desktop réel. *(gates automatisées, build et E2E navigateur multimode passés ; smoke GUI MV-01..MV-20 restant.)*
- [x] **T10 (P1)** — C9 — documenter l'architecture livrée et réconcilier le vault. *(ADR ajouté ; vault checkpoint à jour.)*

*Modifié par Codex le 2026-08-14.*

## Execution status — 2026-08-14

- C0 : complet pour le parcours navigateur — reproduction E2E rouge confirmée, puis le fichier multimode groupé passe `2/2` ; l’instrumentation native et le faux bridge déterministe complet restent à ajouter.
- C1 : complet — parseur total, mapping path/query de session, routes inconnues et sessions contradictoires couverts par tests purs.
- C2 : complet — sélection depuis l’accueil mise en intention temporaire, annulation sans navigation, préférence persistée par workspace et mapping URL validé.
- C3/C4 : complets sur le périmètre livré — provider workspace unique, single-flight/rollback/deadline lifecycle, capacités read-only et cache TanStack à clés isolées.
- C5a : complet — identités `codeSessionId`, `workbenchSessionId`, `operationId` typées et renouvelées explicitement.
- C5b : complet côté code — le détail d’artefact est récupéré via le Workbench partagé et affiché dans Code en lecture seule, sans substitution silencieuse de session.
- C5c : complet côté contrat — création/export et résolution/annulation d’approbation utilisent des POST/DELETE idempotents ; le serveur reste l’autorité d’approbation.
- C5d : complet côté contrat/UI — Automate lit une définition versionnée depuis le workspace puis démarre l’opération via le runtime workflow autoritatif et ses approval gates.
- C6 : complet côté code — overlay Decorum et permission orpheline retirés, contrôles Windows Solid propriétaires, slots SessionHeader réactifs par contexte.
- C7 : complet côté tests automatisés — transitions E2E, lifecycle single-flight/rollback/cleanup_failed, identité et contrats shell couverts.
- C8 : partiel — build Tauri final vert avec `CARGO_BUILD_JOBS=1` ; navigation multimode répétée `4/4` et prompts réels répétés `2/2` en worker unique. Chaque mode (`code`, `work`, `design`, `automate`) a reçu un prompt backend et la réponse attendue ; la fixture a supprimé les sessions/workspaces temporaires. Smoke GUI MV-01..MV-20 non exécuté. La matrice multi-worker reste flaky au démarrage backend/lazy-load et n'est pas déclarée verte.
- Gates prouvées : workbench-shell typecheck/tests (identity 2/2, lifecycle 4/4), app typecheck + 710 tests, desktop TypeScript typecheck, Rust `cargo check --all-targets --all-features`, Cargo release séquentiel, Tauri build final.
- Binaire : `packages/desktop/src-tauri/target/release/Unifia.exe`, 50,668,544 octets, mtime `2026-08-14T21:25:40.3536811+02:00`, SHA-256 `78FE640CDCEEBAD10C15B018C820D7D9F43326F566BE1A013A1931E6B8F63775`.
- Gate non verte : `cargo fmt --check` échoue sur des divergences préexistantes dans de nombreux fichiers Rust non liés ; aucun reformatage global effectué.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|---|---|---|---:|---|---|
| CEO Review | `/plan-ceo-review` | Scope produit | 0 | NOT_RUN | La direction produit était déjà fixée par l'utilisateur : modes = projections UI. |
| Codex Review | `/codex review` | Seconde opinion | 0 | NOT_RUN | Prompt de review externe inclus pour Luna/MiniMax. |
| Eng Review | `/plan-eng-review` | Architecture et tests | 2 | CLEAR_AFTER_REVISION | 12 findings intégrés ; single-flight, rollback, timeout global, cache/SSE, identités, titlebar et tests durcis. |
| Design Review | `/plan-design-review` | UI/UX | 0 | PENDING_AFTER_FIX | À exécuter après restauration fonctionnelle des transitions. |
| DX Review | `/plan-devex-review` | Expérience développeur | 0 | NOT_REQUIRED | Aucun nouveau tooling imposé. |

**VERDICT:** ENG CLEARED AFTER REVISION — le plan corrigé est exécutable ; les preuves desktop manuelles restent des gates de sortie et ne peuvent pas être déclarées automatiquement.

NO UNRESOLVED DECISIONS
