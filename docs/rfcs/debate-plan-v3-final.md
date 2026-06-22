# Plan de débat multi-IA — Round 3 (convergence finale)

> **Contexte** : Round 3 du débat "Collective Intelligence" pour OpenCode.
> Le Round 1 (6 modèles) a posé l'architecture. Le Round 2 (5 modèles) a
> attaqué l'implémentation. Ce Round 3 cible les **4 divergences non résolues**
> et la **mesure de valeur** du système.
>
> **Consigne** : Lis le résumé des Rounds 1-2 ci-dessous. Ne répète pas ce
> qui est acquis. Concentre-toi UNIQUEMENT sur les 5 questions ouvertes.
> Réponses courtes et tranchées — on converge, on ne re-débat pas.

---

## Ce qui est définitivement acquis (Rounds 1 + 2)

### Architecture (unanime, verrouillé)
- Agent natif dans un module dédié `packages/opencode/src/collective/`
- Exposé via skill `/debate [prompt]`
- Auth hybrid : env var → credential file → CLI subprocess (cascade Effect)
- Pipeline **Extract-then-Target** en 4 phases :
  1. DIVERGE (parallèle, indépendant)
  2. CARTOGRAPHIE (extraction de claims atomiques)
  3. CONVERGENCE CIBLÉE (max 2 tours, claims controversées seulement)
  4. SYNTHÈSE (juge non-participant, rapport structuré)

### Principes verrouillés
- **Union des différences** (Blind Spot Hunter), pas consensus
- **Rôles dynamiques** attribués par meta-prompt contextuel, pas hardcodés par provider
- Chaque modèle a une clause **"hors rôle"** pour ne pas rater un blind spot
- **Anonymisation sélective** : claims anonymes pendant le débat (hash-masking),
  attribution complète dans le rapport final uniquement
- Le juge reçoit un **vecteur de fiabilité par domaine** (Epistemic Fingerprinting)
  mais PAS le nom des modèles — il pondère sans biais d'autorité
- **Tiers budgétaires** : Tier 0 (gratuit), Tier 1 (quick), Tier 2 (standard), Tier 3 (deep)
- **Kill-switch** budget temps réel, pas juste estimation
- Format : **JSON typé Effect Schema** + rendu Markdown
- Stockage : **SQLite + index vectoriel optionnel** (LanceDB ou sqlite-vec)
- Mode 2 providers : **Adversarial Pair** (pipeline simplifié, nom distinct)

### Schéma de claim atomique (consensus Round 2)
```json
{
  "claimId": "clm_<hash>",
  "sourceId": "anon_<hash>",
  "category": "security|performance|maintainability|correctness|ux|architecture",
  "content": "Affirmation atomique et falsifiable",
  "evidenceRefs": ["file:line", "code_snippet_hash"],
  "confidenceSelf": 0.85,
  "noveltyMarker": "unique|minority|consensus",
  "isActionable": true,
  "verificationHint": "commande ou test pour vérifier ce claim"
}
```

### Services Effect (consensus Round 2)
```
ProviderDiscovery  — découverte, auth, health check
ClaimExtractor     — extraction + validation de couverture
DebateOrchestrator — coordination des phases
SynthesisJudge     — prompting du juge, format JSON
DebateStore        — persistance SQLite + vectoriel
```

### Insights intégrés comme contraintes
| # | Insight | Statut |
|---|---------|--------|
| BS1 | Anti-contamination (claims anonymes) | ✅ Intégré |
| BS2 | Mémoire collective persistante | ✅ Intégré (SQLite) |
| BS3 | Audit Ghost Models | ✅ Intégré |
| BS4 | Role-Prompting Asymmetry | ✅ Intégré (dynamique) |
| BS5 | Epistemic Fingerprinting | ✅ Intégré (vecteur fiabilité) |
| BS6 | Reproductibilité (IDs stables) | ✅ Intégré |
| BS7 | Métacognition du débat (DeepSeek R2) | ⬜ À trancher (Q4) |
| BS8 | Internal Jargon Trap (Mistral R2) | ⬜ À trancher (Q3) |
| BS9 | Mesure de valeur du débat (ChatGPT R2) | ⬜ À trancher (Q5) |

---

## Les 5 questions ouvertes du Round 3

### Q1 — Extracteur : simple ou double ?

C'est la **plus forte divergence** du Round 2. Deux camps :

**Camp A — Double extracteur** (MiniMax, Mistral) :
> "Un seul extracteur est inacceptable pour un Blind Spot Hunter — c'est
> exactement là qu'on perd le plus de claims." — MiniMax
> Deux extracteurs indépendants + réconciliation par union des claims.

**Camp B — Extracteur unique + validation** (DeepSeek, Gemini) :
> "La validation croisée est trop coûteuse ; un extracteur unique avec
> prompt d'exhaustivité + vérification de couverture sémantique suffit."
> Score de couverture : cosinus entre phrases sources et claims extraits.

Les deux camps ont de bons arguments :
- Double : détecte le filtrage silencieux, mais coûte 2x sur Phase 2
- Simple + validation : moins cher, mais la validation sémantique peut
  rassurer à tort si les claims sont des résumés trop vagues

**Questions** :
- Quel camp choisis-tu et pourquoi ?
- Si double : comment réconcilier les listes quand les 2 extracteurs
  produisent des taxonomies incompatibles ?
- Si simple : comment prouver que la validation par couverture sémantique
  détecte vraiment les claims filtrés (pas juste les claims reformulés) ?
- Compromis possible : un extracteur + un "vérificateur d'exhaustivité"
  qui ne ré-extrait pas mais vérifie que rien n'a été oublié ?

### Q2 — Mémoire : injection automatique ou sur demande ?

Autre divergence non résolue du Round 2 :

**Camp A — Injection automatique discrète** (DeepSeek, Mistral) :
> Injecter les top 3 blind spots des débats passés dans le system prompt
> de l'orchestrator. Une ligne de contexte : "Note: past debates flagged
> risk X in similar context."

**Camp B — Retrieval sur demande uniquement** (MiniMax) :
> "L'injection automatique pollue chaque turn et peut distraire l'orchestrator.
> Un tool `queryPastDebates(query)` que l'orchestrator appelle quand il
> détecte un pattern de récurrence. Pas d'injection par défaut."

**Questions** :
- Quel camp choisis-tu et pourquoi ?
- Si injection automatique : comment éviter le "déjà-vu loop" où le
  passé confirme au lieu de challenger ? Comment filtrer les faux positifs ?
- Si sur demande : comment garantir que l'orchestrator pense à appeler
  le tool ? Un LLM ne sait pas ce qu'il ne sait pas.
- Compromis possible : injection automatique mais seulement pour les
  blind spots à confiance > 0.8, et un tool pour le reste ?

### Q3 — Jargon Trap et Hallucinations techniques

Mistral a identifié en Round 2 un risque sous-estimé : les modèles
**inventent des termes techniques plausibles** qui n'existent pas dans
le codebase ("DebateBus", "CollectiveHook"...). Les autres modèles
ne les contredisent pas car ils ignorent leur inexistence.

**Questions** :
- Faut-il un **vérificateur de jargon** qui grep le codebase et la doc
  pour chaque terme technique dans les claims ?
- Si oui, à quelle phase ? Phase 2 (cartographie) ou Phase 4 (synthèse) ?
- Comment distinguer un terme inventé (hallucination) d'un terme
  **proposé** (nouveau concept légitime que l'IA suggère de créer) ?
- Ce risque est-il assez fréquent pour justifier un composant dédié,
  ou un simple warning dans le prompt de l'extracteur suffit ?

### Q4 — Métacognition : rapport de qualité du débat

DeepSeek a proposé en Round 2 une phase méta : le juge évalue non
seulement les claims mais aussi la **dynamique du débat** :
- Quels claims ont été contestés vs acceptés sans résistance ?
- Où la convergence a été difficile vs artificielle ?
- Quelle confiance accorder au processus lui-même ?

Exemple de sortie : "Le consensus sur X est fragile car il repose sur
un seul tour de critique. Y a été fortement débattu mais un modèle
minoritaire persiste avec un argument non réfuté."

**Questions** :
- Ce méta-rapport doit-il être un composant séparé ou intégré au
  rapport de synthèse principal ?
- Comment mesurer la "fragilité" d'un consensus ? Propose une métrique.
- Ce méta-rapport alimente-t-il la mémoire collective (pour ajuster
  les futurs pipelines) ?
- Le coût de cette phase supplémentaire est-il justifié ? Quand
  l'activer (toujours, Tier 3 seulement, sur demande) ?

### Q5 — Mesure de valeur : comment prouver que N modèles > 1 ?

ChatGPT a posé la question la plus fondamentale en Round 2 :

> "Comment sait-on que 8 modèles ont produit un meilleur résultat qu'un seul ?"

Sans métrique, impossible de justifier le surcoût. Le Blind Spot Hunter
n'a de sens que s'il trouve **réellement** des choses qu'un seul modèle
aurait ratées.

**Questions** :
- Propose 3 à 5 métriques concrètes et mesurables pour évaluer la
  valeur ajoutée du débat multi-modèle.
  Exemples possibles : nombre de blind spots, couverture dimensionnelle,
  réduction des hallucinations, satisfaction utilisateur, etc.
- Comment établir une **baseline** ? (Comparer le résultat du débat à
  la réponse du meilleur modèle seul ?)
- Faut-il un **mode A/B** intégré qui exécute parfois le débat et
  parfois un seul modèle, puis compare les résultats ?
- Ces métriques doivent-elles être affichées à l'utilisateur (pour
  justifier le coût) ou rester internes (pour le tuning) ?

---

## Red Team : permanent ou conditionnel ?

Petite divergence du Round 2 à trancher en bonus :

**Camp A — Conditionnel** (MiniMax, DeepSeek) :
> Activé seulement quand la diversité tombe < seuil (cosinus > 0.85)
> ou sur demande explicite. Un Red Team permanent gaspille des tokens.

**Camp B — Permanent** (Mistral) :
> Toujours un modèle assigné au rôle Red Team. Le coût est modeste
> (un modèle cheap) et la valeur est systématique.

Tranche : conditionnel ou permanent ? Justifie.

---

## Contraintes (complètes)

1. Pas de scraping web — APIs officielles et CLIs uniquement
2. Respect des CGU — chaque provider via son canal officiel
3. Graceful degradation — fonctionne dès 2 providers
4. Budget-aware — estimation + kill-switch temps réel
5. Offline-capable — modèles locaux (Ollama) comme participants
6. Effect runtime — composition async via Effect
7. Anti-contamination — claims anonymes pendant le débat
8. Reproductibilité — IDs stables, runs comparables
9. Audit credentials — vérification ghost models
10. Clause "hors rôle" — chaque modèle peut signaler un insight hors périmètre

---

## Format de réponse attendu

Pour chaque question (Q1-Q5 + Red Team), structure ta réponse ainsi :

```
### Q[N] — [Titre]

**Verdict** : [Ta réponse en 1 phrase — tranche, ne nuance pas]

**Argument décisif** : [Le seul argument qui fait pencher la balance]

**Garde-fou** : [Comment mitiger le risque principal de ce choix]
```

Après les 5+1 questions, ajoute :

```
### Insight unique Round 3

[Cherche TRÈS profond. Les insights évidents (contamination, mémoire,
rôles, jargon, métacognition, mesure de valeur) ont TOUS été trouvés.
Trouve quelque chose que personne n'a encore mentionné en 2 rounds
et 12+ réponses. Si tu ne trouves rien de véritablement nouveau,
dis-le honnêtement plutôt que de recycler.]
```

---

## Modèles interrogés (Round 3)

- [ ] Claude (Anthropic)
- [ ] GPT (OpenAI)
- [ ] Gemini (Google)
- [ ] DeepSeek
- [ ] Qwen (Alibaba)
- [ ] Mistral
- [ ] MiniMax — M3
- [ ] GLM (Zhipu)
