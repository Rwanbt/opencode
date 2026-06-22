# Synthèse du débat multi-IA — Collective Intelligence pour OpenCode

> 6 modèles interrogés : ChatGPT, MiniMax M3, DeepSeek, Mistral, Gemini, Qwen.
> Synthèse réalisée le 2026-06-22. Ce document EST le dogfooding de la feature.

---

## Vue d'ensemble — Consensus vs Blind Spots

| Question | Consensus | Divergence notable |
|----------|-----------|-------------------|
| Q1 Architecture | **Unanime : Agent natif (Option B)** | Aucune — 5/5 sur Option B |
| Q2 Pipeline | Accord sur génération parallèle + synthèse | **Fort désaccord sur comment éviter N²** |
| Q3 Consensus vs Union | **Unanime : Union** (blind spot hunting) | Diverge sur détection hallucinations |
| Q4 Auth | **Unanime : Hybrid (Option D)** | Nuances sur l'ordre de résolution |
| Q5 Juge | **Divisé : C vs A** | Gemini seul sur Option A |
| Q6 Format | Accord : JSON structuré + Markdown | Détails du schéma varient |
| Q7 UX | Accord : `/debate` explicite, opt-in | Tous contre le mode automatique par défaut |

---

## Q1 — Architecture : CONSENSUS TOTAL

**Verdict : Option B — Agent natif dans `agent.ts`**

Tous les modèles convergent. Raisons communes :
- Accès direct au registre de providers et au wrapper LLM Effect
- Cohérence avec les agents existants (orchestrator, critic)
- Pas de surcoût IPC comme un MCP server

**Nuances utiles** :
- **Qwen** ajoute un skill `.md` comme point d'entrée UX + MCP optionnel pour providers externes
- **Mistral** insiste sur une couche d'abstraction pour permettre une migration vers plugin plus tard
- **DeepSeek** propose un module séparé (`packages/agent/debate-agent.ts`) plutôt que tout dans `agent.ts`

**Risque unanime** : `agent.ts` risque de devenir un "god file". Tous recommandent une séparation logique interne.

→ **Action** : Agent natif avec logique dans un fichier dédié (`debate/` ou `collective/`), exposé via un skill `/debate`.

---

## Q2 — Pipeline : DIVERGENCE SIGNIFICATIVE

**4 approches distinctes pour éviter le N²** — c'est la question la plus débattue.

### Les 4 stratégies proposées

| Modèle | Stratégie anti-N² | Complexité | Forces |
|--------|-------------------|-----------|--------|
| **DeepSeek** | Critique sur résumé agrégé (pas sur réponses individuelles) | O(N) | Simple, résumé = compression |
| **Mistral** | Chaque modèle critique seulement 2 pairs (sélection aléatoire) | O(2N) | Préserve la critique directe |
| **Gemini** | Map-Reduce : 1 juge extrait les claims, valide les controverses seulement | O(N + K) | Le plus économe en tokens |
| **Qwen** | 4 phases : divergence → cartographie → convergence ciblée → synthèse | O(N + K) | Le plus structuré |

### Convergence entre Gemini et Qwen

Gemini et Qwen proposent essentiellement le même pattern (extraire d'abord, cibler ensuite) avec des noms différents. La cartographie de Qwen EST le "Reduce" de Gemini. C'est le **signal fort** de cette question.

### Synthèse recommandée : Pipeline "Extract-then-Target"

```
Phase 1 — DIVERGE (parallèle, O(N))
  N modèles répondent indépendamment, en parallèle
  Effect.all avec concurrency + Effect.timeout par provider
  Un provider lent est exclu mais ses résultats partiels sont sauvés

Phase 2 — CARTOGRAPHIE (1 appel)
  Un extracteur identifie les claims atomiques
  Déduplique, classe par thème, détecte consensus/divergences/uniques
  Produit une liste structurée de claims avec attribution

Phase 3 — CONVERGENCE CIBLÉE (max 2 tours, O(K) où K = nb de controverses)
  Seuls les points de désaccord ou faible confiance sont re-soumis
  Chaque modèle ne voit que les claims controversées le concernant
  Critère d'arrêt : stabilité du rapport (delta < seuil)

Phase 4 — SYNTHÈSE (1 appel)
  Rapport structuré avec traçabilité complète
```

**Coût estimé** : N + 1 + K + 1 appels (typiquement 5 + 1 + 3 + 1 = 10 appels au lieu de 5² = 25).

---

## Q3 — Consensus vs Union : CONSENSUS SUR L'UNION

**Verdict : Union pondérée (Blind Spot Hunter)**

Tous les modèles rejettent le consensus strict. Argument commun : "l'intérêt de payer pour N modèles est précisément de trouver ce qu'un seul manquerait."

### 4 méthodes proposées pour distinguer insight vs hallucination

| Modèle | Méthode | Idée clé |
|--------|---------|----------|
| **DeepSeek** | Heuristique 3 niveaux | 1) Vérifiable via outils ? 2) Contredit par d'autres ? 3) Auto-évaluation de certitude |
| **Gemini** | Test de vérifiabilité | "Génère un test/commande bash pour prouver ce risque" — si impossible, tag Low Confidence |
| **Qwen** | Score composite | `f(confiance_auto, spécificité, cohérence, track_record_domaine)` |
| **Mistral** | TF-IDF de rareté | Score de rareté + filtre actionnable + filtre cohérence contexte |

### Insight critique de ChatGPT : la contamination

> "Claude lit GPT → Claude modifie son avis → Tu n'as plus deux opinions indépendantes."

**Solution proposée** (ChatGPT + Qwen convergent) :
- Phase 1 : réponses **totalement indépendantes** (aucun modèle ne voit les autres)
- Phase 3 : critiquer les **claims anonymisées**, pas les réponses attribuées
- Ne jamais montrer "Voici la réponse de Claude" → montrer "Voici le Claim #7"

→ **Action** : Anonymiser les claims dans les phases de critique. Les modèles critiquent des affirmations, pas des auteurs.

---

## Q4 — Auth : CONSENSUS TOTAL + BLIND SPOT

**Verdict : Option D — Hybrid avec cascade de résolution**

Tous proposent le même ordre de priorité :
1. **Env vars** (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.) — rapide, standard
2. **Credential files** (`~/.claude/.credentials.json`, `~/.codex/auth.json`) — transparent
3. **Subprocess CLI** (`claude --print`, `codex exec`, `gemini -p`) — dernier recours

### Blind spot identifié par Mistral : les "Ghost Models"

> "Des modèles disponibles localement mais non déclarés, ou des versions obsolètes qui traînent dans les credentials."

**Solution** : audit des credentials à chaque lancement de débat :
- Vérifier que chaque provider est supporté (liste blanche)
- Avertir si un modèle est obsolète
- Proposer une migration (`gpt-4` → `o3`)

### Blind spot identifié par Qwen : instabilité des CLIs

> "Les interfaces CLI sont souvent instables. Une mise à jour mineure peut casser le parsing stdout."

**Solution** : versionner les parsers CLI, tester la compatibilité au startup.

### Pattern Effect recommandé (Gemini)

```typescript
// Cascade de résolution avec Effect
const resolveProvider = (name: string) =>
  tryApiKey(name).pipe(
    Effect.catchAll(() => tryCredentialFile(name)),
    Effect.catchAll(() => tryCliSubprocess(name)),
    Effect.catchAll(() => Effect.fail(new ProviderUnavailable(name)))
  )
```

---

## Q5 — Juge : DIVERGENCE NOTABLE

**Résultat divisé : 4 voix pour C, 1 voix pour A**

| Modèle | Choix | Raison |
|--------|-------|--------|
| DeepSeek | C (non-participant) + fallback D (vote) | Impartialité |
| Mistral | C + fallback E (utilisateur) | Impartialité |
| Qwen | C modifié (jury anonymisé + override user) | Impartialité + user in the loop |
| **Gemini** | **A (le plus capable)** | "La synthèse exige la meilleure capacité" |
| MiniMax | Juge sectoriel (un modèle par domaine) | Spécialisation |

### Analyse de la divergence

Gemini est le seul à préférer Option A. Son argument : "La synthèse d'informations contradictoires requiert la plus grande fenêtre de contexte et la meilleure capacité d'instruction-following." Mais il reconnaît lui-même le risque de "LLM self-preference bias."

**MiniMax propose une 5ème voie** non prévue dans les options : **juge sectoriel**. GPT juge le code, Gemini juge la cohérence système, Claude juge la sécurité. Intéressant mais complexe à implémenter.

→ **Action recommandée** : Option C par défaut (non-participant), configurable par l'utilisateur. Si aucun non-participant disponible, fallback sur le plus capable avec anonymisation des réponses.

---

## Q6 — Format : CONSENSUS + CONVERGENCE

**Verdict : JSON structuré + rendu Markdown**

Tous convergent vers le même schéma fondamental :

```json
{
  "metadata": { "debate_id", "timestamp", "models", "cost", "duration" },
  "consensus": [{ "claim", "confidence", "models_agreeing" }],
  "blind_spots": [{
    "insight", "discovered_by", "confidence",
    "verification_hint", "rarity_score"
  }],
  "unresolved_conflicts": [{
    "topic", "positions": { "model_a": "X", "model_b": "Y" }
  }],
  "traceability": [{ "model", "response_id", "claims": ["id1", "id2"] }]
}
```

**Ajouts spécifiques par modèle** :
- **DeepSeek** : YAML frontmatter dans le Markdown pour exploitation programmatique
- **Gemini** : champ `verify_with_tool` lié aux outils OpenCode (ex: `run_cargo_audit`)
- **Qwen** : catégorie `meta_observations` pour les insights hors catégorie

→ **Action** : Schéma JSON typé avec Effect Schema / Zod, rendu Markdown pour la TUI.

---

## Q7 — UX : CONSENSUS

**Verdict : `/debate` explicite, opt-in, avec estimation pré-lancement**

Points unanimes :
- Commande `/debate [prompt]` — jamais automatique par défaut
- Estimation coût/temps AVANT lancement (tableau providers × tokens × prix)
- Progression temps réel dans la TUI (spinner par modèle)
- Budget max configurable (arrêt si dépassé)
- Rapport sauvé en fichier (`.opencode/debates/[timestamp].md`)

---

## Les 6 Insights Uniques — LE CŒUR DU BLIND SPOT HUNTING

C'est ici que le dogfooding prouve sa valeur. Chaque modèle a trouvé un angle
que les autres n'ont pas mentionné :

### 1. Contamination des jugements (ChatGPT)
> "Si un modèle lit la réponse d'un autre avant de critiquer, tu n'as plus
> deux opinions indépendantes."

**Impact** : Le pipeline DOIT garantir l'indépendance en Phase 1 et anonymiser
les claims en Phase 3. Sans ça, le débat converge artificiellement.

### 2. Reproductibilité et mémoire des débats (MiniMax M3 + DeepSeek)
> MiniMax : "IDs stables par réponse, cache de hash, store des runs."
> DeepSeek : "Persister les rapports dans une base vectorielle liée au code.
> Les blind spots deviennent des leçons apprises réutilisables — un système
> immunitaire pour le code."

**Impact** : Un débat n'est pas un acte éphémère. Le stocker avec un hash du
contexte (fichiers modifiés, question posée) permet de le réutiliser.
L'orchestrator peut injecter un avertissement : "Le dernier débat a révélé
que l'approche X posait un problème."

### 3. Ghost Models et audit de credentials (Mistral)
> "Des modèles obsolètes ou non déclarés qui traînent dans les credentials.
> Un utilisateur pourrait lancer un débat avec un modèle payant sans le savoir."

**Impact** : Audit des credentials à chaque lancement. Vérifier que les modèles
sont supportés, à jour, et que l'utilisateur est conscient des coûts.

### 4. Role-Prompting Asymmetry (Gemini)
> "Ne posez PAS la même question à tous les modèles. Assignez des rôles
> spécialisés : Modèle A = Architecte Sécurité, Modèle B = Ingénieur
> Performance, Modèle C = Développeur Maintenabilité."

**Impact** : Élimine 80% de la redondance À LA SOURCE. Le juge n'a plus à
fusionner 5 fois le même boilerplate — il assemble les pièces d'un puzzle
que des spécialistes ont forgées. C'est potentiellement l'insight le plus
transformateur du débat.

### 5. Epistemic Fingerprinting (Qwen)
> "Chaque modèle a des biais mesurables. Construire des profils de compétence
> par domaine pour pondérer leurs opinions : Claude fort en code sécurisé,
> DeepSeek fort en optimisation, etc."

**Impact** : Permet de pondérer les votes et de router les questions vers les
modèles les plus pertinents, réduisant le nombre d'appels nécessaires.

### 6. Q8 proposée par ChatGPT — Indépendance des jugements
> "Comment préserver la diversité des opinions et éviter que les modèles
> convergent artificiellement lorsqu'ils se reviewent mutuellement ?"

**Impact** : Cette question MANQUE au plan original. Elle devrait devenir
une contrainte architecturale, pas juste une question.

---

## Plan d'implémentation recommandé (issu de la synthèse)

### Phase 0 — Credential Discovery (déjà spécifié)
- Implémenter `discoverAll()` du RFC credential-discovery-spec.md
- Cascade Effect : env var → credential file → CLI subprocess
- Audit des ghost models au lancement

### Phase 1 — MVP Minimal (2 providers suffisent)
- Agent natif `debate` dans `packages/opencode/src/agent/debate/`
- Skill `/debate [prompt]` comme point d'entrée
- Pipeline 2 phases : diverge parallèle → synthèse directe
- Format JSON + Markdown
- Estimation coût pré-lancement

### Phase 2 — Blind Spot Hunter
- Pipeline 4 phases complet (diverge → cartographie → convergence → synthèse)
- Anonymisation des claims
- Score de rareté + vérifiabilité
- Role-Prompting Asymmetry optionnel

### Phase 3 — Mémoire collective
- Persistance des débats avec hash de contexte
- Injection de leçons apprises dans l'orchestrator
- Epistemic fingerprinting par modèle

---

## Prédictions de ChatGPT — vérification

| Modèle | Prédit | Réel | Correct ? |
|--------|--------|------|-----------|
| Claude | Architecture propre + sécurité | (non interrogé dans ce round) | — |
| GPT | Pipeline modulaire + arbitrage | Pipeline + contamination | ✅ Partiellement |
| Gemini | Scalabilité + orchestration distribuée | Map-Reduce + Role Asymmetry | ✅ Oui |
| DeepSeek | Efficacité/coût + optimisation | Mémoire vectorielle + coût | ✅ Partiellement |
| Qwen | Pragmatique hybride | Epistemic fingerprinting | ❌ Plus original que prévu |
| Mistral | Simplicité et extensibilité | Ghost Models + audit | ❌ Plus original que prévu |
| MiniMax | UX et expérience utilisateur | Reproductibilité + juge sectoriel | ❌ Plus technique que prévu |

**Conclusion** : les stéréotypes par modèle se vérifient partiellement, mais les
insights uniques sont systématiquement imprévisibles — ce qui prouve exactement
la thèse du Blind Spot Hunter.

---

## Conclusion

Le débat a produit **6 insights uniques** qu'aucun modèle seul n'aurait
tous trouvés. Le plus transformateur est le **Role-Prompting Asymmetry** de
Gemini (spécialiser les modèles plutôt que de tous poser la même question),
suivi de la **mémoire collective persistante** de DeepSeek (transformer les
débats en système immunitaire du code).

Le consensus architectural est clair et fort : agent natif + hybrid auth +
union pondérée + juge non-participant + JSON structuré + /debate explicite.

Les divergences portent sur l'optimisation du pipeline (4 stratégies anti-N²
proposées, convergence Gemini-Qwen sur le pattern Extract-then-Target).

**Prochaine étape** : coder le MVP (Phase 1) avec 2 providers minimum,
puis itérer vers le Blind Spot Hunter complet.
