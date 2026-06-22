# Plan d'implémentation — Collective Intelligence / Blind Spot Hunter

> Ce document est le livrable final de 3 rounds de débat multi-IA (8 modèles,
> 20+ réponses, 15 blind spots). Il contient tout ce qu'il faut pour coder
> la feature sans avoir à relire les rounds de débat.

---

## 1. Vue d'ensemble

### Ce qu'on construit

Un mode `/debate` pour OpenCode qui fait dialoguer N modèles IA en parallèle
sur une même question, extrait les points de consensus et les **blind spots**
(insights qu'un seul modèle a vus), puis produit un rapport structuré.

### Pourquoi

Chaque LLM est entraîné différemment et trouve des problèmes différents.
Aujourd'hui les devs font ça manuellement (copier-coller entre Claude, GPT,
Gemini, DeepSeek...). Cette feature automatise le processus.

### Philosophie

**Union des différences** (Blind Spot Hunter), pas consensus. Un insight
mentionné par un seul modèle est peut-être le plus important. Le système
cherche les angles morts, pas le plus petit dénominateur commun.

---

## 2. Architecture

### Positionnement dans OpenCode

**Agent natif** dans un module dédié, exposé via un skill `/debate`.
Suit les mêmes patterns que `orchestrator`, `critic`, `build`.

### Arbre de fichiers à créer

```
packages/opencode/src/collective/
├── index.ts                — Export public + enregistrement agent
├── types.ts                — Claim, DebateReport, DebateConfig, DebateError
├── debate-agent.ts         — Agent.Info declaration (comme build/plan/critic)
├── orchestrator.ts         — DebateOrchestrator service (4 phases)
├── provider-discovery.ts   — Cascade auth: env var → cred file → CLI
├── claim-extractor.ts      — Phase 2: extraction + vérification exhaustivité
├── synthesis-judge.ts      — Phase 4: juge non-participant + métacognition
├── debate-store.ts         — Persistance SQLite (drizzle)
├── debate-store.sql.ts     — Schéma drizzle pour debates + claims
├── role-assigner.ts        — Meta-prompt pour rôles dynamiques
├── red-team.ts             — Red Team conditionnel
├── jargon-checker.ts       — Vérificateur d'ancrage codebase (grep)
├── budget-tracker.ts       — Kill-switch + estimation + tiers
├── metrics.ts              — Shadow baseline + 5 métriques de valeur
└── prompts/
    ├── diverge.txt         — System prompt Phase 1 (par rôle)
    ├── extractor.txt       — Prompt d'extraction de claims
    ├── exhaustivity.txt    — Prompt du vérificateur d'exhaustivité
    ├── convergence.txt     — Prompt Phase 3 (critique de claims anonymes)
    ├── synthesis.txt       — Prompt Phase 4 (juge + méta)
    └── red-team.txt        — Prompt adversarial
```

### Skill file

```
packages/opencode/skills/debate/SKILL.md
```

YAML frontmatter: `name: debate`, `triggers: ["/debate", "/blind-spots"]`

---

## 3. Patterns du codebase à suivre

### Service Effect (pattern canonique d'OpenCode)

```typescript
// Interface
export interface Interface {
  readonly method: (arg: Type) => Effect.Effect<Result, ErrorType>
}

// Service class
export class Service extends ServiceMap.Service<Service, Interface>()(
  "@opencode/Collective"
) {}

// Layer
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const dep = yield* SomeDependency.Service
    // ...
    return Service.of({ method })
  })
)

// Runtime export
export const defaultLayer = layer.pipe(Layer.provide(...))
const { runPromise } = makeRuntime(Service, defaultLayer)
export async function method(arg: Type) {
  return runPromise((svc) => svc.method(arg))
}
```

### Agent declaration (pattern de agent/agent.ts)

```typescript
// Dans debate-agent.ts, exporter un objet Agent.Info compatible
export const debateAgent: Agent.Info = {
  name: "debate",
  description: "Multi-model collective intelligence debate",
  mode: "primary",
  native: true,
  hidden: false,
  permission: { /* ... */ },
  options: {},
  prompt: "..." // ou chargé depuis prompts/
}
```

Puis l'enregistrer dans `agent/agent.ts` aux côtés de `orchestrator`, `critic`, etc.

### Erreurs (pattern NamedError du codebase)

```typescript
import { NamedError } from "../util/error"

export const ProviderTimeoutError = NamedError.create(
  "CollectiveProviderTimeout",
  z.object({ provider: z.string(), ms: z.number() })
)

export const RateLimitError = NamedError.create(
  "CollectiveRateLimit",
  z.object({ provider: z.string(), retryAfter: z.number().optional() })
)

export const ExtractionIncompleteError = NamedError.create(
  "CollectiveExtractionIncomplete",
  z.object({ coverage: z.number(), threshold: z.number() })
)

export const BudgetExhaustedError = NamedError.create(
  "CollectiveBudgetExhausted",
  z.object({ spent: z.number(), limit: z.number() })
)
```

### Streaming (pattern LLM du codebase)

```typescript
// Utiliser Stream.Stream<DebateEvent> pour la progression
export type DebateEvent =
  | { type: "phase_changed"; phase: string }
  | { type: "provider_started"; provider: string }
  | { type: "provider_completed"; provider: string; tokens: number }
  | { type: "provider_failed"; provider: string; error: string }
  | { type: "claim_extracted"; claim: Claim }
  | { type: "cost_update"; spent: number; budget: number }
  | { type: "red_team_activated"; reason: string }
  | { type: "debate_complete"; report: DebateReport }
```

### Persistance (pattern drizzle du codebase)

```typescript
// debate-store.sql.ts
import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core"

export const DebateTable = sqliteTable("debate", {
  id: text().primaryKey(),
  prompt: text().notNull(),
  prompt_hash: text().notNull(),
  workspace_hash: text().notNull(),
  tier: integer().notNull(),
  cost: real(),
  duration_ms: integer(),
  provider_count: integer().notNull(),
  blind_spot_count: integer(),
  report: text({ mode: "json" }),
  ...Timestamps,
})

export const ClaimTable = sqliteTable("debate_claim", {
  id: text().primaryKey(),
  debate_id: text().notNull().references(() => DebateTable.id),
  source_id: text().notNull(), // hash anonyme
  source_provider: text().notNull(), // vrai provider (pour traçabilité)
  category: text().notNull(),
  content: text().notNull(),
  confidence: real(),
  novelty: text(), // "unique" | "minority" | "consensus"
  is_actionable: integer({ mode: "boolean" }),
  verification_hint: text(),
  ...Timestamps,
})
```

### Bus events (pattern Bus du codebase)

```typescript
import { BusEvent } from "../bus/bus-event"

export const DebateStarted = BusEvent.define(
  "collective.debate.started",
  z.object({ debateId: z.string(), tier: z.number(), providers: z.array(z.string()) })
)

export const DebateCompleted = BusEvent.define(
  "collective.debate.completed",
  z.object({ debateId: z.string(), blindSpotCount: z.number(), cost: z.number() })
)
```

---

## 4. Pipeline détaillé

### Phase 0 : PRÉ-DÉBAT

```
1. User tape /debate "Comment sécuriser l'auth de ce module ?"
2. ProviderDiscovery.discover()
   → Cascade: env vars → credential files → CLI binaires
   → Audit ghost models (versions obsolètes)
   → Retourne: Provider[] avec auth method + capabilities
3. RoleAssigner.assign(prompt, providers)
   → Meta-prompt léger qui assigne des rôles spécialisés
   → Chaque modèle a une clause "hors rôle" (wildcard)
   → Fallback: si 2 providers → Advocate vs Critic
4. BudgetTracker.estimate(providers, tier)
   → Affiche: "4 providers détectés. Tier 2 Standard. ~$1.20, ~45s. [Y/n]"
5. DebateStore.seed(prompt)
   → Cherche les 3 blind spots passés les plus pertinents
   → Injecte comme hypothèses à vérifier (pas comme faits)
   → Seed disparaît après Phase 1
```

### Phase 1 : DIVERGE (parallèle, O(N))

```
- N modèles répondent indépendamment et en parallèle
- Chaque modèle reçoit:
  · Le prompt utilisateur
  · Son rôle spécialisé (via role-assigner)
  · Le seed mémoire (hypothèses passées)
  · La clause "hors rôle" : signaler tout insight hors périmètre
- Effect.forEach avec concurrency: "unbounded" + Effect.timeout par provider
- Un provider lent/en erreur → exclu mais résultats partiels sauvés
- Streaming: chaque réponse s'affiche dans la TUI au fur et à mesure
- [Tier 3] Un bug synthétique (Canary) est injecté dans le contexte
```

### Phase 2 : CARTOGRAPHIE (O(1) + vérification)

```
Phase 2a — Extraction
- Modèle cheap (Haiku, Flash, 4o-mini)
- Prompt: "Extrais TOUS les points en claims atomiques JSON"
- Schéma Claim forcé (structured output)
- Résultat: Claim[]

Phase 2b — Vérification d'exhaustivité
- Même modèle ou plus léger
- Prompt: "Pour chaque phrase source, OUI/NON est-elle couverte ?"
- Si > 5% de NON → relance 2a avec prompt renforcé
- Phrases orphelines ajoutées comme claims "recovered"

Phase 2c — JargonChecker
- Grep asynchrone sur le codebase pour chaque terme CamelCase/PascalCase
- Claims d'existence non trouvés → ⚠️ UNVERIFIED
- Claims de proposition → tag "proposed", pas vérifié

Phase 2d — Anonymisation
- Remplacement des sourceIds par hash opaques (anon_<hash>)
- Table de mapping conservée dans l'orchestrateur (jamais dans les prompts)

Phase 2e — Classification
- noveltyMarker: "consensus" | "minority" | "unique"
- Basé sur le nombre de modèles ayant mentionné des claims similaires
```

### Phase 3 : CONVERGENCE CIBLÉE (max adaptatif)

```
- Seuls les claims "minority" et "unique" sont re-soumis
- Les modèles reçoivent des claims ANONYMES: "Claim #clm_47 affirme X.
  Contre-argument ?" — JAMAIS "Claude dit X"
- Le juge reçoit un vecteur de fiabilité en sidecar (fingerprint par domaine)
  mais PAS le nom des modèles dans le texte du prompt
- [Conditionnel] Red Team activé si cosinus similarité > seuil:
  · Tier 2: seuil = 0.85
  · Tier 3: seuil = 0.75 ou toujours actif
  · Modèle le moins cher, prompt adversarial explicite
- Critère d'arrêt adaptatif:
  marginalGain = newClaims / totalClaims
  marginalCost = costThisRound / budgetRemaining
  if (marginalGain < 0.1 && marginalCost > 0.2) → STOP
```

### Phase 4 : SYNTHÈSE (O(1))

```
- Juge: modèle non-participant préféré, fallback sur le plus capable
- Reçoit: claims anonymes + vecteur fiabilité en sidecar
- Produit: DebateReport JSON structuré
- [Tier 2+] Section métacognition intégrée:
  · fragilité = désaccords_persistants / désaccords_initiaux
  · Si > 0.6 → flag [CONSENSUS FRAGILE]
- [Tier 3] Vérifie si le Canary a été détecté
  · Si non → score de confiance dégradé, warning utilisateur
- [Background] Shadow baseline: meilleur modèle seul en parallèle
  · Compare blind_spot_count, coverage, hallucination_rate
  · Badge: "+X blind spots vs single-model"
- Ré-attribution des claims (hash → provider) dans le rapport final
- Sauvegarde dans DebateStore (SQLite)
```

---

## 5. Types principaux

```typescript
// types.ts

export const Claim = z.object({
  claimId: z.string(),
  sourceId: z.string(),         // hash anonyme (anon_xxx)
  sourceProvider: z.string(),   // vrai provider (caché pendant débat)
  category: z.enum([
    "security", "performance", "maintainability",
    "correctness", "ux", "architecture", "other"
  ]),
  content: z.string(),
  evidenceRefs: z.array(z.string()).optional(),
  confidenceSelf: z.number().min(0).max(1),
  noveltyMarker: z.enum(["unique", "minority", "consensus"]),
  isActionable: z.boolean(),
  verificationHint: z.string().optional(),
  isExistenceClaim: z.boolean().optional(),
  jargonRisk: z.number().min(0).max(1).optional(),
  isRecovered: z.boolean().optional(),
})
export type Claim = z.infer<typeof Claim>

export const DebateReport = z.object({
  id: z.string(),
  prompt: z.string(),
  timestamp: z.string(),
  tier: z.number(),
  providers: z.array(z.string()),
  roles: z.record(z.string(), z.string()),
  cost: z.number(),
  durationMs: z.number(),
  consensus: z.array(Claim),
  blindSpots: z.array(Claim),
  unresolvedConflicts: z.array(z.object({
    topic: z.string(),
    positions: z.record(z.string(), z.string()),
  })),
  traceability: z.array(z.object({
    provider: z.string(),
    claimIds: z.array(z.string()),
  })),
  meta: z.object({
    fragility: z.number().min(0).max(1),
    haltingAnalysis: z.string().optional(),
    canaryDetected: z.boolean().optional(),
    diversityScore: z.number().optional(),
  }).optional(),
  valueMetrics: z.object({
    blindSpotCount: z.number(),
    coverageDimensionality: z.number(),
    hallucinationReduction: z.number().optional(),
    costPerValidInsight: z.number().optional(),
  }).optional(),
})
export type DebateReport = z.infer<typeof DebateReport>

export const DebateConfig = z.object({
  tier: z.enum(["free", "quick", "standard", "deep"]),
  maxBudget: z.number().optional(),
  providers: z.array(z.string()).optional(),  // override auto-discovery
  roles: z.record(z.string(), z.string()).optional(), // override auto-assign
  redTeam: z.enum(["off", "auto", "always"]).default("auto"),
  enableMeta: z.boolean().default(true),
  enableCanary: z.boolean().default(false),
  enableShadowBaseline: z.boolean().default(true),
  noMemory: z.boolean().default(false),
  maxRounds: z.number().default(2),
})
export type DebateConfig = z.infer<typeof DebateConfig>

export const ProviderAuth = z.discriminatedUnion("method", [
  z.object({ method: z.literal("api_key"), key: z.string() }),
  z.object({ method: z.literal("credential_file"), path: z.string(), content: z.string() }),
  z.object({ method: z.literal("cli_subprocess"), binary: z.string(), args: z.array(z.string()) }),
])
export type ProviderAuth = z.infer<typeof ProviderAuth>
```

---

## 6. Credential Discovery (Provider Auth)

### Cascade de résolution par provider

| Provider | Étape 1: Env var | Étape 2: Credential file | Étape 3: CLI |
|----------|-----------------|-------------------------|-------------|
| Anthropic | `ANTHROPIC_API_KEY` | `~/.claude/.credentials.json` → `claudeAiOauth.accessToken` | `claude --print` |
| OpenAI | `OPENAI_API_KEY` | `~/.codex/auth.json` → `tokens.access_token` | `codex exec` |
| Google | `GEMINI_API_KEY` | OS Credential Manager → `gemini-cli-api-key/default-api-key` | `gemini -p --skip-trust` |
| DeepSeek | `DEEPSEEK_API_KEY` | — | — |
| Mistral | `MISTRAL_API_KEY` | — | — |
| Qwen | `DASHSCOPE_API_KEY` | — | — |
| Ollama | `OLLAMA_HOST` (défaut localhost:11434) | — | `ollama run` |

### Comportement crucial

- **OAuth tokens (Claude, Codex) ≠ API keys.** Ne marchent PAS comme env var.
  Pour Claude/Codex en mode CLI subprocess: écrire le fichier d'auth complet
  dans un temp dir, appeler le CLI, nettoyer.
- **Gemini**: la clé est dans le Windows Credential Manager (Win32 CredRead),
  macOS Keychain, ou Linux secret-tool. Le blob est du JSON, la clé est dans
  `token.accessToken`. Fonctionne directement comme `GEMINI_API_KEY`.
- **Ghost Model audit**: vérifier que chaque provider détecté est supporté
  par OpenCode. Alerter si version obsolète.

---

## 7. Tiers budgétaires

| Tier | Modèles | Phases | Red Team | Méta | Canary | Coût estimé |
|------|---------|--------|----------|------|--------|-------------|
| 0 Free | Gratuits détectés uniquement | 1 + 4 | OFF | OFF | OFF | $0 |
| 1 Quick | 2-3 | 1 + 2 + 4 | OFF | OFF | OFF | $0.05–0.50 |
| 2 Standard | 4-5 | Pipeline complet | Conditionnel (0.85) | ON | OFF | $0.50–3 |
| 3 Deep | 6-8, rôles spécialisés | Pipeline complet + 2 tours | Agressif (0.75) | ON | ON | $3–15 |

---

## 8. Roadmap d'implémentation (7 phases)

### P0 — Fondations (pré-requis)
- [ ] `types.ts` — Tous les types Zod (Claim, DebateReport, DebateConfig, etc.)
- [ ] `debate-store.sql.ts` — Schéma drizzle (DebateTable, ClaimTable)
- [ ] `debate-store.ts` — Service Effect CRUD (save, get, queryPastDebates)
- [ ] `budget-tracker.ts` — Estimation de coût par tier, kill-switch
- [ ] Bus events (DebateStarted, DebateCompleted)

### P1 — MVP (Tier 1, 2+ providers)
- [ ] `provider-discovery.ts` — Cascade env var → cred file → CLI
- [ ] `claim-extractor.ts` — Phase 2a extraction + 2b vérification exhaustivité
- [ ] `synthesis-judge.ts` — Phase 4 synthèse basique (pas de méta)
- [ ] `orchestrator.ts` — Phases 1 + 2 + 4 (pas de Phase 3)
- [ ] `debate-agent.ts` — Agent.Info, enregistrement dans agent.ts
- [ ] Skill `/debate` (SKILL.md)
- [ ] `prompts/diverge.txt`, `extractor.txt`, `exhaustivity.txt`, `synthesis.txt`
- [ ] Intégration TUI: spinner par provider, affichage rapport Markdown

### P2 — Pipeline complet (Tier 2)
- [ ] `role-assigner.ts` — Meta-prompt pour rôles dynamiques
- [ ] Phase 3 convergence ciblée (claims anonymes, sidecar fingerprint)
- [ ] Anonymisation hash-masking + ré-attribution dans le rapport
- [ ] Critère d'arrêt adaptatif (marginalGain / marginalCost)
- [ ] `jargon-checker.ts` — Grep codebase sur termes techniques
- [ ] Section métacognition dans le rapport (fragilité du consensus)
- [ ] `prompts/convergence.txt`

### P3 — Mémoire collective
- [ ] Injection sélective seed (top 3 blind spots > 0.8 confiance)
- [ ] Tool `queryPastDebates` pour retrieval manuel
- [ ] TTL + garbage collection des débats périmés
- [ ] Hash composite (prompt + workspace + providers) pour indexation

### P4 — Métriques de valeur
- [ ] Shadow baseline (meilleur modèle seul en parallèle)
- [ ] 5 métriques: blind_spot_count, coverage, hallucination_reduction,
      user_action_rate, cost_per_valid_insight
- [ ] Badge dans le rapport: "+X blind spots vs single-model"
- [ ] Mode A/B silencieux sur 10% des débats Tier 2+

### P5 — Red Team + Canary (Tier 3)
- [ ] `red-team.ts` — Conditionnel, seuil cosinus configurable
- [ ] Adversarial Canary (bug synthétique injecté + vérification)
- [ ] `prompts/red-team.txt`

### P6 — Routeur pré-débat
- [ ] Classifier (complexity × stakes × controversy_potential)
- [ ] Auto-tiering: le routeur décide Quick/Standard/Deep
- [ ] Score basé sur l'historique des métriques passées

### P7 — Shadow Debate continu
- [ ] Modèle local (Ollama) analyse chaque requête en background
- [ ] Alerte discrète si divergence critique détectée
- [ ] Opt-out configurable

---

## 9. Ce qui n'est PAS dans le scope

- Pas de scraping web / Playwright sur les interfaces des providers
- Pas d'injection dans le system prompt persistant (seed Round 1 seulement)
- Pas de mode automatique par défaut (toujours opt-in via /debate)
- Pas de Red Team permanent (conditionnel uniquement)
- Pas de double extracteur (unique + vérificateur)
