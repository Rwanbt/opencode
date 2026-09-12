# ADR-MULTI-MODEL-SUBSTRATE — Substrat canonique multi-modèle Team V3

> **Statut :** DRAFT (READY_FOR_E2_REVIEW)
> **Carte :** TEAM-A03 (Lot A, Gate T0)
> **Worktree :** `D:\App\OpenCode\.team-worktrees\A03-9a25e1d2`
> **SHA de base :** `c3471a69265f1e747415266860f615ee6668722a`
> **Date UTC :** 2026-07-20
> **Auteur :** MiniMax-M3 (E1, brouillon)
> **Hash d'instance :** alias 9a25e1d2 / canonique dérivé f88651b9
> **Supersede :** aucun
> **10 sections à arbitrer en A06 / D03 / C01** (cf. §8).

> **Doctrine appliquée :** aucun enum statique central, pas de duplication Debate/Team, pas de dépendance circulaire vers `src/team/**`, auth et credentials via A02-V2 AuthStorage.

**Violation active de la cible « plusieurs centaines de modèles sans liste centrale » :**

L'état actuel **viole** la cible (consigne §22 du plan). Preuves :

- `provider-discovery.ts:31-39` (`PREFERRED_MODELS`, 7 modèles hardcodés).
- `budget-tracker.ts:210-224` (`MODEL_COSTS`, 14 modèles hardcodés).

A03 **identifie** la violation mais **ne la corrige pas**. La fermeture
effective dépend de **C01** (Lot C — registry dynamique) et des
**cartes du Lot B** (`provider-discovery.ts` refondu interrogeant le
registry, `cost-catalog.ts` consommant C01). Le critère de fermeture
**vérifiable** est :

> « Aucun catalogue central statique (array ou Record) de
> `providerID + modelID` dans le runtime ; toute la liste de modèles
> provient d'une source dynamique interrogeable. »

Cet audit ne peut pas vérifier ce critère tant que C01 et les cartes Lot B
ne sont pas livrées. A03 ne **crée pas** de dette cachée ; il **report**
explicitement la résolution à C01 et au Lot B (cf. §8 décision n°5).

---

## 1. Contexte

L'agent Team (plan V3) doit pouvoir invoquer plusieurs providers/models pour :
- les workers multi-modèles (L1, L2, …) ;
- le routage (model-router) ;
- l'évaluation (synthesis-judge, A/B testing) ;
- les connecteurs providers (registre C01, Lot C) ;
- Debate (qui devient l'orchestrateur multi-modèle de référence) ;
- la gestion des coûts et capacités (model-health, cost-catalog).

Le plan §4.1 prescrit 8 modules substrat cibles :
`model-ref.ts`, `provider-discovery.ts`, `model-invoker.ts`, `model-health.ts`,
`cost-catalog.ts`, `usage-normalizer.ts`, `prompt-registry.ts`, `types.ts`.

L'audit A03 (cf. `AUDIT-DEBATE-SUBSTRATE.md`) a établi :
- `packages/unifia/src/multi-model/**` **n'existe pas** aujourd'hui.
- 4 modules substrat ont une ébauche dans `collective/`
  (`provider-discovery.ts`, `budget-tracker.ts` pour costs,
  `metrics.ts` pour usage, `events.ts` partiel).
- 4 modules sont à créer (`model-ref.ts`, `model-invoker.ts`,
  `model-health.ts`, `prompt-registry.ts`).
- 3 violations identifiées (`PREFERRED_MODELS` hardcodé 7,
  `MODEL_COSTS` hardcodé 14, `CLI_AUTH_CONFIGS`/`CREDENTIAL_FILE_PATHS`
  dupliquant AuthStorage).

Le plan §15 interdit la duplication de logique entre Debate et Team. Le
présent ADR propose la frontière canonique entre `collective/**` et le
futur `multi-model/**`.

---

## 2. Forces en présence

### 2.1 Conformité au plan V3

| Exigence plan | Source | Adressée ici |
|---|---|---|
| Substrat canonique partagé | §4.1 | ✅ proposé (multi-model/) |
| Pas de duplication Debate/Team | §15 | ✅ AUTH_STORAGE canonique, pas de hardcoded models |
| Invocation parallele multi-modèle | §14.1 | ✅ concurrency: "unbounded" → à encadrer |
| Coûts et capacités | §14.1 | ✅ tracker réutilisable, MODEL_COSTS vers registry C01 |
| 8 modules substrat | §4.1 | ✅ 8 modules listés §3 |
| Compatibilité avec plan C01 (registry) | §25 (Lot C) | ✅ externalisation modèles + coûts |
| Compatibilité avec plan A02-V2 (AuthStorage, CredentialHandle) | §14.2 ADR | ✅ interface AuthStorage uniquement, CredentialHandle côté broker |
| Erreurs typées | §22 | ✅ NamedError pattern |
| Cancellation et timeouts déterministes | §15.3 | ✅ model-invoker accepte AbortSignal |
| Observabilité et audit structurés | §16 | ✅ events structurés + log structure |
| Aucune architecture temporaire / aucun MVP | §0.2 doctrine | ✅ tous modules dès le premier lot |
| Aucune dette introduite | §0.2 doctrine | ✅ 0 dette ; 9 risques documentés R-A03-1..9 |

### 2.2 Contraintes héritées

- `AuthStorage` (auth/index.ts) : 3 backends (file, keychain, encrypted-file). D-012 impose keychain par défaut Desktop, encrypted-file CLI headless.
- `CredentialHandle v2` (A02-V2 ADR §4) : ID opaque non secret, RPC revalidation 10 champs, fail-closed.
- `PermissionBroker` (D03) : autorisation de l'opération et de son scope.
- Registry dynamique (C01, Lot C) : 200+ modèles attendus ; **aucun enum statique central** dans `multi-model/`.
- `Bus` (bus/bus-event.ts) : bus canonique utilisé par Debate ; substrat doit publier events typés.

---

## 3. Décision technique proposée (DRAFT, à arbitrer en A06)

### 3.1 Namespace et emplacement du substrat canonique

**Proposition :** `packages/unifia/src/multi-model/`

```
multi-model/
  types.ts                  (ModelRef, Capabilities, Cost, ModelRefType)
  model-ref.ts              (branded ModelID/ProviderID, parsing)
  provider-discovery.ts     (refonte — 4 méthodes auth via AuthStorage)
  model-invoker.ts          (invoke + cancellation + timeout)
  model-health.ts           (ghost audit, latency, errors)
  cost-catalog.ts           (interface registry, sans enum central)
  usage-normalizer.ts       (interface standard usage)
  prompt-registry.ts        (interface registry de prompts)
  errors.ts                 (NamedError : InvocableModelError, etc.)
  events.ts                 (ProviderStarted/Completed/Failed/CostUpdate)
  index.ts                  (barrel substrat)
```

**Règle stricte :** aucun fichier dans `multi-model/` n'importe de
`collective/` ou `team/`. **Aucun fichier dans `collective/` ou `team/`
n'importe de `multi-model/`** jusqu'à la phase de migration (post-A06).

### 3.2 Contrats génériques d'un modèle, d'un provider, d'une invocation et d'un résultat

```ts
// types.ts
export interface ModelRef {
  readonly providerID: ProviderID
  readonly modelID: ModelID
  readonly revision?: string
}

export interface Capabilities {
  readonly temperature: boolean   // supporte temperature
  readonly topP: boolean
  readonly maxOutputTokens: number
  readonly structuredOutput: boolean
  readonly toolUse: boolean
  readonly vision: boolean
}

export interface Cost {
  readonly input: number    // USD per 1M tokens
  readonly output: number
  readonly cacheRead?: number
  readonly cacheWrite?: number
}

export interface InvocationRequest {
  readonly model: ModelRef
  readonly system: string
  readonly prompt: string
  readonly temperature?: number
  readonly maxOutputTokens?: number
  readonly schema?: ZodType         // structured output si supporté
  readonly signal: AbortSignal       // cancellation déterministe
}

export interface InvocationResult {
  readonly content: string
  readonly structured?: unknown      // si schema
  readonly usage: Usage
  readonly durationMs: number
}

export interface Usage {
  readonly input: number
  readonly output: number
  readonly cacheRead?: number
  readonly cacheWrite?: number
}
```

### 3.3 Représentation des capacités et limitations

- `Capabilities` est exposé via `multi-model/model-health.ts` (lecture du registry C01).
- Limitations (rate limits, max context) remontées via events `multi-model.events.ModelRateLimited` avec retry-after.
- Découverte dynamique : `multi-model/provider-discovery.ts` interroge le registry C01 ; aucun enum statique.

### 3.4 Représentation des coûts et budgets

- `Cost` (cf. §3.2) : source = `multi-model/cost-catalog.ts` qui consomme C01.
- `BudgetTracker` (collectif réutilisable) : conserve son API `record/check/snapshot` ; accepte `Cost` dynamique au lieu de `MODEL_COSTS` hardcodé.

### 3.5 Stratégie d'agrégation sans couplage à Debate

Le substrat expose un **runtime d'invocation parallèle** sans opinion
sur l'agrégation. Debate consomme ce runtime et implémente ses propres
phases (diverge, extract, converge, synthesize) en dehors du substrat.

```ts
// multi-model/model-invoker.ts
export interface Invoker {
  readonly invoke: (req: InvocationRequest) => Effect.Effect<InvocationResult, InvokerError>
  readonly invokeMany: (reqs: InvocationRequest[]) => Effect.Effect<InvocationResult[], InvokerError>
}
```

**Note de routage (D-022) :** la conception et l'implémentation de
`multi-model/model-invoker.ts` sont routées vers le **Lot B**
(« shared multi-model substrate »), **carte B01+ (Gate T3+)**,
**après** figeage par A06 de la frontière et des contrats génériques.
Pas de D03 ici (D03 = PermissionBroker, hors scope d'une interface
d'invocation). Voir aussi `AUDIT-DEBATE-SUBSTRATE.md` F-A03-3 (corrigé).

### 3.6 Stratégie de compatibilité avec l'existant

- Phase 1 (T0 / A06) : créer `multi-model/` vide. Aucun import depuis `collective/`.
- Phase 2 (T3 / D03) : implémenter `multi-model/provider-discovery.ts` qui consomme `AuthStorage` (auth/index.ts). `collective/provider-discovery.ts` n'est PAS migré immédiatement ; il continue à fonctionner.
- Phase 3 (T7) : migrer `orchestrator.ts:runParticipant()` vers `multi-model/model-invoker.ts`. `runParticipant` devient un wrapper fin.
- Phase 4 (T14) : `collective/provider-discovery.ts` supprimé. Toute l'auth passe par `multi-model/`.

### 3.7 Stratégie d'agrégation sans couplage à Debate (complément §3.5)

L'agrégation Debate (synthesis, claim extraction, red team, etc.) reste
dans `collective/`. Le substrat ne fournit **aucune** logique d'agrégation.
Il fournit uniquement :
- `invoke(req) → result`
- `invokeMany(reqs) → result[]` (parallèle, semaphore configurable)
- `costAtModel(model, usage) → Cost` (lookup)
- `healthAtModel(model) → HealthStatus`

### 3.8 Stratégie de dépréciation des anciens contrats

| Ancien contrat | Nouveau contrat | Sunset |
|---|---|---|
| `collective.ProviderDiscovery.discover()` | `multi-model.provider-discovery.discover()` | T14 (Lot N) |
| `collective.BudgetTracker.tierDefaults()` | `multi-model.budget.tierDefaults(tier, costResolver)` | T7 |
| `PREFERRED_MODELS` (hardcoded) | `registry.listModels({ min, capability })` (C01) | T3 |
| `MODEL_COSTS` (hardcoded) | `cost-catalog.get(model)` (C01) | T3 |
| `ProviderAuth` enum (3 modes) | `AuthStorage` interface + `CredentialHandle` (A02-V2) | T7 |
| `Collective.Participant.role` (string libre) | `permission.roles(roleName)` (D03) | T7 |

### 3.9 Critères empêchant une seconde implémentation concurrente

1. **Pas d'enum statique central** dans `multi-model/` (consigne Lot A, §22).
2. **Pas de duplication de logique** : toute feature demandeuse d'un enum modèle ou d'un fallback hardcodé doit aller en C01 (registry).
3. **Linter CI** : règle `no-restricted-imports` interdisant dans `src/multi-model/**` les imports depuis `collective` ou `team`.
4. **Tests d'isolement** : `pnpm test --filter multi-model` ne doit pas dépendre d'aucun test `collective/`.
5. **Audit registre (A05)** : licence des sources tierces pour les prompts et capabilities.
6. **Threat model A06** : couvre les 9 vecteurs (worker malveillant, plugin compromis, env héritage, same-UID, replay, SSRF/IPC, crash dumps, logs, diagnostic bundles).

### 3.10 Critères de migration Debate → Team

| Critère | Statut |
|---|---|
| Substrat offre `InvocationRequest`/`InvocationResult` typés | À implémenter D03 |
| Substrat offre `Cost` dynamique | À implémenter D03 |
| Substrat offre `HealthStatus` par modèle | À implémenter D03 |
| Substrat offre `BudgetTracker` découplé de `DebateTier` | À implémenter D03 |
| Substrat offre `Events` typés (ProviderStarted, CostUpdate) | À implémenter D03 |
| Substrat offre `NamedError` typés | À implémenter D03 |

### 3.11 Note de séparation : credentials vs permissions

> **Source d'autorité :** `Execution/Reviews/A02-V2-OFFICIAL-REVIEW-DeepSeek-E2.md` et `ADR-SECRET-DELEGATION-V2.md` §3.1 (3 couches, **D-012 figé par E2 APPROVED**). A03 n'invente pas cette séparation ; il la **rappelle** explicitement ici.

| Concept | Responsabilité | Substrat / Couche |
|---|---|---|
| **`AuthStorage`** | Protège les secrets **au repos** (FileStorage plaintext INTERDIT prod / Keychain par défaut Desktop / EncryptedFile CLI headless). | `auth/index.ts` (auth/index.ts) ; pas dans `multi-model/`. |
| **`CredentialBroker`** (NOUVEAU v2 — D-012) | **Résout** un secret brut pour UN appel provider ; lit `AuthStorage` ; émet un SEUL appel scopé par (run, task, op) ; n'injecte PAS dans le process env. | `multi-model/` (à créer en D03). |
| **`PermissionBroker`** | **Autorise** l'opération et son scope ; délivre un handle opaque NON SECRET au worker ; conserve audit + révocation. Sépare permissions workspace / permissions providers. | `team/` (D03 cible, hors `multi-model/`). |

**Conséquence sur `Participant.role` (cf. F-A03-7 / R-A03-7, D-022) :**

`Participant.role` est un **label sémantique de phase** (architect,
sceptic, etc.), **PAS** une permission de credential ou de workspace.
Le routage par défaut de F-A03-7 vers le `PermissionBroker` (D03)
n'est **pas justifié** sans preuve de dépendance directe à un système
de permissions runtime. La décision par défaut de l'ADR (D-022) est
de formaliser `role` comme **contrat générique** (Lot B) via
`multi-model/types.ts` `RoleRef`, **PAS** comme entrée du
`PermissionBroker` (D03).

**Conséquence sur les secrets :**

Le substrat `multi-model/` ne doit **jamais** implémenter ses propres
méthodes d'accès aux secrets. Toute lecture / écriture de credentials
doit passer par `AuthStorage` (auth/index.ts) via `CredentialBroker`
(D-012). Le `multi-model/provider-discovery.ts` n'implémente ni
`CLI_AUTH_CONFIGS` ni `CREDENTIAL_FILE_PATHS` ; il interroge
`AuthStorage` et `CredentialBroker` uniquement.

---

## 4. Backward compat (D-004)

- `collective/**` reste fonctionnel jusqu'à T7 minimum.
- Migration atomique par module (cf. §3.6).
- Aucun import croisé `collective ↔ multi-model` avant T7.

---

## 5. Threat model (extrait — version complète dans A06)

| Vecteur | Mitigation substrat |
|---|---|
| Worker malveillant | usage unique, nonce, fail-closed (A02-V2 §3.4) |
| Plugin compromis | AuthStorage canonique, pas de hardcoded models |
| Process enfant héritant env | pas de `process.env = credential` dans `src/multi-model/**` |
| Same-UID attacker | credentials dans AuthStorage (keychain par défaut) |
| Replay | nonce + handle à usage unique (A02-V2 §4) |
| SSRF/IPC | keychain via named pipe, pas d'URL malléable |
| Crash dumps | redaction `process.env` dans les logs |
| Logs | `SecretRedactor` redaction pre-write |
| Disconnect | état transactionnel DB, reprise au boot |

---

## 6. Routes de migration depuis l'existant

### 6.1 Cartes concernées

| Carte | Action |
|---|---|
| A03 (T0) | Cet ADR — READY_FOR_E2_REVIEW |
| D03 (T3, E2) | Implémenter `multi-model/` (8 modules) + AuthStorage wiring + error types |
| C01 (T3-C) | Registry dynamique models + costs + capabilities (substrat consomme) |
| D03b (T3) | Brancher `provider/provider.ts` vers `multi-model/provider-discovery.ts` |
| B01 (T3) | Substrat prêt pour invocation multi-modèle B01 |
| T7 | Migration `orchestrator.runParticipant` vers `multi-model.model-invoker` |
| T14 | Suppression `PREFERRED_MODELS`, `MODEL_COSTS`, `collective.provider-discovery` |

### 6.2 Backward compat (D-004)

- `collective/**` reste jusqu'à T7 minimum.
- Aucun import croisé interdit (linter CI §3.9).
- Migration par module, un à la fois.

---

## 7. Délégations

### 7.1 À D03 (Gate T3, E2)

- Implémenter les 8 modules cibles.
- Wiring AuthStorage, CredentialHandle, PermissionBroker.
- Tests d'isolement substrat.

### 7.2 À C01 (Lot C)

- Registry dynamique models + costs + capabilities.
- 200+ modèles attendus.

### 7.3 À A06 (threat model final)

- 9 vecteurs threat model (cf. §5 + ADR A02-V2 §7).
- Critères bloquants pour release.

---

## 8. Décisions à reporter (10 points — à trancher en A06 / D03 / C01 / Lot B)

| # | Décision | Owner / carte propriétaire | Gate cible | Précondition | Critère de fermeture vérifiable | Statut |
|---|---|---|---|---|---|---|
| 1 | **Frontière exacte** entre `collective/**` et `multi-model/**` | A06 (architecture globale) | T0 / A06 | Aucune (à fixer en A06) | Document `docs/architecture/team/SUBSTRATE-BOUNDARY.md` listant chaque symbole de `collective/` avec son affectation (collective-only / multi-model / dupliqué-explicite-justifié) | OPEN |
| 2 | **Namespace et emplacement** du substrat canonique | A06 | T0 / A06 | Décision n°1 | `packages/unifia/src/multi-model/` créé vide au HEAD de Team post-A06 ; `pnpm ls --filter multi-model` fonctionne | OPEN |
| 3 | **Contrats génériques** d'un modèle, d'un provider, d'une invocation et d'un résultat | D03 (PermissionBroker) | T3 | Décisions n°1, n°2 | `multi-model/types.ts` exporte `ModelRef, Capabilities, Cost, Usage, InvocationRequest, InvocationResult` versionnés (Schemas Zod) ; les consumers (Debate, Team workers) migrent sans breaking change | OPEN |
| 4 | **Représentation des capacités et limitations** | D03 | T3 | Décision n°3 | `multi-model/model-health.ts` lit les capabilities depuis C01 et expose `HealthStatus` par `ModelRef` ; tests d'isolement substrat passent | OPEN |
| 5 | **Représentation des coûts et budgets** | C01 (registry) + D03 (consommateur) | T3 (C01) puis T3 (D03) | C01 livré | `multi-model/cost-catalog.ts` consomme C01 ; aucun catalogue statique (array ou Record) dans le runtime ; `MODEL_COSTS` supprimé de `budget-tracker.ts` | OPEN |
| 6 | **Stratégie d'agrégation sans couplage à Debate** | D03 + A06 | T3 (D03) puis T0 (A06 review) | Décision n°3 | ADR `multi-model/AGGREGATION-NEUTRAL.md` publié ; aucun import de `collective/` dans `multi-model/` ; débat ne consomme que `Invoker` | OPEN |
| 7 | **Stratégie de compatibilité avec l'existant** | A06 + D03 | T0 / A06 puis T3 | Décision n°1 | Linter CI `no-restricted-imports` appliqué sur `src/multi-model/**` ; tests d'isolement substrat passent | OPEN |
| 8 | **Ordre de migration** Debate puis Team | A06 (decide) puis T7 (H01/H05) | T0 / A06 puis T7 | Décision n°1 | `orchestrator.runParticipant` migré vers `multi-model/model-invoker.ts` ; `collective/provider-discovery.ts` supprimé en T14 | OPEN |
| 9 | **Stratégie de dépréciation** des anciens contrats | A06 (policy) + D03 (exec) | T0 / A06 puis T7 | Décision n°1 | Chaque ancien contrat a un `@deprecated` daté avec sunset explicite ; release notes communiqués | OPEN |
| 10 | **Critères empêchant une seconde implémentation concurrente** | A06 (policy) | T0 / A06 | Décision n°1 | (a) Linter CI interdisant imports croisés ; (b) tests d'isolement ; (c) absence de catalogue statique (cf. n°5) ; (d) revue de registre par A05 (licences) | OPEN |

---

## 9. Diff v0 (A03) → v1 (après E2)

| Section v0 | Action v1 |
|---|---|
| §1 Contexte | inchangé |
| §2 Forces | inchangé |
| §3.1 Namespace | inchangé (proposition) |
| §3.2 Contrats génériques | à finaliser en D03 |
| §3.3 Capabilities | à finaliser |
| §3.4 Coûts | à finaliser avec C01 |
| §3.5 Agrégation | inchangé |
| §3.6 Compatibilité | inchangé |
| §3.7 Agrégation complément | inchangé |
| §3.8 Dépréciation | à finaliser |
| §3.9 Critères concurrence | à finaliser en A06 |
| §3.10 Critères migration | inchangé |
| §4 Backward compat | inchangé |
| §5 Threat model | extrait ; version complète dans A06 |
| §6 Routes migration | inchangé |
| §7 Délégations | inchangé |
| §8 Décisions à reporter | 10 points explicites |

---

## 10. Limites du brouillon

- **Aucune implémentation** : ce document ne contient pas de code ; seul le plan d'architecture.
- **Décisions à reporter** : 10 points explicites ; aucune n'est tranchée par l'orchestrateur.
- **Threat model** : extrait seulement ; version complète dans A06.
- **Backward compat** : stratégie par module, à valider empiriquement.

---

_Fin de l'ADR v1. Aucun code de production modifié. Code réel vérifié au SHA `c3471a6926`. v1 archivé. v2 (corrections E2) à produire si verdict CHANGES_REQUESTED._
