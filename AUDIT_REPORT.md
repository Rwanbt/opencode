# AUDIT CRITIQUE — OpenCode Fork (2026-04-17)

> Audit indépendant du fork OpenCode (agent IA local+cloud, Bun/SolidJS/Tauri 2.0, cible Android+Desktop).
> Méthode : exploration en profondeur + lecture directe des zones critiques + vérification des findings.
> Objectif : bugs subtils, logique algorithmique, gestion tokens/ressources, réactivité Android.

**Résumé exécutif**

| Sévérité | Nombre | Thèmes dominants |
|---|---|---|
| CRITIQUE | 4 | Tokenizer approximatif, reasoning budget capé, stream cleanup, lifecycle Android |
| HAUTE | 6 | AbortSignal, runtime permissions Android, secrets, restart loop, cast `any`, CSP |
| MOYENNE | 5 | Race PID stale, tauri commands unguarded, JSON parse, regex, duplications tokenizer |
| BASSE | 5 | Buffer stderr, poll fréquent, ASSETLINKS, plugin deep-link, messageAgentColor |

Chaque finding indique : statut de vérification (✅ vérifié, ⚠️ supposé, 🔎 à confirmer au runtime), sévérité, fichier:ligne, description, impact, piste de correction.

---

## CRITIQUE

### A.1 — Tokenizer naïf `length / 4` partout ✅
- **Fichier** : [packages/opencode/src/util/token.ts:2-5](packages/opencode/src/util/token.ts#L2-L5), dupliqué inline à [packages/opencode/src/session/llm.ts:171](packages/opencode/src/session/llm.ts#L171)
- **Observé** : `CHARS_PER_TOKEN = 4`, retourne `Math.round(length/4)`. Utilisé dans [compaction.ts:135](packages/opencode/src/session/compaction.ts#L135) pour décider quelle `tool part` compacter.
- **Impact** :
  - Erreurs réelles ±20-40 % selon tokenizer (BPE Qwen/Llama, SentencePiece Gemma, tiktoken OpenAI).
  - Sur les « tool outputs » texte (code, logs, JSON), les chars denses en tokens donnent une sous-estimation ; sur du texte naturel, une surestimation. **Résultat : pruning trop agressif ou trop tardif**, budget reasoning mal calibré, overflow context surprise.
  - La duplication inline à `llm.ts:171` (profiler local-llm) retourne une valeur en `Math.ceil` au lieu de `Math.round` — deux définitions cohabitent.
- **Fix** :
  1. `js-tiktoken` pour OpenAI/Anthropic, encoder mis en cache par `model.id`.
  2. Pour local-llm : utiliser l'endpoint `POST /tokenize` de llama-server (gratuit, exact).
  3. Fallback heuristique **par famille** : `4.0` (OAI/Claude), `3.5` (Qwen/Llama BPE), `5.0` (Gemma).
  4. Supprimer la fonction dupliquée `estimateTokens` dans `llm.ts:171` et appeler `Token.estimate`.

### A.2 — Reasoning budget hard-capé à 1024 ✅
- **Fichier** : [packages/opencode/src/session/llm.ts:62](packages/opencode/src/session/llm.ts#L62)
- **Observé** : `reasoningBudget = Math.min(Math.max(128, maxTokens*0.1), 1024)`. Utilisé en [llm.ts:381](packages/opencode/src/session/llm.ts#L381) via `providerOptions[local-llm].reasoning_budget`.
- **Impact** : Qwen3-Thinking, DeepSeek-R1, Gemma3-Thinking produisent couramment 2-8 K tokens de `<thinking>`. Le cap coupe silencieusement sur les problèmes complexes (debug, raisonnement math, planification). L'utilisateur paye la VRAM et la latence sans bénéficier de la profondeur du raisonnement. **Impact direct sur la qualité perçue de l'agent.**
- **Fix** :
  ```ts
  const THINKING_CAP_BY_FAMILY = {
    qwen: 8192, deepseek: 8192, gemma: 6144, default: 4096,
  }
  const family = detectFamily(model.id) // "qwen-3-32b-thinking" -> "qwen"
  const cap = THINKING_CAP_BY_FAMILY[family] ?? THINKING_CAP_BY_FAMILY.default
  const reasoningBudget = Math.min(Math.max(128, Math.floor(maxTokens * 0.15)), cap)
  ```
  Fraction montée à 15 % du budget output car le thinking est prioritaire sur le texte final pour ces modèles.

### A.3 — Cleanup stream SSE sur abort potentiellement incomplet 🔎
- **Fichier** : [packages/opencode/src/session/llm.ts:107-119](packages/opencode/src/session/llm.ts#L107-L119) (wrapper Effect), `streamText` ligne [331](packages/opencode/src/session/llm.ts#L331).
- **Observé** : `Effect.acquireRelease(new AbortController(), ctrl => ctrl.abort())` libère le signal, mais le `result.fullStream` (AsyncIterable du SDK Vercel AI) n'est pas explicitement drainé. En théorie le SDK ferme le fetch sous-jacent via signal, mais le `ReadableStream` lecteur côté `Stream.fromAsyncIterable` peut rester accroché à des chunks en flight.
- **Impact** (supposé, à mesurer) : sur Android après des centaines de cycles « tapez/effacez un message », memory footprint WebView peut croître → ralentissement puis OOM.
- **Fix** : dans le release, drainer défensivement :
  ```ts
  (ctrl) => Effect.sync(() => {
    ctrl.abort()
    // Drain any buffered chunks to release reader
    ;(async () => { try { for await (const _ of result.fullStream) break } catch {} })()
  })
  ```
  Mais **à confirmer avec un heap snapshot avant/après** avant de committer.

### A.4 — Lifecycle `llama-server` Android `onPause`/`onDestroy` incomplet ⚠️
- **Fichier** : [packages/mobile/src-tauri/src/lib.rs](packages/mobile/src-tauri/src/lib.rs), pas de hook visible sur `AppHandle` pour `Activity` lifecycle.
- **Contexte positif** : le manifeste [AndroidManifest.xml:78-85](packages/mobile/src-tauri/gen/android/app/src/main/AndroidManifest.xml#L78-L85) déclare déjà un `service .LlamaService` avec `foregroundServiceType="specialUse"` et `PROPERTY_SPECIAL_USE_FGS_SUBTYPE` — le pattern est en place.
- **Observé** : le cleanup Rust/TS réagit à `SIGTERM`/`SIGINT` + `atexit` ([local-llm-server/index.ts:262-281](packages/opencode/src/local-llm-server/index.ts#L262-L281)) mais :
  1. Rien ne prouve que `.LlamaService` est démarré au bon moment (avant spawn du sidecar) et arrêté au bon moment.
  2. Pas de hook JS `onPause` pour signaler une pause "chaude" (garde le modèle en VRAM, ferme les connexions).
- **Impact** : sur Android 12+ avec `.LlamaService` pas binding, le phantom process killer peut tuer le child llama-server ~20 s après bascule en background → reconnexion lente au retour.
- **Fix** :
  1. Côté Rust : binder `.LlamaService` avant `spawn` via `startForegroundService` (implémenter le plugin si absent).
  2. Côté JS : écouter `document.visibilitychange` ; sur `hidden` → `invoke("llm_idle_tick")` qui garde le FG service vivant mais peut abaisser la priorité. Au retour, `invoke("llm_resume_ping")` vérifie `isHealthy()`.
  3. Instrumenter : logguer PID llama-server à chaque transition et corréler avec `adb logcat | grep PhantomProcessKiller`.

---

## HAUTE

### A.5 — Runtime permission request Android manquante ⚠️
- **Contexte positif** : [AndroidManifest.xml:3-13](packages/mobile/src-tauri/gen/android/app/src/main/AndroidManifest.xml#L3-L13) déclare correctement `INTERNET`, `READ/WRITE/MANAGE_EXTERNAL_STORAGE`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_SPECIAL_USE`, `POST_NOTIFICATIONS`. Le manifeste n'est **pas** le bug.
- **Observé** : aucune trace côté Rust/TS d'un appel à `requestPermissions(["android.permission.POST_NOTIFICATIONS", …])` ou `Environment.isExternalStorageManager()`. Sur Android 13+, `POST_NOTIFICATIONS` et `MANAGE_EXTERNAL_STORAGE` nécessitent une demande dynamique via dialog système.
- **Impact** : le foreground service ne peut pas afficher de notification (crash silencieux ou sans feedback) ; accès au stockage scoped échoue. Utilisateur voit « modèle non chargé » sans explication.
- **Fix** : ajouter un flow `requestPermissions()` au premier lancement via un plugin Tauri dédié ou `@tauri-apps/plugin-notification`. UI de fallback explicite si refusé.

### A.6 — `Promise.all` sans propagation d'AbortSignal ✅
- **Fichier** : [packages/opencode/src/session/llm.ts:140-145](packages/opencode/src/session/llm.ts#L140-L145)
- **Observé** : `Promise.all([Provider.getLanguage, Config.get, Provider.getProvider, Auth.get])` — aucune des 4 n'accepte `input.abort`.
- **Impact** : sur abort utilisateur pendant le setup (rare mais réel, surtout sur mobile lent), les 4 continuations s'exécutent jusqu'au bout, gardent des refs en mémoire, lancent des log/telemetry. Sur 50 requêtes annulées en rafale → 200 continuations orphelines.
- **Fix** : wrapper `withSignal(signal, promise)` qui rejette avec `AbortError` si signal, chaque fetch lit le signal.

### A.7 — Cast `as any` sur window events mobile ✅
- **Fichier** : [packages/mobile/src/entry.tsx:318-319](packages/mobile/src/entry.tsx#L318-L319)
- **Observé** :
  ```ts
  window.addEventListener("model-selected" as any, handler as any)
  onCleanup(() => window.removeEventListener("model-selected" as any, handler as any))
  ```
- **Observé post-vérif** : `onMount` + `onCleanup` sont bien appariés (ligne 306-310 et 313-320), donc pas de leak à chaque mount. **Requalifié : faiblesse de typage et non bug fonctionnel**. Mais si à l'avenir le component est démonté pendant un `load_llm_model`, le handler n'est plus atteint et l'event est muet.
- **Fix** : typer correctement :
  ```ts
  interface ModelSelectedDetail { providerID: string; modelID: string }
  declare global {
    interface WindowEventMap { "model-selected": CustomEvent<ModelSelectedDetail> }
  }
  ```
  Puis supprimer les casts. Bonus : centraliser via un event-bus Solid (`createEventBus` de solid-primitives) plutôt que `window`.

### A.8 — `ensureCorrectModel` — pas de circuit breaker ✅
- **Fichier** : [packages/opencode/src/local-llm-server/index.ts:508-554](packages/opencode/src/local-llm-server/index.ts#L508-L554)
- **Observé** : si `getLoadedModel()` retourne un nom qui ne matche **jamais** `expected.modelFile.toLowerCase()` (par ex. bug de normalisation GGUF path, ou serveur retourne un alias différent), chaque appel provoquera un kill + restart → boucle infinie de 10 s cycle.
- **Impact** : VRAM churn, inference impossible, batterie Android drain.
- **Fix** : ajouter `let restartCount = 0` module-level, après 3 restarts dans 2 min → `throw` avec message clair au lieu de tenter à nouveau. Reset du compteur après 2 min sans mismatch.

### A.9 — Secrets sensibles en `localStorage` (mobile) ✅
- **Fichier** : [packages/mobile/src/entry.tsx:119-120](packages/mobile/src/entry.tsx#L119-L120), [packages/mobile/src/hooks/use-auto-start-llm.ts:58](packages/mobile/src/hooks/use-auto-start-llm.ts#L58)
- **Observé** : `localStorage.getItem("opencode-model-config")` — JSON en clair. `setPrivateServerFp(fp)` via deep-link stocke potentiellement le fingerprint TLS dans un store non chiffré. Sur Android, toute WebView partagée ou dump de données app (`adb backup`) expose ces données.
- **Impact** : fuite de pairing TLS fingerprint (fingerprinting cross-device) + config modèles (profilage VRAM disponible). Non critique seul, mais cumulatif.
- **Fix** : migrer vers `@tauri-apps/plugin-store` avec chiffrement AES-GCM (dérivé Android Keystore), ou `EncryptedSharedPreferences` exposé via un plugin Rust.

### A.10 — CSP `null` dans `tauri.conf.json` mobile ✅
- **Fichier** : [packages/mobile/src-tauri/tauri.conf.json:22-24](packages/mobile/src-tauri/tauri.conf.json#L22-L24)
- **Observé** : `"security": { "csp": null }`.
- **Impact** : toute XSS (via chat message non échappé, tool output HTML injecté, image markdown malicieuse) peut exécuter du JS arbitraire avec accès à **toutes** les commandes Tauri (incluant `list_models`, `download_model`, `load_llm_model`). C'est la voie la plus courte vers RCE depuis un chat malformé.
- **Fix** :
  ```json
  "security": {
    "csp": "default-src 'self'; connect-src 'self' http://127.0.0.1:* https: wss: ws:; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; frame-ancestors 'none'"
  }
  ```
  Ajuster `connect-src` au minimum selon les endpoints réellement utilisés.

---

## MOYENNE

### A.11 — Commandes Tauri sans guard argument ⚠️
- **Fichier** : `packages/mobile/src-tauri/src/*.rs` — commandes `list_models`, `download_model`, `load_llm_model`.
- **Fix** : valider côté Rust : `filename` doit matcher `^[A-Za-z0-9._-]+\.gguf$`, `url` HTTPS only, `drafter` même règle. Ajouter un allowlist de domaines (`huggingface.co`, `modelscope.cn`, etc.).

### A.12 — `_ownedChildPid` module-level peut devenir stale ✅
- **Fichier** : [packages/opencode/src/local-llm-server/index.ts:480-537](packages/opencode/src/local-llm-server/index.ts#L480-L537)
- **Observé** : bien géré dans `ensureCorrectModel` (ligne 531-537 : invalide avant kill). Dans le catch de `spawnAndWait` (ligne 490), le kill est fait mais `_ownedChildPid = null` ligne 495 vient après le kill. Si ce PID était déjà recyclé par l'OS, `process.kill(child.pid, "SIGKILL")` est no-op bénin, mais si l'OS a assigné le même PID à un process léger entre-temps, risque (très faible) de kill innocent.
- **Fix** : relire `readOwner()` avant chaque kill, vérifier `isPidAlive(owner.childPid)` + vérifier que le processus est bien `llama-server` (lecture `/proc/{pid}/cmdline` ou équivalent Win/mac).

### A.13 — `JSON.parse(localStorage)` try/catch partiel ✅
- **Fichier** : [packages/mobile/src/hooks/use-auto-start-llm.ts:56-70](packages/mobile/src/hooks/use-auto-start-llm.ts#L56-L70) — OK (try/catch en place).
- **Fichiers à auditer** : tous les autres `JSON.parse(localStorage.getItem(...))` dans `packages/app` et `packages/mobile`.
- **Fix** : introduire un helper unique `safeParse<T>(raw, fallback): T`, remplacer toutes les occurrences.

### A.14 — Regex `QUANT_SUFFIX` — `.*$` backtracking ✅
- **Fichier** : [packages/opencode/src/local-llm-server/index.ts:135](packages/opencode/src/local-llm-server/index.ts#L135)
- **Fix** : ancrer strictement :
  ```ts
  const QUANT_SUFFIX = /[-_](q\d+(_[a-z0-9]+)?|iq\d+(_[a-z]+)?|f(p)?(16|32)|bf16)\.gguf$/i
  ```

### A.15 — Duplication tokenizer inline `llm.ts:171` ✅
- **Fichier** : [packages/opencode/src/session/llm.ts:171](packages/opencode/src/session/llm.ts#L171)
- **Fix** : supprimer, remplacer par `Token.estimate`.

### A.16 — `messageAgentColor` boucle backwards avec `.find` interne ✅
- **Fichier** : [packages/app/src/utils/agent.ts:13-23](packages/app/src/utils/agent.ts#L13-L23)
- **Observé** : `list.length` × `agents.find` → O(n·m) si appelé par message dans un rendu. En pratique la boucle break au premier `user` agent trouvé, donc le cas moyen est O(1) ou O(k) où k est la position du dernier user.
- **Fix** : construire une `Map<agentName, color>` depuis `agents` hors du render, passer cette map à `messageAgentColor`.

---

## BASSE

### A.17 — Ring buffer stderr 4096 B tronque stack traces llama-server ✅
- **Fichier** : [packages/opencode/src/local-llm-server/index.ts:55-71](packages/opencode/src/local-llm-server/index.ts#L55-L71)
- **Fix** : `STDERR_BUFFER_SIZE = 16384` + miroir fichier rotatif `~/.opencode/logs/llama-stderr-{pid}.log` (rotation 3 fichiers × 1 MB).

### A.18 — Polling health 5 s permanent ✅
- **Fichier** : [packages/app/src/components/dialog-local-llm.tsx:157-160](packages/app/src/components/dialog-local-llm.tsx#L157-L160)
- **Observé** : `onCleanup(clearInterval)` en place ligne 164. Le poll ne fuit pas, mais consomme inutilement quand l'utilisateur laisse le dialog ouvert en arrière-plan.
- **Fix** : backoff exponentiel après 3 checks OK consécutifs (5 s → 10 s → 30 s → 60 s), reset à 5 s si jamais `ok === false`.

### A.19 — Deep-link : `scheme: ["opencode"]` plugin ≠ manifest double intent-filter ✅
- **Fichiers** : [packages/mobile/src-tauri/tauri.conf.json:44-49](packages/mobile/src-tauri/tauri.conf.json#L44-L49) vs [AndroidManifest.xml:40-61](packages/mobile/src-tauri/gen/android/app/src/main/AndroidManifest.xml#L40-L61)
- **Observé** : la config plugin ne déclare que `opencode`. Le manifest contient **deux** intent-filters (1) `https://opencode.ai/mobile` auto-verify, (2) `opencode://`.
- **Impact** : l'auto-verify `https` nécessite `.well-known/assetlinks.json` hébergé sur `opencode.ai` (pas sûr qu'il existe côté fork). Si pas en place, l'app n'attrape pas les liens https et ouvre le navigateur.
- **Fix** : soit ajouter `"https"` à la config plugin si assetlinks.json est publié, soit retirer l'intent-filter https du manifest (il est auto-généré par le plugin si scheme contient https).

### A.20 — ASSETLINKS.json probablement absent côté `opencode.ai` 🔎
- Dépendance du finding A.19.
- **Fix** : publier ou forker le domaine de redirection pour le QR-pairing.

---

## Faux-positifs requalifiés après vérification

Ces points, initialement suspectés critiques par l'exploration automatique, ont été **reclassés ou invalidés** après lecture directe :

| Finding initial | Verdict après lecture | Fichier |
|---|---|---|
| « Compaction coupe au milieu d'un tool_use / thinking » | **Faux** — la boucle `compaction.ts:124-143` opère **part-wise**, elle marque entièrement les `tool parts` complètes comme compactées. Pas de coupe intra-part. | [compaction.ts:124-143](packages/opencode/src/session/compaction.ts#L124-L143) |
| « AndroidManifest manque `MANAGE_EXTERNAL_STORAGE` et permissions foreground » | **Faux** — tout est déclaré ligne 3-13. Le vrai gap est la demande **runtime** (voir A.5). | [AndroidManifest.xml:3-13](packages/mobile/src-tauri/gen/android/app/src/main/AndroidManifest.xml#L3-L13) |
| « `catch {}` silencieux partout dans hooks mobile » | **Partiel** — le catch principal ligne 50 a bien un `console.error`. Seul le catch de fallback config ligne 68 est silencieux (volontaire, documenté). | [use-auto-start-llm.ts](packages/mobile/src/hooks/use-auto-start-llm.ts) |
| « HF search : race ordre des résultats » | **Valide mais mineur** — debounce 400 ms en place ligne 141. Pas d'`AbortController` → si saisie rapide, anciennes requêtes peuvent gagner la course. Reclassé BASSE, voir A.21. | [dialog-local-llm.tsx:136-152](packages/app/src/components/dialog-local-llm.tsx#L136-L152) |
| « Double-spawn concurrent llama-server » | **Atténué** — `_startPromise` + re-check post-lock sont en place. Risque résiduel = A.12 (PID stale). | [local-llm-server/index.ts:567-626](packages/opencode/src/local-llm-server/index.ts#L567-L626) |

### A.21 — HF search sans AbortController (complément) ✅
- **Fichier** : [packages/app/src/components/dialog-local-llm.tsx:141-151](packages/app/src/components/dialog-local-llm.tsx#L141-L151)
- **Fix** : capture un `AbortController` par frappe, abort le précédent.

---

## Checklist de vérification des fixes (post-implémentation)

À chaque fix, exécuter :

```bash
cd d:/App/OpenCode/opencode/packages/opencode
bun run typecheck
bun test
```

Pour A.1 : ajouter un test `token.estimate` vs `llama-server/tokenize` sur 10 prompts représentatifs → écart <5 %.
Pour A.2 : test `session/llm.ts` avec `model.id = "qwen-3-32b-thinking"` → `reasoningBudget >= 4096`.
Pour A.4 : tester manuellement sur Android (Xiaomi Redmi 10 et Pixel 7) : chat en cours, appui home, attente 60 s, retour app → modèle toujours chargé.
Pour A.10 : tester qu'une URL markdown `![](javascript:alert(1))` dans un message n'exécute rien.

---

## Aucun bug bloquant de sécurité immédiat détecté

Pas de SQL injection, pas de XSS évidente (hors CSP null), pas de path traversal flagrant, pas de deserialization unsafe. Les findings sont dominés par la **gestion des ressources** et la **précision algorithmique** — ce qui est cohérent avec l'objectif "outil réellement utile pour travailler".

---

**Auteur** : Claude Opus 4.7 (audit 2026-04-17), sous directives de @barat.erwan.
**Prochaine étape recommandée** : traiter A.1 + A.2 en premier (impact immédiat sur la qualité des réponses), puis A.4 (réactivité Android).
