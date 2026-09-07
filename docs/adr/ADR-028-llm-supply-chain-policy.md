<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-028 — LLM Supply Chain Policy (C-AR-03)

> **Statut** : DECIDED
> **Date** : 2026-09-02
> **Source** : C-AR-03 (ouvert depuis M1, résolu post-M3-R3),
>   plan V2.3.1 §222 (AI Compiler) + §168 (AI security gates),
>   ADR-011 (MCP compatibility, modèle de compat externe),
>   ADR-024 (extension isolation, trust classes),
>   ADR-010 (key/secret model, déjà DECIDED),
>   ADR-027 (supply chain policy global, déjà DECIDED),
>   `@unifia/contracts/src/ai-compiler.ts` (AI-01, AI-02 livrés).
> **Cible** : `Automate AI × local-single-node × Windows` (puis tous
>   les profiles impliquant l'AI Compiler — Browser, AI, Enterprise).

## Status

DECIDED. ADR de **politique d'ingénierie** (cadre LLM), ni runtime
ni schéma — définit le contrat que toute intégration LLM doit
respecter. **N'est PAS** bloqué par ADR-000 (l'AI Compiler s'exécute
au-dessus du substrate, pas à l'intérieur).

## Contexte

L'AI Compiler (Plan §222) transforme une description en langage
naturel en un `WorkflowDefinition` IR (ADR-002). Il fait intervenir
au moins un fournisseur LLM externe (Anthropic, OpenAI, Mistral,
local Ollama, etc.). Le contrat `@unifia/contracts/src/ai-compiler.ts`
est livré (AI-01 request, AI-02 validation result), mais plusieurs
décisions de chaîne d'approvisionnement n'ont pas encore d'ADR pour
les porter :

1. **Quel(s) fournisseur(s) LLM** ? Multi-provider (per-workspace
   config) ou single-provider hard-coded ?
2. **Quels modèles** ? Liste autorisée ou allowlist dynamique ?
3. **Comment les clés API sont stockées** ? OS keychain via
   `@unifia/secret-broker` (déjà implémenté M1-07), plain env var
   (interdit), vault externe ?
4. **Coût et rate-limiting** ? Hard cap par workspace, par jour ?
   Alerte utilisateur ?
5. **Telemetrie et audit** ? Quels événements sont journalisés ?
   Les prompts sont-ils persistés ?
6. **Tests et validation** ? Golden set de prompts (cf. gates
   §6 `ai_security_gates` du fichier `certification/gates.yaml`),
   hallucination check, capability omission check ?
7. **Failure modes** ? Timeout, retry, fallback vers un autre
   provider, refus gracieux ?
8. **Local vs remote** ? Mode `local-only` (Ollama) autorisé pour
   la cible première `Automate AI × local-single-node` ?

C-AR-03 ratifie une politique par défaut pour ces 8 axes, à
actualiser en ADR-029+ si le paysage change.

## Decision

### 1. Fournisseurs LLM (Provider Registry)

- **Liste autorisée par défaut** (V2.3.1) :
  - `anthropic` (Claude Sonnet, Claude Haiku)
  - `openai` (GPT-4o, GPT-4o-mini)
  - `mistral` (Mistral Large, Mistral Small)
  - `ollama` (local, single-binary, on-device)
  - `openai-compatible` (tout endpoint compatible OpenAI Chat
    Completions : vLLM, llama.cpp server, etc.)
- **Pas de hard-coded** : la sélection est par workspace
  (`WorkspaceConfig.aiCompiler.provider`).
- **Pas d'auto-allowlist** : ajouter un provider nécessite une
  modification du `ProviderRegistrySchema` (TypeScript compile-time
  + `@unifia/contracts/src/ai-compiler.ts` extension).
- **Single-provider pour la première cible** : un workspace =
  un provider à un instant T. Migration entre providers autorisée
  via `WorkspaceConfig.aiCompiler.provider` (pas de routing
  dynamique).

### 2. Modèles (Model Registry)

- **Allowlist explicite par provider** : `claude-3-5-sonnet-*`,
  `claude-3-5-haiku-*`, `gpt-4o`, `gpt-4o-mini`, `mistral-large-*`,
  `mistral-small-*`, plus le catalogue dynamique d'Ollama
  (`ollama list`).
- **Pas d'arbitrary model strings** : un `modelId` non listé est
  rejeté par le contrat (`ModelRegistrySchema.parse`).
- **Date de pin** : chaque `modelId` est pinné à un snapshot
  (`pinnedAt: number`, Unix ms) au moment où le workspace l'a
  sélectionné. Upgrade manuel.
- **Allowlist dynamique tolérée** pour Ollama (le binaire
  télécharge ses modèles à la demande). Un log est émis à chaque
  `ollama pull` pour traçabilité.

### 3. Stockage des clés API (Secret Model)

- **Source unique** : `@unifia/secret-broker` (ADR-010, M1-07).
  Toute clé API vit dans le broker, jamais en env var ni en
  fichier plat.
- **Identifiant broker** : `{provider}:{workspaceId}` pour les
  providers commerciaux ; `ollama` n'a pas de clé (loopback ou
  socket Unix).
- **Rotation** : manuelle, via `unifia secret rotate` (à
  implémenter post-M3). Pas de rotation automatique.
- **Leak canary** : M1-12 secret-leak canary bloque toute clé
  API qui apparaîtrait en clair dans logs, traces, LLM output
  visible, screenshot, audit export.

### 4. Coût et rate-limiting

- **Hard cap par workspace par jour** : `WorkspaceConfig.aiCompiler.
  dailyBudgetUsd: number` (default 5.00, 0 = unlimited). Au-delà,
  le compilateur refuse la requête avec une `IrCompilerError.
  code = "BUDGET_EXCEEDED"`.
- **Rate limit** : 60 requêtes/minute par workspace, par provider.
  Au-delà : `IrCompilerError.code = "RATE_LIMITED"` + retry-after
  en secondes.
- **Métriques** : émises via le logger zero-alloc (M1-12) avec
  `event = "ai.compiler.request"` + `event = "ai.compiler.
  response"` (statusCode, tokensIn, tokensOut, latencyMs, costUsd).
- **Alerte utilisateur** : à 80% du budget quotidien, une
  notification UI est émise (sera implémentée dans
  `automate-surface.tsx` post-M3).

### 5. Telemetrie et audit (Privacy Boundaries)

- **Prompt persistence = opt-in par workspace** :
  `WorkspaceConfig.aiCompiler.persistPrompts: boolean` (default
  `false`). Si `false`, le prompt est passé au LLM mais jamais
  écrit nulle part (logs, traces, audit, debugger).
- **Réponse persistence = opt-in par workspace** :
  `WorkspaceConfig.aiCompiler.persistResponses: boolean` (default
  `false`).
- **Audit obligatoire** : `event = "ai.compiler.invocation"`
  avec `workspaceId`, `provider`, `modelId`, `requestId`,
  `latencyMs`, `tokensIn`, `tokensOut`, `costUsd`,
  `errorCode?` — toujours persisté (pas de opt-in), conformément
  à ADR-009 (Policy) et au Threat Model TM-AI-01.
- **PII filtering** : tout `input` utilisateur qui transite par
  l'AI Compiler est traité comme PII potentielle. Le logger
  zero-alloc masque les valeurs dans les traces par défaut
  (M1-12 canary).

### 6. Tests et validation (AI Security Gates)

- **Golden set de prompts** : `certification/gates.yaml §6
  ai_security_gates` spécifie un gold benchmark (à post-M3-R3) :
  - 50 prompts représentatifs (HTTP, schedule, approval, parallel,
    repeat, wait, error paths).
  - Expected output : `WorkflowDefinitionSchema.parse` doit
    accepter la sortie, `findOrphanEdgeReferences` doit retourner
    `[]`, `findCycles` doit retourner `[]`.
- **Métriques bloquantes** :
  - `hallucinated_executable_tool = 0`
  - `critical_capability_omission = 0`
  - `critical_approval_omission = 0`
  - `critical_data_policy_violation = 0`
  - `forbidden_secret_to_model_flow = 0`
- **Mutation testing** : chaque cas de test est supprimé une fois
  puis re-couru, et le compilateur doit échouer. Pattern identique
  à M2-TEST (46/46 graph property).
- **Pas de fast-check** (ADR-027 §3) : golden set fixe, pas de
  property-based random.

### 7. Failure modes (Robustness)

- **Timeout** : 30 secondes par requête LLM (configurable
  `WorkspaceConfig.aiCompiler.timeoutMs`).
- **Retry** : 1 retry avec backoff exponentiel 1s → 2s (2 essais
  total). Au-delà : `IrCompilerError.code = "PROVIDER_UNAVAILABLE"`.
- **Fallback provider** : non implémenté en V2.3.1. Si un
  provider est down, l'utilisateur doit en changer manuellement.
- **Refus gracieux** : si l'AI Compiler ne peut pas produire un
  IR valide après retry, il retourne un `IrCompilerError` détaillé
  avec un message actionnable (l'utilisateur édite son prompt).
- **Schema strict** : la sortie LLM est parsée par
  `WorkflowDefinitionSchema.parse` (Zod) ; toute déviation est
  rejetée avec un message explicite pointant vers le champ fautif.

### 8. Local vs remote

- **Mode `local-only` autorisé** : un workspace peut être configuré
  en `WorkspaceConfig.aiCompiler.localOnly = true`. Dans ce mode,
  seul `ollama` (ou `openai-compatible` pointant sur un
  loopback/socket Unix) est autorisé ; les providers commerciaux
  sont rejetés au compile-time du workspace.
- **Cible première** : `Automate AI × local-single-node × Windows`
  **exige** `localOnly: true` (le plan §192 fixe la souveraineté
  locale comme non-négociable pour cette cible).
- **Audit** : un workspace en `localOnly: true` a un
  `event = "ai.compiler.local_only"` journalisé au démarrage.

## Consequences

- **C-AR-04 (UX ADR)** reste ouvert. Cette ADR-ci ne touche pas
  l'UI ; la policy UX (tokens de design, framework, validation
  design) sera tranchée séparément.
- **`WorkspaceConfig`** devient un nouveau contrat (à postuler dans
  `@unifia/contracts/src/workspace-config.ts` ou équivalent). Pas
  créé dans cette session — c'est un livrable de la prochaine
  (post-M3).
- **`ProviderRegistrySchema` + `ModelRegistrySchema`** également à
  créer. Listes par défaut fournies dans `@unifia/contracts/src/
  ai-compiler.ts` (extension de la livraison R2 existante).
- **`IrCompilerError`** : nouveau error code enum
  (`BUDGET_EXCEEDED`, `RATE_LIMITED`, `PROVIDER_UNAVAILABLE`,
  `MODEL_NOT_ALLOWED`, `SECRET_MISSING`,
  `PERSISTENCE_DISABLED`).
- **certification/gates.yaml §6** : `ai_security_gates` reste
  `NA_THIS_PROFILE` pour la première cible (local-only Ollama,
  pas de provider commercial). Sera activé pour
  `Automate AI × server-single-node` post-M3.

## Liens

- `packages/contracts/src/ai-compiler.ts` (AI-01, AI-02 livrés R2)
- `packages/contracts/test/ai-compiler.test.ts` (10/10 PASS)
- `@unifia/secret-broker` (ADR-010, M1-07)
- `packages/observability` (M1-12, zero-alloc logger + canary)
- `docs/adr/ADR-010-secret-credential-key-model.md` (DECIDED)
- `docs/adr/ADR-011-mcp-compatibility.md` (DECIDED, modèle compat
  externe)
- `docs/adr/ADR-024-extension-runtime-trust-isolation.md` (DECIDED,
  trust classes)
- `docs/adr/ADR-026-typed-digest-envelope-per-domain.md` (DECIDED)
- `docs/adr/ADR-027-supply-chain-policy.md` (DECIDED, scope global)
- `certification/gates.yaml §6 ai_security_gates`
- Plan V2.3.1 §168 + §222

## Décisions de fond (rappel)

1. **5 providers** : anthropic, openai, mistral, ollama,
   openai-compatible.
2. **Allowlist explicite par provider**, pas d'auto-allowlist.
3. **Clés API dans `@unifia/secret-broker`** uniquement.
4. **Hard cap 5 USD/jour par workspace** (default), 0 = unlimited.
5. **Rate limit 60 req/min** par workspace par provider.
6. **Audit obligatoire**, prompts/réponses opt-in par workspace.
7. **Golden set 50 prompts** (post-M3-R3), 5 métriques
   bloquantes.
8. **Mode `localOnly: true`** exigé pour la première cible
   `Automate AI × local-single-node × Windows`.
