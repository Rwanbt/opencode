# Collective Intelligence — Guide d'utilisation

## Qu'est-ce que c'est ?

Le mode `/debate` fait dialoguer plusieurs IAs en parallèle sur une même question, extrait chaque insight atomique, identifie les **blind spots** (points qu'une seule IA a vus), et produit un rapport structuré.

La philosophie : **union des différences**, pas consensus. Un insight mentionné par un seul modèle est peut-être le plus important.

---

## Démarrage rapide

```
/debate Comment sécuriser l'authentification de ce module ?
```

C'est tout. Le système :
1. Détecte automatiquement vos providers configurés (Anthropic, OpenAI, Google, etc.)
2. Lance tous les modèles en parallèle
3. Extrait et classifie chaque insight
4. Produit un rapport avec blind spots mis en avant

---

## Pré-requis

**Au moins 2 providers IA configurés** parmi :

| Provider | Clé d'environnement | Alternative |
|----------|---------------------|-------------|
| Anthropic | `ANTHROPIC_API_KEY` | `~/.claude/.credentials.json` ou `claude --print` |
| OpenAI | `OPENAI_API_KEY` | `~/.codex/auth.json` |
| Google | `GEMINI_API_KEY` | Credential Manager OS |
| DeepSeek | `DEEPSEEK_API_KEY` | — |
| Mistral | `MISTRAL_API_KEY` | — |
| Groq | `GROQ_API_KEY` | — |
| OpenRouter | `OPENROUTER_API_KEY` | — |

La détection est automatique — si vous avez déjà configuré vos providers dans OpenCode, `/debate` les trouvera.

---

## Les 4 tiers

| Tier | Modèles | Ce qui tourne | Coût estimé | Quand l'utiliser |
|------|---------|---------------|-------------|------------------|
| **free** | Gratuits uniquement | Phase 1 + 4 | $0 | Question simple, test rapide |
| **quick** | 2-3 | Phase 1 + 2 + 4 | $0.05–0.50 | Review rapide, question ciblée |
| **standard** | 4-5 | Pipeline complet + convergence | $0.50–3 | Architecture, sécurité, design |
| **deep** | 6-8 | Tout + red team + canary | $3–15 | Audit critique, decision majeure |

Le tier est **auto-classifié** par défaut en fonction de la complexité de votre question. Vous pouvez le forcer :

```
/debate --tier standard Faut-il migrer vers des microservices ?
```

---

## Lire le rapport

### Blind Spots (la section la plus importante)

```
## 🔍 Blind Spots (4)
- [security] L'endpoint /reset-password n'a pas de rate limiting [BLIND SPOT]
- [architecture] Le cache Redis n'est pas invalidé lors des migrations [BLIND SPOT]
```

Ce sont les insights qu'**une seule IA** a vus. Les autres l'ont raté. C'est la valeur principale du débat.

### Consensus

Les points sur lesquels la majorité des modèles sont d'accord. Utile pour confirmer, mais moins surprenant.

### Conflits non résolus

```
## ⚡ Unresolved Conflicts (1)
### Stratégie de cache
- anthropic/claude-sonnet-4: Préfère un cache write-through
- openai/gpt-4.1: Recommande un cache write-behind pour la latence
```

Quand les IAs ne sont pas d'accord même après convergence.

### Indicateurs

| Indicateur | Signification |
|------------|---------------|
| **Fragilité > 60%** | ⚠️ CONSENSUS FRAGILE — les accords sont superficiels |
| **Diversité** | % d'insights uniques vs consensus — plus c'est haut, plus le débat a été utile |
| **Coût/insight** | Combien chaque insight actionnable a coûté |
| **+N blind spots vs single-model** | Combien d'insights supplémentaires le débat multi-IA a trouvé par rapport à un seul modèle |

---

## Configuration avancée

Dans `opencode.json`, section `experimental.collective` :

```json
{
  "experimental": {
    "collective": {
      "default_tier": "standard",
      "max_budget_usd": 5.0,
      "red_team": "auto",
      "enable_canary": true,
      "enable_shadow_baseline": true,
      "enable_memory": true,
      "ab_mode": false,
      "retention_days": 90,
      "shadow_daemon": {
        "enabled": false,
        "ollama_host": "http://localhost:11434",
        "model": "llama3.2",
        "divergence_threshold": 0.3
      }
    }
  }
}
```

| Option | Défaut | Description |
|--------|--------|-------------|
| `default_tier` | `quick` | Tier par défaut si l'auto-classification ne change rien |
| `max_budget_usd` | — | Plafond de coût par débat en USD |
| `red_team` | `auto` | `off` / `auto` (activé si consensus élevé) / `always` |
| `enable_canary` | `false` | Injecte un faux bug pour tester la vigilance des modèles (Deep tier) |
| `enable_shadow_baseline` | `true` | Compare le résultat collectif vs un seul modèle |
| `enable_memory` | `true` | Réinjecte les blind spots passés comme hypothèses à vérifier |
| `retention_days` | `90` | Durée de rétention de l'historique des débats |
| `shadow_daemon` | désactivé | Analyse continue en arrière-plan via Ollama local |

---

## API HTTP

Pour l'intégration programmatique :

```bash
# Lancer un débat
curl -X POST http://localhost:PORT/debate \
  -H "Content-Type: application/json" \
  -d '{"question": "Comment gérer la concurrence ?", "tier": "standard"}'

# Estimer le coût avant de lancer
curl -X POST http://localhost:PORT/debate/estimate \
  -H "Content-Type: application/json" \
  -d '{"question": "Comment gérer la concurrence ?", "tier": "standard"}'

# Consulter un débat passé
curl http://localhost:PORT/debate/dbt_xxxxx

# Lister les débats récents
curl http://localhost:PORT/debate?limit=10

# Donner du feedback sur les claims (améliore les métriques)
curl -X POST http://localhost:PORT/debate/dbt_xxxxx/feedback \
  -H "Content-Type: application/json" \
  -d '{"actions": [{"claimId": "clm_xxx", "action": "acted"}]}'
```

---

## Comment ça marche (pour les curieux)

```
Vous: /debate "Question"
         │
         ▼
┌─────────────────────┐
│  Phase 0: Pré-débat │  Auto-tier, détection providers, rôles, seed mémoire
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│  Phase 1: Diverge   │  N modèles répondent en parallèle (anti-contamination)
│  (parallèle, O(N))  │  Chaque modèle a un rôle + clause "hors rôle"
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│  Phase 2: Extraire  │  Extraction atomique → vérification exhaustivité
│  + Vérifier         │  → grep codebase (jargon) → classification novelty
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│  Phase 3: Converger │  Claims minority/unique re-soumis anonymement
│  (Standard+ seul)   │  Halting adaptatif: gain marginal vs coût
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│  Phase 4: Synthèse  │  Juge non-participant → cross-validation
│                     │  → fragilité → ré-attribution → rapport
└─────────┬───────────┘
          ▼
     Rapport Markdown
```

### Anti-contamination

Les modèles ne voient **jamais** les réponses attribuées des autres. Pendant le débat, chaque source est un hash anonyme (`anon_8f3a2b1c`). L'attribution réelle n'apparaît que dans le rapport final.

### Mémoire collective

Si vous lancez un débat sur un sujet déjà débattu dans le même workspace, les blind spots passés les plus fiables sont injectés comme hypothèses à vérifier — pas comme faits. Les modèles doivent les confirmer ou les infirmer indépendamment.

### Red Team

Quand le consensus est trop élevé (≥85% sur Standard, ≥75% sur Deep), un modèle adversarial est activé pour challenger les accords. Les IAs entraînées sur des données similaires peuvent être d'accord pour de mauvaises raisons.

### Canary (Deep tier)

Un faux bug technique crédible est injecté dans le contexte. Si aucun modèle ne le détecte, le score de confiance du rapport est dégradé. C'est un test de vigilance automatisé.

---

## Bonnes pratiques

1. **Soyez spécifique.** "Comment sécuriser l'auth JWT de l'endpoint /api/users ?" > "Sécurité ?"
2. **Ajoutez du contexte.** Collez du code, un schéma d'archi, des contraintes. Plus les modèles ont de contexte, plus les blind spots sont pertinents.
3. **Utilisez Standard pour les décisions d'architecture.** Quick est bien pour les reviews de code, Standard pour les décisions qui engagent.
4. **Donnez du feedback.** Le endpoint `/feedback` améliore les métriques au fil du temps — marquez les claims sur lesquels vous avez agi.
5. **Lisez les blind spots en premier.** Le consensus est rarement surprenant. Les blind spots, si.
