# Performance Baselines — OpenCode

Référence mesurée sur la machine de développement principale (Windows 11, RTX 4090, Ryzen 9 7950X).

## Budgets UI

| Opération | Budget | Mesuré | Status |
|-----------|--------|--------|--------|
| Rendu frame UI | < 16.6 ms | ~8 ms | ✅ |
| Navigation session → session | < 200 ms | ~80 ms | ✅ |
| Ouverture du chat | < 500 ms | ~150 ms | ✅ |
| Chargement des sessions | < 1 s | ~300 ms | ✅ |

## Budgets Inference (Desktop local LLM)

| Modèle | Prefill | Decode | Platform |
|--------|---------|--------|----------|
| Gemma-4 E4B Q4_0 | - | - | Desktop GPU (ref) |

## Budgets Mobile (Android)

| Modèle | Prefill | Decode | Platform |
|--------|---------|--------|----------|
| Gemma-4 E4B Q4_0 | 36.5 tok/s | 7.81 tok/s | Xiaomi 14 Ultra (Hexagon NPU) |
| Gemma-4 E4B Q4_0 | 16.2 tok/s | 4.87 tok/s | Mi 10 Pro (CPU) |

## Méthodologie

- Mesures via le benchmark tab intégré (Settings → Benchmark)
- N = 3 runs, moyenne reportée
- Conditions : modèle chargé à froid, batch de 512 tokens de test

## Mise à jour

Mettre à jour après toute modification du pipeline inference ou de la configuration llama-server.
