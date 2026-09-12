# RFC-TEAM — Programme Agent Team V3, transition Gate T0 → T1

> **Carte :** TEAM-A06 (Lot A, Gate T0 — clôture)
> **SHA de base :** `ef48e5d5c5cc0aff802a519950e15aeb3786e1c6`
> **Date UTC :** 2026-07-21
> **Auteur :** Claude Sonnet 5 (consolidation A01-A05)
> **Statut :** READY_FOR_E2_REVIEW
> **Nature :** ce document est prospectif (RFC), contrairement à
> `ADR-TEAM-FINAL-ARCHITECTURE.md` qui est rétrospectif/décisionnel. Il
> porte les questions qui restent ouvertes après consolidation du Lot A.

---

## 1. Ce qui est réglé (voir ADR)

Les 6 décisions architecturales listées dans `ADR-TEAM-FINAL-ARCHITECTURE.md`
sont gelées et non-négociables pour les cartes en aval. Ce RFC ne les remet
pas en question — il porte sur ce qui n'a **pas** encore de décision
tranchée.

## 2. Décisions ouvertes — nécessitent un arbitrage avant Lot B

### 2.1 Séquencement B01 vs garanties mécaniques worktree (Décision 5 de l'ADR)

**Question :** B01 (première carte de code de production, Lot B, Gate T3)
peut-elle démarrer avant que les deux garanties mécaniques identifiées par
A04 (hooks Husky effectivement installés par worktree, lease/fencing réels
via fichier-lock + Scope Monitor) soient implémentées ?

**Options :**
- **(a)** B01 attend l'implémentation de ces deux garanties (carte dédiée,
  probablement dans le Lot B avant B01, ou en tout début de Lot B).
- **(b)** B01 démarre avec un risque accepté et documenté explicitement
  (ex. checklist manuelle de l'exécuteur en attendant l'automatisation),
  avec un délai maximal fixé pour l'automatisation.
- **(c)** Un mécanisme minimal (juste `bun install` obligatoire, pas encore
  le Scope Monitor complet) suffit pour démarrer B01, le Scope Monitor
  complet arrivant plus tard dans le Lot B.

**Recommandation d'A06 (non contraignante) :** option (c) — le risque de
gate qualité no-op (TDR-026) est mécaniquement trivial à fermer (une ligne
dans le script de création de worktree) et devrait être fermé avant B01
sans délai. Le Scope Monitor complet (TDR-030) est plus substantiel et peut
suivre en parallèle des premières cartes B01+ tant que leur scope reste
petit et que l'orchestrateur (vous) continue de vérifier manuellement le
`git status`/`git diff --stat` avant chaque commit, comme fait
systématiquement dans ce passage pour A04/A05.

**Ceci reste une décision produit que ce document ne tranche pas
unilatéralement — à confirmer par l'utilisateur avant l'ouverture de B01.**

### 2.2 Reviewer indépendant pour les cartes critiques du Lot B

**Question :** cet environnement d'outillage ne dispose que d'un accès à
des modèles Claude (Opus/Sonnet/Haiku) via l'outil Agent — aucun accès à
Kimi/Mistral/DeepSeek/Gemini/GPT. Claude-Opus-4.8-E2 a déjà servi de
reviewer pour A04 et A05 (sujets indépendants, sessions isolées à chaque
fois). Pour les cartes critiques du Lot B (notamment celles qui implémentent
les Décisions 1 et 2 de l'ADR — secrets et cancellation), est-il acceptable
de continuer à utiliser Claude-Opus-4.8-E2 comme reviewer par défaut, ou
faut-il un relais humain vers un modèle réellement distinct (Kimi, GPT,
etc.) pour ces cartes à plus haut risque ?

**Recommandation d'A06 (non contraignante) :** pour les cartes `risk:
critical` touchant directement Décision 1 (secrets) ou Décision 2
(cancellation), un reviewer réellement distinct (relais humain) serait
préférable à une 3e ou 4e réutilisation d'Opus, étant donné l'enjeu
sécurité. Pour les cartes `risk: high` ou moins, Opus reste raisonnable.

### 2.3 Dépendance C01 (registry) vs B01 (substrat multi-modèle)

**Question :** B01 extrait le substrat `multi-model/` mais dépend d'un
registry dynamique (C01, Lot C) pour éliminer `PREFERRED_MODELS`/
`MODEL_COSTS`. Le DAG précis entre B01 et C01 (paralléliser avec une
interface stable définie d'abord, ou séquencer strictement C01 puis B01) est
hors du périmètre de cette RFC — à trancher par la carte de planification
du Lot B/C elle-même (pas par A06).

## 3. Ce que ce RFC ne couvre pas

- Le détail d'implémentation de chaque décision de l'ADR (routé vers les
  cartes propriétaires, voir `TECHNICAL-DEBT-REGISTER.md`).
- Les gates T1-T14 elles-mêmes — ce RFC ne couvre que la transition
  immédiate T0 → T1/Lot B.

---

_Fin du RFC. Les 3 questions ouvertes ci-dessus sont les seuls points
nécessitant un arbitrage humain avant que le Lot B ne s'enchaîne
automatiquement — tout le reste du Lot A est tranché par l'ADR._
