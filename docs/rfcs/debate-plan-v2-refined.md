# Plan de débat multi-IA — Round 2 (post-synthèse)

> **Contexte** : Ce document est le Round 2 du débat "Collective Intelligence"
> pour OpenCode. Le Round 1 a interrogé 6 modèles (ChatGPT, DeepSeek, Mistral,
> Gemini, Qwen, MiniMax M3). Cette version intègre les consensus, résout les
> divergences, et pose des questions plus précises sur les points ouverts.
>
> **Consigne** : lis le résumé du Round 1 ci-dessous, puis réponds aux 8
> questions du Round 2. Ne répète pas les positions du Round 1 — concentre-toi
> sur ce qui est nouveau, ce que tu contestes, et les détails d'implémentation.

---

## Résumé du Round 1 — Ce qui est acquis

### Consensus unanime (6/6 modèles d'accord — ne pas re-débattre)

1. **Architecture : Agent natif** dans `agent.ts`, avec logique dans un module
   séparé (`debate/` ou `collective/`), exposé via un skill `/debate`.

2. **Auth : Hybrid avec cascade** — env var → credential file → CLI subprocess.
   Pattern Effect : `tryApiKey → catchAll → tryCredentialFile → catchAll → tryCli`.

3. **Philosophie : Union des différences** (Blind Spot Hunter), pas consensus.
   Chaque insight unique a de la valeur, même s'il est mentionné par un seul modèle.

4. **UX : `/debate` explicite**, jamais automatique par défaut. Estimation
   coût/temps avant lancement. Progression temps réel dans la TUI.

5. **Format : JSON structuré + Markdown**. Le JSON est typé (Effect Schema/Zod),
   le Markdown est un rendu pour l'humain.

### Convergence forte (Round 1 a tranché)

6. **Pipeline "Extract-then-Target"** (convergence Gemini + Qwen) :
   - Phase 1 — DIVERGE : N modèles répondent en parallèle, indépendamment
   - Phase 2 — CARTOGRAPHIE : 1 extracteur identifie les claims atomiques
   - Phase 3 — CONVERGENCE CIBLÉE : seuls les désaccords sont re-soumis (max 2 tours)
   - Phase 4 — SYNTHÈSE : rapport structuré avec traçabilité

7. **Juge non-participant** (Option C, 5/6 modèles). Gemini était seul sur
   Option A (le plus capable même s'il a participé). Le groupe a retenu C
   avec fallback sur le plus capable si aucun non-participant disponible.

### 6 Blind Spots découverts en Round 1

Ces insights sont maintenant des **contraintes architecturales** :

| # | Contrainte | Source | Implication |
|---|-----------|--------|-------------|
| BS1 | **Contamination** — les modèles ne doivent jamais voir les réponses attribuées des autres | ChatGPT | Claims anonymisées en Phase 3 |
| BS2 | **Mémoire collective** — les débats doivent être persistés et réutilisables | DeepSeek | Store avec hash de contexte |
| BS3 | **Ghost Models** — audit des credentials avant chaque débat | Mistral | Vérification modèles obsolètes |
| BS4 | **Role-Prompting Asymmetry** — spécialiser les prompts par modèle | Gemini | Ne pas poser la même question à tous |
| BS5 | **Epistemic Fingerprinting** — profiler les forces/faiblesses par modèle | Qwen | Pondérer les votes par domaine |
| BS6 | **Reproductibilité** — IDs stables, cache de hash, store des runs | MiniMax | Debug et comparaison entre runs |

---

## Architecture existante d'OpenCode (rappel)

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

---

## Les 8 questions du Round 2

### Q1 — Role-Prompting Asymmetry : comment l'implémenter ?

Gemini a proposé l'insight le plus transformateur du Round 1 : au lieu de
poser la même question à N modèles (80% de redondance), assigner des **rôles
spécialisés** à chaque modèle.

Exemple :
- Claude → Architecte Sécurité ("cherche uniquement les failles")
- DeepSeek → Ingénieur Performance ("cherche les goulots d'étranglement")
- GPT → Développeur Maintenabilité ("critique la lisibilité")

**Questions** :
- Faut-il des rôles **fixes** (hardcodés par provider) ou **dynamiques**
  (attribués selon le contexte de la question) ?
- Qui décide des rôles ? L'utilisateur, un meta-prompt, ou un mapping
  configurable ?
- Comment gérer le cas où l'utilisateur n'a que 2 providers — 2 rôles
  suffisent-ils, ou faut-il un fallback "généraliste" ?
- Le rôle spécialisé risque-t-il de **réduire** la diversité (un modèle
  bridé par son rôle rate un insight hors périmètre) ?

### Q2 — Cartographie des claims : quel extracteur ?

Le pipeline Extract-then-Target repose sur une Phase 2 critique : un
**extracteur** qui transforme N réponses libres en claims atomiques structurées.

C'est le single point of failure du pipeline. Si l'extracteur rate un claim
ou le catégorise mal, il ne sera jamais débattu.

**Questions** :
- Quel modèle doit servir d'extracteur ? Le même que le juge (Phase 4) ?
  Un modèle dédié ? Le plus rapide/moins cher ?
- Quel format pour les claims extraites ?
  Propose un schéma JSON concret pour un "claim atomique".
- Comment garantir que l'extracteur ne **filtre pas** silencieusement un
  insight parce qu'il le juge non pertinent ?
- Faut-il une validation croisée de l'extraction (2 extracteurs indépendants
  qui comparent leurs listes de claims) ?

### Q3 — Contamination : anonymisation complète ou partielle ?

ChatGPT a identifié que montrer "Voici la réponse de Claude" biaise les
critiques. Qwen a proposé l'anonymisation des claims en Phase 3.

Mais l'anonymisation totale pose des problèmes :
- On perd le **Epistemic Fingerprinting** (Qwen) — si on ne sait pas quel
  modèle a dit quoi, on ne peut pas pondérer par compétence
- Le juge final ne peut pas utiliser le track record des modèles
- L'utilisateur perd la traçabilité dans le rapport

**Questions** :
- Anonymisation **totale** (jamais d'attribution) ou **sélective** (anonyme
  pendant le débat, attribué dans le rapport final) ?
- Si sélective, à quel moment ré-attribuer ?
- Comment concilier anonymisation (anti-biais) et fingerprinting (pondération
  par compétence) ? Ce sont deux objectifs contradictoires.
- Propose un mécanisme concret.

### Q4 — Mémoire collective : quel stockage et quelle réutilisation ?

DeepSeek a proposé de persister les débats comme "système immunitaire du
code". MiniMax a insisté sur la reproductibilité (IDs stables, cache, store).

**Questions** :
- Quel stockage ? SQLite local (léger), base vectorielle (Qdrant/LanceDB),
  ou simple filesystem (`.opencode/debates/`) ?
- Quelle clé d'indexation ? Hash des fichiers modifiés ? Hash du prompt ?
  Les deux ?
- Comment injecter les leçons apprises dans les futures sessions ?
  Automatiquement dans le system prompt de l'orchestrator ? Sur demande ?
- Quelle durée de rétention ? Les débats vieillissent-ils (le code change,
  les conclusions deviennent obsolètes) ?
- Faut-il un mécanisme de "garbage collection" des débats périmés ?

### Q5 — Budget et rate limits : stratégie concrète

Tous les modèles du Round 1 ont mentionné le coût sans proposer de
stratégie détaillée. Or c'est critique : un débat à 8 modèles sur un
prompt complexe peut coûter $5-30.

**Questions** :
- Comment estimer le coût **avant** le débat ? Quelles métriques ?
  (tokens estimés × prix par provider, temps estimé)
- Comment gérer un provider qui atteint son rate limit en plein débat ?
  Timeout + exclusion gracieuse ? Fallback sur un autre modèle ? File d'attente ?
- Faut-il un système de **tiers** ? Exemple :
  - Tier 1 "Quick" : 2-3 modèles, 1 phase, pas de review → ~$0.10
  - Tier 2 "Standard" : 4-5 modèles, pipeline complet → ~$1-3
  - Tier 3 "Deep" : 8 modèles, rôles spécialisés, 2 tours → ~$5-15
- Comment gérer les plans gratuits avec quotas très bas (ex: Gemini free
  = 15 RPM, DeepSeek free = 10 RPM) ?

### Q6 — Indépendance des jugements (Q8 proposée par ChatGPT en Round 1)

ChatGPT a identifié une question manquante dans le plan original :

> "Comment préserver la diversité des opinions et éviter que les modèles
> convergent artificiellement lorsqu'ils se reviewent mutuellement ?"

**Questions** :
- Les reviews doivent-elles être anonymisées (critiquer des claims,
  pas des réponses) ?
- Faut-il mesurer la **diversité informationnelle** avant et après le
  débat ? Si oui, quelle métrique ? (ex: entropie de Shannon sur les
  claims, similarité cosinus des embeddings)
- Comment détecter une **convergence artificielle** (tous les modèles
  finissent par dire la même chose après le Round 2 alors qu'ils
  divergeaient en Round 1) ?
- Faut-il un "Red Team" permanent — un modèle dont le rôle est
  explicitement de contester le consensus émergent ?

### Q7 — Graceful degradation : le cas 2 providers

La contrainte "2 providers suffisent" est critique car beaucoup d'utilisateurs
n'auront que Claude + GPT, ou Claude + Gemini.

Avec seulement 2 modèles :
- Le pipeline Extract-then-Target est-il encore utile, ou un simple
  diff des réponses suffit ?
- Qui est le juge si les 2 ont participé ? Faut-il un 3ème appel au
  "meilleur" des 2 avec un prompt de synthèse ?
- Le Role-Prompting Asymmetry fonctionne-t-il avec 2 rôles seulement ?
- Comment garantir la valeur ajoutée par rapport à "j'interroge juste
  mon modèle habituel" ?

### Q8 — Implémentation Effect : structure du code

L'implémentation doit utiliser Effect (TypeScript). Le Round 1 n'a pas
abordé la structure concrète du code.

**Questions** :
- Quelle granularité de services Effect ? Un service `DebateService` monolithique
  ou plusieurs (`ProviderDiscovery`, `ClaimExtractor`, `DebateOrchestrator`,
  `SynthesisJudge`, `DebateStore`) ?
- Comment modéliser les erreurs ? Un type union `DebateError` avec variantes
  (`ProviderTimeout`, `RateLimitExceeded`, `ExtractionFailed`, `BudgetExhausted`) ?
- Comment gérer le streaming ? Les réponses de Phase 1 doivent s'afficher
  au fur et à mesure dans la TUI — utiliser `Effect.Stream` ou un pattern
  pub/sub ?
- Propose un squelette de code (interfaces principales + flux d'appels)
  pour l'agent debate.

---

## Contraintes (rappel + nouvelles)

1. **Pas de scraping web** — uniquement APIs officielles et CLIs installés
2. **Respect des CGU** — chaque provider via son canal officiel
3. **Graceful degradation** — fonctionne dès 2 providers
4. **Budget-aware** — estimation pré-lancement + budget max configurable
5. **Offline-capable** — modèles locaux (Ollama) comme participants
6. **Effect runtime** — composition async via Effect, pas Promises raw
7. **🆕 Anti-contamination** — les modèles ne voient jamais les réponses attribuées des autres
8. **🆕 Reproductibilité** — chaque débat a un ID stable, les runs sont comparables
9. **🆕 Audit des credentials** — vérification des ghost models avant chaque débat

---

## Format de réponse attendu

Pour chaque question (Q1-Q8), structure ta réponse ainsi :

```
### Q[N] — [Titre]

**Recommandation** : [Ta réponse courte]

**Justification** : [2-5 phrases]

**Risques** : [Ce qui pourrait mal tourner]

**Divergence avec le Round 1** : [Si tu contestes un consensus du Round 1,
explique pourquoi. Si tu es d'accord, dis "Aucune — j'appuie le consensus."]
```

Après les 8 questions, ajoute :

```
### Insight unique Round 2

[Un nouveau point que tu n'as pas mentionné en Round 1 et que tu penses
que les autres IAs n'auront pas non plus mentionné dans ce round. Cherche
plus profond — les insights évidents ont déjà été trouvés.]
```

---

## Modèles interrogés (Round 2)

- [ ] Claude (Anthropic) — Sonnet 4.6 / Opus 4.8
- [ ] GPT (OpenAI) — GPT-5.5 / o3
- [ ] Gemini (Google) — 2.5 Pro
- [ ] DeepSeek — V3 / R1
- [ ] Qwen (Alibaba) — Qwen3
- [ ] Mistral — Large
- [ ] MiniMax — M3
- [ ] GLM (Zhipu) — GLM-4
