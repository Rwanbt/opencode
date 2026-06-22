# Synthèse finale — Collective Intelligence pour OpenCode

> 3 rounds, 8 modèles, 20+ réponses. Ce document clôt le débat et produit
> la **spec d'implémentation définitive**. Après ceci, on code.

---

## Verdicts finaux — Toutes divergences résolues

### Q1 — Extracteur : EXTRACTEUR UNIQUE + VÉRIFICATEUR

**Score : 5 voix Camp B (unique+vérif) vs 1 voix Camp A (double)**

| Modèle | Verdict | Variante |
|--------|---------|----------|
| DeepSeek | Unique + vérification phrase par phrase | Vérificateur OUI/NON par phrase |
| Mistral | Unique + vérificateur d'exhaustivité | Même extracteur, 2ème passe |
| Gemini | Unique + vérificateur booléen léger | Modèle Tier 1, ajout seulement |
| Qwen | Unique + scoring couverture cosinus | Alerte si couverture < 0.7 |
| **MiniMax** | **Double extracteur** | Union pondérée des claims |
| ChatGPT | (observateur) | Penche vers compromis |

**Verdict définitif** : Extracteur unique (modèle rapide/cheap) + vérificateur
d'exhaustivité léger. Le vérificateur ne ré-extrait pas — il vérifie que
chaque phrase source est couverte par au moins un claim.

**Argument décisif** (MiniMax lui-même l'a fourni involontairement) :
> "Camp B = 1 extraction + 1 vérification = 2 calls. Même coût."
> Exact — donc à coût égal, le vérificateur est plus ciblé (il cherche les
> trous) là où un 2ème extracteur refait le même travail avec les mêmes biais.

**Implémentation** :
```
Phase 2a — Extraction (modèle cheap, ex: Haiku/Flash/4o-mini)
  Prompt: "Extrais TOUS les points, même mineurs. Si tu résumes, marque is_aggregated: true."
  → Liste de claims atomiques

Phase 2b — Vérification d'exhaustivité (même modèle ou plus léger)
  Prompt: "Pour chaque phrase source, OUI/NON est-elle capturée par un claim ?"
  → Si > 5% de NON → relance Phase 2a avec prompt renforcé
  → Les phrases orphelines sont ajoutées comme claims avec tag "recovered"
```

---

### Q2 — Mémoire : INJECTION SÉLECTIVE + TOOL

**Score : 4 voix injection sélective vs 2 voix sur demande seule**

| Modèle | Verdict |
|--------|---------|
| DeepSeek | Injection auto filtrée (confiance > 0.8, similarité > 0.85) |
| Mistral | Injection auto top 3 blind spots > 0.8 |
| Qwen | Injection auto sélective + tool pour le reste |
| **MiniMax** | **Sur demande seule** + seed unique au Round 1 |
| **Gemini** | **Sur demande seule** via tool |
| ChatGPT | (observateur) — note le risque de "déjà-vu loop" |

**Verdict définitif** : Injection sélective automatique (max 3 blind spots,
confiance > 0.8, divergence > 0.6 avec contexte actuel) + tool `queryPastDebates`
pour la recherche manuelle.

**Compromis retenu** (proposition MiniMax adaptée) :
L'injection se fait en **seed du Round 1 uniquement** — pas dans le system
prompt persistant. Formulée comme hypothèses à vérifier, pas comme faits :
> "Previous debates on similar code flagged: [X], [Y]. Verify or refute."

Le seed disparaît après la Phase 1. Le tool reste disponible pour toutes les phases.

**Garde-fous** :
- TTL 7 jours (Qwen) sur les claims injectés
- Hash du contexte pour éviter la redondance
- Flag `[HISTORIQUE]` explicite
- Désactivable via `--no-memory`

---

### Q3 — Jargon Trap : VÉRIFICATEUR INTÉGRÉ EN PHASE 2

**Consensus : tous d'accord sur le principe, divergence mineure sur l'implémentation**

**Verdict définitif** : Vérificateur de jargon intégré au `ClaimExtractor` (pas
un composant séparé). Grep du codebase + doc sur les termes techniques en
CamelCase/PascalCase. Distinction inventé vs proposé :

```
Si le claim dit "il existe un DebateBus" → grep → pas trouvé → ⚠️ UNVERIFIED
Si le claim dit "créons un DebateBus" → pas vérifié → tag "proposed"
```

**Règle** : Ne jamais supprimer un claim. Marquer et laisser le juge décider.

---

### Q4 — Métacognition : INTÉGRÉE AU RAPPORT, TIER 2+

**Consensus : tous d'accord sur le principe, divergence sur le seuil d'activation**

| Modèle | Activation |
|--------|-----------|
| MiniMax | Tier 3 seulement, opt-in |
| DeepSeek | Tier 2+ |
| Mistral | Tier 2+ |
| Gemini | Tier 3 seulement |
| Qwen | Tier 2+ automatique |

**Verdict définitif** : Intégrée au rapport principal (pas de composant séparé),
activée en Tier 2+. Le juge produit synthèse + méta en un seul prompt (coût
marginal nul, argument décisif de Qwen).

**Métrique de fragilité** :
```
fragilité = désaccords_persistants_phase3 / désaccords_phase1
```
- Score 0 = consensus solide (tous les désaccords résolus)
- Score 1 = consensus artificiel (aucun désaccord résolu, juste ignoré)
- Si > 0.6 : flag `[CONSENSUS FRAGILE]` dans le rapport

Alimente la mémoire collective pour ajuster les futurs pipelines.

---

### Q5 — Mesure de valeur : BASELINE SHADOW + 5 MÉTRIQUES

**Consensus fort sur le principe, convergence sur l'implémentation**

**Verdict définitif** : 5 métriques, baseline via shadow run du meilleur modèle
seul en parallèle (opt-out, pas opt-in).

| # | Métrique | Mesure | Source |
|---|---------|--------|--------|
| 1 | **Blind Spot Count** | Claims uniques validés par le débat | Auto |
| 2 | **Coverage Dimensionality** | Nb de catégories touchées vs single model | Auto |
| 3 | **Hallucination Reduction** | Claims vérifiés échoués (débat vs single) | Auto |
| 4 | **User Action Rate** | % de blind spots sur lesquels l'user agit | Feedback |
| 5 | **Cost per Valid Insight** | $/insight actionnable | Auto |

**Affichage** : Badge concis dans le rapport final :
> "+4 blind spots vs single-model, -2 hallucinations, $0.62/insight"

Mode A/B silencieux sur 10% des débats Tier 2+ pour calibrer les métriques.

---

### Red Team : CONDITIONNEL

**Score : 5 voix conditionnel vs 1 voix permanent**

**Verdict définitif** : Conditionnel avec tiering :
- Tier 0-1 : OFF
- Tier 2 : activé si cosinus similarité > 0.85 entre claims
- Tier 3 : activé si cosinus > 0.75 OU automatique

Modèle cheap, seuil configurable par l'utilisateur.

---

## Les 6 Insights Uniques du Round 3

Après 3 rounds et 20+ réponses, les derniers insights sont les plus profonds :

### 1. Corrélation cachée des modèles (ChatGPT)
> "5 modèles entraînés sur le même internet = potentiellement 1 erreur partagée.
> Un consensus fort peut être un biais collectif, pas une vérité."

**Impact** : Distinguer "consensus indépendant" (chemins de raisonnement
différents) vs "consensus corrélé" (mêmes arguments, mêmes références).
Mesurer l'Information Gain, pas juste le nombre d'insights.

**Action** : Avant de shipper, mesurer la corrélation pairwise des blind spots
sur un benchmark de code réel. Si corrélation inter-modèles > 0.7, la promesse
de diversité est fragile.

### 2. Routeur pré-débat (MiniMax)
> "Le routeur EST le produit — le débat est juste le chemin coûteux.
> Sans routeur, la feature brûle le budget sur des questions triviales."

**Impact** : Un classifier `(complexity × stakes × controversy_potential)`
qui route vers le bon tier. C'est l'équivalent d'un triage aux urgences.

**Action** : Implémenter comme première feature, avant même le pipeline complet.

### 3. Shadow Debate continu (DeepSeek)
> "Un modèle local léger analyse chaque requête importante en arrière-plan.
> Si divergence critique détectée, alerte discrète — sans rien demander."

**Impact** : Fusionne débat explicite et monitoring implicite. Le Blind Spot
Hunter ne se manifeste que quand il a quelque chose d'important à dire.

**Action** : Phase 2 du produit, après le MVP. Nécessite un modèle local (Ollama).

### 4. Paradoxe du débat optimal (Mistral)
> "Plus le système est efficace, moins il est utilisé. Les devs cessent
> de vérifier manuellement → désapprentissage → boucle de feedback brisée."

**Impact** : Prévoir un mécanisme de maintien de l'engagement humain.
User Action Rate comme métrique clé.

### 5. Adversarial Canary (Gemini)
> "Injecter un bug synthétique dans le contexte avant le débat. Si les
> modèles ne le trouvent pas → score de confiance du rapport drastiquement
> réduit. C'est un unit test du pipeline lui-même."

**Impact** : Seul mécanisme proposé pour tester la fiabilité du système
en temps réel, pas juste en benchmark. Brillant et implémentable.

**Action** : Activer en Tier 3 uniquement (coût du canary + vérification).

### 6. Halting Problem du débat (Qwen)
> "Quand le gain d'information marginal devient-il inférieur au coût marginal ?
> Critère d'arrêt information-theoretic, pas arbitraire."

**Impact** : Remplace le "max 2 tours" rigide par un arrêt adaptatif :
```
marginalGain = newClaimsThisRound / totalClaimsAllRounds
marginalCost = costThisRound / totalBudgetRemaining
if (marginalGain < 0.1 && marginalCost > 0.2) → STOP
```

**Action** : Implémenter dans `DebateOrchestrator`, configurable.

---

## Spec d'implémentation définitive

### Architecture

```
packages/opencode/src/collective/
├── index.ts              — Export public, enregistrement de l'agent
├── types.ts              — Claim, DebateReport, DebateError, DebateConfig
├── debate-agent.ts       — Agent natif (Agent.Info)
├── orchestrator.ts       — DebateOrchestrator (coordination des 4 phases)
├── provider-discovery.ts — Cascade auth (env → cred file → CLI)
├── claim-extractor.ts    — Extraction + vérification d'exhaustivité
├── synthesis-judge.ts    — Juge non-participant + métacognition
├── debate-store.ts       — SQLite + index vectoriel (LanceDB)
├── role-assigner.ts      — Meta-prompt pour rôles dynamiques
├── red-team.ts           — Red Team conditionnel
├── jargon-checker.ts     — Vérificateur d'ancrage codebase
├── budget-tracker.ts     — Kill-switch + estimation + tiers
└── metrics.ts            — Shadow baseline + 5 métriques de valeur
```

### Pipeline complet

```
┌─ PRÉ-DÉBAT ─────────────────────────────────────────────┐
│ 1. /debate "prompt"                                      │
│ 2. ProviderDiscovery → audit credentials + ghost models  │
│ 3. RoleAssigner → rôles dynamiques par meta-prompt       │
│ 4. BudgetTracker → estimation coût, choix du tier        │
│ 5. DebateStore → seed mémoire (top 3 blind spots passés) │
│ 6. Affichage estimation → user confirme [Y/n]            │
└──────────────────────────────────────────────────────────┘

┌─ PHASE 1 : DIVERGE (parallèle) ─────────────────────────┐
│ N modèles répondent indépendamment                       │
│ Rôles spécialisés + clause "hors rôle"                   │
│ Effect.all + Effect.timeout par provider                  │
│ [Tier 3] Canary synthétique injecté                      │
│ Streaming vers TUI (spinner par modèle)                  │
└──────────────────────────────────────────────────────────┘

┌─ PHASE 2 : CARTOGRAPHIE ────────────────────────────────┐
│ 2a. Extraction (modèle cheap) → claims atomiques JSON    │
│ 2b. Vérification exhaustivité (OUI/NON par phrase)       │
│     Si > 5% NON → relance 2a avec prompt renforcé        │
│ 2c. JargonChecker → grep codebase sur termes techniques  │
│     "existe" → vérifier, "proposé" → laisser passer      │
│ 2d. Anonymisation → hash-masking des sourceIds            │
│ 2e. Classification → consensus / minority / unique        │
└──────────────────────────────────────────────────────────┘

┌─ PHASE 3 : CONVERGENCE CIBLÉE (max adaptatif) ──────────┐
│ Seuls les claims controversés/uniques sont re-soumis      │
│ Claims ANONYMES (pas d'attribution visible)               │
│ Chaque modèle critique les claims, pas les auteurs        │
│ [Conditionnel] Red Team si cosinus > seuil                │
│ Critère d'arrêt : marginalGain < 0.1 && cost > 0.2       │
│ Le juge reçoit vecteur fiabilité (fingerprint) en sidecar │
└──────────────────────────────────────────────────────────┘

┌─ PHASE 4 : SYNTHÈSE ────────────────────────────────────┐
│ Juge non-participant (ou meilleur avec anonymisation)     │
│ Ré-attribution des claims dans le rapport final           │
│ [Tier 2+] Section métacognition intégrée                 │
│ [Tier 3] Vérification du Canary                          │
│ [Background] Shadow baseline (meilleur modèle seul)       │
│ Calcul des 5 métriques de valeur                         │
│ Sauvegarde dans DebateStore (SQLite)                     │
└──────────────────────────────────────────────────────────┘

┌─ RAPPORT FINAL ──────────────────────────────────────────┐
│ { consensus, blind_spots, unresolved_conflicts,           │
│   traceability, meta: { fragility, halting_analysis },    │
│   value_metrics: { blind_spot_count, coverage, ... } }    │
│ Rendu Markdown dans TUI                                   │
│ Badge: "+X blind spots vs single-model"                   │
│ Sauvegardé: .opencode/debates/<id>.json                   │
└──────────────────────────────────────────────────────────┘
```

### Tiers budgétaires

| Tier | Modèles | Phases | Red Team | Méta | Canary | Coût |
|------|---------|--------|----------|------|--------|------|
| 0 Free | Gratuits détectés | 1+4 | OFF | OFF | OFF | $0 |
| 1 Quick | 2-3 | 1+2+4 | OFF | OFF | OFF | $0.05-0.50 |
| 2 Standard | 4-5 | Complet | Cond. | ON | OFF | $0.50-3 |
| 3 Deep | 6-8, rôles | Complet | Agressif | ON | ON | $3-15 |

### Erreurs Effect typées

```typescript
type DebateError =
  | { _tag: "ProviderTimeout"; provider: string; ms: number }
  | { _tag: "RateLimitExceeded"; provider: string; retryAfter?: number }
  | { _tag: "ExtractionIncomplete"; coverage: number; threshold: number }
  | { _tag: "BudgetExhausted"; spent: number; limit: number }
  | { _tag: "NoProviderAvailable" }
  | { _tag: "CanaryMissed"; confidence: "degraded" }
```

---

## Roadmap d'implémentation

| Phase | Livrable | Dépendances |
|-------|---------|-------------|
| **P0** | Credential Discovery (`discoverAll()`) | Aucune |
| **P1** | MVP : `/debate` avec 2+ providers, Tier 1 pipeline | P0 |
| **P2** | Pipeline complet (4 phases, rôles, anonymisation) | P1 |
| **P3** | Mémoire collective (SQLite + injection sélective) | P2 |
| **P4** | Métriques de valeur (shadow baseline, 5 métriques) | P2 |
| **P5** | Red Team conditionnel + Canary (Tier 3) | P2 |
| **P6** | Routeur pré-débat (auto-tiering) | P4 (besoin des métriques) |
| **P7** | Shadow Debate continu (modèle local en background) | P2 + Ollama |

---

## Bilan du processus de débat

### Ce que 3 rounds ont produit

| Métrique | Valeur |
|----------|--------|
| Modèles interrogés | 8 |
| Réponses totales | 20+ |
| Questions posées | 21 (7+8+6) |
| Consensus unanimes | 12 |
| Divergences résolues | 6 |
| Blind spots découverts | 15 |
| Insights uniques | 15 (6 R1 + 3 R2 + 6 R3) |

### Les 3 insights les plus transformateurs (sur 15)

1. **Role-Prompting Asymmetry** (Gemini R1) — élimine 80% de redondance
2. **Adversarial Canary** (Gemini R3) — unit test du pipeline lui-même
3. **Corrélation cachée des modèles** (ChatGPT R3) — le risque existentiel

### Preuve de concept du Blind Spot Hunter

Ce débat EST la preuve de concept. En 3 rounds manuels, le processus a
trouvé 15 insights qu'aucun modèle seul n'aurait tous identifiés. Les
insights les plus précieux venaient systématiquement de modèles inattendus
(Gemini pour l'architecture, MiniMax pour le routeur, Mistral pour le
jargon trap). La feature automatise ce processus.
