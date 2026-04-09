# Plan d'implémentation — Optimisations IA locale

> Synthèse de l'analyse collaborative Claude + ChatGPT + Gemini (avril 2026)

---

## Status des implémentations

| # | Feature | Status | Commit |
|---|---------|--------|--------|
| 1 | **Prompt reduction local-llm (16K → 1K tokens)** | ✅ Implémenté | `caa127103` |
| 2 | **llama.cpp b8731 + Hadamard rotation KV cache** | ✅ Implémenté | `13c526dfa` |
| 3 | **Speculative Decoding + VRAM Guard** | ✅ Implémenté | `caa127103` |
| 4 | **KV cache q4_0 par défaut (72% savings)** | ✅ Implémenté | `13c526dfa` |
| 5 | **VRAM monitoring widget** | ✅ Implémenté | `13c526dfa` |
| 6 | **Recommandations GGUF par VRAM** | ✅ Implémenté | `d59965520` |
| 7 | **Tokens output dynamiques (auto par taille modèle)** | ✅ Implémenté | `d59965520` |
| 8 | **Configuration presets (Fast/Quality/Eco/Long)** | ✅ Implémenté | `13c526dfa` |
| 9 | **GPU/CPU offloading (auto/gpu-max/balanced)** | ✅ Implémenté | `d59965520` |
| 10 | **Memory mapping (mmap on/off/auto)** | ✅ Implémenté | `a2aec91d8` |
| 11 | **Tool skeletons (signatures minimalistes)** | ✅ Implémenté | `caa127103` |
| 12 | **Tool whitelist (7 outils pour local)** | ✅ Implémenté | `caa127103` |
| 13 | **Prompt profiler (token logging)** | ✅ Implémenté | `caa127103` |
| 14 | **RAG TF-IDF** | ❌ Supprimé (doublon de RAG upstream) | `caa127103` |
| 15 | Auto-routing local/cloud | ⏳ Planifié | router.ts design prêt |
| 16 | SolidAttention (KV sur SSD) | ⏳ Recherche | Pas dans llama.cpp mainline |
| 17 | RAG embeddings offline (MiniLM ONNX) | ⏳ Option B | Upstream RAG recommandé |

---

## Détail des optimisations implémentées

### Prompt reduction (P0 — plus gros impact)

Le prompt système pour `local-llm` passe de **~16,200 tokens à ~1,020 tokens** (-94%) :

| Composant | Avant | Après |
|-----------|-------|-------|
| Prompt système (default.txt → local.txt) | 2,300 | 130 |
| Descriptions outils (prose → skeletons) | 10,000 | 175 |
| Schémas JSON outils (18 → 7 outils) | 2,900 | 700 |
| Environnement (verbose → 1 ligne) | 215 | 15 |
| Skills | 800 | 0 |
| **Total** | **~16,200** | **~1,020** |

**Fichiers modifiés :**
- `packages/opencode/src/session/prompt/local.txt` — nouveau prompt compact
- `packages/opencode/src/session/system.ts` — routing + env réduit + skills skip
- `packages/opencode/src/tool/registry.ts` — whitelist + skeletons + filtrage
- `packages/opencode/src/session/llm.ts` — prompt profiler

### Speculative Decoding (P1)

- Flag `--model-draft` dans `llm.rs`
- VRAM Guard : vérifie `nvidia-smi` avant d'activer, fallback `true` si non détectable
- Auto-détection du draft model (cherche `*0.8B*.gguf`)

### Configuration presets

| Preset | KV Cache | Context | Temp | Offload | mmap |
|--------|----------|---------|------|---------|------|
| Fast | q4_0 | 8K | 0.5 | gpu-max | auto |
| Quality | q8_0 | max | 0.7 | auto | auto |
| Eco | q4_0 | 16K | 0.5 | balanced | on |
| Long Context | q4_0 | 128K+ | 0.7 | auto | auto |

---

## Features restantes (non implémentées)

### Auto-routing local/cloud

Design prêt (`router.ts`), intégration dans `prompt.ts` identifiée. Nécessite :
- `classifyTask()` avec regex + word count
- `getLocalModel()` helper dans `provider.ts`
- Config `experimental.auto_route.enabled`

### SolidAttention (KV Cache sur SSD)

Recherché : pas de fork llama.cpp stable avec cette feature. Le prompt cache natif (b8731) couvre partiellement le besoin via `--cache-reuse`.

### RAG embeddings offline

Option A (recommandée) : utiliser le RAG upstream (`experimental.rag.enabled: true`)
Option B : intégrer all-MiniLM-L6-v2 (22MB) via le crate `ort` déjà présent

---

## Références

- [TurboQuant (arXiv:2504.19874)](https://arxiv.org/abs/2504.19874) — Google Research, ICLR 2026
- [llama.cpp PR #21038](https://github.com/ggml-org/llama.cpp/pull/21038) — Hadamard rotation (MERGED)
- [SolidAttention (USENIX FAST 2026)](https://www.usenix.org/conference/fast26/presentation/zheng)
- [PolarQuant (arXiv:2603.29078)](https://arxiv.org/abs/2603.29078)
- [SpinQuant (arXiv:2405.16406)](https://arxiv.org/abs/2405.16406) — Meta
