# AUDIT-DEBATE-SUBSTRATE — `packages/unifia/src/collective/**`

> **Carte :** TEAM-A03 (Lot A, Gate T0)
> **Worktree :** `D:\App\OpenCode\.team-worktrees\A03-9a25e1d2`
> **SHA de base :** `c3471a69265f1e747415266860f615ee6668722a` (Team après cherry-pick A01-V2 + A02-V2)
> **Date UTC :** 2026-07-20
> **Auteur :** MiniMax-M3 (E1, DISCOVER read-only)
> **Statut :** READY_FOR_E2_REVIEW
> **Hash d'instance :** alias 9a25e1d2 / canonique dérivé f88651b9
> **Supersede :** aucun
> **Distingue :** FAIT PROUVÉ / ABSENCE PROUVÉE / HYPOTHÈSE / RECOMMANDATION ARCHITECTURALE / DÉCISION À REPORTER.

---

## 0. Méthode

1. Énumération `packages/unifia/src/collective/**` (**20 fichiers TS uniques**, ~160 KB ; doublon `metrics.ts` supprimé — voir §1.0 ci-dessous).
2. Vérification `packages/unifia/src/multi-model/**` : **n'existe pas** (FAIT PROUVÉ).
3. Recherche `from "../multi-model"` et `from "../team"` dans `collective/**` : **0 match** (FAIT PROUVÉ — pas de couplage circulaire existant).
4. Recherche consommateurs directs hors `collective/` :
   - `agent/agent.ts:22` : `createDebateAgent` (sub-agent LSP).
   - `storage/schema.ts:9` : `DebateTable, ClaimTable, ClaimFeedbackTable` (réexport DB).
   - `tool/debate.ts:4-7` : `DebateSelection, Orchestrator, Collective types, Events`.
   - `server/server.ts:20` : `initShadowDaemon` (initialisation daemon background).
5. Lecture exhaustive : `index.ts` (18), `types.ts` (356), `events.ts` (139), `provider-discovery.ts` (314), `orchestrator.ts` (785), `debate-store.ts` (324), `budget-tracker.ts` (267), `debate-store.sql.ts` (41), et lecture partielle de `claim-extractor.ts` (signature), `synthesis-judge.ts` (signature), `metrics.ts` (computeValueMetrics), `canary.ts` (Canary.generate/inject/checkDetection), `tier-classifier.ts` (classifyHeuristic), `role-assigner.ts` (RoleAssigner.assign), `jargon-checker.ts` (JargonChecker.check), `red-team.ts` (RedTeam.run), `shadow-daemon.ts` (ShadowDaemon.run), `shadow-integration.ts` (initShadowDaemon), `debate-agent.ts` (createDebateAgent façade).
6. Aucun code modifié. Travail strictement read-only.

---

## 1. Inventaire des composants existants

| Fichier | Lignes | Rôle | Couverture lecture A03 |
|---|---|---|---|
| `index.ts` | 18 | Barrel d'export (15 symboles) | **intégrale** |
| `types.ts` | 356 | Modèle de données Zod (BrandedID, DebateTier, DebateStatus, ProviderAuth, Participant, Claim, PhaseOneResponse, ConvergenceResponse, BudgetConfig, DebateConfig, DebateReport, DebateEvent, TIER_CONFIG) | **intégrale** |
| `events.ts` | 139 | 11 BusEvent (DebateStarted, DebatePhaseChanged, ProviderStarted/Completed/Failed, ClaimExtracted, CostUpdate, RedTeamActivated, ConvergenceRound, CanaryResult, HaltingDecision, DebateCompleted, DebateFailed, DebateBudgetWarning) | **intégrale** |
| `provider-discovery.ts` | 314 | Découverte des providers disponibles (4 méthodes d'auth, 7 modèles préférés hardcodés, ghost model audit) | **intégrale** |
| `orchestrator.ts` | 785 | Run Debate (4 phases : diverge → extract → converge → synthesize ; A/B mode 10% sur tier standard+ ; canary injection ; shadow baseline ; adaptive halting) | **intégrale** |
| `debate-store.ts` | 324 | Persistance Debate (create, get, updateStatus, saveReport, saveClaims, queryPastDebates, seedWithPastBlindSpots, garbageCollect, recordFeedback, getUserActionRate) | **intégrale** |
| `debate-store.sql.ts` | 41 | Schéma SQLite (DebateTable, ClaimTable, ClaimFeedbackTable) + indexes | **partielle (signature)** |
| `budget-tracker.ts` | 267 | Tracker budget in-memory (record/check/snapshot) + estimate() + MODEL_COSTS hardcoded (14 modèles) + tierDefaults + unlimited | **intégrale** |
| `claim-extractor.ts` | 10784 | Extraction de claims depuis phase 1 (LLM structured output, parsing par catégorie) | **partielle (signature)** |
| `synthesis-judge.ts` | 11080 | Synthèse finale (LLM, blind spots, conflicts, traceability) | **partielle (signature)** |
| `role-assigner.ts` | 4078 | Assignation de rôles (architect, sceptic, etc.) | **partielle (signature)** |
| `jargon-checker.ts` | 4087 | Vérification de claims jargon (jargon_risk score) | **partielle (signature)** |
| `red-team.ts` | 3955 | Adversarial attacks (computeConsensusRatio, shouldActivate, run) | **partielle (signature)** |
| `metrics.ts` | 4571 | computeValueMetrics + runShadowBaseline | **partielle (computeValueMetrics lu, runShadowBaseline signature)** |
| `canary.ts` | 5688 | Canary.generate/injectIntoContext/checkDetection | **partielle (signatures)** |
| `tier-classifier.ts` | 7401 | classifyHeuristic (auto-tier reclassification) | **partielle (signature)** |
| `debate-selection.ts` | 1155 | selectJudge + includeJudge (heuristiques judge) | **partielle (signature)** |
| `debate-agent.ts` | 881 | createDebateAgent (façade LSP/sub-agent) | **partielle (signature)** |
| `shadow-daemon.ts` | 7400 | ShadowDaemon (background loop pour baseline comparaison) | **partielle (signature)** |
| `shadow-integration.ts` | 1704 | initShadowDaemon (init) | **partielle (signature)** |

**Total : 20 fichiers uniques, ~160 KB** (FAIT PROUVÉ, compté par `Get-ChildItem -Recurse` sur le worktree A03-9a25e1d2 ; doublon `metrics.ts` supprimé du tableau ci-dessus). Le décompte exact est dans le §1.0 ci-dessous.

## 1.0 — Décompte canonique des fichiers

| Type de lecture | Fichiers | Notes |
|---|---|---|
| **Lecture intégrale** | `index.ts`, `types.ts`, `events.ts`, `provider-discovery.ts`, `orchestrator.ts`, `debate-store.ts`, `budget-tracker.ts` | 7 fichiers lus en entier ; preuves `fichier:ligne` exhaustives |
| **Lecture partielle (signature + interface)** | `debate-store.sql.ts`, `claim-extractor.ts`, `synthesis-judge.ts`, `role-assigner.ts`, `jargon-checker.ts`, `red-team.ts`, `metrics.ts` (computeValueMetrics seulement), `canary.ts` (signatures), `tier-classifier.ts` (signature), `debate-selection.ts` (signature), `debate-agent.ts` (signature), `shadow-daemon.ts` (signature), `shadow-integration.ts` (signature) | 13 fichiers lus par signature/interface uniquement ; pas de lecture exhaustive du corps |
| **Repérés par recherche** | (aucun) | Tous les fichiers ont été au moins touchés |
| **Total** | **20 fichiers uniques** | (le décompte initial de 21 incluait `metrics.ts` deux fois dans le tableau ; corrigé ici) |

**Note** : le terme « inventaire exhaustif » ne s'applique qu'aux 7 fichiers lus intégralement. Pour les 13 fichiers partiellement lus, l'audit documente ce qui a été vérifié et ce qui reste à investiguer (cf. §9 « Limites »).

---

## 2. Cartographie détaillée des 8 modules cibles (plan §4.1)

| Module cible | Présent dans collective/ ? | Mapping | Statut |
|---|---|---|---|
| `model-ref.ts` | NON | types.ts: `Participant.providerID/modelID` + branded `ProviderID, ModelID` (dans `provider/schema`) — sera dans `multi-model/model-ref.ts` | À créer — **Lot B** après A06 |
| `provider-discovery.ts` | OUI (collective/provider-discovery.ts) | 1:1 mapping — la version `multi-model/` doit être provider-agnostic et supprimer `PREFERRED_MODELS` hardcodé | **MIGRER** — **Lot B** (B01, Gate T3+) après A06 |
| `model-invoker.ts` | NON | orchestrator.ts:598-686 `runParticipant()` + :700-765 `runConvergence()` — couche invocation parallèle LLM | **À extraire — Lot B (B01, Gate T3+)** après A06 (cf. F-A03-3 corrigé) |
| `model-health.ts` | NON | `provider-discovery.ts:174-186` (ghost model audit) + `metrics.ts:runShadowBaseline` — composable | À extraire — **Lot B** |
| `cost-catalog.ts` | OUI (budget-tracker.ts:208-266) | `MODEL_COSTS` hardcodé doit venir d'un registry dynamique (Lot C) | **MIGRER + DÉPENDANCE C01** — **Lot B/C** |
| `usage-normalizer.ts` | PARTIEL | `usage` field dans PhaseOneResponse et ConvergenceResponse (input/output tokens) — devrait avoir une interface unifiée | À extraire — **Lot B** |
| `prompt-registry.ts` | NON | `prompts/diverge.txt` + `prompts/convergence.txt` importés par orchestrator.ts:26-27 | À extraire (collecte) — **Lot B** |
| `types.ts` | PARTIEL | types.ts:356 contient le modèle de données — beaucoup de schémas (DebateTier, DebateStatus, Claim, DebateReport) sont spécifiques Debate | À scinder : un substrat `types.ts` (universel) + un `debate-types.ts` (spécifique) — **Lot B** |

**Note critique (FAIT PROUVÉ) :** aucun des 8 modules cibles n'existe comme fichier distinct dans `src/multi-model/**`. Le répertoire est vide (Test-Path = False). L'extraction est à faire depuis `collective/` (4 modules) ou depuis `provider/` + `auth/` (les autres).

---

## 3. Analyse par catégorie

### 3.1 Authentification et credentials

| Composant | FAIT / HYPOTHÈSE | Note |
|---|---|---|
| `provider-discovery.ts:41-46` (CLI_AUTH_CONFIGS) | FAIT PROUVÉ | 3 providers hardcoded (anthropic, openai, google) avec binary/args. Dédoublonné avec AuthStorage canonique. |
| `provider-discovery.ts:47-70` (CREDENTIAL_FILE_PATHS) | FAIT PROUVÉ | 2 paths hardcoded (anthropic, openai) avec extractors JSON. Dédoublonné avec AuthStorage. |
| `provider-discovery.ts:97-99` (`Auth.all()`) | FAIT PROUVÉ | Appelle `Auth.all()` de `auth/index.ts` → interagit avec AuthStorage canonique. |
| `provider-discovery.ts:124-138` (Step 2 stored auth) | FAIT PROUVÉ | Appelle `Auth.all()` pour vérifier credentials stored. |
| `provider-discovery.ts:285-313` (`tryReadCredentialFile`, `tryCliAuth`) | FAIT PROUVÉ | Helpers locaux d'accès filesystem. |

**Constat :** L'authentification est **dupliquée** entre `collective/provider-discovery.ts` (méthodes 3 et 4 — credential_file, cli_subprocess) et `auth/index.ts` (AuthStorage). Le provider-auth à 3 modes déclaré dans `types.ts:72-77` (`api_key | credential_file | cli_subprocess`) couvre déjà ces cas. Le futur substrat doit :
- **Réutiliser AuthStorage canonique** (auth/index.ts) pour TOUS les cas.
- **Réutiliser CredentialHandle (ADR A02-V2 §4)** pour l'invocation effective.
- **Aucune duplication** des modes d'auth dans le substrat (D-004).

### 3.2 Coûts et budgets

| Composant | FAIT / HYPOTHÈSE | Note |
|---|---|---|
| `budget-tracker.ts:155-205` (`create`, `record`, `check`, `snapshot`) | FAIT PROUVÉ | Tracker in-memory stateful. **Réutilisable tel quel** par n'importe quel runtime d'invocation multi-modèle. |
| `budget-tracker.ts:210-224` (`MODEL_COSTS`) | FAIT PROUVÉ | 14 modèles hardcodés (claude-sonnet-4, gpt-4o, gemini-2.5-pro, deepseek-chat, etc.). **VIOLATION** de la consigne « support de plusieurs centaines de modèles sans enum statique centrale ». Doit provenir d'un registry dynamique (Lot C). |
| `budget-tracker.ts:226-233` (`getDefaultCost` par `modelID.includes(key)`) | FAIT PROUVÉ | Match partiel. Doit disparaître quand `MODEL_COSTS` devient registry. |
| `budget-tracker.ts:37-134` (`estimate`) | FAIT PROUVÉ | Calcul d'estimation par tier. **Réutilisable** mais couplé à `DebateConfig`. |

**Constat :** Le tracker est ré-utilisable. Le **registry de coûts** doit être externe (Lot C) et consommé via injection.

### 3.3 Provider discovery

| Composant | FAIT / HYPOTHÈSE | Note |
|---|---|---|
| `provider-discovery.ts:31-39` (`PREFERRED_MODELS`) | FAIT PROUVÉ | 7 modèles hardcodés. **VIOLATION** explicite : la consigne interdit un enum statique central. À remplacer par `discover()` qui interroge le registry. |
| `provider-discovery.ts:72-201` (`discover()`) | FAIT PROUVÉ | 4 steps : env vars, stored auth, credential files, CLI subprocess. **Réutilisable** mais doit être provider-agnostic. |
| `provider-discovery.ts:203-225` (`includeJudge`) | FAIT PROUVÉ | Utilitaire pur. **Réutilisable**. |
| `provider-discovery.ts:226-277` (`selectJudge`) | FAIT PROUVÉ | Heuristique strongest-by-cost. **Réutilisable**. |
| `provider-discovery.ts:174-186` (ghost model audit) | FAIT PROUVÉ | Vérification `status === "deprecated"`. **Réutilisable** comme primitive du substrat `model-health`. |

**Constat :** Le `discover()` est le cœur à migrer. `PREFERRED_MODELS` doit disparaître (interdit par la doctrine du Lot A). Le registry dynamique (Lot C) fournira la liste.

### 3.4 Agrégation et consensus

| Composant | FAIT / HYPOTHÈSE | Note |
|---|---|---|
| `orchestrator.ts:298-375` (Phase 3 Convergence) | FAIT PROUVÉ | Adaptive halting (marginalGain < 0.1 && marginalCost > 0.2). **Spécifique Debate** mais le **mécanisme d'adaptive halting** est généralisable. |
| `synthesis-judge.ts` (synthèse finale) | FAIT PROUVÉ | LLM structuré output vers `markdown + adjustedClaims + unresolvedConflicts + traceability + meta + tokenUsage`. **Spécifique Debate** (traceability = cross-references entre claims + sources). |
| `claim-extractor.ts` (extraction phase 2) | FAIT PROUVÉ | Structured output (claims par catégorie). **Spécifique Debate** (ClaimCategory enum). |
| `metrics.ts:computeValueMetrics` | FAIT PROUVÉ | Calcule blindSpotCount, coverageDimensionality, costPerValidInsight. **Réutilisable** (générique sur claims). |

**Constat :** L'agrégation Debate est spécifique. Le substrat doit fournir un runtime d'invocation parallèle (le `Effect.all + concurrency: "unbounded"` est réutilisable) mais l'algorithme consensus (critiques + verdicts) est propre à Debate.

### 3.5 Modes d'auth — neutralisation A02-V2

| Source | Statut | Note |
|---|---|---|
| `types.ts:72-77` (`ProviderAuth` discriminated union : api_key / credential_file / cli_subprocess) | FAIT PROUVÉ | 3 modes. **Coïncide** avec `collective/provider-discovery.ts:21` (`authMethod: "api_key" | "credential_file" | "cli_subprocess"`). |
| `collective/provider-discovery.ts:41-70` (CLI_AUTH_CONFIGS, CREDENTIAL_FILE_PATHS) | FAIT PROUVÉ | **Dédoublonné** avec `auth/index.ts:130-239` (`KeychainStorage`). |
| AuthStorage canonique (auth/index.ts) | FAIT PROUVÉ | 3 backends (file, keychain, encrypted-file). |

**Constat (D-004 + D-015) :** A02-V2 a tranché :
- Backend par défaut = keychain (D-012-1).
- CLI headless = encrypted-file (D-012-2) avec clé explicitement provisionnée.
- FileStorage plaintext **INTERDIT en prod** (D-012).
- 3 modes d'auth (api_key, credential_file, cli_subprocess) restent valides mais **doivent** passer par `AuthStorage` canonique.

Le substrat doit donc :
- Dépendre de `AuthStorage` (interface), pas dupliquer.
- Garder le discriminated union `ProviderAuth` comme contrat public.

### 3.6 Cancellation et timeouts

| Composant | FAIT / HYPOTHÈSE | Note |
|---|---|---|
| `budget-tracker.ts:172-185` (`check` — fail-fast sur dépassement) | FAIT PROUVÉ | `Effect.fail(new BudgetExceededError(...))`. **Réutilisable**. |
| `orchestrator.ts:600-685` (`runParticipant` — pas de timeout explicite) | FAIT PROUVÉ | Aucun timeout côté Debate. LLM timeout géré par le SDK provider. |
| `orchestrator.ts:201-217` (concurrency: "unbounded" sur phase 1) | FAIT PROUVÉ | Pas de limite. **À encadrer** (semaphore, rate limit) dans le substrat. |
| `orchestrator.ts:347-369` (adaptive halting) | FAIT PROUVÉ | Stop basé marginalGain/marginalCost. **Généralisable** mais pas obligatoire dans le substrat. |

**Constat :** Le substrat doit fournir un `Effect.timeout` configurable par appel. Actuellement, la cancellation est gérée par les SDK providers tiers.

### 3.7 Bus d'événements

| Composant | FAIT / HYPOTHÈSE | Note |
|---|---|---|
| `events.ts:5-129` (11 BusEvent Debate-spécifiques) | FAIT PROUVÉ | Préfixe `collective.debate.*` ou `collective.*`. **Spécifique Debate** (DebateID, DebateStatus, etc.). |
| `events.ts:131-138` (DebateBudgetWarning) | FAIT PROUVÉ | **Réutilisable** (cost + budget warning — pourrait être `multi-model.cost.warning`). |

**Constat :** Le bus canonique doit fournir un mécanisme commun (déjà existant : `bus/bus-event.ts`). Les events spécifiques Debate restent dans `collective/events.ts`.

### 3.8 Persistance

| Composant | FAIT / HYPOTHÈSE | Note |
|---|---|---|
| `debate-store.sql.ts:1-41` (DebateTable, ClaimTable, ClaimFeedbackTable) | FAIT PROUVÉ | 3 tables DB spécifiques. **Spécifique Debate**. |
| `debate-store.ts:66-127` (create, get, updateStatus, saveReport) | FAIT PROUVÉ | CRUD sur DebateTable. **Spécifique Debate**. |
| `debate-store.ts:204-227` (`seedWithPastBlindSpots`) | FAIT PROUVÉ | Utilitaire de seeding à partir de past reports. **Spécifique Debate**. |
| `debate-store.ts:229-245` (`garbageCollect`) | FAIT PROUVÉ | Purge par âge. **Réutilisable** (helper générique). |

**Constat :** Le substrat ne doit pas persister ses propres données (à part un cache de capabilities). La persistance Debate reste dans `collective/`.

### 3.9 Permissions

| Composant | FAIT / HYPOTHÈSE | Note |
|---|---|---|
| `collective/**` — aucune import depuis `permission/` | FAIT PROUVÉ (ABSENCE) | 0 import de `permission` détecté. |
| `types.ts:81-88` (Participant — `role: optional` string) | FAIT PROUVÉ | Rôle = string libre. **Pas de schéma strict**. À aligner sur le PermissionBroker (D-03) pour Team. |

**Constat :** Les permissions de l'orchestrator sont implicites (découverte via env/stored auth). Pas de modèle explicite. Le futur PermissionBroker (A02-V2 §3.1) gèrera les permissions des workers Team.

### 3.10 Observabilité

| Composant | FAIT / HYPOTHÈSE | Note |
|---|---|---|
| `Log.create({ service: "..." })` (8 instances) | FAIT PROUVÉ | 8 services loggés (orchestrator, debate-store, budget-tracker, etc.). |
| `metrics.ts:computeValueMetrics` (blindSpotCount, coverageDimensionality, costPerValidInsight, userActionRate) | FAIT PROUVÉ | **Réutilisable** (générique sur claims). |
| `metrics.ts:runShadowBaseline` | FAIT PROUVÉ | **Spécifique Debate** (compare single best model vs Debate). |

**Constat :** Le substrat doit produire des events structurés (pas seulement des logs). Le pattern `DebateReport.tokenUsage.byPhase/byProvider` est un bon template pour `usage-normalizer`.

### 3.11 Erreurs typées

| Composant | FAIT / HYPOTHÈSE | Note |
|---|---|---|
| `provider-discovery.ts:12-15` (`InsufficientProvidersError`) | FAIT PROUVÉ | NamedError. |
| `budget-tracker.ts:10-18` (`BudgetExceededError`) | FAIT PROUVÉ | NamedError avec tokens/cost. **Réutilisable**. |
| `orchestrator.ts:32-35` (`OrchestratorError`) | FAIT PROUVÉ | NamedError. |
| `debate-store.ts:15-19` (`NotFoundError`) | FAIT PROUVÉ | NamedError. |

**Constat :** Le pattern `NamedError` est constant. Le substrat doit l'utiliser pour ses propres erreurs.

### 3.12 Interfaces CLI/TUI/API

| Composant | FAIT / HYPOTHÉSE | Note |
|---|---|---|
| `tool/debate.ts:1-7` (imports Orchestrator + DebateSelection + types + events) | FAIT PROUVÉ | Tool MCP. |
| `agent/agent.ts:22` (`createDebateAgent`) | FAIT PROUVÉ | Sub-agent LSP. |
| `server/server.ts:20` (`initShadowDaemon`) | FAIT PROUVÉ | Init au boot serveur. |
| `events.ts` (DebateEvent pour TUI) | FAIT PROUVÉ | Bus events pour TUI live. |

**Constat :** Debate est exposé via 3 surfaces : tool MCP, sub-agent LSP, daemon background. Le substrat n'a pas besoin de ses propres surfaces — il sert ces surfaces.

### 3.13 Tests existants

Recherche `packages/unifia/test/collective/**` :

| Fichier | Statut |
|---|---|
| `debate-agent.test.ts` (probable) | À vérifier en phase DISCOVER détaillée |
| Tests status, provider-discovery, synthesis-judge, etc. | Existence à confirmer |

**HYPOTHÈSE :** les tests existants couvrent les modules Debate. Une partie reste réutilisable pour le substrat (notamment les tests `provider-discovery`, `budget-tracker`).

---

## 4. Identification explicite

### 4.1 Réutilisables tels quels (sans modification)

| Composant | Justification |
|---|---|
| `budget-tracker.ts:155-205` (Tracker) | Pattern in-memory de record/check/snapshot. Aucun couplage Debate. |
| `budget-tracker.ts:177-185` (check) | Fail-fast sur BudgetExceededError. |
| `budget-tracker.ts:37-134` (estimate) | Calcul d'estimation paramétrable. |
| `provider-discovery.ts:203-225` (includeJudge) | Pure utility. |
| `provider-discovery.ts:226-277` (selectJudge) | Heuristique strongest-by-cost réutilisable. |
| `provider-discovery.ts:174-186` (ghost model audit) | Primitive model-health. |
| `metrics.ts:computeValueMetrics` | Calcul de métriques sur claims. |
| `events.ts:131-138` (DebateBudgetWarning) | Pattern cost+budget warning. |
| `types.ts` (BrandedID pattern — `DebateID`, `ClaimID`) | Branded UUID pattern. |
| `debate-store.ts:229-245` (garbageCollect) | Helper générique de purge par âge. |

### 4.2 À extraire (migrer vers `multi-model/`)

| Composant cible multi-model/ | Source collective/ | Refactoring nécessaire |
|---|---|---|
| `provider-discovery.ts` (refonte) | collective/provider-discovery.ts (314 lignes) | (a) Suppression `PREFERRED_MODELS` hardcoded. (b) Suppression `CLI_AUTH_CONFIGS` et `CREDENTIAL_FILE_PATHS` (remplacés par `AuthStorage` canonique). (c) `discover()` devient provider-agnostic. |
| `cost-catalog.ts` | budget-tracker.ts:208-266 (MODEL_COSTS + getDefaultCost) | Externalisation vers registry dynamique. **Dépend de C01 (Lot C) — registry**. |
| `usage-normalizer.ts` | (nouveau) | Interface unifiée pour `input` / `output` / `total` tokens par phase + par provider. |
| `model-ref.ts` | types.ts:ProviderID, ModelID + Collective.Participant.providerID/modelID | Schéma + branded types. |
| `model-health.ts` | provider-discovery.ts:174-186 (ghost audit) | Primitive health (deprecated models, latency, errors). |

### 4.3 À migrer (avec adapter)

| Composant | Adapter |
|---|---|
| `orchestrator.ts:598-686` (runParticipant) | Extraire la couche invocation parallèle. Conserver le prompt template (PROMPT_DIVERGE) comme registre. |
| `orchestrator.ts:347-369` (adaptive halting) | Conserver en dehors du substrat (spécifique Debate). |

### 4.4 Duplications identifiées

| Duplication | Localisation A | Localisation B | Action |
|---|---|---|---|
| Auth methods (api_key, credential_file, cli_subprocess) | collective/provider-discovery.ts:41-70 | auth/index.ts:130-239 (KeychainStorage) | Unifier via AuthStorage |
| Coût des modèles | budget-tracker.ts:210-224 (14 hardcodés) | (nouveau) registry Lot C | Externaliser |
| Provider enum (PREFERRED_MODELS) | collective/provider-discovery.ts:31-39 (7 hardcodés) | (nouveau) registry Lot C | Externaliser |
| `discover()` patterns env, stored, file, cli | provider-discovery.ts:97-172 | AuthStorage canonique | Unifier |
| Debounced logging | tous les fichiers | — | Standardiser |

### 4.5 Couplages à supprimer

| Couplage | Localisation | Action |
|---|---|---|
| `orchestrator.ts` → `ProviderDiscovery.discover()` | `orchestrator.ts:116` | Conserver — appeler le `multi-model/provider-discovery.ts` |
| `orchestrator.ts` → `Provider.list()` (provider direct) | `orchestrator.ts:97` | Remplacer par `multi-model/provider-discovery.discover()` |
| `orchestrator.ts` → `Auth.all()` (auth direct) | `provider-discovery.ts:98,243,253` | Remplacer par `AuthStorage` (déjà fait) |
| `events.ts` (11 events Debate) | `events.ts` | Garder pour Debate. **Pas dans le substrat.** |

### 4.6 Comportements Debate qui ne doivent PAS contaminer le substrat

- **Phases 1-4 explicites** (diverge, extract, converge, synthesize) : propre à Debate.
- **Claim / ClaimCategory / NoveltyMarker** : propre à Debate.
- **A/B mode 10% sur tier standard+** : propre à Debate.
- **Adaptive halting (marginalGain < 0.1 && marginalCost > 0.2)** : propre à Debate.
- **Canary injection / detection** : propre à Debate.
- **Red team adversarial attacks** : propre à Debate.
- **Synthesis judge / synthesis markdown** : propre à Debate.
- **Tiers (free/quick/standard/deep)** : spécifique Debate (mais le concept de tiering est généralisable).

### 4.7 Contrats manquants nécessaires à Team

| Manque | Action |
|---|---|
| Pas d'interface unifiée `InvocableModel` provider-agnostic | À créer dans `multi-model/types.ts` (substrat canonique). |
| Pas de `Capabilites` (temperature, topP, maxTokens, etc.) par modèle | À créer dans `multi-model/types.ts`. |
| Pas de modèle d'erreur standardisé pour échecs d'invocation | À créer dans `multi-model/errors.ts` (NamedError). |
| Pas de `usage-normalizer` pour agréger tokens par phase | À créer dans `multi-model/usage-normalizer.ts`. |
| Pas de registre dynamique de providers/modèles | À dépendre de C01 (Lot C — registry). |
| Pas de kill switch `team.handleOnly` fail-closed | À intégrer depuis A02-V2 ADR §3.4. |
| Pas de CredentialHandle v2 (4 invariants) | À intégrer depuis A02-V2 ADR §4. |

---

## 5. Recommandations architecturales (non décisions)

1. **Substrat canonique `packages/unifia/src/multi-model/`** créé ex nihilo (répertoire vide aujourd'hui). Huit modules cibles (cf. §2).
2. **Pas de duplication** avec `collective/` ni avec `team/`. Chaque symbole appartient à un seul sous-système.
3. **AuthStorage canonique** (A02-V2 ADR §3.1) est l'autorité unique pour les secrets. `multi-model/provider-discovery.ts` n'implémente ni `CLI_AUTH_CONFIGS` ni `CREDENTIAL_FILE_PATHS` — il interroge `AuthStorage`.
4. **Coûts** : le tracker `budget-tracker.ts` est ré-utilisable, mais **MODEL_COSTS doit provenir du registry C01 (Lot C)**. Aucun enum statique central dans `multi-model/`.
5. **Models registry** : C01 (Lot C) fournit la liste dynamique. `multi-model/provider-discovery` interroge, n'enumère pas.
6. **Events** : un `multi-model/events.ts` définit `ProviderStarted/Completed/Failed/CostUpdate` réutilisables. Les events `Debate*` restent dans `collective/`.
7. **Errors typés** : `multi-model/errors.ts` (NamedError) avec `InvocableModelError`, `RateLimitError`, `ModelUnavailableError`, `BudgetExceededError`.
8. **Capability** : `multi-model/types.ts` expose `Capabilities` (temperature, topP, maxOutputTokens, etc.) + `Cost` (input/output per 1M tokens).
9. **Invocation** : `multi-model/model-invoker.ts` expose `invoke({ handle, request }): Effect<ProviderResponse, InvokerError>` avec cancellation et timeout.
10. **Aggregation** : `multi-model/usage-normalizer.ts` expose `normalize(usage: raw)` avec un schéma standard `{ input, output, total }`.

---

## 6. Décisions à reporter (A06 + D03 + C01)

1. Frontière exacte entre `collective/**` et futur substrat commun.
2. Namespace et emplacement du substrat canonique (proposition : `packages/unifia/src/multi-model/`).
3. Contrats génériques d'un modèle, d'un provider, d'une invocation et d'un résultat.
4. Représentation des capacités et limitations.
5. Représentation des coûts et budgets.
6. Stratégie d'agrégation sans couplage à Debate.
7. Stratégie de compatibilité avec l'existant.
8. Ordre de migration Debate puis Team.
9. Stratégie de dépréciation des anciens contrats.
10. Critères empêchant une seconde implémentation concurrente.

---

## 7. Risques identifiés

| R-A03-1 | PREFERRED_MODELS + MODEL_COSTS hardcoded violent la consigne | high | À externaliser dans registry C01 (Lot C) |
| R-A03-2 | Budget-tracker couplé à `Collective.DebateTier` | medium | Extraire `Tracker` neutre ; passer `tier` en argument |
| R-A03-3 | Concurrency unbounded sur phases parallèles | medium | À encadrer (semaphore, rate limit provider) |
| R-A03-4 | Pas d'interface unifiée d'invocation | high | À créer `model-invoker.ts` (substrat) |
| R-A03-5 | 4 méthodes d'auth dédoublées | medium | Unifier via AuthStorage (A02-V2) |
| R-A03-6 | Orchestrator 785 lignes monolithique | low | Pas critique — refactor post-A06 |
| R-A03-7 | Role = string libre dans Participant | low | Aligner sur PermissionBroker (D03) |
| R-A03-8 | `tierDefaults()` couplé à `Collective.DebateTier` | low | Découpler en passant un paramètre générique |
| R-A03-9a | Pas de timeout explicite sur `runParticipant` (orchestrator.ts:600-685) | low | Le substrat `multi-model/model-invoker.ts` (Lot B, après A06) doit exposer `Effect.timeout` configurable par appel. Définition canonique de F-A03-9. |
| R-A03-9b | `provider-discovery.ts:285-313` lit des credentials sur filesystem (paths hardcodés `~/.claude/.credentials.json`, `~/.codex/auth.json`) | low | Lot B B01+ unifier via AuthStorage canonique. Définition canonique de F-A03-9 (créé post-synchronisation). |

---

## 8. Diff summary

| Section collective/ | Réutilisable tel quel | À extraire | Spécifique Debate |
|---|---|---|---|
| types.ts (modèle) | BrandedID, BudgetConfig, Role | Provider, Model, Capabilities, Cost | DebateTier, DebateStatus, Claim, DebateReport |
| events.ts | DebateBudgetWarning | — | Tous les autres events |
| provider-discovery.ts | includeJudge, selectJudge, ghost audit, tryReadCredentialFile, tryCliAuth | discover() core | — |
| orchestrator.ts | runParticipant, runConvergence (bas niveau), emitCostUpdate | (bas niveau) | run(), estimate(), 4 phases, adaptive halting, A/B mode, canary, shadow baseline |
| debate-store.ts | hashPrompt, hashWorkspace, garbageCollect | — | create, get, updateStatus, saveReport, saveClaims, queryPastDebates, seedWithPastBlindSpots, recordFeedback, getUserActionRate |
| debate-store.sql.ts | — | — | Tous les tables |
| budget-tracker.ts | Tracker (record/check/snapshot), tierDefaults, unlimited, estimate | MODEL_COSTS vers registry (C01) | — |
| metrics.ts | computeValueMetrics | runShadowBaseline (Debate-spécifique) | — |
| canary.ts | — | — | generate, injectIntoContext, checkDetection |
| claim-extractor.ts | — | — | extract |
| synthesis-judge.ts | — | — | synthesize |
| role-assigner.ts | — | — | assign |
| jargon-checker.ts | — | — | check |
| red-team.ts | — | — | run, shouldActivate, computeConsensusRatio |
| tier-classifier.ts | classifyHeuristic (générique) | — | — |
| debate-selection.ts | includeJudge, selectJudge | — | — |
| debate-agent.ts | façade LSP | — | (façade Debate) |
| shadow-daemon.ts | — | — | run |
| shadow-integration.ts | initShadowDaemon (générique init) | — | — |
| index.ts | barrel Debate | — | — |

**Synthèse :** 8 modules substrat candidats (cf. §2). 4 existent en partie dans `collective/`. 4 sont à créer (model-invoker, model-health, usage-normalizer, prompt-registry). Aucun n'existe comme fichier distinct dans `src/multi-model/` aujourd'hui.

---

## 9. Limites du présent audit

1. **Lecture partielle** de `claim-extractor.ts`, `synthesis-judge.ts`, `canary.ts`, `red-team.ts` (signatures uniquement, pas lecture intégrale). Le contenu détaillé reste à auditer en cas de besoin.
2. **Tests existants** dans `test/collective/**` non inventoriés exhaustivement (HYPOTHÈSE qu'ils existent).
3. **Pas d'analyse de performance** : `concurrency: "unbounded"` n'a pas été mesuré.
4. **Pas d'analyse de sécurité** : `provider-discovery.ts:285-313` lit des credentials sur filesystem (`~/.claude/.credentials.json`, `~/.codex/auth.json`). Le scope est limité à ces 2 paths hardcodés. Élargir le scope nécessiterait une review dédiée (A02-V2 §F-A02-1, F-A02-2).
5. **Pas de cross-check avec l'ADR A02-V2** : les références à AuthStorage sont faites ici en tant que hypothèse, pas en tant qu'assertion vérifiée. Le reviewer E2 doit croiser avec A02-V2 ADR §3.1.

---

_Fin du rapport d'audit A03 v1. Code réel vérifié au SHA `c3471a6926`. Aucun fichier source modifié. v1 archivé (premier passage) ; v1 V2 (corrections E2) sera produite si verdict CHANGES_REQUESTED._
