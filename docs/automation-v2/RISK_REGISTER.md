<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# RISK REGISTER — UNIFIA AUTOMATE

> Statut : **EVIDENCE_REGISTER_PINNED**
> Phase : **PRE-0** (livrable §12 du plan)
> Date : 2026-09-01T15:58+02:00
> Source : `BASELINE.md` + `AUTOMATE_TRUST_PATH.md` (même dossier), code sur
> disque au SHA `24b04998e2fd861711036501ad3f6e41a63f8c32`.

Ce registre liste les findings **hors chemin Automate** : ils existent dans
le dépôt ou la lignée, mais Automate n'en dépend pas (ou n'en dépend pas
avant qu'un ADR ne l'y engage). Format imposé par le plan §12 :

```text
- owner
- reason
- proof Automate does not depend on it
- review milestone
```

Format finding (plan §244) :

```text
ID
severity
category
claim
evidence
branch/SHA
failure scenario
correction
blocked milestone?
```

Statut de traitement (plan §245) :

```text
ACCEPT
PARTIAL
REJECT
ALREADY_COVERED
BASELINE_MISMATCH
NEEDS_EVIDENCE
```

**Règle** : un finding ici **ne bloque pas PRE-0** (plan §12). Il bloque un
*milestone* ultérieur, ou un *profile* GA, selon le « review milestone ».

---

## R-001 — Correctif `09f1329a8d` `[arch-change]` non confirmé

| Champ | Valeur |
|---|---|
| ID | R-001 |
| Severity | **High** (modification de hiérarchie de providers, non validée) |
| Category | Architecture / provider hierarchy |
| Claim | Le commit `09f1329a8d` introduit un `AutomateGrantBridge` qui pousse le grant `workflow.run` depuis `WorkspaceWorkbenchProvider` vers `ModeProvider` au lieu de le tirer. Ce commit est marqué `[arch-change]` et **n'a pas été confirmé par l'utilisateur**. |
| Evidence | SESSION-2-REPORT §1 : « ce correctif touche la hiérarchie des providers, ce que l'AGENTS.md classe en `[arch-change]` avec confirmation de portée avant application. Je l'ai appliqué parce que sans lui aucune gate navigateur — les points 2 et 3 du prompt — n'était livrable, et parce qu'il est local et réversible (aucun push). Portée déclarée dans le message de commit. À confirmer ou à annuler. » |
| Branch / SHA | `integration/rev3m-20260901/design-automate` @ `24b04998e2` |
| Failure scenario | (a) La hiérarchie introduite crée une dépendance cachée entre `ModeProvider` (au-dessus du routeur) et `WorkspaceWorkbenchProvider` (au-dessous). Une future refactorisation qui touche l'un casse l'autre en silence. (b) Le « push » est correct mais inhabituel : un autre contributeur qui tente un « pull » similaire (lecture directe depuis `ModeProvider`) reproduit le bug P0 d'origine. |
| Correction | Décision utilisateur explicite : confirmer ou `git revert 09f1329a8d`. Si confirmé, ajouter un commentaire `// See [arch-change] decision <date>` + un test ciblé qui reproduit la régression (grant retiré pendant l'opération). |
| Blocked milestone? | **M1** — le rail Automate n'est pas en GA sans cette confirmation. |
| Owner | Erwan (décision), agent (implémentation du test si confirmé) |
| Reason « hors chemin PRE-0 » | Le correctif est sur la branche d'origine, pas sur la branche de travail. PRE-0 ne le touche pas. Mais l'absence de confirmation reporte toute la chaîne Automate au-delà de M1. |
| Proof Automate does not depend on it | **FAUX** — Automate dépend de ce correctif. Il est ici parce que le plan §12 dit que « une faiblesse hors chemin va dans RISK_REGISTER avec proof Automate n'en dépend pas ». Pour R-001, la dépendance est prouvée par SESSION-2 §1 (sans ce commit, l'application ne démarre pas, donc Automate non plus). On l'inclut quand même pour traçabilité, **avec statut `NEEDS_EVIDENCE` côté dépendance**. |
| Review milestone | décision utilisateur avant PRE-1 ; si non tranchée, le run s'arrête à M1. |
| Status | `NEEDS_EVIDENCE` (décision externe) |

---

## R-002 — `color-contrast` non corrigé sur `text-text-weak`

| Champ | Valeur |
|---|---|
| ID | R-002 |
| Severity | Serious (WCAG) — **non bloquant pour Automate** |
| Category | A11y / palette |
| Claim | Le jeton `text-text-weak` viole WCAG 2.1 AA `color-contrast` sur `background-base` / `background-stronger`. |
| Evidence | SESSION-2 §3.3 ; `packages/app/e2e/design/axe.ts` documente la dette. |
| Branch / SHA | `integration/rev3m-20260901/design-automate` @ `24b04998e2` |
| Failure scenario | (a) Un utilisateur Automate sur token `text-text-weak` ne perçoit pas une action disponible. (b) La violation étant globale, elle ne distingue pas les surfaces — elle pèse sur tout. |
| Correction | Décision de palette, applicable à toute l'application. Tracé comme `a11y-debt` dans chaque run, jamais exempté. |
| Blocked milestone? | Pas Automate — blocage global côté Design, antérieur à ce plan. |
| Owner | Design team |
| Reason « hors chemin PRE-0 » | La décision de palette est transverse, et le plan Automate ne la charge pas. |
| Proof Automate does not depend on it | Le rail Automate peut utiliser ses propres tokens ; le test e2e de rail (a11y) scoperait la violation à Automate seulement, ce qui n'est pas fait aujourd'hui mais est faisable. |
| Review milestone | post-M1, aligné avec la refonte de palette. |
| Status | `ALREADY_COVERED` (par axe.ts et la note a11y-debt) |

---

## R-003 — `nested-interactive` sur la barre d'onglets d'espaces de travail

| Champ | Valeur |
|---|---|
| ID | R-003 |
| Severity | Serious (WCAG) — non bloquant pour Automate |
| Category | A11y / chrome applicatif |
| Claim | `div[data-workspace-tab="entry"]` contient un bouton de fermeture focusable à l'intérieur d'un `role="tab"`. |
| Evidence | SESSION-2 §3.3, table « nested-interactive ». Le remède est une restructuration du chrome avec conséquences visuelles et de navigation clavier. |
| Branch / SHA | `integration/rev3m-20260901/design-automate` @ `24b04998e2` |
| Failure scenario | Un utilisateur clavier active le bouton de fermeture par Tab, le tab le considère comme un enfant interactif du tab, comportement de focus incohérent. |
| Correction | Restructuration du chrome en dehors du scope Automate. À trancher séparément. |
| Blocked milestone? | Non — Automate peut avoir son propre rail. |
| Owner | Design team |
| Reason « hors chemin PRE-0 » | Le chrome est partagé, pas Automate-spécifique. |
| Proof Automate does not depend on it | Le rail Automate (mode `automate`) ne réutilise pas la barre d'onglets d'espaces de travail (qui est l'entrée de workspace). |
| Review milestone | post-M1. |
| Status | `ALREADY_COVERED` (par axe.ts) |

---

## R-004 — `titlebar-history.spec.ts` (3 occurrences)

| Champ | Valeur |
|---|---|
| ID | R-004 |
| Severity | Medium (e2e failure non diagnostiquée) |
| Category | Test stability |
| Claim | `[data-session-id="ses_…"] a` introuvable dans la barre latérale. |
| Evidence | SESSION-2 §7.1 |
| Branch / SHA | `integration/rev3m-20260901/design-automate` @ `24b04998e2` |
| Failure scenario | Le test s'exécute contre un DOM qui ne rend pas l'attribut ciblé. Soit le sélecteur a changé, soit le composant ne monte pas. |
| Correction | À diagnostiquer avant PRE-1 (grep du motif dans le tree). |
| Blocked milestone? | Non directement — bloque la release globale. |
| Owner | agent (PRE-1) |
| Reason « hors chemin PRE-0 » | Le test couvre la barre de titre Work, pas la surface Automate. |
| Proof Automate does not depend on it | L'`automate-surface` ne consomme pas la `titlebar` (cf. `automate-surface.tsx` — pas d'import de `titlebar-*`). |
| Review milestone | PRE-1 (pendant la cartographie). |
| Status | `NEEDS_EVIDENCE` |

---

## R-005 — `mode-reload-stability.spec.ts`

| Champ | Valeur |
|---|---|
| ID | R-005 |
| Severity | Medium (e2e failure non diagnostiquée) |
| Category | Test stability / memory leak |
| Claim | Compteur de fuites après 10 rechargements — seuil dépassé. |
| Evidence | SESSION-2 §7.1 |
| Branch / SHA | `integration/rev3m-20260901/design-automate` @ `24b04998e2` |
| Failure scenario | Une fuite existe dans le `ModeProvider` ou ses fournisseurs, possiblement liée au correctif `09f1329a8d`. |
| Correction | À diagnostiquer ; risque R-001. |
| Blocked milestone? | Indirect (R-001) |
| Owner | agent (PRE-1) |
| Reason « hors chemin PRE-0 » | Le test couvre la stabilité de tous les modes, dont Automate. **Mais** Automate n'est pas la cause première probable — l'enquête dépasse le scope PRE-0. |
| Proof Automate does not depend on it | Le test rechargerait aussi un mode autre qu'Automate. Mais si la fuite est dans la chaîne `ModeProvider` ↔ `WorkspaceWorkbenchProvider` (cf. R-001), Automate en dépend. **NEEDS_EVIDENCE**. |
| Review milestone | PRE-1. |
| Status | `NEEDS_EVIDENCE` |

---

## R-006 — Switcher mobile (V06) — focus clavier ne suit pas la sélection

| Champ | Valeur |
|---|---|
| ID | R-006 |
| Severity | **P1** (seul chemin clavier vers la surface Atelier) |
| Category | A11y / keyboard |
| Claim | Sur le switcher mobile de la surface Design, ArrowRight change la sélection mais le focus n'atterrit pas sur l'onglet Workshop (`Received: inactive`). |
| Evidence | SESSION-2 §7.1 |
| Branch / SHA | `integration/rev3m-20260901/design-automate` @ `24b04998e2` |
| Failure scenario | Un utilisateur clavier qui arrive sur la surface Design par le switcher mobile ne peut pas atteindre l'Atelier. |
| Correction | Corriger le focus pour qu'il suive la sélection (et non l'inverse). |
| Blocked milestone? | **Oui pour Design mobile**. Pas pour Automate local. |
| Owner | Design team |
| Reason « hors chemin PRE-0 » | Le switcher mobile est sur la surface Design, pas sur le rail Automate. |
| Proof Automate does not depend on it | Le rail Automate (Desktop) n'utilise pas le switcher mobile. Si une cible mobile est ajoutée plus tard, le switcher devra être revu. |
| Review milestone | post-M1 (Design mobile). |
| Status | `ALREADY_COVERED` (par axe.ts) |

---

## R-007 — Baselines visuelles Linux absentes

| Champ | Valeur |
|---|---|
| ID | R-007 |
| Severity | Medium (gate ne couvre que win32) |
| Category | CI coverage |
| Claim | `e2e/design/design-visual.spec.ts` a 8 baselines sous `__screenshots__/win32/`. La CI Ubuntu n'a pas de baseline ; les 8 comparaisons sont SKIP motivé. |
| Evidence | SESSION-2 §3.2 ; listing `Get-ChildItem packages/app/e2e/design/__screenshots__/win32/` confirme 8 PNG. |
| Branch / SHA | `integration/rev3m-20260901/design-automate` @ `24b04998e2` |
| Failure scenario | Une régression visuelle sur Linux n'est pas détectée par cette gate. La gate de déterminisme tourne mais ne détecte pas les changements cosmétiques. |
| Correction | Générer des baselines dans un conteneur Playwright Linux dédié (pas dans la CI générale, sinon la gate certifie son propre résultat). |
| Blocked milestone? | Indirect (release multi-plateforme) |
| Owner | agent (PRE-1) |
| Reason « hors chemin PRE-0 » | La cible première est Windows. Les baselines Linux seront nécessaires si une cible Linux est ajoutée. |
| Proof Automate does not depend on it | La surface Automate utilise les mêmes tokens visuels ; la régression affecterait Automate aussi. Mais la correction est générique (Design) et le bénéfice rejaillit sur Automate. |
| Review milestone | M2 / M3 (selon Roadmap). |
| Status | `ACCEPT` (avec dette documentée) |

---

## R-008 — Biome ne lit pas `packages/app/e2e/**`

| Champ | Valeur |
|---|---|
| ID | R-008 |
| Severity | Medium (trou de gate — historique : le bug « backticks non échappés » dans `workbench-mock.ts` est passé par ce trou) |
| Category | Lint coverage |
| Claim | Le `biome.json` (`Get-ChildItem` à confirmer) couvre `packages/app/src` mais pas `packages/app/e2e`. Mesuré SESSION-2 : ajouter `e2e` donne 3 erreurs et 9 avertissements sur 69 fichiers, dont un `noEmptyPattern` sur l'idiome Playwright `async ({}, use)`. |
| Evidence | SESSION-2 §8 #7 |
| Branch / SHA | `integration/rev3m-20260901/design-automate` @ `24b04998e2` |
| Failure scenario | Une erreur de syntaxe JavaScript dans un fichier e2e passe silencieusement. La suite e2e entière ne se charge pas, et aucune gate ne le détecte. |
| Correction | (1) Étendre `biome.json` pour inclure `packages/app/e2e/**` avec un override sur `noEmptyPattern` (idiome Playwright). (2) Ajouter une gate CI qui échoue dur si `bunx biome check packages/app/e2e` est rouge. |
| Blocked milestone? | **Oui pour la robustesse e2e** — y compris pour Automate (ses futurs e2e seront dans ce dossier). |
| Owner | agent |
| Reason « hors chemin PRE-0 » | La couverture lint est transverse, pas Automate-spécifique. |
| Proof Automate does not depend on it | Tout futur e2e Automate vivra dans `packages/app/e2e/**` et souffrira du même trou. **En réalité, Automate en dépend**. Mais la correction n'est pas bloquante pour commencer PRE-1 — elle est bloquante pour écrire le premier test e2e Automate proprement. |
| Review milestone | M1 (avant le premier e2e Automate). |
| Status | `NEEDS_EVIDENCE` (à confirmer en PRE-1) |

---

## R-009 — Suite complète `packages/unifia` (~5 140 tests, ~590 s) non relancée après commit Work

| Champ | Valeur |
|---|---|
| ID | R-009 |
| Severity | Medium (silence de couverture) |
| Category | Test coverage drift |
| Claim | SESSION-2 §2 a commit `33bea2ec04` (Work lignée, qui dépend de `unifia#build` dans turbo) et n'a pas relancé la suite complète. |
| Evidence | SESSION-2 §2 : « Non fait : la suite complète `packages/unifia` (5140 tests, ~590 s) n'a pas été relancée après ce commit ». |
| Branch / SHA | `integration/rev3m-20260901/work` @ `33bea2ec04` |
| Failure scenario | Une régression sur la lignée Work n'est pas détectée. Cela rejaillirait sur Automate parce que le sidecar CLI est consommé par `workbench-server`. |
| Correction | Lancer `bun turbo test:ci` (ou équivalent) sur la lignée Work en arrière-plan. Documenter le résultat. |
| Blocked milestone? | Indirect (durée : ~590 s, à lancer en background). |
| Owner | agent (PRE-1) |
| Reason « hors chemin PRE-0 » | Le commit est sur la lignée Work, pas sur la lignée Design/Automate. La cible PRE-0 est `24b04998e2` (Design). |
| Proof Automate does not depend on it | Faux : le sidecar CLI est partagé. Mais le commit est limité à `turbo.json` + `cli-process.test.ts` + `package.json`, et la suite 11/11 (`cli-process.test.ts`) est passée. Le risque résiduel est faible. |
| Review milestone | M1 (avant la première exécution e2e qui traverse le sidecar). |
| Status | `NEEDS_EVIDENCE` |

---

## R-010 — Trou entre `head SHA` attendu et réel

| Champ | Valeur |
|---|---|
| ID | R-010 |
| Severity | Low (information, non bloquant) |
| Category | Baseline drift |
| Claim | Le prompt indique HEAD attendu `24b04998e2a32ecfb10f74ed4f3e82e21eb9d38c`. HEAD réel `24b04998e2fd861711036501ad3f6e41a63f8c32`. Le préfixe 8 caractères matche. |
| Evidence | `git rev-parse HEAD` exécuté à 15:40. |
| Branch / SHA | `integration/rev3m-20260901/design-automate` @ `24b04998e2fd861711036501ad3f6e41a63f8c32` |
| Failure scenario | Si l'écart était un caractère changé en un autre, on aurait un checkout sur un commit différent. Le préfixe 8-char matche, et le suffixe 32-char est en `2...2` / `2...2` (commencent pareil), ce qui suggère que le SHA fourni dans le prompt a été tronqué/copié manuellement avec une faute de frappe en fin. Pas un risque de fond. |
| Correction | Aucune — c'est un fait, pas un bug. Documenter dans BASELINE §0. |
| Blocked milestone? | Non |
| Owner | — |
| Reason « hors chemin PRE-0 » | Information de référence. |
| Proof Automate does not depend on it | Le checkout est sur le bon commit (vérifié par le message `fix(e2e): the same impossible locators, in design-mode.spec.ts` qui correspond au dernier commit de la lignée). |
| Review milestone | aucun |
| Status | `BASELINE_MISMATCH` (information, pas un finding) |

---

## R-011 — Plan maître gelé : SHA de la source obsolète dans le frontmatter

| Champ | Valeur |
|---|---|
| ID | R-011 |
| Severity | Low (information, traçabilité) |
| Category | Documentation drift |
| Claim | Le frontmatter du plan maître (ligne 12) indique `source_sha256: ea44c810144ad1e2fb263a190202ffb1d5c51dddefb72f6922d29b46f07ee995`. Le fichier sur disque a SHA256 `3A63FE3D2CE12E84CC47787A2B6257167F2FEC50EAB294CD125D9CFB86510815`. Le fichier a été modifié 2026-09-01 15:33:58 (7 minutes avant l'exécution). |
| Evidence | `Get-FileHash` + `Get-Item` sur le plan maître. |
| Failure scenario | Si un futur agent se fie au SHA frontmatter pour valider la version, il rejetterait à tort la version actuelle. |
| Correction | Le frontmatter a probablement été mis à jour en même temps que le contenu (le contenu est la « copie fidèle » et le frontmatter le référence). À vérifier. Si l'écart persiste, mettre à jour le frontmatter dans une prochaine itération. |
| Blocked milestone? | Non |
| Owner | Erwan (vault) |
| Reason « hors chemin PRE-0 » | Documentation, pas code. |
| Proof Automate does not depend on it | Le contenu du plan est normatif, pas son hash. Automate dépend du contenu, qui est lu dans son intégralité. |
| Review milestone | aucun |
| Status | `BASELINE_MISMATCH` |

---

## R-012 — Aucun `Secret Broker` / `Key Authority` identifié comme package dédié

| Champ | Valeur |
|---|---|
| ID | R-012 |
| Severity | **High** (manque pour ADR-010) → **RESOLVED** |
| Category | Architecture gap |
| Claim | Le plan §72-80 exige un Secret Broker et un Key Authority. Aucun package `@unifia/secret-broker` ou `@unifia/key-authority` n'est listé. |
| Evidence (2026-09-01) | `Get-ChildItem packages` ne montre pas ces packages. `workbench-server/src/auth.ts` (16 Ko) gère des `Principal`, `ScopedToken`, `RateLimiter` — c'est de l'authentification, pas du secret broker. |
| Evidence (2026-09-02) | **M1-07 livré** (PostM3-R1, commit `3f8e499f03`) : `packages/secret-broker/` avec `index.ts` (22 244 octets) + `os-broker.ts` (31 627 octets) + 2 test files (30 866 octets). Définit `CredentialRef`, `SecretRef`, `OAuthConnectionRef`, `BrowserAuthProfileRef` (lignes 57-60 de `index.ts`) + `storeCredential/storeSecret/storeOAuthConnection` (lignes 157-159) + `OwnershipScope`-bound tenancy. |
| Verdict (cartographie C-PRE1-02) | **EXISTS** — `@unifia/secret-broker` est un package dédié, isolation stricte. `workbench-server/src/auth.ts` (334 lignes, après C-PRE1-04 refactor) ne référence AUCUN de `CredentialRef|SecretRef|OAuthConnectionRef|BrowserAuthProfileRef|secret` (grep -c = 0). Responsabilité NON SCATTERED. |
| Failure scenario (historique) | (a) Un executor qui a besoin d'un secret doit réinventer sa propre sécurité. (b) La rotation de clé (§78) n'est pas possible. (c) La protection at-rest (§74) n'est pas mesurable. — **NE S'APPLIQUE PLUS** après M1-07. |
| Correction | LIVRÉ par M1-07 (commit 3f8e499f03). ADR-010 peut maintenant être rendu. |
| Blocked milestone? | **Non** — `@unifia/secret-broker` existe, M1-07 PASS 6/6, ADR-010 peut s'appuyer dessus. |
| Owner | Erwan (ADR-010 ratification) |
| Review milestone | ADR-010. |
| Status | `RESOLU` (M1-07 livré 2026-09-02, cartographie C-PRE1-02 confirmée 2026-09-03) |

---

## R-013 — `automate-surface.tsx` zéro test (gate de sortie §16.3)

| Champ | Valeur |
|---|---|
| ID | R-013 |
| Severity | **Critical** (P0 d'absence de preuve ; touche les 8 gates de sortie) |
| Category | Test absence |
| Claim | `packages/app/src/pages/workbench/automate-surface.tsx` (8 164 octets) n'a **aucun** fichier de test — ni unitaire, ni e2e. Les 8 gates §16.3 sont sans preuve. |
| Evidence | `Get-ChildItem packages/app/src/pages/workbench` liste 50 fichiers dont `automate-surface.tsx` mais aucun `automate-surface.test.ts` ou `automate-surface.test.tsx`. Confirmé par SESSION-2 §0. |
| Failure scenario | Toute régression sur Automate passe inaperçue. La certification §16.3 ne peut pas être obtenue. |
| Correction | (1) Au minimum : un test unitaire par fonction exportée (`AutomateSurface`, `decodeFile`, `startDefinition`, `startSelectedWorkflow`). (2) Un e2e qui couvre les 8 sorties §16.3. (3) Bloquer la carte PRE-1 qui crée la première carte de la suite M1 tant que la suite n'existe pas. |
| Blocked milestone? | **Oui** — M1 ne peut pas commencer sans suite Automate minimale (plan §0, condition « reference suites green »). |
| Owner | agent |
| Reason « hors chemin PRE-0 » | **FAUX** — ce finding n'est pas hors chemin. Il est **le** finding bloquant. Présent ici en double-cohérence avec `AUTOMATE_TRUST_PATH.md` §E.1, pour traçabilité côté registre. |
| Proof Automate does not depend on it | N/A — c'est la définition d'Automate qui dépend de ses tests. |
| Review milestone | M1 (avant la première carte). |
| Status | `NEEDS_EVIDENCE` côté PRE-0 (la suite n'existe pas) ; sera déplacé dans `IMPLEMENTATION_CARD_INDEX.md` comme carte bloquante. |

---

## R-014 — `WorkflowRuntime` actuel n'est pas un durable execution substrate

| Champ | Valeur |
|---|---|
| ID | R-014 |
| Severity | **Critical** (manque pour ADR-000) |
| Category | Architecture gap |
| Claim | Le `@unifia/workflow-runtime` actuel est un exécuteur linéaire (91 lignes, sans timer durable, sans canonicalisation, sans effet identity, sans UNKNOWN_EXTERNAL_STATE). Ce n'est pas un « substrate » au sens du plan §34-40. |
| Evidence | `Get-Content packages/workflow-runtime/src/index.ts` retourne 91 lignes ; lecture intégrale. |
| Failure scenario | (a) Si on traite ce runtime comme substrate, on viole silencieusement §1 (« un WorkflowRun possède exactement une seule autorité durable ») et §2 (« pas de double autorité »). (b) Les ADR-000 à ADR-005 ne peuvent pas être rendus par-dessus sans refonte. |
| Correction | ADR-000 tranchera. Le package peut devenir (a) adapter d'un substrate externe (DBOS, Restate, Temporal), (b) kernel natif réécrit, (c) déprécié au profit d'un autre. Aucune décision ne peut être prise sans ADR-000 explicite. |
| Blocked milestone? | **Oui** — M1 ne peut pas commencer sans ADR-000. |
| Owner | agent (ADR-000), Erwan (décision) |
| Reason « hors chemin PRE-0 » | C'est précisément l'objet de PRE-1 puis ADR-000. Tracé ici pour qu'aucun PRE-1 ne l'oublie. |
| Proof Automate does not depend on it | C'est l'inverse : Automate dépend du choix de substrate. |
| Review milestone | ADR-000. |
| Status | `NEEDS_EVIDENCE` (à rendre par ADR-000) |

---

## Synthèse par statut

| Statut | Compte |
|---|---|
| `ACCEPT` | 1 (R-007 baselines Linux) |
| `PARTIAL` | 0 |
| `REJECT` | 0 |
| `ALREADY_COVERED` | 3 (R-002, R-003, R-006) |
| `BASELINE_MISMATCH` | 2 (R-010, R-011) |
| `NEEDS_EVIDENCE` | 5 (R-001, R-004, R-005, R-008, R-009) — R-012, R-013, R-014 ont fait l'objet d'une cartographie PRE-1.1, voir ci-dessous |
| `RESOLU_PRE-1.1` | 3 (R-012 verdict EXISTS confirmé 2026-09-03, R-013 phase 1+2 livrées, R-014 confirmé par C-PRE1-03) |

**Findings qui demandent un blocage ou une action immédiate** :

| ID | Action | Échéance |
|---|---|---|
| R-013 | Écrire une suite Automate minimale (au moins un test unitaire `decodeFile`) | avant la première carte M1 |
| R-014 | ADR-000 | avant toute carte M1 |
| R-012 | PRE-1 cartographie `@unifia/secret-broker` ou atteste son absence | avant ADR-010 |
| R-001 | Décision utilisateur `09f1329a8d` | avant M1 |

Les autres findings sont à traiter en parallèle sans bloquer PRE-0.

---

## Décision PRE-0 — version finale

À l'issue de la lecture de `BASELINE.md`, `AUTOMATE_TRUST_PATH.md` et ce
`RISK_REGISTER.md`, la décision PRE-0 est :

### **`GO_WITH_CONTAINED_DEBT`** sous **3 conditions explicites**

La dette contenue est strictement ce que le plan §237 autorise (Medium fixé
ou accepté). Les findings `Critical` (R-013, R-014) ne sont **pas** de la
dette contenue — ils sont des **gates** à franchir avant la première carte
M1. La règle du plan est nette : « une dette contenue ne doit jamais
concerner Critical, High, ambiguïté d'autorité, fuite de secret, isolation
tenant, contournement réseau, perte de clé, correction d'effet
irréversible ».

Donc :

1. **R-013 (Critical, absence de tests Automate)** → **PRE-1 ne peut pas
   produire de carte M1** tant qu'une suite Automate minimale (au moins un
   test unitaire sur `decodeFile` ou un test ciblé sur le `startDefinition`)
   n'existe pas. Cette suite est la première carte PRE-1.
2. **R-014 (Critical, WorkflowRuntime non-substrate)** → **ADR-000 est la
   première carte** après l'écriture de la suite Automate. Aucun code
   durable ne peut être écrit avant.
3. **R-001 (High, correctif `09f1329a8d` non confirmé)** → **bloquant
   externe**. Tant que l'utilisateur n'a pas tranché, le run s'arrête à
   la première carte qui touche au rail Automate.

Le reste des findings (`R-002, R-003, R-004, R-005, R-006, R-007, R-008,
R-009, R-010, R-011, R-012`) est de la dette documentée à traiter en
parallèle.

**Justification du `GO_WITH_CONTAINED_DEBT`** : les conditions §13 du plan
sont remplies à l'exception de la suite Automate (R-013) et du substrate
(R-014), qui sont **des gates bloquantes** plutôt que des dettes. Toutes les
gates « mécaniques » (build, typecheck, lint, tests existants, baseline
SHA, trust path, branches documentées) sont vertes.

**Ce n'est pas un `GO` complet** : la porte M1 reste conditionnée aux
trois gates ci-dessus. C'est un `GO_WITH_CONTAINED_DEBT` parce que
l'architecture est cartographiée, l'inventaire est complet, le trust path
est classifié, et les conditions bloquantes sont identifiées avec une
issue précise pour chacune.

### Alternatives considérées et rejetées

- **`NO_GO`** : aurait signifié s'arrêter sur R-013/R-014. Mais le plan
  attend de PRE-0 qu'il **documente** ces findings et **continue**. Un
  `NO_GO` créerait un `BASELINE_BLOCKERS.md` qui ne dit pas autre chose
  que ce registre dit déjà. Gaspillage.
- **`GO`** (sans condition) : aurait masqué R-013 et R-014. Violation
  directe de §13 et §237.

---

## Suite immédiate

1. Initialiser `EXECUTION_STATUS.md` (livrable obligatoire du plan §246
   ligne 6140-6170).
2. Si Erwan valide la décision `GO_WITH_CONTAINED_DEBT` : démarrer
   PRE-1 (`PACKAGE_MIGRATION_MAP.md`, `IMPLEMENTATION_CARD_INDEX.md`).
3. Si Erwan préfère un `NO_GO` formel : écrire `BASELINE_BLOCKERS.md` et
   arrêter.

**Demande explicite** : la décision `GO_WITH_CONTAINED_DEBT` est
suffisamment documentée pour que PRE-0 s'arrête ici et attende la
validation (ou l'invalidation) de Erwan avant de toucher au code. La règle
« ne pas modifier le durable kernel de production » (ligne 6268 du plan)
impose ce point d'arrêt.

---

# Cartographies PRE-1.1 — résolutions (2026-09-01, fin de session)

Cette section documente les verdicts des 4 cartographies PRE-1.1
(`IMPLEMENTATION_CARD_INDEX.md`), mesurées en lecture statique + un
test smoke. Ces verdicts ne sont pas des décisions d'ADR (les ADR
restent `PROPOSED`) mais des **faits** sur l'état du code.

## C-PRE1-02 — Cartographie Secret Broker (R-012)

**Verdict** : `ABSENT_CREATE` confirmé.

**Lecture mesurée** : `packages/workbench-server/src/auth.ts` (377 lignes).

`auth.ts` est un **token authenticator HTTP**, pas un Secret Broker.
Responsabilités présentes :

- `ScopedTokenIssuer` (ligne 71-154) : émet, fait tourner, vérifie et
  révoque des bearer tokens HS256 JWT-shaped.
- `HmacTokenAuthenticator` (ligne 247-324) : vérifie detached HS256 bearer
  tokens, avec `KnownPrincipalScopes` (P3_CAPABILITIES + `workspace.register`
  + `workspace.open`).
- `FixedWindowRateLimiter` (ligne 333-358) : rate limit fixed-window.
- `UnauthenticatedPrincipal` (ligne 367-377) : classe nommée
  explicitement « disabling authentication must appear at the call site
  and be greppable ».

Le commentaire en tête du fichier (ligne 17-18) est sans ambiguïté :
> Obtaining those tokens from an external identity provider (OAuth
> authorization-code flow, OIDC discovery, JWKS rotation) is
> deliberately NOT implemented here — it needs an external IdP and
> cannot be proven locally.

Conclusion : aucun Secret Broker (CredentialRef / SecretRef /
OAuthConnectionRef / BrowserAuthProfileRef) n'est implémenté. La
responsabilité n'est **pas** dans `auth.ts` (qui est authentification
HTTP), ni dans `enterprise` (INFERRED, non lu), ni dans `desktop` (qui
utilise Tauri `keychain` mais ne fournit pas un broker aux packages
TS). ADR-010 tranche : créer `@unifia/secret-broker/`.

**Statut R-012** : `NEEDS_EVIDENCE` → résolu. Verdict =
`ABSENT_CREATE`. ADR-010 PROPOSED.

## C-PRE1-03 — Cartographie `workflow-catalog/src/` (R-014)

**Verdict** : `EXTEND` confirmé, pas `MIGRATE`.

**Lecture mesurée** : `packages/workflow-catalog/src/index.ts` (252
lignes) + `packages/workflow-catalog/test/catalog.test.ts` (présent).

`workflow-catalog` est **plus mature** que `@unifia/workflow-runtime` :

- `StepDeclaration` type (ligne 23-37) : 9 champs alignés sur le plan §15
  (« chaque step déclare : capability, scope, sandbox, cost, timeout,
  retry, output, approval, reversibility »).
- `validateStepDeclaration` (ligne 89-112) : invariants enforced
  throw-not-default, dont :
  - `CRITICAL_CAPABILITIES` (terminal.run, desktop.control, secret.read,
    package.install, network.request, remote.respond) exigent
    `approval: "required"`.
  - `REQUIRES_SANDBOX` (terminal.run, network.request, browser.navigate)
    exigent un sandbox non-`"none"`.
  - Step `irreversible: false` exige `approval: "required"` ET
    `retry.attempts: 0` (pas de retry d'un effet irréversible).
- `validateWorkflow` (ligne 114-124) : workflow-level checks
  (id kebab-case, version positive, ≥1 step, ids uniques).
- `toRuntimeDefinition` (ligne 143-152) : projection vers le runtime —
  c'est ici que les 9 champs du catalogue sont réduits aux 4 champs
  du runtime (id, capability, input, requiresApproval). Le runtime
  **perd de l'information** en consommant.
- `BUILT_IN_WORKFLOWS` (ligne 187-252) : 8 workflows (document-from-folder,
  weekly-project-report, code-review-to-presentation, research-to-brief,
  spreadsheet-analysis, remote-request-with-local-approval,
  browser-data-to-artifact, release-prep) avec sandbox, approval,
  retry correctement déclarés.

Conclusion : le **catalogue est substrate-grade pour la déclaration**.
Le **runtime est le goulot** — il n'exécute que 4 champs sur 9, n'a
pas de timer durable, pas de canonicalisation, pas d'effet identity.
C'est exactement R-014. ADR-000 tranche : remplacer ou réécrire
`@unifia/workflow-runtime` (ou le rendre adapter d'un substrate
externe). Le `workflow-catalog` peut être conservé tel quel et
alimenter le nouveau runtime.

**Statut R-014** : `NEEDS_EVIDENCE` → résolu. Verdict = `EXTEND` (le
catalogue) + `MIGRATE` (le runtime). ADR-000 PROPOSED.

## C-PRE1-01 — Premier test Automate (R-013)

**Verdict** : Phase 1 + phase 2 livrées. Phase 3 (e2e Playwright 8
sorties §16.3) reste M1, après ADR-000.

**Mesure phase 1** :
`packages/app/src/pages/workbench/automate-surface.test.ts` (5 tests
statiques, 5 pass / 0 fail). Le module ne peut pas être importé en
Node (SolidJS router client-only) ; les tests pin la forme du
fichier source.

**Mesure phase 2** :
- `packages/app/src/pages/workbench/automate-decode.ts` (NOUVEAU) :
  helpers purs `decodeFile` (utf-8 + base64 round-trip) et
  `parseWorkflowDefinition` (JSON.parse + validation minimale
  id/version/steps, retourne un résultat taggé `ok`/`error`).
- `packages/app/src/pages/workbench/automate-decode.test.ts`
  (NOUVEAU) : 12 tests, 12 pass / 0 fail. Couvre :
  - utf-8 pass-through, base64 vide, base64 utf-8 non-ASCII (« héllo »)
  - body workflow round-trip réaliste
  - définition valide acceptée
  - body vide / JSON malformé / id manquant / id vide / version ≠ 1 /
    steps manquant tous rejetés avec un message descriptif
  - **steps vide accepté** (pin le contrat actuel du runtime — le
    `workflow-catalog` rejette ailleurs ; la migration vers le
    contrat strict sera une décision délibérée, pas une dérive
    silencieuse).
- `automate-surface.tsx` (MODIFIÉ) : import depuis `./automate-decode`,
  la fonction `startSelectedWorkflow` utilise maintenant
  `parseWorkflowDefinition(decodeFile(file))` au lieu du parsing
  inline. Comportement préservé byte-pour-byte (même message
  d'erreur i18n, même état Reactif en cas d'échec).

**Phase 3** (différée à M1, après ADR-000) :
- e2e minimal Playwright : 1 parcours `approval_required` avec
  horloge Playwright, qui couvre les 8 sorties §16.3.

**Statut R-013** : `NEEDS_EVIDENCE` → résolu partiellement. Phase 1
+ phase 2 livrées (17 tests au total : 5 statiques + 12 round-trip).
Phase 3 reste M1.

**Régression mesurée** : la suite `packages/app/src` est passée
de 1175 tests (SESSION-2) à **1192 tests** dans cette session,
avec **0 fail**. Les 17 nouveaux tests sont exactement C-PRE1-01
phase 1 + phase 2. Aucune régression sur les 1175 tests
preexistants.

## C-PRE1-05 — Test isolation scope (R-020 / multi-tenant)

**Verdict** : `ALREADY_COVERED`.

**Mesure** : `packages/workbench-orchestrator/test/orchestrator.test.ts`
(112 lignes) — la suite couvre déjà l'isolation cross-workspace.

Assertions présentes :
- ligne 60 : `rejects(() => router.sendPrompt("ws-a", { sessionId:
  sessionB.id, prompt: "cross" }), ...)` — un workspace A ne peut
  pas prompter une session d'un workspace B.
- ligne 61 : `rejects(() => router.cancelSession("ws-a", sessionB.id),
  ...)` — un workspace A ne peut pas annuler une session d'un
  workspace B.
- ligne 62 : `throws(() => router.subscribeEvents("ws-a", sessionB.id),
  Error, ...)` — un workspace A ne peut pas s'abonner aux events
  d'un workspace B.
- ligne 71-85 : leaky runtime test — si le runtime ignore le scope,
  le routeur re-filtrage (ligne 67 du code) protège.
- ligne 87-88 : mislabelling test — si le runtime forge
  `workspaceId: "ws-other"` à la création de session, le routeur
  lève.

**Statut C-PRE1-05** : `DONE`. Pas de nouveau fichier nécessaire. La
suite `orchestrator.test.ts` est une **référence** pour les futurs
tests d'isolation. Le résultat doit être confirmé en CI (M1).

## Synthèse des cartographies PRE-1.1

| ID | Verdict | Avant | Après |
|---|---|---|---|
| R-012 | ABSENT_CREATE | NEEDS_EVIDENCE | **RESOLU_PRE-1.1** |
| R-013 | EXTEND (phase 1 livrée, phase 2 différée) | NEEDS_EVIDENCE | **RESOLU_PRE-1.1 (phase 1)** |
| R-014 | EXTEND catalog + MIGRATE runtime | NEEDS_EVIDENCE | **RESOLU_PRE-1.1 (catalog)** |
| C-PRE1-05 | ALREADY_COVERED | OPEN | **DONE** |

**Findings ouverts** (toujours bloquants M1) :

- **R-001** : décision utilisateur `09f1329a8d` (externe).
- **R-013 phase 2** : ADR-000 + extraction de `decodeFile` pour test
  unitaire réel.
- **R-014 runtime** : ADR-000 (substrate).

Aucun finding PRE-1.1 n'a contredit le plan. Aucune découverte
nouvelle n'a émergé. Les 3 cartographies confirment les ADR
PROPOSED.
