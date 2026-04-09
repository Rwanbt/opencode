# Plan d'implémentation — Optimisations IA locale

Ce plan documente les améliorations à apporter à OpenCode pour optimiser l'inférence locale des modèles IA (LLM, STT, TTS) sur des configurations domestiques (8 Go VRAM / 16 Go RAM).

---

## 1. TurboQuant — KV Cache 3-bit quasi sans perte

### Contexte technique
TurboQuant (Google Research, ICLR 2026) utilise deux étapes :
1. **PolarQuant** : rotation orthogonale (Walsh-Hadamard) des vecteurs KV pour éliminer les outliers → quantification Lloyd-Max optimale
2. **QJL** : correction d'erreur 1-bit via projection Johnson-Lindenstrauss → estimateur non-biaisé de l'inner product

Résultat : **3 bits/valeur** avec une distorsion quasi nulle (dans un facteur 2.7x de la borne théorique). À 3.5 bits, les benchmarks sont identiques au FP16.

### État actuel dans llama.cpp
- **PR #21038 MERGÉ** (1er avril 2026) : rotation Hadamard pour KV cache intégrée au mainline. Active automatiquement avec `--ctk q4_0 --ctv q4_0`.
- **TurboQuant complet (avec QJL)** : disponible uniquement dans des forks communautaires (`turbo3`, `turbo4`, `tq3_0`)

### Implémentation
- **Phase 1** (immédiat) : Mettre à jour notre version de llama.cpp de b8709 vers la dernière version qui inclut PR #21038. La rotation sera appliquée automatiquement à nos `--ctk q4_0` existants.
- **Phase 2** (quand disponible en mainline) : Ajouter les types `turbo3`/`turbo4` dans les options KV cache des Settings > Configuration
- **Fichiers à modifier** :
  - `packages/desktop/src-tauri/src/llm.rs` : mettre à jour `LLAMA_RELEASE_TAG`, ajouter option de type KV cache depuis les settings
  - `packages/app/src/components/settings-configuration.tsx` : ajouter `turbo3`, `turbo4` dans les options KV cache
  - `.github/workflows/android.yml` : mettre à jour la version llama.cpp

### Gain estimé
| Type KV cache | VRAM pour 32K tokens | Qualité |
|---------------|---------------------|---------|
| FP16 (actuel possible) | ~1088 MiB | 100% |
| q8_0 (notre défaut) | ~544 MiB | ~99.5% |
| q4_0 + rotation (PR mergé) | ~288 MiB + meilleure qualité | ~99% |
| turbo3 (fork) | ~200 MiB | ~99.5% |

---

## 2. MoE Expert Offloading intelligent

### Contexte
Gemma 4 26B A4B est un modèle Mixture-of-Experts : 26B params totaux, 4B actifs par token. Le système `--fit` de llama.cpp gère déjà le split GPU/CPU, mais on peut l'optimiser.

### Implémentation
- **Phase 1** : Ajouter un sélecteur dans Settings > Configuration pour le mode d'offloading :
  - `auto` (défaut, --fit gère tout)
  - `gpu-priority` : maximise les layers sur GPU, overflow sur CPU
  - `balanced` : répartit équitablement entre GPU et CPU pour un débit stable
- **Phase 2** : Détection automatique du type de modèle (dense vs MoE) via l'API `/v1/models` de llama-server et ajustement des paramètres
- **Fichiers à modifier** :
  - `packages/desktop/src-tauri/src/llm.rs` : ajouter les options `-ot` (override tensor) pour le placement fin des experts
  - `packages/app/src/components/settings-configuration.tsx` : section "GPU/CPU Offloading"

---

## 3. IQ3_M / IQ4_XS — Quantification intelligente des poids

### Contexte
Les formats Importance Quantization (IQ) de llama.cpp analysent quels poids sont critiques et les compressent de manière différenciée. IQ3_M réduit un modèle 26B à ~11 GB (vs ~15 GB en Q4_K_M).

### Implémentation
- **Phase 1** : Dans le dialog Local AI (dialog-local-llm.tsx), ajouter des recommandations de format GGUF basées sur la VRAM détectée :
  - 4 GB VRAM → suggérer IQ3_M
  - 6 GB VRAM → suggérer IQ4_XS
  - 8 GB VRAM → suggérer Q4_K_M
  - 12+ GB VRAM → suggérer Q5_K_M ou Q6_K
- **Phase 2** : Afficher l'utilisation VRAM estimée dans le catalog de modèles
- **Fichiers à modifier** :
  - `packages/app/src/components/dialog-local-llm.tsx` : ajouter les badges de recommandation et l'estimation VRAM
  - `packages/desktop/src-tauri/src/llm.rs` : détecter la VRAM via `nvidia-smi` et la retourner via une commande Tauri

---

## 4. SolidAttention — KV Cache sur SSD

### Contexte
SolidAttention (USENIX FAST 2026) permet de stocker le KV cache sur un SSD NVMe au lieu de la VRAM. Réduction de 98% de la mémoire KV cache, amélioration jusqu'à 3.1x de la vitesse d'inférence à 128K tokens.

### Implémentation
- **Phase 1** (recherche) : Vérifier si un fork de llama.cpp intègre SolidAttention ou un mécanisme similaire de KV offloading sur disque
- **Phase 2** (si disponible) : Ajouter les flags appropriés dans llm.rs et une option dans Settings
- **Phase 3** (si non disponible) : Implémenter un mécanisme de swap KV cache en Rust utilisant mmap sur un fichier SSD
- **Fichiers à modifier** :
  - `packages/desktop/src-tauri/src/llm.rs` : flags SolidAttention ou mécanisme de swap
  - `packages/app/src/components/settings-configuration.tsx` : option "KV Cache Storage" (VRAM / SSD / Auto)

### Gain estimé
- Contexte possible : 128K+ tokens sur 8 GB VRAM
- Prérequis : SSD NVMe (>3 GB/s de lecture séquentielle)

---

## 5. Weight Streaming depuis SSD

### Contexte
llama.cpp utilise déjà mmap par défaut, ce qui permet au système d'exploitation de ne charger que les pages mémoire nécessaires. Cependant, ce n'est pas du vrai "streaming" — les pages restent en RAM une fois chargées.

### Implémentation
- **Phase 1** : Ajouter l'option `--no-mmap` + `--mlock off` dans les settings avancés pour permettre au système de gérer le swap SSD automatiquement
- **Phase 2** : Expérimenter avec le flag `--split-mode row` pour distribuer les layers entre GPU et swap SSD
- **Fichiers à modifier** :
  - `packages/desktop/src-tauri/src/llm.rs` : options mmap/mlock dans les flags serveur
  - `packages/app/src/components/settings-configuration.tsx` : section "Memory Management"

---

## 6. RAG local — Mémoire long terme sur SSD

### Contexte
Actuellement, chaque session est indépendante. Un système RAG (Retrieval-Augmented Generation) permettrait à l'IA de "se souvenir" des conversations passées et des documents indexés.

### Implémentation
- **Phase 1** : Base de données vectorielle locale (SQLite avec extension `sqlite-vss` ou `hnswlib` en Rust)
- **Phase 2** : Indexation automatique des réponses AI et des fichiers de projet
- **Phase 3** : Injection automatique du contexte pertinent dans le prompt
- **Fichiers à créer** :
  - `packages/desktop/src-tauri/src/rag.rs` : moteur RAG (indexation + recherche)
  - `packages/app/src/components/settings-rag.tsx` : configuration RAG (activer/désactiver, taille de l'index, auto-indexation)
  - Intégration dans `packages/opencode/src/session/llm.ts` : injection du contexte RAG dans le prompt

### Architecture
```
User query → RAG search (SSD) → Top K documents → Inject in prompt → LLM inference
```

---

## 7. Monitoring VRAM temps réel

### Contexte
L'utilisateur n'a aucune visibilité sur l'utilisation VRAM actuelle. Important pour ajuster les paramètres.

### Implémentation
- **Phase 1** : Commande Tauri `get_vram_usage()` qui appelle `nvidia-smi` (ou équivalent)
- **Phase 2** : Widget dans la barre de status de l'app montrant VRAM utilisée / totale
- **Phase 3** : Alertes quand la VRAM approche 90%
- **Fichiers à modifier** :
  - `packages/desktop/src-tauri/src/llm.rs` : commande `get_vram_info`
  - `packages/app/src/components/status-bar.tsx` ou widget dédié

---

## 8. Gestion dynamique des tokens output

### Contexte
Actuellement `max_tokens` est fixe (32K par défaut ou configurable manuellement). Un mode "auto" intelligent répartirait dynamiquement les tokens entre prompt et réponse.

### Implémentation
- **Phase 1** (fait) : Settings > Configuration avec mode Auto/Manuel pour output tokens
- **Phase 2** : Le mode Auto calcule : `output_tokens = min(model_limit, (context_remaining - prompt_size) / 2)`
- **Phase 3** : Adaptation par type de requête (question courte → peu de tokens, "écris un essai" → max tokens)
- **Fichiers à modifier** :
  - `packages/app/src/components/dialog-local-llm.tsx` : `registerLocalModels()` lit les settings et calcule dynamiquement
  - `packages/app/src/components/settings-configuration.tsx` : déjà implémenté, à affiner

---

## 9. Profils de configuration prédéfinis

### Contexte
Comme LM Studio, proposer des profils qui configurent automatiquement tous les paramètres.

### Implémentation
- **Profil "Rapide"** : q4_0 KV cache, faible contexte (8K), temperature basse → réponses courtes et rapides
- **Profil "Qualité"** : q8_0 KV cache, contexte max, temperature moyenne → meilleures réponses
- **Profil "Éco"** : q4_0 KV cache, offloading CPU, petit modèle → minimal VRAM
- **Profil "Long contexte"** : turbo3 KV cache (quand dispo), SSD swap, contexte 128K+
- **Fichiers à modifier** :
  - `packages/app/src/components/settings-configuration.tsx` : sélecteur de profil en haut de la page

---

## Ordre de priorité recommandé

| # | Feature | Impact | Effort | Priorité |
|---|---------|--------|--------|----------|
| 1 | Mise à jour llama.cpp (rotation KV) | Fort | Faible | **P0** |
| 2 | Tokens output dynamiques | Fort | Faible | **P0** |
| 3 | Recommandations GGUF par VRAM | Moyen | Faible | **P1** |
| 4 | Monitoring VRAM | Moyen | Faible | **P1** |
| 5 | Profils prédéfinis | Moyen | Moyen | **P2** |
| 6 | MoE Expert Offloading | Fort | Moyen | **P2** |
| 7 | TurboQuant complet | Très fort | Dépend du merge upstream | **P2** |
| 8 | RAG local | Très fort | Élevé | **P3** |
| 9 | SolidAttention (KV sur SSD) | Très fort | Très élevé | **P3** |
| 10 | Weight Streaming SSD | Fort | Élevé | **P3** |

---

## Références

- [TurboQuant Paper (arXiv:2504.19874)](https://arxiv.org/abs/2504.19874) — Google Research, ICLR 2026
- [PolarQuant (arXiv:2603.29078)](https://arxiv.org/abs/2603.29078) — Rotation-based weight quantization
- [SpinQuant (arXiv:2405.16406)](https://arxiv.org/abs/2405.16406) — Meta, learned rotations
- [SolidAttention (USENIX FAST 2026)](https://www.usenix.org/conference/fast26/presentation/zheng) — KV cache on SSD
- [llama.cpp PR #21038](https://github.com/ggml-org/llama.cpp/pull/21038) — Hadamard rotation for KV cache (MERGED)
- [llama.cpp Discussion #20969](https://github.com/ggml-org/llama.cpp/discussions/20969) — TurboQuant community integration
- [QJL Repository](https://github.com/amirzandieh/QJL) — Error correction component
- [Google Research Blog: TurboQuant](https://research.google/blog/turboquant-redefining-ai-efficiency-with-extreme-compression/)
