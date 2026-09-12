# BLOCKED DECISIONS — décisions en attente

Décisions que l'agent ne peut PAS trancher seul et qui bloquent l'exécution. **À fournir par l'utilisateur avant le passage à l'exécution carte par carte.**

## BD-1 — Plan Directeur V3 Unifia Workbench

**Statut :** ✅ **RÉSOLU — Plan capturé** depuis Obsidian le 2026-07-31.
**Source :** `/vault/OpenCode/Plan-directeur-V3-Unifia-WorkBench-OpenWork-OpenCowork.md` (49 575 bytes, 2149 lignes, 187 sections).
**Snapshot local :** `docs/autonomy/PLAN-DIRECTEUR-V3.md`.
**Structure :** 22 phases (Phase -2 à Phase 19) + 3 gates (A, B, C) + 19 sections thématiques.
**Verdict :** mon TASK-GRAPH DRAFT précédent était sous-dimensionné — il ne couvrait que la Phase 0 (rebrand cosmétique). Le plan réel est un programme 6 mois solo / 3 mois équipe couvrant réécriture runtime, sécurité, capabilities, mobile, web, release.

**Conséquence opérationnelle :** je réécris le TASK-GRAPH en v1.0 aligné sur les 22 phases du plan. J'exécute Phase -2 (audit licences, 100% documentaire) sans décision utilisateur. À partir de la Phase 0, je m'arrête pour validation.

## BD-2 — packages/enterprise/ : EXCLUDE par défaut

**Statut :** `VIOLATED` — rebrand partiel accidentel
**Sévérité :** MOYENNE
**Risque :** Possible contamination de code propriétaire non documenté.
**Action requise :** confirmer EXCLUDE (par défaut) ou AUDIT_LICENSE_FIRST.
**Note :** le Plan V3 §3.1 (matrice d'adoption OpenWork) ne mentionne pas enterprise → cohérent avec EXCLUDE.

**Violation constatée (2026-07-31) :** lors de P0-C003 (rename packages workspaces) puis P2-C090e (openapi specs), `packages/enterprise/package.json` a été partiellement rebrandé :
- `@unifia/enterprise` → `@unifia/enterprise` (P0-C003, cohérent avec workspaces)
- `OPENCODE_DEPLOYMENT_TARGET` → `UNIFIA_DEPLOYMENT_TARGET` (P2-C090e, env var)

**Décision prise :** la restauration complète casserait le workspace (le package n'existerait plus sous son ancien nom). On documente la violation et on attend décision utilisateur :
- Option A : restaurer (mais casser workspace)
- Option B : accepter le rebrand et basculer enterprise/ en INCLUDE (modifier BD-2)
- Option C : exclure enterprise/ de tous les futurs rebrand via une whitelist `enterprise/`

## BD-3 — packages/desktop-electron/ : DEPRECATE

**Statut :** `DEFERRED` (par défaut DEPRECATE)
**Sévérité :** MOYENNE
**Action requise :** confirmer DEPRECATE (par défaut, ajout README) ou REBRAND comme la version Tauri.
**Note :** le Plan V3 §2.2 parle d'« enfermement Electron » comme risque → cohérent avec DEPRECATE.

## BD-4 — Tauri identifier macOS

**Statut :** `NEEDS_EXTERNAL_E2`
**Sévérité :** HAUTE
**Question :** Le passage de `ai.opencode.desktop.dev` à `ai.unifia.workbench.dev` nécessite une re-certification macOS (Developer ID Apple). Faut-il acheter un nouveau Developer ID Unifia ou conserver l'ancien ? Coût ~$99/an.
**Action requise :** décision budget + certif.
**Note :** le Plan V3 §6.1 prévoit `Rwanbt/unifia` comme fork OpenCode → l'identifier macOS doit s'aligner.

## BD-5 — Couverture i18n du rebrand

**Statut :** `OPEN`
**Sévérité :** FAIBLE
**Question :** faut-il traduire les libellés dans les 21 langues existantes (84 fichiers racine + 21 i18n desktop = 105 fichiers) ou seulement mettre à jour les chaînes en-US ?
**Recommandation :** mettre à jour toutes les langues existantes (cohérence), ne PAS introduire de nouvelles langues.
**Note :** le fork a déjà une session `Session-2026-07-17-i18n-Fork-16-Locales-Complet.md` → l'i18n est mature, ne pas casser.

## BD-6 — Provider MiniMax (M3) en provider de premier plan

**Statut :** `OPEN`
**Sévérité :** MOYENNE
**Question :** Unifia doit-il être listé dans `packages/unifia/src/provider/` comme provider natif, ou rester externe ?
**Recommandation :** provider natif (cohérence avec le fait que ce pack utilise MiniMax M3).
**Note :** le Plan V3 §5 confirme « Providers et modèles = Unifia Core » → cohérent avec provider natif.

## BD-7 — Stratégie de remotes upstream (NOUVEAU, issue Plan V3 §12)

**Statut :** `OPEN`
**Sévérité :** HAUTE
**Question :** le Plan V3 §12 (Phase 0) définit 4 remotes :
- `upstream-opencode` (Rwanbt/unifia ou anomalyco/opencode ?)
- `upstream-openwork` (URL à fournir)
- `upstream-open-cowork` (URL à fournir)
- `origin-unifia` (Rwanbt/unifia — nouveau repo à créer ?)

**Action requise :** confirmer les URLs upstream pour OpenWork et Open Cowork (BD-7a), et confirmer la création du repo `Rwanbt/unifia` (BD-7b).

## BD-8 — Accès aux codebases OpenWork et Open Cowork (NOUVEAU, bloquant Phase -1)

**Statut :** ✅ **RÉSOLU** — utilisateur a copié les clones dans `/opt/data/projets/` (openwork-dev/, open-cowork-main/) le 2026-07-31. Clones upstream également verrouillés en bare dans `/opt/data/work/unifia-sandbox/upstreams/`.

## BD-9 — Licence du snapshot i18n utilisateur (NOUVEAU, bloquant Phase 7)

**Statut :** `BLOCKED_MISSING_LICENSE`
**Sévérité :** BLOQUANT pour P7-I18N-MIGRATION
**Question :** le snapshot `.i18n-work/` (16 langues, 325 fichiers, 11 660 clés) n'a pas de licence explicite. Avant toute intégration dans Unifia, l'utilisateur doit confirmer la licence (typiquement : "MIT,Copyright Erwan" ou "CC-BY-SA" ou "domaine public").
**Action requise :** déclarer la licence du snapshot.
**Note :** l'intégration dans le fork Unifia (MIT) suppose une licence compatible.


## BD-10 — Pont Feishu — ✅ **CLOS le 2026-08-06 par suppression**

**Décision utilisateur :** supprimer, ne pas configurer.

**Raisonnement :** le mode remote de l'app mobile couvre déjà le besoin de pilotage
à distance. Une messagerie externe n'apporte rien et **ajoute une surface d'attaque**.

**Ce qu'était réellement cette route :** le guichet de support du projet **amont**.
`POST /feishu` relayait un message Feishu dans un canal **Discord de support** avec
un token de bot. C'est de la plomberie héritée du fork, câblée vers un Discord qui
n'appartient pas à l'utilisateur — pas une fonctionnalité de l'application.

**Supprimé :**
- la route `POST /feishu` (`packages/function/src/api.ts`) ;
- `feishu-remote-adapter.ts` et sa suite de tests ;
- `getFeishuTenantToken()` — **déjà du code mort** avant cette session, défini et jamais appelé ;
- les secrets `FEISHU_APP_ID`, `FEISHU_APP_SECRET`, `FEISHU_ENCRYPT_KEY` ;
- les secrets `DISCORD_SUPPORT_BOT_TOKEN` et `DISCORD_SUPPORT_CHANNEL_ID`, devenus
  morts avec la route — un token de bot lié à un Worker est un token qui fuit si le
  Worker est compromis.

**Conservé volontairement :** `@unifia/remote-bridge`. C'est une **bibliothèque**,
sans point d'entrée réseau : elle n'écoute rien et ses transports sont **désactivés
par défaut**. Elle porte la chaîne de sécurité du §22 (signatures réelles,
anti-rejeu, appairage côté hôte, révocation) et reste la preuve de la Phase 9. La
surface d'attaque supprimée était l'**endpoint HTTP vivant**, pas le code de
vérification.

## BD-11 — Renommage de l'identifiant Android `ai.opencode.mobile` (NOUVEAU, reliquat Phase 0)

**Statut :** ✅ **RÉSOLU** le 2026-08-06 — identifiant `ai.unifia.mobile` choisi par l'utilisateur, renommage appliqué, build vérifié et **validé sur Mi 10 Pro** (`LlamaEngine initialized` sans `UnsatisfiedLinkError`, toolchain migré fonctionnel).
**Sévérité :** non bloquant pour le reste du plan — bloquant pour « Phase 0 terminée ».

**Ce qui reste :** `packages/mobile/src-tauri/tauri.conf.json` déclare encore
`"identifier": "ai.opencode.mobile"`. Le desktop a été rebrandé (`ai.unifia.workbench.dev`),
le mobile non.

**Pourquoi ce n'est pas un simple remplacement de chaîne :** le renommage touche
~25 fichiers Kotlin suivis, les **chemins de répertoire de paquet**
(`app/src/main/java/ai/opencode/mobile/`), le nom de bibliothèque JNI
`opencode_mobile_lib` (`Cargo.toml` + trois `System.loadLibrary`), le thème
`Theme.opencode_mobile`, et surtout des chemins **codés en dur** dans `LlamaEngine.kt` :

```
/data/data/ai.opencode.mobile/runtime/.native_lib_dir
/data/user/0/ai.opencode.mobile/runtime/.native_lib_dir
```

**Le vrai danger :** l'`applicationId` détermine le répertoire de données sur l'appareil.
Un renommage qui manque ces chemins **compile parfaitement**, passe le typecheck, et casse le
runtime LLM **seulement sur un vrai téléphone**. De plus, changer l'`applicationId` fait
installer l'APK comme une **application différente** — les données de l'utilisateur sur
l'appareil actuel ne sont pas migrées.

**Action requise avant de l'appliquer :**
1. Confirmer l'identifiant cible (`ai.unifia.mobile` ? `ai.unifia.workbench.mobile` ?).
2. Confirmer que la perte des données de l'app mobile actuelle sur l'appareil est acceptée,
   ou décider d'une procédure de migration.
3. Après renommage : `bun tauri android build --target aarch64` avec `ORT_LIB_LOCATION`,
   puis vérifier **sur appareil** que le chargement d'un modèle local fonctionne encore
   (c'est le seul chemin qui exerce les chemins codés en dur).

**Pourquoi ce n'est pas fait ici :** aucune de ces trois vérifications ne peut être produite
depuis cette session sans l'appareil et sans la décision de l'utilisateur sur la perte de
données. Le faire à l'aveugle produirait un changement qui a l'air correct dans le diff et
qui casse en production.

## BD-12 — Vérification du DockerDriver en exécution réelle (NOUVEAU, reliquat Phase 8)

**Statut :** ✅ **RÉSOLU** le 2026-08-05 — daemon démarré sur autorisation explicite de l'utilisateur, `DockerDriver` vérifié en exécution réelle (`SandboxDrivers` 40/40).
**Sévérité :** faible — la propriété que le §35 exige est déjà prouvée.

`NativeRestrictedDriver` et `Wsl2Driver` sont vérifiés **en exécution réelle**.
`DockerDriver` ne l'est pas : le daemon n'est pas lancé sur cette machine
(`npipe:////./pipe/dockerDesktopLinuxEngine` introuvable).

**Ce qui est déjà prouvé sans daemon :** la propriété du §35 — *aucun repli
silencieux*. Docker absent lève `SandboxUnavailableError` au lieu de se rabattre
sur le backend natif. C'est la garantie de sécurité ; l'exécution réelle
vérifierait le confinement, pas le refus.

**Action requise :** démarrer Docker Desktop, puis relancer
`cd packages/sandbox-drivers && bun test/drivers.test.ts`. Le driver n'a pas été
lancé automatiquement ici : démarrer une application lourde sur la machine de
l'utilisateur sans qu'il l'ait demandé n'est pas une action à prendre seul.

**Lima :** `NON FAIT`, et ne peut pas l'être ici — Lima est macOS uniquement.
