# Plan de débat multi-IA — "Collective Intelligence" pour OpenCode

> Ce document est conçu pour être envoyé tel quel à plusieurs IAs (Claude, GPT,
> Gemini, DeepSeek, Qwen, Mistral, etc.) afin de recueillir leurs perspectives
> sur l'architecture optimale. Chaque IA répond aux mêmes questions, puis les
> réponses sont synthétisées.

---

## Contexte

**OpenCode** est un terminal agentique IA open-source (Bun + SolidJS + Tauri 2.0).
Il supporte déjà 20+ providers LLM via Vercel AI SDK, un système d'agents
(build, plan, explore, orchestrator, critic...), des plugins, et le protocole MCP.

**Objectif** : ajouter un mode "Collective Intelligence" / "Blind Spot Hunter"
qui fait dialoguer automatiquement plusieurs modèles IA entre eux pour obtenir
des résultats plus complets et plus fiables que n'importe quel modèle seul.

**Motivation** : aujourd'hui, les développeurs font ça manuellement en copiant-
collant entre Claude, ChatGPT, Gemini, DeepSeek, etc. C'est long mais
extrêmement utile car chaque modèle est entraîné différemment et trouve des
problèmes différents.

---

## Architecture existante d'OpenCode (résumé technique)

```
packages/opencode/src/
├── provider/provider.ts    — 20+ providers, Vercel AI SDK, Effect runtime
├── agent/agent.ts          — Agents natifs: build, plan, explore, orchestrator, critic
├── session/prompt.ts       — Boucle de session, routing de modèles
├── session/llm.ts          — Wrapper LLM (streamText)
├── tool/registry.ts        — Registre d'outils (plugin-extensible)
├── skill/index.ts          — Skills SKILL.md (slash commands)
├── plugin/loader.ts        — Système de plugins (tool, provider, tui)
└── mcp/index.ts            — MCP servers comme tool providers
```

**Points d'extension identifiés** :
1. Nouveau type d'agent via `Agent.Info`
2. Outils custom via le registre de plugins
3. MCP server dédié au débat
4. Wrapper LLM pour appels parallèles
5. Skill `.md` déclenchant le mode débat

**Contrainte clé** : OpenCode utilise Effect (TypeScript) pour la composition
async et le dependency injection. Toute architecture proposée doit être
compatible avec ce runtime.

---

## Le problème de l'authentification multi-provider

Les utilisateurs n'ont pas forcément des clés API (pay-per-token). Ils ont des
**comptes gratuits ou payants** authentifiés via OAuth sur leurs machines :

| Provider | Stockage auth | Format | Utilisable comme env var ? |
|----------|--------------|--------|---------------------------|
| Claude Code | `~/.claude/.credentials.json` | OAuth token (`sk-ant-oat01-...`) | NON — il faut le fichier complet |
| Codex/ChatGPT | `~/.codex/auth.json` | JWT OAuth (`eyJ...`) | NON — il faut le fichier complet |
| Gemini CLI | OS Credential Manager | API key dans blob JSON | OUI — `GEMINI_API_KEY` |
| DeepSeek | Variable d'env ou config | API key (`sk-...`) | OUI |
| Mistral | Variable d'env | API key | OUI |
| Qwen | Variable d'env | API key | OUI |

**Implication architecturale** : le système ne peut pas supposer que tous les
providers utilisent des API keys. Il doit supporter :
- API keys classiques (env vars)
- OAuth tokens qui nécessitent un fichier de credentials
- CLIs locaux comme intermédiaires (`claude --print`, `codex exec`, `gemini -p`)
- Interfaces web via navigateur headless (option controversée — CGU)

---

## Les 7 questions du débat

Chaque IA doit répondre à ces 7 questions avec ses recommandations et justifications.

### Q1 — Architecture : Plugin, Agent, ou Core Feature ?

Le mode Collective Intelligence devrait-il être :

**Option A** : Un **plugin** (`packages/plugin/`) — découplé, installable séparément
**Option B** : Un **agent natif** ajouté à `agent.ts` — comme orchestrator/critic
**Option C** : Une **feature core** intégrée dans `session/prompt.ts` — dans la boucle principale
**Option D** : Un **MCP server externe** — process séparé communiquant via MCP

Justifie ton choix en considérant : maintenabilité, performance, UX, portabilité.

### Q2 — Pipeline : Quel workflow de débat ?

ChatGPT a proposé un pipeline en 3 phases :
1. Génération parallèle (N modèles répondent)
2. Review croisée (chaque modèle critique les autres)
3. Synthèse finale (un "juge" produit le rapport)

**Sous-questions** :
- Ce pipeline en 3 phases est-il optimal, ou proposes-tu un autre workflow ?
- Faut-il des tours itératifs (Round 1 → critique → Round 2 → re-critique) ?
  Si oui, combien de tours maximum et quel critère d'arrêt ?
- Comment gérer le cas où un provider est lent ou timeout ?
- Comment éviter l'explosion combinatoire (N modèles × N reviews = N² appels) ?

### Q3 — Consensus vs Union des différences

Deux philosophies s'opposent :

**Consensus** : chercher ce sur quoi tous les modèles sont d'accord, ignorer les outliers.
**Union** (Blind Spot Hunter) : considérer que chaque insight unique a de la valeur,
et qu'un élément mentionné par un seul modèle est peut-être le plus important.

- Quelle approche recommandes-tu et pourquoi ?
- Comment distinguer un insight unique précieux d'une hallucination isolée ?
- Propose un algorithme ou des heuristiques concrètes pour cette distinction.

### Q4 — Authentification : comment gérer les comptes gratuits ?

L'utilisateur type a :
- Un abonnement Claude Pro/Max (OAuth, pas d'API key)
- Un compte ChatGPT free (OAuth via Codex CLI)
- Gemini CLI avec API key gratuite (AI Studio)
- Peut-être DeepSeek/Mistral avec API key free tier

**Options** :
**A** : API keys uniquement — simple mais exclut les comptes OAuth
**B** : Credential discovery automatique — lire les fichiers d'auth des CLIs installés
**C** : Délégation aux CLIs — appeler `claude --print`, `codex exec`, `gemini -p` en subprocess
**D** : Hybrid — API keys quand disponibles, fallback sur CLIs locaux

Quel choix et pourquoi ? Comment gérer les rate limits des plans gratuits ?

### Q5 — Sélection du juge final

Qui devrait faire la synthèse finale ? Options :

**A** : Le modèle le plus capable disponible (auto-détecté)
**B** : Toujours le même modèle (configurable par l'utilisateur)
**C** : Un modèle qui n'a PAS participé à la génération initiale
**D** : Pas de juge unique — vote pondéré entre tous les modèles
**E** : L'utilisateur lui-même, assisté par un résumé structuré

Arguments pour/contre chaque option ?

### Q6 — Format de sortie

Quel format pour le rapport final ?

Propose un schéma concret (JSON, Markdown, ou autre) qui capture :
- Les insights de chaque modèle
- Les points de consensus
- Les éléments uniques (blind spots détectés)
- Le niveau de confiance par section
- Les désaccords non résolus
- La traçabilité (quel modèle a dit quoi)

### Q7 — UX et intégration

Comment l'utilisateur interagit-il avec ce système ?

- Commande slash (`/debate`, `/review-all`, `/blind-spots`) ?
- Mode automatique (chaque `plan` passe par le débat) ?
- Interface de visualisation des résultats (TUI, panel VS Code, Markdown) ?
- Comment afficher la progression en temps réel (N modèles en parallèle) ?
- Estimation de coût/temps avant lancement ?

---

## Contraintes techniques à respecter

1. **Pas de scraping web** — pas de Playwright/Puppeteer sur les interfaces web
   des providers. Uniquement APIs officielles et CLIs installés.
2. **Respect des CGU** — chaque provider doit être appelé via son canal officiel.
3. **Graceful degradation** — si seulement 2 providers sont disponibles, le
   système doit quand même fonctionner (pas de minimum à 4+).
4. **Budget-aware** — l'utilisateur doit pouvoir limiter le coût total du débat
   (en tokens ou en monnaie).
5. **Offline-capable** — support optionnel des modèles locaux (Ollama, llama.cpp)
   comme participants au débat.
6. **Effect runtime** — l'implémentation TypeScript doit utiliser Effect pour
   la composition async, pas des Promises raw.

---

## Format de réponse attendu

Pour chaque question (Q1-Q7), structure ta réponse ainsi :

```
### Q[N] — [Titre]

**Recommandation** : [Ta réponse courte]

**Justification** : [2-5 phrases]

**Risques** : [Ce qui pourrait mal tourner avec cette approche]

**Alternative considérée** : [L'option que tu as failli choisir et pourquoi tu l'as écartée]
```

Après les 7 questions, ajoute :

```
### Insight unique

[Un point que tu penses que les autres IAs n'auront pas mentionné —
un angle mort, un risque caché, une opportunité non évidente, ou un
pattern architectural que tu connais d'un autre domaine et qui
s'appliquerait ici.]
```

---

## Modèles interrogés

Ce prompt sera envoyé à :
- [ ] Claude (Anthropic) — Sonnet 4.6 / Opus 4.8
- [ ] GPT (OpenAI) — GPT-5.5 / o3
- [ ] Gemini (Google) — 2.5 Pro
- [ ] DeepSeek — V3 / R1
- [ ] Qwen (Alibaba) — Qwen3
- [ ] Mistral — Large
- [ ] MiniMax — M3
- [ ] GLM (Zhipu) — GLM-4

Les réponses seront ensuite synthétisées selon exactement le processus
que cette feature est censée automatiser — dogfooding ultime.
