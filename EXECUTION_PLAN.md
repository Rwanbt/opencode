# PLAN D'ATTAQUE — Exécution des fixes de l'audit 2026-04-17

> **Pour qui ?** Modèles IA de niveau Haiku/Sonnet 4.6. Chaque étape est auto-suffisante : paths exacts, strings à rechercher, diff avant/après, commandes de vérification. **Ne jamais improviser au-delà de ce qui est écrit ici.**
>
> Référence : [AUDIT_REPORT.md](AUDIT_REPORT.md), [PERFORMANCE_REPORT.md](PERFORMANCE_REPORT.md), [ANDROID_AUDIT.md](ANDROID_AUDIT.md).

---

## 0. Règles non-négociables (LIRE EN PREMIER)

### 0.1 — Interdits absolus
- **JAMAIS** `git push --force`, `git reset --hard`, `git commit --amend` sauf ordre explicite de l'utilisateur.
- **JAMAIS** `--no-verify` sur les commits (les hooks pre-commit détectent les régressions).
- **JAMAIS** modifier `C:/Users/barat/AppData/Local/Antigravity/` ou tuer des processus non-OpenCode (règle [CLAUDE.md](CLAUDE.md)).
- **JAMAIS** proposer un fallback CPU pour l'inference LLM (règle : GPU mandatory).
- **JAMAIS** `bun tauri android build` sans vérification thorough du code (5+ min par build).
- **JAMAIS** utiliser `sed` ou regex sur du code source. Utiliser `Edit` avec des anchors textuels uniques.
- **JAMAIS** laisser un `catch (e) {}` silencieux. Au minimum `log.error(...)` ou `console.error(...)`.

### 0.2 — Obligatoires avant chaque fix
1. **Read** le fichier cible intégralement (ou la section large autour des lignes).
2. **Grep** global du pattern/symbole pour trouver TOUTES les occurrences du bug (la règle [CLAUDE.md](CLAUDE.md) : « Never fix just the first occurrence »).
3. **Énoncer en 2 lignes** : cause racine + pourquoi le fix proposé la résout. Si impossible d'énoncer ça → tu n'as pas compris, STOP.

### 0.3 — Obligatoires après chaque fix
```bash
cd d:/App/OpenCode/opencode
bun run typecheck          # 0 erreur tolérée
cd packages/opencode
bun test                   # tests du package modifié, sauf exceptions documentées
```
Si **typecheck fail** : lire l'erreur, fixer la vraie cause. **Jamais** `// @ts-ignore`, **jamais** `any` pour contourner.

### 0.4 — Anti-loop (après 3 tentatives sur le même problème)
STOP. Écrire :
- Diagnostic complet en 5 lignes.
- 2 ou 3 approches alternatives.
- **Attendre décision utilisateur.** Ne pas continuer seul.

### 0.5 — Commit
- Un commit par fix (A.1, A.2, etc.), pas un gros commit groupé.
- Message format :
  ```
  fix(A.X): <short title>

  - What: <1-2 lines>
  - Why: <audit finding reference>
  - Verify: <how to check>

  Audit: d:/App/OpenCode/opencode/AUDIT_REPORT.md#aX

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  ```

---

## 1. Ordre d'exécution (respect des dépendances)

```
Phase 1 (parallélisable — pas de dépendances croisées)
├── A.1 Tokenizer          ← impact large, teste tout
├── A.2 Reasoning budget   ← localisé, rapide
├── A.10 CSP Tauri mobile  ← config, pas de test runtime
└── A.14 Regex QUANT

Phase 2 (dépend A.1 validé)
├── A.15 Supprimer duplicat tokenizer inline
└── A.17 Ring buffer stderr

Phase 3 (sécurité mobile, après A.10)
├── A.11 Guards Tauri commands
└── A.9  Secrets → plugin-store

Phase 4 (robustesse)
├── A.6  AbortSignal dans Promise.all
├── A.8  Circuit breaker ensureCorrectModel
├── A.12 owner.childPid reread before kill
├── A.16 messageAgentColor map
└── A.21 AbortController HF search

Phase 5 (Android lifecycle — nécessite device physique pour validation)
├── A.5  Runtime permissions
├── A.4  onPause / onResume hooks
└── A.3  Stream drain (heap snapshot nécessaire)

Phase 6 (doc + infra)
├── A.18 Backoff health poll
├── A.19 Deep-link cleanup
└── Bench suite + CI
```

**Ne pas** commencer la Phase N+1 avant que toutes les tâches de Phase N soient commitées et que `bun run typecheck` passe.

---

## A.1 — Remplacer le tokenizer naïf `length/4`

### Contexte
Le code utilise `CHARS_PER_TOKEN = 4` partout pour estimer le nombre de tokens. Impact : compaction décide quels tool outputs pruner sur une estimation ±30 % fausse. Pour local-llm, on a un endpoint `/tokenize` exact côté llama-server qu'on peut appeler gratuitement.

### Cible de vérité
- Cloud (OpenAI, Anthropic) : `js-tiktoken` (sync, déjà dans npm).
- Local (`local-llm`) : POST `/tokenize` sur `baseURL` (cf. [local-llm-server](packages/opencode/src/local-llm-server/index.ts)).
- Fallback (API injoignable) : `length / 3.5` (empirique BPE).

### Étape 1 — Installer la dépendance
```bash
cd d:/App/OpenCode/opencode/packages/opencode
bun add js-tiktoken@^1.0.20
```
Vérifier que `packages/opencode/package.json` mentionne bien `"js-tiktoken"` dans `dependencies`.

### Étape 2 — Refactor `src/util/token.ts`

**Anchor à chercher (doit matcher exactement) :**
```ts
export namespace Token {
  const CHARS_PER_TOKEN = 4

  export function estimate(input: string) {
    return Math.max(0, Math.round((input || "").length / CHARS_PER_TOKEN))
  }
}
```

**Remplacer par :**
```ts
import { encodingForModel, getEncoding, type TiktokenModel } from "js-tiktoken"

export namespace Token {
  const FALLBACK_CHARS_PER_TOKEN = 3.5

  // Cache encoders by model family to avoid re-init cost (~50ms on first call).
  const encoderCache = new Map<string, ReturnType<typeof getEncoding>>()

  function getEncoder(modelID?: string) {
    const key = modelID ?? "default"
    let enc = encoderCache.get(key)
    if (enc) return enc
    try {
      enc = modelID
        ? encodingForModel(modelID as TiktokenModel)
        : getEncoding("cl100k_base")
    } catch {
      enc = getEncoding("cl100k_base")
    }
    encoderCache.set(key, enc)
    return enc
  }

  /** Fast heuristic — use for large inputs where exactness is not critical. */
  export function estimate(input: string): number {
    const text = input ?? ""
    if (!text) return 0
    return Math.max(0, Math.ceil(text.length / FALLBACK_CHARS_PER_TOKEN))
  }

  /** Exact count via tiktoken. Use for budget decisions, prompt caching. */
  export function count(input: string, modelID?: string): number {
    const text = input ?? ""
    if (!text) return 0
    try {
      return getEncoder(modelID).encode(text).length
    } catch {
      return estimate(text)
    }
  }
}
```

**Points d'attention** :
- Ne **pas** supprimer `estimate()` : il reste utilisé par le hot path `compaction.ts:135`. Mais il retourne maintenant une valeur `Math.ceil(length/3.5)` au lieu de `Math.round(length/4)` — plus fidèle pour BPE/tiktoken.
- `count()` est nouveau, à appeler uniquement là où la précision compte (voir Étape 4).

### Étape 3 — Vérifier qu'aucun autre `CHARS_PER_TOKEN` ou `length / 4` ne traîne

Commande à exécuter, via Grep :
- Pattern : `CHARS_PER_TOKEN` — type: ts
- Pattern : `length\s*/\s*4` — type: ts

Pour chaque match hors de `util/token.ts`, juger si c'est le même bug. Oui pour `llm.ts:171` (voir A.15).

### Étape 4 — (Optionnel, différable) Remplacer `Token.estimate` par `Token.count` dans le chemin chaud

Fichier : [packages/opencode/src/session/compaction.ts:135](packages/opencode/src/session/compaction.ts#L135)

**Avant :**
```ts
const estimate = Token.estimate(part.state.output)
```

**Après :**
```ts
const estimate = Token.count(part.state.output, input.model?.id)
```

⚠️ **Attention** : `Token.count` encode le texte entier. Sur de gros tool outputs (>100 KB), coût ~5-20 ms. Acceptable dans la compaction (off hot path), **pas** acceptable dans le streaming. Ne pas remplacer dans `llm.ts` sauf dans le profiler.

### Étape 5 — Vérification
```bash
cd d:/App/OpenCode/opencode
bun run typecheck
cd packages/opencode
bun test src/util
```

Si possible, ajouter un test simple `test/util/token.test.ts` :
```ts
import { describe, test, expect } from "bun:test"
import { Token } from "../../src/util/token"

describe("Token", () => {
  test("estimate returns 0 for empty", () => {
    expect(Token.estimate("")).toBe(0)
    expect(Token.estimate(null as any)).toBe(0)
  })
  test("count for GPT-4 encodes hello world as 2 tokens", () => {
    expect(Token.count("hello world", "gpt-4")).toBe(2)
  })
})
```

### Étape 6 — Commit
```
fix(A.1): replace naive char/4 tokenizer with js-tiktoken

- What: Token.count() uses tiktoken (cached per model), estimate() fallback 3.5 chars/tok
- Why: length/4 was ±30% off on BPE models → wrong prune decisions, wrong budgets
- Verify: bun test src/util passes; tokenize('hello world') returns 2 for gpt-4

Audit: d:/App/OpenCode/opencode/AUDIT_REPORT.md#a1
```

---

## A.2 — Reasoning budget capé à 1024 (fix dynamique)

### Contexte
[packages/opencode/src/session/llm.ts:62](packages/opencode/src/session/llm.ts#L62) cape à 1024 tokens. Qwen-3-Thinking et DeepSeek-R1 produisent couramment 2-8 K tokens de raisonnement. Cap dynamique par famille de modèle requis.

### Étape 1 — Lire le contexte

Lire [packages/opencode/src/session/llm.ts:40-70](packages/opencode/src/session/llm.ts#L40-L70) pour voir la fonction `getLocalLLMAdaptiveLimits`.

### Étape 2 — Ajouter la helper `getThinkingCap`

**Au-dessus** de la définition de `getLocalLLMAdaptiveLimits` (ligne ~43), insérer :

```ts
/** Max reasoning/thinking tokens by model family.
 *  Qwen-Thinking and DeepSeek-R1 can emit very long reasoning chains
 *  on complex problems — capping too low silently truncates them.
 *
 *  Keep this list short and conservative. Add families here as we
 *  observe truncation in production. */
function getThinkingCap(modelID: string): number {
  const id = modelID.toLowerCase()
  if (id.includes("qwen") && id.includes("thinking")) return 8192
  if (id.includes("deepseek") && (id.includes("r1") || id.includes("thinking"))) return 8192
  if (id.includes("gemma") && id.includes("thinking")) return 6144
  if (id.includes("qwen") || id.includes("qwq")) return 4096
  return 2048 // safe default — doubled from previous 1024
}
```

### Étape 3 — Utiliser le cap

**Anchor à chercher** (exact match, ligne 62) :
```ts
      const reasoningBudget = Math.min(Math.max(128, Math.floor(maxTokens * 0.1)), 1024)
```

**Remplacer par** :
```ts
      const cap = getThinkingCap(model.id)
      const reasoningBudget = Math.min(Math.max(128, Math.floor(maxTokens * 0.15)), cap)
```

Note : fraction 0.15 au lieu de 0.10 — le thinking est prioritaire sur le texte final pour ces familles.

### Étape 4 — Vérification

```bash
cd d:/App/OpenCode/opencode
bun run typecheck
```

Test manuel : lancer un chat avec `qwen3-32b-thinking`, observer les logs `log.info("local-llm adaptive limits", ...)`. Le `reasoningBudget` devrait être `min(maxTokens*0.15, 8192)`. Pour `maxTokens ≥ 55_000` (contexte 131K × 40 %), on obtient **8192** (anciennement 1024, soit ×8).

### Étape 5 — Commit
```
fix(A.2): dynamic reasoning budget cap per model family

- What: getThinkingCap() returns 8192 for Qwen/DeepSeek thinking, 2048 default
- Why: 1024 cap silently truncated reasoning on complex problems
- Verify: log.info("local-llm adaptive limits") shows reasoningBudget=8192 for qwen-thinking

Audit: d:/App/OpenCode/opencode/AUDIT_REPORT.md#a2
```

---

## A.10 — CSP stricte pour `tauri.conf.json` mobile

### Contexte
[packages/mobile/src-tauri/tauri.conf.json:22-24](packages/mobile/src-tauri/tauri.conf.json#L22-L24) : `"csp": null`. Une XSS dans un message chat peut appeler n'importe quelle commande Tauri (incluant `download_model`).

### Étape 1 — Identifier les connect-src réellement utilisés

Grep dans `packages/mobile/` et `packages/app/` pour trouver les destinations `fetch()` / `WebSocket` / `invoke` :

- Pattern : `fetch\(` / `new WebSocket` / `EventSource` — type : ts, tsx
- Noter les URLs (localhost, 127.0.0.1, huggingface.co, opencode.ai, etc.)

À l'audit, les domaines observés sont :
- `http://127.0.0.1:14097` (llama-server)
- `http://127.0.0.1:14099` (opencode-cli)
- `https://huggingface.co`, `https://*.hf.co`
- `wss://` et `ws://` si streaming custom
- `ipc:` (Tauri internal)

### Étape 2 — Modifier le fichier

**Anchor** (exact) :
```json
    "security": {
      "csp": null
    }
```

**Remplacer par** :
```json
    "security": {
      "csp": "default-src 'self' ipc: https://tauri.localhost; connect-src 'self' ipc: http://127.0.0.1:* https://huggingface.co https://*.hf.co https://*.huggingface.co ws://127.0.0.1:* wss://127.0.0.1:*; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval'; font-src 'self' data:; object-src 'none'; frame-ancestors 'none'"
    }
```

**Points d'attention** :
- `'wasm-unsafe-eval'` nécessaire pour ghostty-vt.wasm (terminal) et tiktoken wasm.
- `ipc:` obligatoire pour Tauri 2.0 IPC.
- Si un test mobile fail après : lire la console WebView, chercher `Refused to connect to …` → ajouter le domaine à `connect-src`. **Ne pas** rebasculer sur `csp: null`.

### Étape 3 — Vérification

⚠️ **Le test complet nécessite un build Android (5+ min).** Avant de rebuild, vérifier :
```bash
cd d:/App/OpenCode/opencode/packages/mobile
bun run dev  # lance Vite dev server, charge la CSP
```
Ouvrir dans un browser (mobile en mode dev), ouvrir DevTools → Console → naviguer dans l'app → vérifier 0 violation CSP.

### Étape 4 — Commit
```
fix(A.10): strict CSP for mobile tauri.conf.json

- What: connect-src restricted to localhost + HuggingFace + Tauri IPC
- Why: csp:null allowed any XSS to reach Tauri commands (download_model etc.)
- Verify: app loads without CSP violations in DevTools Console

Audit: d:/App/OpenCode/opencode/AUDIT_REPORT.md#a10
```

---

## A.14 — Regex `QUANT_SUFFIX` ancrée

### Contexte
[packages/opencode/src/local-llm-server/index.ts:135](packages/opencode/src/local-llm-server/index.ts#L135) : regex avec `.*$` peut backtracker sur noms de fichiers tordus.

### Étape 1 — Anchor à chercher

```ts
const QUANT_SUFFIX = /[-_](q\d+(_[a-z0-9]+)?|iq\d+(_[a-z]+)?|f16|fp16|bf16|f32|fp32).*$/i
```

### Étape 2 — Remplacer par

```ts
const QUANT_SUFFIX = /[-_](q\d+(_[a-z0-9]+)?|iq\d+(_[a-z]+)?|f16|fp16|bf16|f32|fp32)\.gguf$/i
```

Changement unique : `.*$` → `\.gguf$`.

### Étape 3 — Vérifier qu'aucun appelant n'attend le comportement `.*$`

Grep : `QUANT_SUFFIX` — type: ts. Lire chaque occurrence, s'assurer que l'usage est un `.replace()` sur un nom de fichier terminé par `.gguf`. À l'audit, un seul appelant dans ce fichier.

### Étape 4 — Vérification + Commit
```bash
bun run typecheck
bun test packages/opencode/src/local-llm-server
```
Commit similaire aux précédents, référence `#a14`.

---

## A.15 — Supprimer le tokenizer inline dupliqué

### Contexte
[packages/opencode/src/session/llm.ts:171](packages/opencode/src/session/llm.ts#L171) redéfinit `estimateTokens = (text) => Math.ceil(text.length / 4)` inline. Duplicat de `Token.estimate`.

### Étape 1 — Anchor à chercher

```ts
    // Prompt profiler for local models
    if (input.model.providerID === "local-llm") {
      const estimateTokens = (text: string) => Math.ceil(text.length / 4)
      const systemTokens = estimateTokens(system.join("\n"))
      log.info("prompt profile", { systemTokens, model: input.model.api.id })
    }
```

### Étape 2 — Remplacer par

```ts
    // Prompt profiler for local models
    if (input.model.providerID === "local-llm") {
      const systemTokens = Token.count(system.join("\n"), input.model.id)
      log.info("prompt profile", { systemTokens, model: input.model.api.id })
    }
```

Vérifier que `Token` est déjà importé en haut du fichier (grep pour `from "@/util/token"` ou `from "../util/token"`). Sinon ajouter l'import.

### Étape 3 — Vérification + Commit

Typecheck, commit référence `#a15`.

---

## A.11 — Guards sur commandes Tauri

### Contexte
`download_model`, `load_llm_model`, `list_models` côté Rust n'ont pas de validation argument. Une XSS peut faire télécharger n'importe quelle URL vers le device.

### Étape 1 — Lire le code actuel

Ouvrir [packages/mobile/src-tauri/src/llm.rs](packages/mobile/src-tauri/src/llm.rs) — lire les signatures des `#[tauri::command]`.

### Étape 2 — Ajouter un module de validation

Créer [packages/mobile/src-tauri/src/validate.rs](packages/mobile/src-tauri/src/validate.rs) :

```rust
//! Input validation for Tauri commands exposed to the WebView.
//! Untrusted data (from a possible XSS) must not reach the filesystem or network unchecked.

use std::path::Path;

const ALLOWED_HOSTS: &[&str] = &[
    "huggingface.co",
    "hf.co",
    "cdn-lfs.huggingface.co",
    "cdn-lfs.hf.co",
];

pub fn validate_filename(name: &str) -> Result<&str, String> {
    if name.is_empty() || name.len() > 256 {
        return Err("filename length out of range".into());
    }
    if name.contains('/') || name.contains('\\') || name.contains("..") || name.contains('\0') {
        return Err("filename contains forbidden characters".into());
    }
    let p = Path::new(name);
    match p.extension().and_then(|e| e.to_str()) {
        Some("gguf") | Some("onnx") => Ok(name),
        _ => Err("unsupported file extension".into()),
    }
}

pub fn validate_url(url: &str) -> Result<&str, String> {
    let parsed = url::Url::parse(url).map_err(|e| format!("invalid url: {e}"))?;
    if parsed.scheme() != "https" {
        return Err("only https URLs allowed".into());
    }
    let host = parsed.host_str().ok_or("missing host")?;
    if !ALLOWED_HOSTS.iter().any(|h| host == *h || host.ends_with(&format!(".{h}"))) {
        return Err(format!("host not in allowlist: {host}"));
    }
    Ok(url)
}
```

Ajouter `url = "2"` à `[dependencies]` de [packages/mobile/src-tauri/Cargo.toml](packages/mobile/src-tauri/Cargo.toml) s'il n'y est pas.

Déclarer le module : dans [packages/mobile/src-tauri/src/lib.rs](packages/mobile/src-tauri/src/lib.rs), ajouter `mod validate;` aux autres `mod` en haut.

### Étape 3 — Appliquer les guards dans chaque commande

Dans [packages/mobile/src-tauri/src/llm.rs](packages/mobile/src-tauri/src/llm.rs), au début de chaque `#[tauri::command] pub async fn download_model(...)`, `load_llm_model(...)`, insérer :

```rust
crate::validate::validate_filename(&filename).map_err(|e| e.to_string())?;
// pour download_model:
crate::validate::validate_url(&url).map_err(|e| e.to_string())?;
```

### Étape 4 — Vérification
```bash
cd d:/App/OpenCode/opencode/packages/mobile/src-tauri
cargo check
```

Si `cargo check` échoue : lire l'erreur, fixer. Ne pas laisser d'avertissements `unused_imports` qui masqueraient un vrai problème.

### Étape 5 — Commit référence `#a11`.

---

## A.6 — AbortSignal dans Promise.all de setup

### Contexte
[packages/opencode/src/session/llm.ts:140-145](packages/opencode/src/session/llm.ts#L140-L145) : `Promise.all` ignore `input.abort`. Sur annulation utilisateur, les 4 promises continuent orphelines.

### Étape 1 — Anchor

```ts
    const [language, cfg, provider, auth] = await Promise.all([
      Provider.getLanguage(input.model),
      Config.get(),
      Provider.getProvider(input.model.providerID),
      Auth.get(input.model.providerID),
    ])
```

### Étape 2 — Encadrer avec un helper racing

Au début du fichier (sous les imports), ajouter :

```ts
function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("Aborted", "AbortError"))
    signal.addEventListener("abort", onAbort, { once: true })
    promise.then(
      (v) => { signal.removeEventListener("abort", onAbort); resolve(v) },
      (e) => { signal.removeEventListener("abort", onAbort); reject(e) },
    )
  })
}
```

### Étape 3 — Appliquer

Remplacer l'anchor par :
```ts
    const [language, cfg, provider, auth] = await raceAbort(
      Promise.all([
        Provider.getLanguage(input.model),
        Config.get(),
        Provider.getProvider(input.model.providerID),
        Auth.get(input.model.providerID),
      ]),
      input.abort,
    )
```

### Étape 4 — Vérification
Typecheck + test. Note : ça ne **cancel pas** les 4 promises sous-jacentes (elles continuent), mais on libère le `await` immédiatement. Pour une vraie cancellation il faudrait que chaque fonction accepte un signal → refactor plus large, out-of-scope A.6.

Commit référence `#a6`.

---

## A.8 — Circuit breaker pour `ensureCorrectModel`

### Contexte
[packages/opencode/src/local-llm-server/index.ts:508-554](packages/opencode/src/local-llm-server/index.ts#L508-L554) : peut boucler restart indéfiniment si détection mismatch persistante.

### Étape 1 — Ajouter l'état module-level

Après les autres variables module-level du fichier (chercher `_ownedChildPid` / `_currentModelID` / `_startPromise`), ajouter :

```ts
// Circuit breaker for model-mismatch restart loops.
// If more than MAX_RESTARTS happen within RESTART_WINDOW_MS, we stop
// and throw — preferable to burning cycles forever.
const RESTART_WINDOW_MS = 120_000
const MAX_RESTARTS = 3
let _restartTimestamps: number[] = []

function recordRestart(): void {
  const now = Date.now()
  _restartTimestamps = _restartTimestamps.filter((t) => now - t < RESTART_WINDOW_MS)
  _restartTimestamps.push(now)
}

function hasExceededRestartBudget(): boolean {
  const now = Date.now()
  _restartTimestamps = _restartTimestamps.filter((t) => now - t < RESTART_WINDOW_MS)
  return _restartTimestamps.length >= MAX_RESTARTS
}
```

### Étape 2 — Appliquer dans `ensureCorrectModel`

**Anchor à chercher** (avant la ligne de `log.warn("Loaded model mismatch …`) :
```ts
    if (loaded.toLowerCase() === expected.modelFile.toLowerCase()) return true

    log.warn("Loaded model mismatch — restarting", { loaded, expected: expected.modelFile })
```

**Remplacer par** :
```ts
    if (loaded.toLowerCase() === expected.modelFile.toLowerCase()) return true

    if (hasExceededRestartBudget()) {
      throw new Error(
        `llama-server restart loop detected (${MAX_RESTARTS} restarts in ${RESTART_WINDOW_MS}ms). ` +
        `Loaded="${loaded}" Expected="${expected.modelFile}". ` +
        `Check model file integrity or path resolution.`,
      )
    }
    recordRestart()
    log.warn("Loaded model mismatch — restarting", {
      loaded,
      expected: expected.modelFile,
      restartsInWindow: _restartTimestamps.length,
    })
```

### Étape 3 — Vérification

Typecheck + commit référence `#a8`. Pas de test runtime facile (nécessite un cas de mismatch forcé).

---

## A.12 — Relire `owner.childPid` avant chaque kill

### Contexte
[packages/opencode/src/local-llm-server/index.ts:480-537](packages/opencode/src/local-llm-server/index.ts#L480-L537) : `_ownedChildPid` module-level peut devenir stale si l'OS recycle le PID.

### Étape 1 — Identifier tous les `process.kill(` dans ce fichier

Grep `process.kill\(` dans `packages/opencode/src/local-llm-server/`. Probable : 3-4 sites.

### Étape 2 — Créer un helper sûr

Ajouter après les helpers existants :

```ts
/** Kills the child only if OWNER_FILE still names it. Safe against PID recycling. */
function safeKillChild(signal: NodeJS.Signals = "SIGKILL"): void {
  const owner = readOwner()
  if (!owner) return
  if (!isPidAlive(owner.childPid)) return
  try {
    process.kill(owner.childPid, signal)
  } catch {
    // already dead or permission lost
  }
}
```

### Étape 3 — Remplacer les appels directs

Pour chaque `process.kill(owner.childPid, "SIGKILL")` **où l'on ne vient pas juste de lire `owner` atomiquement**, remplacer par `safeKillChild("SIGKILL")`.

**NE PAS** remplacer aveuglément : si le code lit `owner` puis kill immédiatement (sans `await` au milieu), c'est safe. Remplacer seulement si plus d'un `await` sépare la lecture et le kill.

### Étape 4 — Vérification
Typecheck. Commit `#a12`.

---

## A.16 — Memo map pour `messageAgentColor`

### Contexte
[packages/app/src/utils/agent.ts:13-23](packages/app/src/utils/agent.ts#L13-L23) : `.find` dans boucle → O(n·m) potentiel.

### Étape 1 — Ajouter une surcharge acceptant une map

Dans [packages/app/src/utils/agent.ts](packages/app/src/utils/agent.ts), **garder** la fonction existante et ajouter :

```ts
export function buildAgentColorMap(agents: readonly { name: string; color?: string }[]): Map<string, string | undefined> {
  const m = new Map<string, string | undefined>()
  for (const a of agents) m.set(a.name, a.color)
  return m
}

export function messageAgentColorMemo(
  list: readonly { role: string; agent?: string }[] | undefined,
  colorMap: Map<string, string | undefined>,
): string | undefined {
  if (!list) return undefined
  for (let i = list.length - 1; i >= 0; i--) {
    const item = list[i]
    if (item.role !== "user" || !item.agent) continue
    return agentColor(item.agent, colorMap.get(item.agent))
  }
}
```

### Étape 2 — Migrer les appelants (différable)

Grep `messageAgentColor(` dans `packages/app/src/`. Pour chaque component qui recalcule la liste d'agents à chaque render : utiliser `createMemo(() => buildAgentColorMap(agents()))` côté SolidJS, passer la map à `messageAgentColorMemo`.

**Ne PAS** supprimer `messageAgentColor` original dans ce commit — laisser les appelants migrer progressivement.

### Étape 3 — Commit `#a16`.

---

## A.21 — AbortController pour HF search

### Contexte
[packages/app/src/components/dialog-local-llm.tsx:141-151](packages/app/src/components/dialog-local-llm.tsx#L141-L151) : debounce OK, mais pas d'abort. Résultats peuvent arriver dans le désordre.

### Étape 1 — Anchor

```ts
  let hfSearchTimeout: ReturnType<typeof setTimeout> | undefined

  function handleHfSearch(value: string) {
    setHfQuery(value)
    setHfError("")
    if (hfSearchTimeout) clearTimeout(hfSearchTimeout)
    if (!value.trim()) { setHfResults([]); return }
    hfSearchTimeout = setTimeout(async () => {
      setHfSearching(true)
      try {
        const results = await searchHuggingFace(value)
        setHfResults(results)
      } catch (e) {
        setHfError("Search failed. Check your connection.")
        setHfResults([])
      }
      setHfSearching(false)
    }, 400)
  }
```

### Étape 2 — Remplacer par

```ts
  let hfSearchTimeout: ReturnType<typeof setTimeout> | undefined
  let hfSearchAbort: AbortController | undefined

  function handleHfSearch(value: string) {
    setHfQuery(value)
    setHfError("")
    if (hfSearchTimeout) clearTimeout(hfSearchTimeout)
    if (hfSearchAbort) hfSearchAbort.abort()
    if (!value.trim()) { setHfResults([]); return }
    const ctrl = new AbortController()
    hfSearchAbort = ctrl
    hfSearchTimeout = setTimeout(async () => {
      setHfSearching(true)
      try {
        const results = await searchHuggingFace(value, ctrl.signal)
        if (!ctrl.signal.aborted) setHfResults(results)
      } catch (e: any) {
        if (e?.name === "AbortError") return
        setHfError("Search failed. Check your connection.")
        setHfResults([])
      } finally {
        if (!ctrl.signal.aborted) setHfSearching(false)
      }
    }, 400)
  }
```

### Étape 3 — Propager le signal à `searchHuggingFace`

Grep `function searchHuggingFace` ou `export.*searchHuggingFace` → ouvrir le fichier, ajouter un paramètre `signal?: AbortSignal`, le passer au `fetch(url, { signal })`. Si la fonction ne supporte pas le signal : la surcharger, ou ignorer le signal et se contenter du flag `ctrl.signal.aborted` dans le caller.

### Étape 4 — Cleanup sur unmount

Sous le bloc ci-dessus, chercher le `onCleanup` existant (ligne 164 environ). Étendre :
```ts
  onCleanup(() => {
    clearInterval(healthInterval)
    if (hfSearchTimeout) clearTimeout(hfSearchTimeout)
    if (hfSearchAbort) hfSearchAbort.abort()
  })
```

### Étape 5 — Typecheck + commit `#a21`.

---

## A.4 — Lifecycle Android onPause/onResume (complexe, 4-6 h)

### Contexte et cadre
⚠️ Ce fix touche Rust + TS + AndroidManifest. Il nécessite **un device physique** pour valider. **Ne pas** commencer sans avoir :
- Un Xiaomi ou Pixel connecté en USB debug.
- `adb logcat` opérationnel.
- Les précédentes étapes (A.1, A.2, A.10) commitées.

### Étape 1 — Lire l'existant

Fichiers à lire intégralement :
- [packages/mobile/src-tauri/src/lib.rs](packages/mobile/src-tauri/src/lib.rs)
- [packages/mobile/src-tauri/src/llm.rs](packages/mobile/src-tauri/src/llm.rs)
- [packages/mobile/src/entry.tsx](packages/mobile/src/entry.tsx)

Identifier où `spawn_llama_server` est appelé et où les signaux SIGTERM/SIGINT sont gérés.

### Étape 2 — Ajouter un hook `visibilitychange` côté JS

Dans [packages/mobile/src/entry.tsx](packages/mobile/src/entry.tsx), après l'initialisation de la plateforme, ajouter (emplacement exact : dans `FullApp` component, dans un nouveau `onMount`) :

```tsx
  onMount(() => {
    let wasHidden = false
    const handler = async () => {
      if (document.hidden) {
        wasHidden = true
        try { await invokeTauri("llm_idle_tick") } catch {}
      } else if (wasHidden) {
        wasHidden = false
        try {
          const ok = await invokeTauri<boolean>("check_llm_health", { port: null })
          if (!ok) {
            window.dispatchEvent(new CustomEvent("llm-needs-reload"))
          }
        } catch {}
      }
    }
    document.addEventListener("visibilitychange", handler)
    onCleanup(() => document.removeEventListener("visibilitychange", handler))
  })
```

### Étape 3 — Implémenter `llm_idle_tick` côté Rust

Dans [packages/mobile/src-tauri/src/llm.rs](packages/mobile/src-tauri/src/llm.rs), ajouter une commande :

```rust
#[tauri::command]
pub async fn llm_idle_tick() -> Result<(), String> {
    // No-op for now; placeholder that we can hook foreground-service keepalive into later.
    log::debug!("llm_idle_tick: app went background");
    Ok(())
}
```

Enregistrer la commande dans le `invoke_handler!` de [lib.rs](packages/mobile/src-tauri/src/lib.rs).

### Étape 4 — Binding foreground service (delta)

Cette partie nécessite du code Kotlin ou JNI. **Si non-trivial** : documenter dans un commit séparé « A.4-part1 » (les étapes 2-3 uniquement), créer un issue GitHub `A.4-part2: foreground service binding` et ne **pas** bloquer la chaîne de fixes sur cette partie.

### Étape 5 — Test sur device

```bash
cd d:/App/OpenCode/opencode/packages/mobile
export ORT_LIB_LOCATION="D:/tmp/ort-android"
bun tauri android dev
```
Sur le device : lancer un chat, charger un modèle local, appuyer Home, attendre 60 s, retour app. Observer `adb logcat | grep "llm_idle_tick\|PhantomProcessKiller"`.

**Succès** : modèle toujours chargé au retour, première réponse <2 s.
**Échec attendu si étape 4 skippée** : le phantom killer tue le sidecar, il faut l'étape 4.

### Étape 6 — Commit `#a4-part1`

---

## A.3 — Stream SSE drain (nécessite heap snapshot)

### Contexte
Suspect, pas confirmé. **Ne PAS** appliquer ce fix sans avoir d'abord mesuré.

### Étape 1 — Mesurer

1. Build desktop debug.
2. Ouvrir DevTools de la WebView (Tauri : `webview:context-menu` → Inspect, ou `WEBKIT_INSPECTOR=1`).
3. Performance → Memory → Heap snapshot. Nommer `baseline.heapsnapshot`.
4. Scénario : envoyer un message, l'interrompre à 50 %, répéter 50×.
5. Heap snapshot #2 : `after-50-aborts.heapsnapshot`.
6. Dans DevTools → Memory → Comparison. Chercher `ReadableStream`, `TransformStream`, `TextDecoder` retenus → si le delta est >50 instances entre les deux snapshots, la fuite est réelle.

### Étape 2 — Si confirmé, fix

Ajouter dans [packages/opencode/src/session/llm.ts:107-119](packages/opencode/src/session/llm.ts#L107-L119) :

```ts
                const ctrl = yield* Effect.acquireRelease(
                  Effect.sync(() => new AbortController()),
                  (ctrl) => Effect.sync(() => {
                    ctrl.abort()
                    // Drain any buffered chunks so the underlying reader is released.
                    // Non-blocking — we don't await; it's fire-and-forget cleanup.
                    ;(async () => {
                      try { for await (const _ of result.fullStream) break } catch {}
                    })()
                  }),
                )
```

⚠️ Problème : `result` n'est pas encore en scope à ce moment. Le fix nécessite peut-être une acquisition `Effect.acquireRelease` de `result` entier, pas seulement du signal. Si complexité > budget : documenter la mesure et créer un issue, ne pas committer un fix boiteux.

### Étape 3 — Si non confirmé

Ne pas committer de fix. Mettre à jour [AUDIT_REPORT.md](AUDIT_REPORT.md) pour marquer A.3 comme « invalidé par mesure 2026-XX-XX, hesh snapshot rule ». Progresser.

---

## A.5, A.9, A.17, A.18, A.19 — Fixes rapides groupés

Pour brièveté, voici les anchors et remplacements directs. Mêmes règles qu'au-dessus (typecheck, commit séparé par finding).

### A.5 — Ajouter flow runtime permissions
- Fichier nouveau : [packages/mobile/src-tauri/src/permissions.rs](packages/mobile/src-tauri/src/permissions.rs) avec commande `request_permissions(names: Vec<String>) -> Result<Vec<String>, String>`.
- Appel au boot dans `FullApp` entry : `await invoke("request_permissions", { names: ["POST_NOTIFICATIONS", "MANAGE_EXTERNAL_STORAGE"] })`.
- Implémentation JNI : utiliser le plugin `@tauri-apps/plugin-permissions` si disponible pour Tauri 2.4+, sinon écrire le JNI glue.
- **Si le plugin Tauri permissions n'est pas ready pour Android** : documenter blockage, ne pas forcer un fix cassé.

### A.9 — localStorage → plugin-store
- Installer `@tauri-apps/plugin-store` (probablement déjà présent).
- Grep `localStorage.setItem("opencode-` dans `packages/mobile/src/` → chaque occurrence : `await tauriStore.set(key, value); await tauriStore.save()`.
- Pour les données critiques (fingerprint TLS) : utiliser un store dédié `secure.json` scoped par user.
- **Ne PAS** migrer aveuglément si le store n'offre pas de chiffrement at-rest — documenter le gap.

### A.17 — Ring buffer stderr 16 KB + miroir
Fichier : [packages/opencode/src/local-llm-server/index.ts:55](packages/opencode/src/local-llm-server/index.ts#L55). Anchor `const STDERR_BUFFER_SIZE = 4096`. Remplacer par `16384`.

Pour le miroir fichier (plus de travail) : créer un helper qui écrit `fs.appendFileSync(logPath, chunk)` en parallèle du ring buffer. Path `path.join(runtimeDir, "logs", \`llama-stderr-${pid}.log\`)`. Rotation : à l'ouverture, si >5 fichiers dans logs/, supprimer le plus vieux.

### A.18 — Backoff health poll
Fichier [packages/app/src/components/dialog-local-llm.tsx:155-164](packages/app/src/components/dialog-local-llm.tsx#L155-L164). Remplacer `setInterval(..., 5000)` par une fonction récursive :
```ts
  let healthDelay = 5000
  const pollHealth = async () => {
    const ok = await invokeTauri("check_llm_health", { port: null }).catch(() => false)
    setHealthy(ok)
    healthDelay = ok ? Math.min(healthDelay * 2, 60000) : 5000
    healthTimeoutId = setTimeout(pollHealth, healthDelay)
  }
  let healthTimeoutId: ReturnType<typeof setTimeout>
  onMount(() => { pollHealth() })
  onCleanup(() => { if (healthTimeoutId) clearTimeout(healthTimeoutId) })
```

### A.19 — Deep-link dual scheme cleanup
[packages/mobile/src-tauri/tauri.conf.json:44-49](packages/mobile/src-tauri/tauri.conf.json#L44-L49) : **si** l'utilisateur ne contrôle pas `opencode.ai/.well-known/assetlinks.json`, retirer l'intent-filter `https` du manifeste généré. Pour l'instant, documenter uniquement dans [ANDROID_AUDIT.md](ANDROID_AUDIT.md), **ne pas** modifier le fichier auto-généré (il sera régénéré).

---

## Vérification globale (après chaque phase)

```bash
cd d:/App/OpenCode/opencode
bun run typecheck                              # 0 errors
cd packages/opencode && bun test                # passes
cd ../mobile/src-tauri && cargo check           # 0 errors
cd ../desktop/src-tauri && cargo check          # 0 errors
```

Si une de ces étapes fail après un fix — **rollback le fix spécifique**, diagnostiquer, recommencer. Ne pas empiler les fixes sur une base cassée.

---

## Ressources

- Audit : [AUDIT_REPORT.md](AUDIT_REPORT.md)
- Perf : [PERFORMANCE_REPORT.md](PERFORMANCE_REPORT.md)
- Android : [ANDROID_AUDIT.md](ANDROID_AUDIT.md)
- Règles : [CLAUDE.md](CLAUDE.md)
- Roadmap : `D:/Documents/Obsidian/IA_Dev_Brain/OpenCode/Plan Directeur — Roadmap OpenCode (7 Chantiers).md` → **Chantier 8**

---

## Template de progression

Après chaque finding traité, mettre à jour `KNOWN_ISSUES.md` : déplacer l'entrée de « Bugs critiques non encore corrigés » vers un nouveau `CHANGELOG.md` avec la date et le SHA du commit.

---

**Dernière mise à jour** : 2026-04-17.
