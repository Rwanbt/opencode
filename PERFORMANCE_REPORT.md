# PERFORMANCE REPORT — OpenCode Fork (2026-04-17)

> Analyse de la logique algorithmique et propositions de benchmarks.
> Cible : agent réactif pour LLMs locaux (llama-server:14097) et cloud, fonctionnant de la montre connectée au desktop 128 Go.

---

## 1. Hot paths identifiés

| # | Localisation | Observé | Impact estimé |
|---|---|---|---|
| HP1 | [packages/opencode/src/provider/transform.ts](packages/opencode/src/provider/transform.ts) (monolithe) + `models-snapshot.js` 1.75 MB | 20+ SDKs importés statiquement, snapshot JSON chargé au boot | **+400 ms cold start CLI**, +1-2 s mobile |
| HP2 | [packages/opencode/src/session/llm.ts:43-70](packages/opencode/src/session/llm.ts#L43-L70) | `fetch /props` à chaque stream request, pas de cache | 20-80 ms de latence par message |
| HP3 | [packages/opencode/src/session/compaction.ts:124-143](packages/opencode/src/session/compaction.ts#L124-L143) | Itération backward complète pour trouver `PRUNE_PROTECT` tokens | O(n·m) où n=messages, m=parts |
| HP4 | [packages/opencode/src/util/token.ts](packages/opencode/src/util/token.ts) | `length/4` partout dans le chemin chaud | Erreur ±30 % sur budget tokens |
| HP5 | [packages/opencode/src/local-llm-server/index.ts:262-281](packages/opencode/src/local-llm-server/index.ts#L262-L281) | `pruneStaleRefs()` sur chaque `ensureRunning` | lecture disque + filter, négligeable mais cumulatif |
| HP6 | [packages/opencode/src/session/processor.ts](packages/opencode/src/session/processor.ts) | SessionProcessor + layer Effect composé à chaque message | Cold start layer : profiler |
| HP7 | Provider SDKs bundlés | openai, anthropic, google, mistral, bedrock, azure… tous chargés | Taille bundle mobile |
| HP8 | [packages/app/src/utils/agent.ts:13-23](packages/app/src/utils/agent.ts#L13-L23) + autres utils | `.find` dans boucle | O(n·m) potentiel sur rendu listes longues |

---

## 2. Auto-adaptation device (lacune majeure)

### 2.1 — État actuel

Ce qui existe :
- **Adaptive context window** via `/props` ([llm.ts:43-70](packages/opencode/src/session/llm.ts#L43-L70)) : lit `n_ctx` réel du serveur, scale output 40 %, thinking 10 %.
- **Pruning thresholds** scalés à `model.limit.context` ([compaction.ts:41-47](packages/opencode/src/session/compaction.ts#L41-L47)).
- **Mémoire device** : `get_memory_info` côté Rust ([use-auto-start-llm.ts:91-98](packages/mobile/src/hooks/use-auto-start-llm.ts#L91-L98)) — utilisée pour l'affichage uniquement.
- **Preset LLM mobile** : `kvCacheType: "q4_0", flashAttn: true, offloadMode: "auto"` — hardcodé ([use-auto-start-llm.ts:11-17](packages/mobile/src/hooks/use-auto-start-llm.ts#L11-L17)).

### 2.2 — Ce qui manque

1. **Détection GPU/VRAM** : aucune sonde. Un desktop avec RTX 4090 (24 GB VRAM) reçoit la même config qu'un Intel iGPU 2 GB.
2. **Matrice décisionnelle** : `{ device_profile, model_size } → { n_gpu_layers, batch, ubatch, flash_attn, kv_cache_type, n_ctx }`.
3. **Fallback cloud** : si le modèle local ne tient pas en VRAM, aucune suggestion automatique de bascule vers un provider cloud équivalent.
4. **Profil persistant** : re-probed à chaque boot au lieu d'être caché.

### 2.3 — Proposition d'architecture

**Nouveau module** `packages/opencode/src/device/` :

```
device/
├── probe.ts           // Entry : await DeviceProbe.detect(): DeviceProfile
├── probe-desktop.ts   // wgpu::Instance via Tauri command
├── probe-android.ts   // ActivityManager MemoryInfo + SOC_MODEL
├── profile.ts         // type DeviceProfile (GPU, VRAM, RAM, CPU, OS)
├── decision.ts        // (profile, model) => LlamaConfig
└── store.ts           // persist ~/.opencode/device-profile.json
```

**`DeviceProfile` (shape)** :

```ts
type DeviceProfile = {
  os: "windows" | "macos" | "linux" | "android" | "ios"
  cpu: { cores: number; threads: number; arch: "x64" | "arm64" }
  ram: { totalMb: number; availableMb: number }
  gpu: Array<{
    vendor: "nvidia" | "amd" | "intel" | "apple" | "qualcomm" | "mali" | "adreno" | "other"
    name: string
    vramMb: number
    api: "cuda" | "vulkan" | "metal" | "opencl" | "rocm"
  }>
  // Android-specific
  soc?: string       // "sm8550", "tensor-g3", etc.
  socTier?: "flagship" | "upper-mid" | "mid" | "low"
}
```

**Decision engine** — matrice (extrait simplifié) :

```
// Choose n_gpu_layers based on model size vs VRAM
function chooseGpuLayers(model: ModelInfo, profile: DeviceProfile): number {
  const vram = Math.max(...profile.gpu.map(g => g.vramMb), 0)
  const modelSizeMb = model.sizeBytes / 1024 / 1024
  const kvCacheMb = estimateKvCache(model.nCtx, model.params, quantKv)
  if (vram <= 0) return 0                        // CPU only (blocked per CLAUDE.md rule — we error)
  if (vram >= modelSizeMb + kvCacheMb + 512) return 999  // full offload
  return Math.floor((vram - kvCacheMb - 512) / (modelSizeMb / model.nLayers))
}
```

**Source de vérité des specs** : HuggingFace metadata `config.json` + `tokenizer.json` (mimique `llama.cpp --print-info`). Cache 7 jours.

**Interaction avec CLAUDE.md règle "GPU mandatory"** : si `profile.gpu.length === 0 || vram === 0`, l'app refuse de charger (ou force cloud provider), pas de fallback CPU silencieux.

---

## 3. Benchmarks à mettre en place

Nouveau dossier `packages/opencode/test/bench/` :

### 3.1 — `bench-tokenize.ts`
Compare 3 méthodes sur 100 prompts réels (du dataset `test/fixtures/prompts.json`) :
- `Token.estimate` (length/4)
- `tiktoken` via `js-tiktoken`
- `llama-server POST /tokenize` (ground truth)

**Métriques** : MAE, MAPE, p99 temps par call.
**Seuil de passage** : remplacement de `length/4` doit réduire MAPE <10 %.

### 3.2 — `bench-compaction.ts`
Historiques synthétiques 10 K / 50 K / 131 K tokens, 20 % tool outputs.
**Métriques** : temps total pruning, tokens reclaimed, % tool outputs supprimés.
**Régression** : pas plus de +20 % vs baseline.

### 3.3 — `bench-startup.ts`
- CLI : `time bun run src/index.ts --version` 10×, médiane.
- Mobile : via `maestro test bench-startup.yaml` (lance app + mesure temps jusqu'à `window.appReady = true`).

### 3.4 — `bench-streaming.ts`
10 prompts fixes × 3 modèles (1 cloud Claude Sonnet, 1 local Qwen-3-8B, 1 local Gemma-3-4B).
**Métriques** : ttft (time-to-first-token), tokens/s sustained, latence p95 par chunk.

### 3.5 — `bench-rag.ts`
Scan d'un monorepo fictif (10 K fichiers, 500 K LOC). Measure : time to index, RAM peak, disk I/O.

### 3.6 — Infrastructure

```json
// package.json (racine) — ajouter scripts
{
  "scripts": {
    "bench": "bun test --coverage=false packages/opencode/test/bench",
    "bench:save": "bun run bench --reporter=json > test/bench/results.json",
    "bench:compare": "bun run scripts/compare-bench.ts test/bench/baseline.json test/bench/results.json"
  }
}
```

CI : `.github/workflows/bench.yml` exécute `bench:compare` sur PR et commente régressions >10 %.

---

## 4. Quick wins perf (faible coût, fort impact)

| Quick win | Fichier | Gain estimé |
|---|---|---|
| Dynamic import des provider SDKs | [packages/opencode/src/provider/transform.ts](packages/opencode/src/provider/transform.ts) | -500 à -800 KB cold start |
| Lazy load `models-snapshot.js` via streaming JSON | `packages/opencode/src/provider/` | -200 ms boot mobile |
| Cache `/props` (keyed by baseURL) | [llm.ts:50](packages/opencode/src/session/llm.ts#L50) | -50 ms par stream |
| AbortController sur HF search | [dialog-local-llm.tsx:141](packages/app/src/components/dialog-local-llm.tsx#L141) | UX — résultats dans l'ordre |
| Memo map agents → color | [utils/agent.ts](packages/app/src/utils/agent.ts) | marginal sur listes <50 items |
| Backoff health polling | [dialog-local-llm.tsx:157](packages/app/src/components/dialog-local-llm.tsx#L157) | -50 % calls Tauri sur idle |

---

## 5. Méthodologie de mesure

1. **Avant chaque optimisation, mesurer** avec `bench:save` sur baseline (HEAD de `dev`).
2. **Après**, comparer. Refuser le merge si régression non justifiée.
3. Pour le mobile Android : `adb shell dumpsys meminfo ai.opencode.mobile` avant/après une session 30 min, observer `TOTAL PSS`.
4. Heap snapshot WebView via Chrome DevTools Remote sur une session 100 messages avec 10 abort-and-retype : confirmer ou invalider A.3.

---

## 6. Lien avec le rapport d'audit

Les findings suivants impactent directement la performance :
- **A.1 Tokenizer** → section 3.1
- **A.2 Reasoning budget** → qualité mesurable via bench custom
- **A.8 Restart loop** → latence inference mesurable
- **A.16 messageAgentColor** → rendu listes

Voir [AUDIT_REPORT.md](AUDIT_REPORT.md) pour détails correctifs.
