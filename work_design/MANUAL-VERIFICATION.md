# Vérifications manuelles restantes

Cette liste est la source de vérité des contrôles qui nécessitent une machine, un appareil, une interaction UI ou une décision humaine. Aucun item ne doit être marqué `PASS` sur une simple compilation.

| ID | Gate | Procédure | Preuve attendue | Statut |
|---|---|---|---|---|
| MV-01 | Bridge natif desktop | Construire le profil debug, lancer l’application Tauri et ouvrir un mode Work avec un workspace réel. Observer l’appel natif qui fournit le jeton court ; vérifier qu’aucun secret maître n’est présent dans le JS, le local storage, l’URL ou les logs. | Capture des appels/console filtrée + chemin du build + résultat d’inspection du stockage. | `PENDING` |
| MV-02 | Rotation desktop | Maintenir un flux SSE ouvert, déclencher la rotation du jeton, vérifier l’état `rotating`, la mise en attente des sorties, l’acceptation temporaire de l’ancien jeton puis son refus après la grace period. | Trace horodatée : ancien/nouveau jeton redacted, événements de rotation, requête après expiration refusée. | `PENDING` |
| MV-03 | Android runtime | Installer le build debug Android sur un appareil identifié, ouvrir Work puis Design, revenir en arrière-plan et au premier plan. Vérifier l’absence de second runtime et la reprise du flux. | `adb` package/version, `lastUpdateTime`, captures des deux modes, trace de reprise. Installation et démarrage ont été observés sur `b7163823`; le parcours Work/Design et le cycle arrière-plan/reprise restent à prouver. | `PENDING` |
| MV-04 | Android SVG inert | Dans le WebView Android réel, charger un SVG via `<img src="data:…">` contenant un texte, un token de couleur et une tentative de script/ressource externe. Vérifier rendu, inertie et absence de requête externe. | Capture écran + log réseau/WebView ; le script et la ressource externe ne s’exécutent pas. | `PENDING` |
| MV-05 | Mobile write safety | Depuis Android, tenter une écriture Work/Design avec un compte de test et vérifier le refus par défaut ; vérifier qu’une approbation explicite seule permet l’action prévue. | Requête, statut, écran d’approbation, audit redacted. | `PENDING` |
| MV-06 | Navigation UI | Tester le rail Code/Work/Design/Automate, les deep links et le mode persistant après fermeture/réouverture pour deux répertoires distincts. | Matrice chemin → mode affiché, captures et absence de requête réseau sur le changement de mode. | `PENDING` |
| MV-07 | Crash/restart | Arrêter brutalement le service local pendant une session, relancer l’application, vérifier l’identité d’instance, la reprise du workspace et l’absence de contamination d’un ancien worktree. | Logs de deux instances, workspace IDs, résultat de reprise et absence de trace orpheline. | `PENDING` |
| MV-08 | Port et single-writer | Lancer deux instances sur le port configuré, puis avec port automatique ; vérifier qu’une seule devient propriétaire et que l’autre échoue proprement. | Sortie des deux processus, port effectivement lié, erreur attendue et arrêt propre. | `PENDING` |
| MV-09 | CSP | Vérifier dans les builds desktop et Android que `connect-src` autorise uniquement les origines prévues pour le bridge et le loopback, que `img-src` accepte `data:`, et que `object-src`/frames restent bloqués. | Garde statique `scripts/check-workbench-security.mjs` PASS ; CSP extraite des bundles empaquetés et test manuel des URLs autorisées/interdites restent requis. | `PENDING` |
| MV-10 | Publication gate | Avant toute PR/merge, relire la checklist, inspecter le diff, vérifier licences/SPDX, migrations/rollback et confirmer explicitement qu’aucune publication n’est demandée. | Validation humaine signée dans le checkpoint ; aucun push/merge automatique. | `PENDING` |

## Règle de mise à jour

- `PENDING` → `PASS` uniquement avec la preuve décrite.
- `PENDING` → `BLOCKED` si l’environnement ou l’autorisation manque ; noter la cause et ne pas contourner.
- Les secrets, certificats, tokens et captures doivent être redacted avant archivage.

## Observations appareil — 2026-08-14

- Appareil détecté : `b7163823` — Xiaomi Mi 10 Pro (`adb devices -l`).
- Copie locale signée avec `C:\Users\barat\.android\debug.keystore` : signature APK v2/v3 vérifiée ; l’APK source reste unsigned et inchangé.
- Installation : package `ai.unifia.mobile`, version `0.1.0`, `lastUpdateTime=2026-08-14 09:43:38`.
- Runtime : `ai.unifia.mobile/.MainActivity` résumée au premier plan ; les logs montrent `/global/health` complété avec `healthy=true`, version `local` et port loopback `127.0.0.1:14096`.
- Capture locale : `D:\App\OpenCode\.build-temp\unifia-device-proof-2.png` montre l’application Unifia avec le sélecteur « Ouvrir un projet » et le runtime disponible.
- Sous-test lifecycle : PID `6866` avant/après la relance et `MainActivity` résumée ; l’injection réelle de `KEYCODE_HOME` a été refusée par MIUI (`SecurityException`, permission `INJECT_EVENTS` manquante), donc le passage arrière-plan n’est pas prouvé.
- CSP statique : `packages/desktop/src-tauri/tauri.conf.json` et `packages/mobile/src-tauri/tauri.conf.json` déclarent des origines explicites, `img-src data:`, `object-src 'none'` et `frame-ancestors 'none'`; le runtime `packages/unifia/src/server/instance.ts` reste limité à `self data:` pour `connect-src`. L’extraction des bundles empaquetés et les essais URL restent requis pour MV-09.
- Statut inchangé : MV-03 et MV-04 restent `PENDING`, car l’observation n’a pas encore couvert tout le parcours Work/Design, arrière-plan/reprise et le test SVG inert demandé.
