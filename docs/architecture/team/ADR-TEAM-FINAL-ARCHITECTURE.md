# ADR-TEAM-FINAL-ARCHITECTURE — Architecture finale gelée, Lot A / Gate T0

> **Carte :** TEAM-A06 (Lot A, Gate T0 — clôture)
> **SHA de base :** `ef48e5d5c5cc0aff802a519950e15aeb3786e1c6`
> **Date UTC :** 2026-07-21
> **Auteur :** Claude Sonnet 5 (consolidation A01-A05)
> **Statut :** READY_FOR_E2_REVIEW
> **Portée :** cette ADR fige les décisions architecturales dérivées des 5
> audits du Lot A. Conformément à la doctrine §0.2 du plan directeur
> ("architecture finale dès le premier lot"), ces décisions ne sont **pas
> révisables** par les cartes d'implémentation en aval (Lot B+) sans passer
> par une nouvelle ADR explicite.

---

## Décision 1 — Secrets : architecture 3-couches AuthStorage / CredentialBroker / PermissionBroker

**Contexte.** A02-V2 a cartographié le flux de credentials actuel et
identifié deux failles concrètes : propagation brute vers `process.env`
(F-A02-1, TDR-009) et 4 méthodes de résolution de credentials dupliquées
entre `auth/` et `collective/provider-discovery.ts` (R-A03-5, TDR-018), plus
une lecture filesystem directe non unifiée (R-A03-9b, TDR-023).

**Décision.** La décomposition en 3 couches devient l'autorité unique :
- **AuthStorage** : persistance des credentials (FileStorage dev-only avec
  avertissement explicite si utilisé en production ; KeychainStorage à
  finaliser comme cible production).
- **CredentialBroker** : résolution/délégation opaque — aucun composant en
  dehors du broker ne doit lire un credential en clair ou l'écrire dans
  `process.env`/variables globales.
- **PermissionBroker** : évaluation des droits associés à chaque credential
  et à chaque session (voir Décision 2 pour son interaction avec les
  sessions enfants).

**Alternatives rejetées.**
- *Continuer avec l'écriture directe `process.env`* : rejeté — c'est
  précisément F-A02-1 (TDR-009), la faille source de cette décision.
- *EncryptedFile avec sel `hostname`/`machine-id`* : rejeté comme secret
  suffisant par le verdict E2 A02-V2 — la CLI headless doit soit échouer
  proprement, soit exiger un opt-in explicite
  `OPENCODE_AUTH_INSECURE_FILE=1` marqué non-sûr dev-only.

**Conséquences.** Toute carte future qui introduit une nouvelle méthode
d'authentification (nouveau provider, nouveau plugin) doit passer par
CredentialBroker. Aucune exception. Voir décision gelée #2 du
`TECHNICAL-DEBT-REGISTER.md`.

---

## Décision 2 — Cancellation arborescente des sessions

**Contexte.** F-A01-2 (TDR-002) a démontré, par lecture exhaustive de tous
les call sites de `AbortController`/`AbortSignal` (44 preuves), qu'aucun
mécanisme n'existe pour propager une annulation d'une session parent vers
ses sessions enfants.

**Décision.** `Session.cancelRecursive(parentID)` est la primitive
canonique gelée : elle itère `children(parentID)` et appelle l'abort sur
chaque enfant, récursivement. C'est la **seule** voie d'annulation
arborescente autorisée dans Team.

**Interaction avec Décision 1 (composition TM-17).** Cette primitive doit
être livrée et testée **avant** que Team n'exécute un worker non fiable en
production, car son absence combinée à une faille de credential (Décision 1
non close) crée une fenêtre d'exfiltration prolongée (voir
`THREAT-MODEL.md` §5, TM-17). C'est une précondition inter-cartes explicite,
pas une simple liste de deux items indépendants.

**Alternatives rejetées.**
- *Annulation par timeout global uniquement (pas de propagation explicite)*
  : rejeté — laisse une fenêtre d'exécution non bornée pour les enfants tant
  que le timeout global n'est pas atteint, incompatible avec le principe
  fail-closed de Team.

**Conséquences.** H02 (worker runtime cancellation) doit livrer cette
primitive avec un test couvrant explicitement un parent + au moins deux
enfants récursifs.

---

## Décision 3 — Permissions des sessions enfants : least-privilege fail-closed

**Contexte.** F-A01-1 (TDR-001) a montré que la sémantique effective du
champ `permission` d'une session enfant (Ruleset vide vs `undefined` vs
héritage implicite) n'est pas démontrée par le code actuel — c'est une
zone d'ambiguïté, pas un bug prouvé.

**Décision.** Politique gelée : **least-privilege fail-closed**. Toute
création de session Team avec `parentID` doit fournir un `Ruleset` enfant
**explicite**, validé comme sous-ensemble non plus permissif que le
Ruleset du parent. La création est **refusée** si aucune politique
effective explicite n'est fournie. Aucun héritage implicite
(`inherit_parent_unless_overridden`) n'est autorisé — ce pattern a été
explicitement écarté par le verdict E2 d'A01-V2 comme incompatible avec
default-deny.

**Alternatives rejetées.**
- *Héritage implicite du Ruleset parent* : rejeté par E2 (A01-V2 §7.3) —
  incompatible avec default-deny.
- *Ruleset vide par défaut sans validation de sous-ensemble* : rejeté —
  n'empêche pas une escalade de privilège si un enfant reçoit
  explicitement un Ruleset plus permissif que son parent par erreur de
  configuration en amont.

**Conséquences.** D03 doit stocker le diff entre Ruleset parent et enfant
pour audit, et bloquer toute création non conforme.

---

## Décision 4 — Substrat multi-modèle : provider-agnostic, sans enum statique

**Contexte.** A03 a documenté une violation explicite de la doctrine du
plan (aucun enum statique central pour un système visant plusieurs
centaines de modèles) : `PREFERRED_MODELS` (7 modèles) et `MODEL_COSTS`
(14 modèles) hardcodés dans `collective/`.

**Décision.** Le substrat `multi-model/` cible (Lot B, après A06) est
gelé comme : provider-agnostic, sans enum statique, interrogeant un
registry dynamique (Lot C, carte C01) pour la liste de modèles et leurs
coûts. `multi-model/provider-discovery.ts` **interroge**, il n'énumère pas.
Aucune carte future ne doit introduire un nouvel enum de modèles statique.

**Alternatives rejetées.**
- *Étendre la liste hardcodée au fur et à mesure* : rejeté — c'est
  exactement le pattern que la doctrine du plan interdit explicitement
  (support de plusieurs centaines de modèles sans liste centrale).

**Conséquences.** B01 (Gate T3+, après A06) ne peut pas démarrer
l'extraction du substrat sans que C01 (registry, Lot C) ait au minimum une
interface stable définie — dépendance à documenter dans le DAG du Lot B/C
par la carte de planification correspondante (hors périmètre de cette ADR).

---

## Décision 5 — Isolation Git : worktree par carte, avec application mécanique (pas seulement documentaire)

**Contexte.** A04 a démontré deux failles opérationnelles concrètes du
mécanisme actuel de worktree-par-carte (plan §12.3) : (a) le gate qualité
pre-commit (Husky) est silencieusement no-op dans tout worktree de carte
faute de `bun install` exécuté (F-A04-5, TDR-026) ; (b) les leases et
fencing tokens ne sont déclarés qu'en YAML, sans fichier-lock réel ni Scope
Monitor automatisé (F-A04-9, TDR-030) — la protection actuelle contre les
collisions de claim ou les commits hors scope est purement documentaire.

**Décision.** Le mécanisme worktree-par-carte reste l'architecture cible
(confirmé fonctionnel sous Windows par le test fixture A04), **mais** deux
garanties mécaniques sont ajoutées comme pré-requis du Lot B avant toute
carte de code de production :
1. Chaque script de création de worktree de carte doit soit exécuter
   `bun install`, soit vérifier `test -d .husky/_` et échouer bloquant sinon.
2. Un fichier-lock réel (`Execution/Locks/<lease_id>.lock`) est créé à la
   claim et supprimé à la clôture, plus un script de vérification de scope
   exécuté avant tout commit de carte comparant les fichiers stagés à
   `allowed_files`.

**Alternatives rejetées.**
- *Continuer sur la discipline documentaire seule (YAML + convention)* :
  rejeté comme insuffisant pour un programme multi-agent où l'exécuteur
  n'est pas nécessairement fiable à 100 % (cohérent avec TM-01/TM-12 du
  threat model) — un système fail-closed ne peut pas reposer uniquement
  sur le respect volontaire d'une convention.

**Conséquences — POINT DE DÉCISION UTILISATEUR EXPLICITE.** Ces deux
garanties ne sont **pas encore implémentées** au moment de la clôture de
Gate T0 (T0 est un gate d'audit et de décision, pas d'implémentation). La
question de savoir si B01 (première carte de code de production) peut
démarrer **avant** que ces deux mécanismes soient effectivement en place,
ou doit attendre leur implémentation, est une décision de risque produit
que cette ADR **ne tranche pas unilatéralement** — voir
`RFC-TEAM.md` §Décisions ouvertes pour la question posée à l'utilisateur.

---

## Décision 6 — Conformité de redistribution de données tierces

**Contexte.** A05 a démontré que le snapshot `models-snapshot.js`,
redistribué dans tous les artefacts de release, embarque l'intégralité de
la base `models.dev` (licence MIT du dépôt source) sans le copyright et le
permission notice que MIT exige explicitement pour toute copie substantielle.

**Décision.** Un mécanisme de génération automatique de notices tierces est
gelé comme architecture cible : registre déclaratif des sources de données
tierces (extensible, pas seulement `models.dev`) → génération automatique
de `THIRD_PARTY_NOTICES.md` (ou équivalent) → inclusion vérifiée par test
CI dans au moins un artefact de distribution. Le pin de version/commit de
chaque source ingérée est également gelé comme exigence (répond à TDR-034).

**Alternatives rejetées.**
- *Ajout manuel ponctuel d'une notice pour `models.dev` uniquement* : rejeté
  comme solution non pérenne — toute future source de données tierce
  (benchmarks, autres registries) aurait le même point aveugle sans
  mécanisme généralisé (cf. règle préventive `MODEL-DATA-LICENSE-AUDIT.md`
  §10).

**Conséquences.** La carte propriétaire de cette implémentation (à créer,
Lot B/C) doit inclure le test CI vérifiant la présence effective de
l'attribution dans l'artefact de build final, pas seulement dans le code
source.

---

## Résumé des décisions et de leur statut

| Décision | Domaine | Statut à la clôture T0 | Implémentation |
|---|---|---|---|
| 1 — AuthStorage 3-couches | Secrets | GELÉE | D03 |
| 2 — Cancellation arborescente | Sessions | GELÉE | H02 |
| 3 — Permissions least-privilege fail-closed | Sessions | GELÉE | D03 |
| 4 — Substrat multi-modèle sans enum statique | Multi-model | GELÉE | Lot B/C (B01, C01) |
| 5 — Worktree + garanties mécaniques | Git/orchestration | GELÉE (architecture) — **implémentation en attente de décision utilisateur** | Lot B (orchestrateur) |
| 6 — Notices tierces automatisées | Conformité données | GELÉE | Carte propriétaire à créer |

Toutes les décisions ci-dessus sont tracées vers `TECHNICAL-DEBT-REGISTER.md`
avec owner, carte cible, gate cible et critère de fermeture vérifiable.

---

_Fin de l'ADR. Aucune modification de code production. Cette ADR fige
l'architecture ; son implémentation est routée vers les cartes du
Lot B et suivants, conformément à la doctrine "audit et décisions" de
Gate T0._
