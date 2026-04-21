<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="Logo OpenCode">
    </picture>
  </a>
</p>
<p align="center">L'agent de codage IA open source.</p>
<p align="center">
  <a href="https://opencode.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/opencode-ai"><img alt="npm" src="https://img.shields.io/npm/v/opencode-ai?style=flat-square" /></a>
  <a href="https://github.com/anomalyco/opencode/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/anomalyco/opencode/publish.yml?style=flat-square&branch=dev" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.bs.md">Bosanski</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.gr.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a>
</p>

[![OpenCode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://opencode.ai)

<!-- WHY-FORK-MATRIX -->
## Pourquoi ce fork ?

> **En bref** — le seul agent de codage open source qui livre un orchestrateur DAG, une API REST de tâches, un scoping MCP par agent, une FSM de session à 9 états, un scanner de vulnérabilités intégré *et* une application Android de premier ordre avec inférence LLM sur l'appareil. Aucun autre CLI — propriétaire ou open — ne combine tout cela.

> See the English [README.md](README.md) for the full positioning prose (vs. vendor-locked CLIs, vs. BYOM peers, vs. specialized CLIs) and architecture diagram.

### Capability matrix — this fork vs. the 2026 landscape

Legend: ✅ shipped · ❌ absent · *partial* limited/incomplete · *plugin* via community add-on · *paid* behind a subscription tier.

#### Orchestration, API surface, governance

| Capability                             | **This fork** | Claude Code | Codex CLI | Gemini CLI | opencode (upstream) | Aider | Goose | Cline | Roo Code | Cursor | Continue | Crush | Qwen Code |
| -------------------------------------- | :-----------: | :---------: | :-------: | :--------: | :-----------------: | :---: | :---: | :---: | :------: | :----: | :------: | :---: | :-------: |
| Open source                            |       ✅       |      ❌      |  partial  |      ✅     |          ✅          |   ✅   |   ✅   |   ✅   |    ✅     |    ❌    |     ✅     |   ✅   |     ✅     |
| BYOM (bring your own model)            |       ✅       |      ❌      |     ❌     |      ❌     |          ✅          |   ✅   |   ✅   |   ✅   |    ✅     |  partial |     ✅     |   ✅   |   partial  |
| Local models (llama.cpp / Ollama)      |       ✅       |      ❌      |     ❌     |      ❌     |          ✅          |   ✅   |   ✅   |   ✅   |    ✅     |    ❌    |     ✅     |   ✅   |     ✅     |
| Parallel agents in isolated worktrees  |    ✅ native   |  ✅ (Teams)  |  partial  |      ❌     |      via plugin     |   ❌   | partial | ✅ (v3.58) | partial | ❌ | ❌ | ❌ |     ❌     |
| Explicit **DAG orchestration**         | ✅ **unique**  |    ad-hoc   |     ❌     |      ❌     |          ❌          |   ❌   | recipes (linear) | ❌ | ❌ | ❌ |     ❌     |   ❌   |     ❌     |
| **REST task API** (programmable)       | ✅ **unique**  | partial (SDK) |  ❌    |      ❌     |          ❌          |   ❌   |   ❌   |   ❌   |    ❌     |    ❌    |     ❌     |   ❌   |     ❌     |
| **TUI task dashboard**                 |       ✅       |      ❌      |     ❌     |      ❌     |       partial       |   ❌   |   ❌   |   ❌   |    ❌     |   n/a   |    n/a    |   ❌   |   partial  |
| MCP support                            | ✅ + **per-agent scoping** | ✅ | ✅ | ✅ | ✅ | via plugins | ✅ | ✅ | ✅ | partial | ✅ |   ❌   |     ✅     |
| **9-state session FSM (persistent)**   | ✅ **unique**  |      ❌      |     ❌     |      ❌     |        basic        |   ❌   |   ❌   |   ❌   |    ❌     |    ❌    |     ❌     |   ❌   |     ❌     |
| Built-in **vulnerability scanner**     | ✅ **unique**  |      ❌      |     ❌     |      ❌     |          ❌          |   ❌   |   ❌   |   ❌   |    ❌     |    ❌    |     ❌     |   ❌   |     ❌     |
| **DLP / secret redaction** before LLM call | ✅         |   partial    |     ❌     |      ❌     |          ❌          |   ❌   |   ❌   |   ❌   |    ❌     |    ❌    |     ❌     |   ❌   |     ❌     |
| **Per-agent tool allow/deny**          |       ✅       |   partial    |     ❌     |      ❌     |        basic        |   ❌   |   ❌   |   ❌   |  partial  |    ❌    |     ❌     |   ❌   |     ❌     |
| Docker sandboxing (opt-in)             |       ✅       |      ❌      |     ✅     |      ❌     |          ❌          |   ❌   |   ❌   |   ❌   |    ❌     |    ❌    |     ❌     |   ❌   |     ❌     |
| Git auto-commits / rollback            |       ✅       |      ✅      |     ✅     |      ✅     |      ✅ (signed)     |   ✅   |   ✅   |   ✅   |    ✅     |    ✅    |     ✅     |   ✅   |     ✅     |

#### Intelligence, context, developer UX

| Capability                             | **This fork** | Claude Code | Codex CLI | Gemini CLI | opencode (upstream) | Aider | Goose | Cline | Roo Code | Cursor | Continue | Crush | Qwen Code |
| -------------------------------------- | :-----------: | :---------: | :-------: | :--------: | :-----------------: | :---: | :---: | :---: | :------: | :----: | :------: | :---: | :-------: |
| LSP integration (go-to-def, diagnostics) | ✅           |   partial    |  partial  |   partial   |          ✅          | partial | partial | ✅   |    ✅     |    ✅    |     ✅     | partial |  partial  |
| Plugin SDK (`@opencode/plugin`)        |       ✅       |   partial    |     ❌     |      ❌     |          ✅          |   ❌   |   ✅   |   ✅   |    ✅     |    ✅    |     ✅     |   ❌   |     ❌     |
| Prompt caching (cloud + local KV)      |       ✅       |      ✅      |     ✅     |      ✅     |          ✅          |   ✅   |   ✅   |   ✅   |    ✅     |    ✅    |     ✅     |   ✅   |     ✅     |
| **Hybrid RAG (BM25 + vector + decay)** | ✅ **unique**  |      ❌      |     ❌     |      ❌     |          ❌          |   ❌   |   ❌   | partial | ❌      |  vector only |  vector only |  ❌   |     ❌     |
| **Memory conflict resolution**         | ✅ **unique**  |      ❌      |     ❌     |      ❌     |          ❌          |   ❌   |   ❌   |   ❌   |    ❌     |    ❌    |     ❌     |   ❌   |     ❌     |
| **Auto-learn** (lesson extraction)     | ✅ **unique**  |      ❌      |     ❌     |      ❌     |          ❌          |   ❌   |   ❌   |   ❌   |    ❌     |    ❌    |     ❌     |   ❌   |     ❌     |
| Auto-compact (AI summarization)        |       ✅       |      ✅      |     ✅     |      ✅     |          ✅          |   ✅   |   ✅   |   ✅   |    ✅     |    ✅    |     ✅     | partial |     ✅     |
| Unified-diff edit engine               |       ✅       |      ✅      |     ✅     |   partial   |          ✅          |   ✅   | partial | partial |    ✅     | partial |  partial  | partial |  partial  |
| ACP (Agent Client Protocol) layer      |       ✅       |      ❌      |     ❌     |      ❌     |        basic        |   ❌   |   ❌   |   ❌   |    ❌     |    ❌    |     ❌     |   ❌   |     ❌     |

#### Platform reach & multimodal

| Capability                             | **This fork** | Claude Code | Codex CLI | Gemini CLI | opencode (upstream) | Aider | Goose | Cline | Roo Code | Cursor | Continue | Crush | Qwen Code |
| -------------------------------------- | :-----------: | :---------: | :-------: | :--------: | :-----------------: | :---: | :---: | :---: | :------: | :----: | :------: | :---: | :-------: |
| First-class **Android app**            | ✅ **unique**  |      ❌      |     ❌     |      ❌     |          ❌          |   ❌   |   ❌   |   ❌   |    ❌     |    ❌    |     ❌     |   ❌   |     ❌     |
| iOS (remote mode)                      |       ✅       |      ❌      |     ❌     |      ❌     |          ❌          |   ❌   |   ❌   |   ❌   |    ❌     |    ❌    |     ❌     |   ❌   |     ❌     |
| Adaptive runtime (VRAM/CPU/thermal)    | ✅ **unique**  |      ❌      |     ❌     |      ❌     |      hardcoded      | hardcoded | hardcoded | hardcoded | hardcoded | n/a | hardcoded | hardcoded | hardcoded |
| **STT** (voice-to-text, built-in)      | ✅ (Parakeet)  |      ❌      |     ❌     |      ❌     |          ❌          |   ❌   |   ❌   | partial  |    ❌     |    ❌    |     ❌     |   ❌   |     ❌     |
| **TTS** (text-to-speech + voice clone) | ✅ (Pocket/Kokoro) |  ❌       |     ❌     |      ❌     |          ❌          |   ❌   |   ❌   |   ❌   |    ❌     |    ❌    |     ❌     |   ❌   |     ❌     |
| **OAuth deep-link callback**           |       ✅       |      ❌      |     ❌     |      ❌     |          ❌          |   ❌   |   ❌   |   ❌   |    ❌     |    ❌    |     ❌     |   ❌   |     ❌     |
| **mDNS service discovery**             | ✅ **unique**  |      ❌      |     ❌     |      ❌     |          ❌          |   ❌   |   ❌   |   ❌   |    ❌     |    ❌    |     ❌     |   ❌   |     ❌     |
| **Upstream branch watcher** (`vcs.branch.behind`) | ✅ **unique** | ❌ |    ❌     |      ❌     |          ❌          |   ❌   |   ❌   |   ❌   |    ❌     |    ❌    |     ❌     |   ❌   |     ❌     |
| **Collaborative mode** (JWT + presence + file-lock) | ✅ | ❌      |     ❌     |      ❌     |          ❌          |   ❌   |   ❌   |   ❌   |    ❌     | partial |     ❌     |   ❌   |     ❌     |
| **AnythingLLM bridge**                 | ✅ **unique**  |      ❌      |     ❌     |      ❌     |          ❌          |   ❌   |   ❌   |   ❌   |    ❌     |    ❌    |     ❌     |   ❌   |     ❌     |
| **GDPR export/erasure route**          | ✅ **unique**  |      ❌      |     ❌     |      ❌     |          ❌          |   ❌   |   ❌   |   ❌   |    ❌     |    ❌    |     ❌     |   ❌   |     ❌     |
| Price                                  |  free + BYOM  |  $20/mo sub |$20/mo sub |  1000/day free | free + BYOM    | free + BYOM | free + BYOM | free + BYOM | free + BYOM | $20/mo sub | free + BYOM | free + BYOM | free + BYOM |

---

## Fonctionnalités du fork

> Ceci est un fork de [anomalyco/opencode](https://github.com/anomalyco/opencode) maintenu par [Rwanbt](https://github.com/Rwanbt).
> Synchronisé avec l'upstream. Voir la [branche dev](https://github.com/Rwanbt/opencode/tree/dev) pour les dernières modifications.

#### IA locale d'abord

OpenCode exécute des modèles IA localement sur du matériel grand public (8 Go VRAM / 16 Go RAM), sans aucune dépendance cloud pour les modèles 4B-7B.

**Optimisation des prompts (réduction de 94%)**
- Prompt système de ~1K tokens pour les modèles locaux (vs ~16K pour le cloud)
- Schémas d'outils squelettiques (signatures d'1 ligne vs prose de plusieurs Ko)
- Liste blanche de 7 outils (bash, read, edit, write, glob, grep, question)
- Pas de section skills, informations d'environnement minimales

**Moteur d'inférence (llama.cpp b8731)**
- Backend GPU Vulkan, téléchargé automatiquement au premier chargement de modèle
- **Configuration adaptative à l'exécution** (`packages/opencode/src/local-llm-server/auto-config.ts`) : `n_gpu_layers`, threads, taille de batch/ubatch, quantification du cache KV et taille du contexte dérivées de la VRAM détectée, de la RAM libre, du découpage CPU big.LITTLE, du backend GPU (CUDA/ROCm/Vulkan/Metal/OpenCL) et de l'état thermique. Remplace l'ancien `--n-gpu-layers 99` codé en dur — un Android 4 Go fonctionne désormais en repli CPU au lieu d'être tué par OOM, les desktops haut de gamme obtiennent un batch ajusté au lieu du 512 par défaut.
- `--flash-attn on` — Flash Attention pour l'efficacité mémoire
- `--cache-type-k/v` — Cache KV avec rotation de Hadamard ; palier adaptatif (f16 / q8_0 / q4_0) selon la marge VRAM
- `--fit on` — ajustement VRAM secondaire exclusif au fork (activation via `OPENCODE_LLAMA_ENABLE_FIT=1`)
- Décodage spéculatif (`--model-draft`) avec garde VRAM (désactivation automatique si < 1.5 Go libre)
- Slot unique (`-np 1`) pour minimiser l'empreinte mémoire
- **Harnais de benchmark** (`bun run bench:llm`) : mesure reproductible de FTL / TPS / RSS de pic / temps mur par modèle, par exécution, sortie JSONL pour archivage CI

**Reconnaissance vocale (Parakeet TDT 0.6B v3 INT8)**
- NVIDIA Parakeet via ONNX Runtime — ~300ms pour 5s d'audio (18x temps réel)
- 25 langues européennes (anglais, français, allemand, espagnol, etc.)
- Zéro VRAM : CPU uniquement (~700 Mo RAM)
- Téléchargement automatique du modèle (~460 Mo) au premier appui micro
- Animation de forme d'onde pendant l'enregistrement

**Synthèse vocale (Kyutai Pocket TTS)**
- TTS natif français créé par Kyutai (Paris), 100M paramètres
- 8 voix intégrées : Alba, Fantine, Cosette, Eponine, Azelma, Marius, Javert, Jean
- Clonage vocal zero-shot : téléchargez un WAV ou enregistrez depuis le micro
- CPU uniquement, ~6x temps réel, serveur HTTP sur le port 14100
- Fallback : moteur Kokoro TTS ONNX (54 voix, 9 langues, CMUDict G2P)

**Gestion des modèles**
- Recherche HuggingFace avec badges de compatibilité VRAM/RAM par modèle
- Télécharger, charger, décharger, supprimer des modèles GGUF depuis l'interface
- Catalogue pré-sélectionné : Gemma 4 E4B, Qwen 3.5 (4B/2B/0.8B), Phi-4 Mini, Llama 3.2
- Tokens de sortie dynamiques selon la taille du modèle
- Détection automatique du modèle draft (0.5B-0.8B) pour le décodage spéculatif

**Configuration**
- Préréglages : Fast / Quality / Eco / Long Context (optimisation en un clic)
- Widget de surveillance VRAM avec barre d'utilisation colorée (vert / jaune / rouge)
- Type de cache KV : auto / q8_0 / q4_0 / f16
- Déchargement GPU : auto / gpu-max / balanced
- Memory mapping : auto / on / off
- Basculement de recherche web (icône globe dans la barre de prompt)

**Fiabilité de l'agent (modèles locaux)**
- Gardes pré-vol (au niveau code, 0 token) : vérification d'existence du fichier avant édition, vérification du contenu old_string, lecture obligatoire avant édition, prévention d'écriture sur fichier existant
- Rupture automatique de boucle infinie : 2x appels d'outils identiques → erreur injectée (garde au niveau code, pas uniquement dans le prompt)
- Télémétrie des outils : taux de succès/erreur par session avec détail par outil, journalisé automatiquement
- Objectif : >85% de taux de réussite des outils sur les modèles 4B

**Multi-plateforme** : Windows (Vulkan), Linux, macOS, Android

#### Tâches en arrière-plan

Déléguez du travail à des sous-agents qui s'exécutent de manière asynchrone. Définissez `mode: "background"` sur l'outil task et il retourne immédiatement un `task_id` pendant que l'agent travaille en arrière-plan. Les événements bus (`TaskCreated`, `TaskCompleted`, `TaskFailed`) sont publiés pour le suivi du cycle de vie.

#### Équipes d'agents

Orchestrez plusieurs agents en parallèle via l'outil `team`. Définissez des sous-tâches avec des liens de dépendance ; `computeWaves()` construit un DAG et exécute les tâches indépendantes simultanément (jusqu'à 5 agents en parallèle). Contrôle du budget via `max_cost` (dollars) et `max_agents`. Le contexte des tâches terminées est automatiquement transmis aux tâches dépendantes.

#### Isolation Git worktree

Chaque tâche en arrière-plan obtient automatiquement son propre git worktree. L'espace de travail est lié à la session dans la base de données. Si une tâche ne produit aucune modification de fichier, le worktree est nettoyé automatiquement. Cela fournit une isolation au niveau git sans conteneurs.

#### API de gestion des tâches

API REST complète pour la gestion du cycle de vie des tâches :

| Méthode | Chemin | Description |
|---------|--------|-------------|
| GET | `/task/` | Lister les tâches (filtrer par parent, statut) |
| GET | `/task/:id` | Détails de la tâche + statut + info worktree |
| GET | `/task/:id/messages` | Récupérer les messages de la session de tâche |
| POST | `/task/:id/cancel` | Annuler une tâche en cours ou en file d'attente |
| POST | `/task/:id/resume` | Reprendre une tâche terminée/échouée/bloquée |
| POST | `/task/:id/followup` | Envoyer un message de suivi à une tâche inactive |
| POST | `/task/:id/promote` | Promouvoir une tâche d'arrière-plan au premier plan |
| GET | `/task/:id/team` | Vue agrégée de l'équipe (coûts, diffs par membre) |

#### Tableau de bord TUI des tâches

Plugin de barre latérale affichant les tâches en arrière-plan actives avec des icônes de statut en temps réel :

| Icône | Statut |
|-------|--------|
| `~` | Running / Retrying |
| `?` | Queued / Awaiting input |
| `!` | Blocked |
| `x` | Failed |
| `*` | Completed |
| `-` | Cancelled |

Dialogue avec actions : ouvrir la session de tâche, annuler, reprendre, envoyer un suivi, vérifier le statut.

#### Portée MCP par agent

Listes d'autorisation/refus par agent pour les serveurs MCP. Configurez dans `opencode.json` sous le champ `mcp` de chaque agent. La fonction `toolsForAgent()` filtre les outils MCP disponibles en fonction de la portée de l'agent appelant.

```json
{
  "agents": {
    "explore": {
      "mcp": { "deny": ["dangerous-server"] }
    }
  }
}
```

#### Cycle de vie de session à 9 états

Les sessions suivent l'un des 9 états, persistés dans la base de données :

`idle` · `busy` · `retry` · `queued` · `blocked` · `awaiting_input` · `completed` · `failed` · `cancelled`

Les états persistants (`queued`, `blocked`, `awaiting_input`, `completed`, `failed`, `cancelled`) survivent aux redémarrages de la base de données. Les états en mémoire (`idle`, `busy`, `retry`) se réinitialisent au redémarrage.

#### Agent orchestrateur

Agent coordinateur en lecture seule (50 étapes maximum). A accès aux outils `task` et `team` mais tous les outils d'édition sont interdits. Délègue l'implémentation aux agents build/general et synthétise les résultats.

---

## Architecture technique

### Support multi-fournisseurs

Plus de 21 fournisseurs prêts à l'emploi : Anthropic, OpenAI, Google Gemini, Azure, AWS Bedrock, Vertex AI, OpenRouter, GitHub Copilot, XAI, Mistral, Groq, DeepInfra, Cerebras, Cohere, TogetherAI, Perplexity, Vercel, Venice, GitLab, Gateway, ainsi que tout endpoint compatible OpenAI. Tarification issue de [models.dev](https://models.dev).

### Système d'agents

| Agent | Mode | Accès | Description |
|-------|------|-------|-------------|
| **build** | primary | full | Agent de développement par défaut |
| **plan** | primary | read-only | Analyse et exploration du code |
| **general** | subagent | full (no todowrite) | Tâches complexes multi-étapes |
| **explore** | subagent | read-only | Recherche rapide dans le codebase |
| **orchestrator** | subagent | read-only + task/team | Coordinateur multi-agents (50 étapes) |
| **critic** | subagent | read-only + bash + LSP | Revue de code : bugs, sécurité, performance |
| **tester** | subagent | full (no todowrite) | Écrire et exécuter des tests, vérifier la couverture |
| **documenter** | subagent | full (no todowrite) | JSDoc, README, documentation inline |
| compaction | hidden | none | Résumé de contexte piloté par IA |
| title | hidden | none | Génération de titre de session |
| summary | hidden | none | Résumé de session |

### Intégration LSP

Support complet du Language Server Protocol avec indexation des symboles, diagnostics et support multi-langages (TypeScript, Deno, Vue, et extensible). L'agent navigue dans le code via les symboles LSP plutôt que par recherche textuelle, permettant un go-to-definition précis, find-references et la détection d'erreurs de type en temps réel.

### Support MCP

Client et serveur Model Context Protocol. Supporte les transports stdio, HTTP/SSE et StreamableHTTP. Flux d'authentification OAuth pour les serveurs distants. Capacités tool, prompt et resource. Portée par agent via les listes d'autorisation/refus.

### Architecture client/serveur

API REST basée sur Hono avec routes typées et génération de spécification OpenAPI. Support WebSocket pour PTY (pseudo-terminal). SSE pour le streaming d'événements en temps réel. Auth basique, CORS, compression gzip. Le TUI est une interface ; le serveur peut être piloté depuis n'importe quel client HTTP, l'interface web ou une application mobile.

### Gestion du contexte

Auto-compactage avec résumé piloté par IA lorsque l'utilisation des tokens approche la limite de contexte du modèle. Élagage sensible aux tokens avec seuils configurables (`PRUNE_MINIMUM` 20KB, `PRUNE_PROTECT` 40KB). Les sorties de l'outil skill sont protégées de l'élagage.

### Moteur d'édition

Application de diffs unifiés avec vérification des hunks. Applique des hunks ciblés sur des régions spécifiques du fichier plutôt que des réécritures complètes. Outil multi-edit pour les opérations par lots sur plusieurs fichiers.

### Système de permissions

Permissions à 3 états (`allow` / `deny` / `ask`) avec correspondance par motifs génériques. Plus de 100 définitions d'arité de commandes bash pour un contrôle précis. Application des limites du projet empêchant l'accès aux fichiers hors de l'espace de travail.

### Retour arrière basé sur git

Système de snapshots qui enregistre l'état des fichiers avant chaque exécution d'outil. Supporte `revert` et `unrevert` avec calcul de diff. Les modifications peuvent être annulées par message ou par session.

### Suivi des coûts

Coût par message avec décomposition complète des tokens (input, output, reasoning, cache read, cache write). Limites de budget par équipe (`max_cost`). Commande `stats` avec agrégation par modèle et par jour. Coût de session en temps réel affiché dans le TUI. Données de tarification issues de models.dev.

### Système de plugins

SDK complet (`@opencode/plugin`) avec architecture de hooks. Chargement dynamique depuis des packages npm ou le système de fichiers. Plugins intégrés pour l'authentification Codex, GitHub Copilot, GitLab et Poe.

---

## Idées reçues courantes

Pour éviter toute confusion liée aux résumés générés par IA de ce projet :

- Le **TUI est en TypeScript** (SolidJS + @opentui pour le rendu terminal), pas en Rust.
- **Tree-sitter** est utilisé uniquement pour la coloration syntaxique du TUI et l'analyse des commandes bash, pas pour l'analyse de code au niveau agent.
- Il n'y a **pas de sandboxing Docker/E2B** -- l'isolation est assurée par les git worktrees.
- Il n'y a **pas de base de données vectorielle ni de système RAG** -- le contexte est géré via l'indexation de symboles LSP + l'auto-compactage.
- Il n'y a **pas de "mode watch" qui propose des corrections automatiques** -- le file watcher existe uniquement à des fins d'infrastructure.
- L'**auto-correction** utilise la boucle standard de l'agent (le LLM voit les erreurs dans les résultats d'outils et réessaie), pas un mécanisme spécialisé de réparation automatique.

## Matrice de capacités

| Capacité | Statut | Notes |
|----------|--------|-------|
| Background tasks | Implemented | `mode: "background"` on task tool |
| Agent teams (DAG) | Implemented | Wave-based parallel execution, budget control |
| Git worktree isolation | Implemented | Auto-created per background task |
| Task REST API | Implemented | 8 endpoints for full lifecycle |
| TUI task dashboard | Implemented | Sidebar + dialog actions |
| MCP agent scoping | Implemented | Per-agent allow/deny config |
| 9-state lifecycle | Implemented | Persistent to SQLite |
| Orchestrator agent | Implemented | Read-only coordinator |
| Multi-provider (21+) | Implemented | Including local models |
| LSP integration | Implemented | Symbols, diagnostics, multi-language |
| MCP protocol | Implemented | Client + server, 3 transports |
| Plugin system | Implemented | SDK + hook architecture |
| Cost tracking | Implemented | Per-message, per-team, per-model |
| Context auto-compact | Implemented | AI summarization + pruning |
| Git rollback/snapshots | Implemented | Revert/unrevert per message |
| Docker sandboxing | Implemented | Optional via `experimental.sandbox.type: "docker"` |
| Vector DB / RAG | Implemented | `experimental.rag.enabled: true`, SQLite + cosine similarity |
| Dry run / command preview | Implemented | `dry_run` param on bash/edit/write tools |
| Specialized agents | Implemented | critic, tester, documenter subagents |
| Auto-learn | Implemented | Post-session lesson extraction to `.opencode/learnings/` |
| Vulnerability scanner | Implemented | Auto-scan on edit/write for secrets, injections, unsafe patterns |
| DLP / AgentShield | Implemented | `experimental.dlp.enabled: true`, redacts secrets before LLM calls |
| Policy engine | Implemented | `experimental.policy.enabled: true`, conditional rules + custom policies |
| Confidence/decay | Implemented | Time-based scoring for RAG embeddings, exponential decay |
| Memory conflict resolution | Implemented | Detects and resolves duplicate/contradictory embeddings |
| Per-message token display | Partial | Stored in DB, shown as session aggregate |

### IA Locale (Desktop + Mobile)
| Capacité | Statut | Notes |
|----------|--------|-------|
| Local LLM (llama.cpp b8731) | Implemented | Vulkan GPU, auto-download runtime, `--fit` auto-VRAM |
| **Configuration adaptative à l'exécution** | Implemented | `auto-config.ts` : n_gpu_layers / threads / batch / quant KV dérivés de la VRAM détectée, RAM, big.LITTLE, backend GPU, état thermique |
| **Harnais de benchmark** | Implemented | `bun run bench:llm` mesure FTL, TPS, RSS de pic, temps mur par modèle ; sortie JSONL |
| Flash Attention | Implemented | `--flash-attn on` on desktop and mobile |
| KV cache quantization | Implemented | q4_0 / q8_0 / f16 adaptive with Hadamard rotation (72% memory savings) |
| Exact tokenizer (OpenAI) | Implemented | `js-tiktoken` pour gpt-*/o1/o3/o4 ; empirique 3.5 caractères/token pour Llama/Qwen/Gemma |
| Speculative decoding | Implemented | VRAM Guard (desktop) / RAM Guard (mobile), draft model auto-detection |
| HuggingFace model search | Implemented | Réponse validée par Zod, badges VRAM, gestionnaire de téléchargement, 9 modèles pré-sélectionnés |
| **Téléchargements GGUF reprenables** | Implemented | En-tête HTTP `Range` — une interruption 4G ne redémarre pas un transfert de 4 Go depuis zéro |
| Tool telemetry | Implemented | Per-session success/error rate logging with per-tool breakdown |
| Redémarrage avec disjoncteur | Implemented | `ensureCorrectModel` abandonne après 3 redémarrages en 120 s pour éviter les boucles burn-cycle |

### Sécurité et Gouvernance
| Capacité | Statut | Notes |
|----------|--------|-------|
| **CSP stricte (desktop + mobile)** | Implemented | `connect-src` limité à loopback + HuggingFace + fournisseurs HTTPS ; pas de `unsafe-eval`, `object-src 'none'`, `frame-ancestors 'none'` |
| **Durcissement de release Android** | Implemented | `isDebuggable=false`, `allowBackup=false`, `isShrinkResources=true`, `FOREGROUND_SERVICE_TYPE_SPECIAL_USE` |
| **Durcissement de release desktop** | Implemented | Devtools ne sont plus forcément activés — le défaut Tauri 2 (debug uniquement) a été restauré pour qu'un point d'appui XSS ne puisse pas s'accrocher à `__TAURI__` en production |
| **Validation des entrées des commandes Tauri** | Implemented | Gardes `download_model` / `load_llm_model` / `delete_model` : charset du nom de fichier, allowlist HTTPS vers `huggingface.co` / `hf.co` |
| **Chaîne de logging Rust** | Implemented | `log` + `android_logger` sur mobile ; pas de `eprintln!` en release → pas de fuite de path/URL vers logcat |
| **Traqueur d'audit de sécurité** | Implemented | [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md) — toutes les trouvailles classées S1/S2/S3 avec `path:line`, statut et justification de correctif reporté |

---

## Future Roadmap

Three major initiatives are planned on dedicated feature branches. Each is designed to be modular — they can be developed independently and merged when ready.

### 🤝 Collaborative Mode ()

**Goal**: Multiple developers interacting with agents simultaneously in real-time.

| Component | Description |
|-----------|-------------|
| Multi-user auth | JWT-based authentication on the Hono server, user sessions, role-based access |
| WebSocket broadcast | Real-time event streaming to all connected clients (agent activity, file changes, task status) |
| File concurrency | Lock-based or CRDT-based conflict resolution when multiple agents/users edit the same file |
| Presence UI | See who is connected, what they're working on, which agents are assigned to whom |
| Shared context | Cross-user session history, shared learnings, team-wide RAG index |

**Scale**: ~3000+ LOC, major architectural change. Requires refactoring the server for multi-tenant support.

### 📱 Mobile Version ()

**Goal**: Run OpenCode as a native mobile app on Android and iOS, with full agent capabilities.

| Component | Description |
|-----------|-------------|
| **Tauri 2.0 migration** | Leverage Tauri's mobile targets (Android/iOS) to package the existing SolidJS frontend as a native app |
| **Runtime adaptation** | Bundle the TypeScript agent core with Vite for WebView execution; delegate performance-critical tasks to Tauri's Rust layer |
| **isomorphic-git** | Replace system  calls with isomorphic-git for pure-JS git operations within the mobile sandbox |
| **File system access** | Use  for sandboxed file access + Document Picker integration |
| **Remote mode** | Connect to a desktop OpenCode instance over a secure tunnel (Tailscale/Cloudflare) for full capability without local execution |
| **Mobile-optimized UI** | Conversational interface that hides terminal complexity; swipe-based diff review; virtual keyboard optimizations |

**Platform comparison**:
- **Android** (via Termux or Tauri): Full Node.js support, broad file access, excellent performance
- **iOS** (via Tauri/a-Shell): Sandbox restrictions, limited native packages, but strong Apple Silicon performance for local models

**Scale**: ~2000+ LOC for the Tauri mobile shell, ~500 LOC for isomorphic-git adapter, ~300 LOC for remote mode.

### 🔗 AnythingLLM Fusion ()

**Goal**: Merge OpenCode's agentic coding capabilities with [AnythingLLM](https://github.com/mintplex-labs/anything-llm)'s document RAG and multi-user chat platform.

| Component | Description |
|-----------|-------------|
| **Context bridge** | Pipe AnythingLLM's indexed documents (PDFs, wikis, Confluence, etc.) into OpenCode's system prompt as additional context |
| **Agent skill plugin** | Expose OpenCode's core commands (, , edit, bash) as an AnythingLLM Agent Skill via HTTP API |
| **Unified vector store** | Merge OpenCode's SQLite RAG with AnythingLLM's vector DB backends (LanceDB, Pinecone, Chroma) for a single knowledge layer |
| **Multi-user workspace** | Leverage AnythingLLM's existing multi-user and workspace management for team environments |
| **Containerized deployment** | Docker Compose setup running both backends, with shared auth and a unified API gateway |

**Synergy**: AnythingLLM excels at document ingestion and RAG over non-code content. OpenCode excels at code manipulation, agentic tool use, and multi-provider LLM orchestration. Combined, they create a full-stack AI development platform that can reason over documentation AND write/execute code.

**Scale**: ~1500+ LOC for the bridge layer, ~500 LOC for the Agent Skill adapter, ~300 LOC for vector store unification.

---

### Installation

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Gestionnaires de paquets
npm i -g opencode-ai@latest        # ou bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS et Linux (recommandé, toujours à jour)
brew install opencode              # macOS et Linux (formule officielle brew, mise à jour moins fréquente)
sudo pacman -S opencode            # Arch Linux (Stable)
paru -S opencode-bin               # Arch Linux (Latest from AUR)
mise use -g opencode               # n'importe quel OS
nix run nixpkgs#opencode           # ou github:anomalyco/opencode pour la branche dev la plus récente
```

> [!TIP]
> Supprimez les versions antérieures à 0.1.x avant d'installer.

### Application de bureau (BETA)

OpenCode est aussi disponible en application de bureau. Téléchargez-la directement depuis la [page des releases](https://github.com/anomalyco/opencode/releases) ou [opencode.ai/download](https://opencode.ai/download).

| Plateforme            | Téléchargement                        |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `opencode-desktop-darwin-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe`    |
| Linux                 | `.deb`, `.rpm`, ou AppImage           |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### Répertoire d'installation

Le script d'installation respecte l'ordre de priorité suivant pour le chemin d'installation :

1. `$OPENCODE_INSTALL_DIR` - Répertoire d'installation personnalisé
2. `$XDG_BIN_DIR` - Chemin conforme à la spécification XDG Base Directory
3. `$HOME/bin` - Répertoire binaire utilisateur standard (s'il existe ou peut être créé)
4. `$HOME/.opencode/bin` - Repli par défaut

```bash
# Exemples
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agents

OpenCode inclut deux agents intégrés que vous pouvez basculer avec la touche `Tab`.

- **build** - Par défaut, agent avec accès complet pour le travail de développement
- **plan** - Agent en lecture seule pour l'analyse et l'exploration du code
  - Refuse les modifications de fichiers par défaut
  - Demande l'autorisation avant d'exécuter des commandes bash
  - Idéal pour explorer une base de code inconnue ou planifier des changements

Un sous-agent **general** est aussi inclus pour les recherches complexes et les tâches en plusieurs étapes.
Il est utilisé en interne et peut être invoqué via `@general` dans les messages.

En savoir plus sur les [agents](https://opencode.ai/docs/agents).

### Documentation

Pour plus d'informations sur la configuration d'OpenCode, [**consultez notre documentation**](https://opencode.ai/docs).

### Contribuer

Si vous souhaitez contribuer à OpenCode, lisez nos [docs de contribution](./CONTRIBUTING.md) avant de soumettre une pull request.

### Construire avec OpenCode

Si vous travaillez sur un projet lié à OpenCode et que vous utilisez "opencode" dans le nom du projet (par exemple, "opencode-dashboard" ou "opencode-mobile"), ajoutez une note dans votre README pour préciser qu'il n'est pas construit par l'équipe OpenCode et qu'il n'est pas affilié à nous.

### FAQ

#### En quoi est-ce différent de Claude Code ?

C'est très similaire à Claude Code en termes de capacités. Voici les principales différences :

- 100% open source
- Pas couplé à un fournisseur. Nous recommandons les modèles proposés via [OpenCode Zen](https://opencode.ai/zen) ; OpenCode peut être utilisé avec Claude, OpenAI, Google ou même des modèles locaux. Au fur et à mesure que les modèles évoluent, les écarts se réduiront et les prix baisseront, donc être agnostique au fournisseur est important.
- Support LSP prêt à l'emploi
- Un focus sur la TUI. OpenCode est construit par des utilisateurs de neovim et les créateurs de [terminal.shop](https://terminal.shop) ; nous allons repousser les limites de ce qui est possible dans le terminal.
- Architecture client/serveur. Cela permet par exemple de faire tourner OpenCode sur votre ordinateur tout en le pilotant à distance depuis une application mobile. Cela signifie que la TUI n'est qu'un des clients possibles.

---

**Rejoignez notre communauté** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
