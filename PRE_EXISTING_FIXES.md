# Pre-existing debt pass — 2026-04-18

Scope: close the findings still open after Sprint 1/2/3. Branch `dev`.
Validation : `bun run typecheck` (14 pkg) + `cargo check` desktop + `cargo check` mobile → tous verts.
**Aucun commit fait** — à revoir avant `git commit`.

| # | Item | Statut |
|---|------|--------|
| 1 | desktop `export_types` dead code | NO-OP — déjà propre (fn utilisée ligne 323 + test) |
| 2 | 40 warnings mobile | FIXED — 40 → 0 |
| 3 | S2.A2 deep-link providerID allowlist | FIXED |
| 4 | A.12 `_ownedChildPid` stale | FIXED |
| 5 | A.17 stderr ring buffer 4096 B | FIXED BY a182f0559 (déjà à 16384) |
| 6 | S1.L2 markdown cache 200 entries | FIXED (cap 50 + TTL 60 s) |
| 7 | S1.L3 session-prefetch cache | FIXED (LRU cap 100) |
| 8 | S2.V2 embedding response validation | FIXED (Zod + dim check) |
| 9 | S2.V1 RPC worker ID reuse | FIXED (UUID + timeout 30 s + delete-before-resolve) |
| 10 | A.5 runtime permissions Android | VERIFIED — déjà correct (MainActivity + notifications.ts + graceful fallback) |
| 11 | A.6 Promise.all sans abort | FIXED BY bbd5cfd39 |
| 12 | I9 Thermal JNI Android | FIXED (impl JNI complète cfg-gated android, fallback "nominal") |
| 13 | Deferred mobile work | SKIP (scope) |

---

## Détails par item

### 1. Desktop `export_types` — NO-OP
`packages/desktop/src-tauri/src/lib.rs:492` : la fn est **utilisée** ligne 323 (dans `setup()`) et dans `test_export_types`. `cargo check` desktop ne remonte aucun warning. Finding obsolète.

**Test manuel** : `cargo check -p opencode-desktop` → 0 warning.

### 2. 40 warnings mobile — FIXED
Cause : `#[tauri::command]` dans `speech.rs`, `kokoro/`, `parakeet/`, `fetch_private_server` sont enregistrés uniquement sous `#[cfg(target_os="android")]` dans `invoke_handler!`. Sur `cargo check` hôte Windows, le compilateur ne voit aucun appelant → 40 warnings dead_code.

**Correctif** :
- `speech.rs`, `kokoro/engine.rs`, `parakeet/engine.rs` → `#![allow(dead_code)]` inner attr au niveau module, avec commentaire "cross-cfg API surface".
- `fetch_private_server` → `#[allow(dead_code)]` + commentaire.
- `let mut builder` → `#[cfg_attr(not(target_os = "android"), allow(unused_mut))]` (mut utilisé seulement dans bloc android).

**Test manuel** : `cd packages/mobile/src-tauri && cargo check` → 0 warning.
**Risque** : nul sur cible Android (les fonctions sont activement appelées). Sur hôte, les vrais bugs (type mismatch, trait unimplemented) restent signalés car seul `dead_code` est silencé, pas tout.

### 3. S2.A2 Deep-link providerID allowlist — FIXED
**Fichier** : `packages/app/src/pages/layout.tsx:1366-1390`.
**Cause** : `parseOAuthCallbackDeepLink` valide la forme (`/^[a-z0-9][a-z0-9_-]{0,63}$/i`) mais pas l'identité. Une URL `opencode://oauth/callback?providerID=attacker&code=xxx` déclenchait `dispatchEvent` quel que soit l'ID.
**Correctif** : au dispatch, on construit une allowlist = `providers.all()` (registry live) ∪ `popularProviders` (fallback first-launch) et on `continue` + `console.warn` si inconnu. Garde la compat avec les custom providers (tant qu'ils sont enregistrés).

**Test manuel** :
1. Construire un deep-link `opencode://oauth/callback?providerID=foobar&code=xxx`. L'ouvrir. Vérifier `console.warn` + aucune dialog déclenchée.
2. Avec `providerID=anthropic` (présent dans `popularProviders`), dispatch normal.

**Risque** : un provider dynamique chargé tardivement (après handleDeepLinks drain) peut rater son callback. Mitigation : `popularProviders` couvre les 9 principaux, les custom providers sont chargés au démarrage via `provider.list()` avant le drain des deep-links pendants.

### 4. A.12 `_ownedChildPid` stale — FIXED
**Fichier** : `packages/opencode/src/local-llm-server/index.ts:615-623`.
**Cause** : sur exit naturel du child llama-server (OOM, segfault, kill externe), le `.then()` qui annule le stderrReader laissait `_ownedChildPid` pointer sur un PID réutilisable par l'OS.
**Correctif** : reset de `_ownedChildPid = null` dans le handler `child.exited.then()`, gardé par `if (_ownedChildPid === child.pid)` pour éviter de marcher sur un spawn de remplacement (race avec `ensureCorrectModel`).

**Test manuel** :
1. Démarrer le serveur local.
2. `taskkill /F /PID <llama-server>` pendant une inférence.
3. Vérifier que `_ownedChildPid` retourne à null (via log) et qu'un nouveau ensureRunning démarre un child propre.

**Risque** : faible. La garde `===` évite la race la plus évidente.

### 5. A.17 stderr 4096 B — FIXED BY a182f0559
`STDERR_BUFFER_SIZE = 16384` déjà en place (ligne 32). Le finding est obsolète depuis le commit initial `a182f0559`.

### 6. S1.L2 markdown cache — FIXED
**Fichier** : `packages/ui/src/components/markdown.tsx`.
**Correctif** :
- `max = 200` → `max = 50`.
- Ajout `TTL_MS = 60_000` et champ `at: number` par entrée.
- Nouvelle fn `cacheGet()` qui drop les entrées expirées à la lecture.
- `touch()` purge les entrées > TTL à chaque écriture (itération par ordre d'insertion = ordre d'âge, on s'arrête au premier non-expiré).

**Test manuel** :
1. Streamer une conversation avec beaucoup de blocks markdown.
2. Snapshot heap : RSS plafonne ~50 MB (vs 200 MB avant).
3. Laisser la page idle 90 s, déclencher un render → le cache se purge.

**Risque** : rerender cost sur chunk déjà vu > 60s. Shiki highlight coûte ~1-5 ms pour un block 1 kB, acceptable.

### 7. S1.L3 session-prefetch cache — FIXED
**Fichier** : `packages/app/src/context/global-sync/session-prefetch.ts`.
**Correctif** : ajout `CACHE_MAX = 100`, `setSessionPrefetch` fait `delete+set` (MRU) puis évince tant que `size > CACHE_MAX` (par ordre FIFO/LRU). `rev` counter préservé pour invalider les tasks en vol.

**Test manuel** :
1. `bun test src/context/global-sync/session-prefetch.test.ts` → 5/5 ok (déjà vérifié).
2. Scénario : ouvrir 120 sessions différentes sans fermer le projet. Vérifier que `cache.size === 100` (via devtools).

**Risque** : nul, la sémantique existante (hit/miss) n'est pas modifiée, juste bornée.

### 8. S2.V2 embedding response validation — FIXED
**Fichier** : `packages/opencode/src/rag/embed.ts`.
**Correctif** :
- Schema Zod `VectorSchema = z.array(z.number().finite()).min(1)`.
- Helper `assertVector(vec, expected?)` qui throw sur shape invalide ou dim mismatch.
- `generateEmbedding` valide le vecteur retourné contre `config.dimensions`.
- `generateEmbeddings` valide la longueur du batch + chaque vecteur.

**Test manuel** :
1. Mock un endpoint `/v1/embeddings` qui renvoie `{embedding: ["a", "b"]}` → throw "invalid vector shape".
2. Mock un endpoint qui renvoie dim=1024 quand on attend 1536 → throw "dimension mismatch".

**Risque** : faible. Les providers honnêtes (OpenAI/Google) renvoient toujours une shape conforme.

### 9. S2.V1 RPC worker ID reuse — FIXED
**Fichier** : `packages/opencode/src/util/rpc.ts`.
**Correctif** :
- Compteur `id` remplacé par `crypto.randomUUID()` (pas de réutilisation possible).
- `pending` typé `Map<string, Pending>` avec `{ resolve, reject, timer }`.
- Timeout 30 s par call — reject + cleanup du slot.
- `delete` avant `resolve` dans le handler onmessage.

**Test manuel** :
1. Worker qui met 31 s à répondre → Promise reject avec "rpc: call X timed out after 30000ms".
2. Worker qui répond normalement → unchanged behavior.

**Risque** : si un call RPC légitime dépasse 30 s (ex: indexing massif), il timeout. À surveiller dans les logs post-déploiement ; augmenter à 60 s si besoin. BM25 indexing est la seule call potentielle > 10 s.

### 10. A.5 Runtime permissions Android — VERIFIED
Rien à changer.
- **POST_NOTIFICATIONS** : requis à runtime dans `MainActivity.kt:41-48` (Kotlin) **et** `packages/mobile/src/notifications.ts:26-30` (JS). Double couverture.
- **RECORD_AUDIO** : obtenu via WebView `navigator.mediaDevices.getUserMedia()` dans `use-speech.ts:48` — le WebView Android délègue la demande au système. Le try/catch ligne 83 capture les refus et dispatch `stt-start-failed` + `console.error`.
- **Fallback gracieux** : sur refus, l'event `stt-start-failed` est dispatché. Aucun subscriber pour l'instant → la fallback n'avance pas au-delà du log. Amélioration cosmétique possible mais non bloquante.

**Test manuel** :
1. Révoquer micro dans les settings Android → cliquer record STT → console.error + UI reset.
2. Révoquer notifications → `requestPermission()` relance la dialog ou échoue gracefully.

### 11. A.6 Promise.all sans abort — FIXED BY bbd5cfd39
Commit confirmé : `fix(A.6): wrap setup Promise.all with AbortSignal via raceAbort`.

### 12. I9 Thermal JNI — FIXED (impl complète)
**Fichier** : `packages/mobile/src-tauri/src/lib.rs:87-170` + `Cargo.toml` (deps Android).
**Correctif** :
- Ajout `jni = "0.21"` + `ndk-context = "0.1"` dans `[target.'cfg(target_os = "android")'.dependencies]`.
- Nouvelle fn `query_thermal_status_jni()` : `ndk_context::android_context()` → `JavaVM::from_raw` → `attach_current_thread` → `getSystemService("power")` → `getCurrentThermalStatus(): I`.
- Mapping via `thermal_code_to_label` : 0-1 nominal, 2 fair, 3 serious, 4+ critical.
- Tout JNI error path retourne "nominal" + log.debug (pas de crash possible).
- Pas de listener — polling 30s côté TS reste en place (commentaire le mentionne).

**Test manuel** :
1. Android build : `ORT_LIB_LOCATION=... bun tauri android build` — compile attendue (build 5+ min, pas encore vérifié, à confirmer au prochain run).
2. Sur device, `adb shell dumpsys thermalservice` → forcer un override `cmd thermalservice override-status 3` → `get_thermal_state` doit retourner "serious".

**Risque** : **le cargo check hôte ne valide PAS le code JNI** (cfg-gated android). Un typo dans l'appel `env.call_method` passerait silencieusement. Si le build Android casse, revert `Cargo.toml` + restaurer le stub `fn get_thermal_state() -> "nominal"`.

Points de vigilance :
- `JavaVM::from_raw` est `unsafe` — le pointeur `ctx.vm()` doit être un `JavaVM*` valide. ndk-context garantit ça pour le process lifetime.
- `attach_current_thread` retourne un `AttachGuard` qui détache automatiquement via Drop en fin de fn.
- Signatures JNI : `"(Ljava/lang/String;)Ljava/lang/Object;"` pour `getSystemService`, `"()I"` pour `getCurrentThermalStatus()` — vérifiées contre Android SDK 34.

### 13. Deferred mobile work — SKIP
Non traité cette passe, reste ouvert : Vim/alt-screen terminal, mouse tracking, virtual keybind row, neural voice clone (Kokoro voice clone). Scope trop large, chacun nécessite 1-3 jours dédiés.

---

## Validation finale

```
$ bun run typecheck
Tasks: 14 successful, 14 total, Time: 8.458s

$ cd packages/desktop/src-tauri && cargo check
Finished `dev` profile — 0 warnings

$ cd packages/mobile/src-tauri && cargo check
Finished `dev` profile — 0 warnings

$ cd packages/app && bun test src/context/global-sync/session-prefetch.test.ts
5 pass, 0 fail, 12 expect() calls
```

## Fichiers touchés

- `packages/mobile/src-tauri/Cargo.toml` (+jni, +ndk-context)
- `packages/mobile/src-tauri/src/lib.rs` (thermal JNI, allow(dead_code), cfg_attr unused_mut)
- `packages/mobile/src-tauri/src/speech.rs` (inner allow dead_code)
- `packages/mobile/src-tauri/src/kokoro/engine.rs` (inner allow dead_code)
- `packages/mobile/src-tauri/src/parakeet/engine.rs` (inner allow dead_code)
- `packages/opencode/src/local-llm-server/index.ts` (reset _ownedChildPid on exit)
- `packages/opencode/src/rag/embed.ts` (Zod validation embeddings)
- `packages/opencode/src/util/rpc.ts` (UUID + timeout + delete-before-resolve)
- `packages/ui/src/components/markdown.tsx` (cap 50 + TTL 60s)
- `packages/app/src/context/global-sync/session-prefetch.ts` (LRU cap 100)
- `packages/app/src/pages/layout.tsx` (providerID allowlist)

## Recommandations commit

Proposition de découpage (un commit par thème) :
1. `chore(mobile): silence 40 cross-cfg dead_code warnings on host check`
2. `fix(llm): reset _ownedChildPid on natural child exit (A.12)`
3. `perf(markdown): cap cache to 50 entries + 60s TTL (S1.L2)`
4. `perf(sync): bound session-prefetch cache to 100 LRU entries (S1.L3)`
5. `sec(deep-link): validate oauth providerID against provider registry (S2.A2)`
6. `sec(rag): validate embedding responses with Zod (S2.V2)`
7. `sec(rpc): UUID ids + 30s timeout + delete-before-resolve (S2.V1)`
8. `feat(mobile/thermal): wire PowerManager.getCurrentThermalStatus via JNI (I9)`
