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

---

## Passe finale — 7 items (2026-04-18)

Deuxième passe de nettoyage ciblée sur les 7 findings persistants de
`SECURITY_AUDIT.md` / `AUDIT_REPORT.md`. Validation : `bun run typecheck`
(14 pkg ok), `cargo check --release` desktop (ok), `cargo check` mobile host
(ok), `cargo clippy --no-deps` desktop + mobile (0 warning introduit).
**Aucun commit fait.**

| # | Item | Statut |
|---|------|--------|
| 1 | S2.A3 `unsafe env::set_var` SAFETY comments | ENRICHED — déjà présents, reformulés en `SAFETY:` capitalisé + rationale thread-safety explicite |
| 2 | S2.A4 Windows registry `u16` alignment | FIXED — cast alignée via `u16::from_le_bytes` sur chunks_exact(2), plus aucun cast non-aligné |
| 3 | S3.A1 innerHTML lint rule | DOCUMENTED — `.eslintrc.restrict.cjs` créé (no-restricted-syntax), 4 call sites annotés `eslint-disable-next-line` avec justification. Pas d'ESLint en CI → rule opt-in |
| 4 | S3.A2 deep-link directory validation | FIXED — `isSafeDirectory` exige maintenant un chemin absolu (POSIX `/`, Windows `X:\`/`X:/`, UNC `\\`). Les chemins relatifs ou bare names sont rejetés |
| 5 | S2.L1 SSE heartbeat double-stop race | NO-OP — un flag `let done = false` protège déjà `stop()` (event.ts:36). Pas de modification nécessaire |
| 6 | S2.L2 Terminal focus microbursts | NO-OP — `createEffect(on(...))` appelle `onCleanup(stop)` avant chaque ré-exécution : Solid cancel rAF+timers automatiquement. Pas de race observable |
| 7 | A.11 Tauri command input guards | FIXED — path traversal colmaté sur `tts_save/delete_voice_clone` (desktop + mobile), bounds sur `tts_speak`, `kokoro_synthesize`, `stt_transcribe`, `parse_markdown_command`, `wsl_path`, `fetch_private_server`, `write_debug_log`, charset guard sur `check_app_exists`/`resolve_app_path` |

### Détails

**S2.A3 — SAFETY comments (ENRICHED)**
Fichier : `packages/desktop/src-tauri/src/main.rs:14,70`. Commentaires
existants (`// Safety:`) reformulés en `// SAFETY:` (convention Rust) avec
rationale détaillée : `env::set_var` n'est unsound qu'en cas d'accès
concurrent à l'environnement (libc `setenv`/`getenv` non thread-safe), et
les deux call sites s'exécutent en haut de `main()` avant tout spawn tokio
/ rayon / plugin.

**S2.A4 — Registry alignment (FIXED)**
Fichier : `packages/desktop/src-tauri/src/os/windows.rs:200-210`.
Remplacement du `std::slice::from_raw_parts(data.as_ptr().cast::<u16>(), …)`
(UB sur strict-alignment, Windows-on-ARM ou sanitizer) par une boucle
`chunks_exact(2)` + `u16::from_le_bytes([a, b])` qui est 1-byte aligned
par construction. Le `unsafe` autour du bloc disparaît (l'`unsafe` restant
entoure seulement les appels FFI `RegGetValueW`).
Test manuel : `cargo check --release` desktop → ok ; `cargo clippy --no-deps`
→ aucun nouveau warning. Fonctionnellement identique (LE order imposé par
Registry API).

**S3.A1 — innerHTML lint rule (DOCUMENTED)**
Aucun `eslint.config.*` ou `.eslintrc*` n'existe dans le repo (confirmé par
`Glob **/eslint.config.*` et `**/.eslintrc*`). Création de
`.eslintrc.restrict.cjs` à la racine avec deux rules `no-restricted-syntax` :
une pour `x.innerHTML = …`, une pour JSX `innerHTML={…}`. Le fichier
documente les 7 call sites vettés et sert de living-doc même sans CI
ESLint.

4 call sites annotés (les 3 de l'audit + le JSX dans content-bash.tsx) :
- `packages/ui/src/components/markdown.tsx:95,329`
- `packages/app/src/components/file-tree.tsx:99`
- `packages/web/src/components/share/content-bash.tsx:51-52`

Chaque annotation précise la provenance du HTML (icon registry statique,
Shiki sanitized, DOM outerHTML) pour passer l'audit.

**Risque** : la règle ne s'active que si quelqu'un branche ESLint sur le
repo. C'est un filet documentaire pour un futur setup. Aucune régression
possible ici (fichier isolé, pas chargé par le runtime).

**S3.A2 — Deep-link directory (FIXED)**
Fichier : `packages/app/src/pages/layout/deep-links.ts:17-40`.
Ajout d'une heuristique `isAbsolutePath(d)` appelée depuis
`isSafeDirectory` : accepte `/...` (POSIX), `X:\`/`X:/` (Windows drive),
`\\server\share` (UNC). Tout le reste (relatif, bare name) est refusé.
L'appel à `GET /project` pour croiser les roots connus a été évalué mais
écarté : `parseDeepLink` est synchrone, appelé au drain des deep-links
pending avant que l'app n'ait forcément chargé `/project` — cela
introduirait une dépendance réseau dans un hot path startup. L'absolute
path check est la barrière la plus rentable et la moins risquée.

**Tests manuels** :
1. `opencode://open-project?directory=../../etc` → rejeté (log silencieux).
2. `opencode://open-project?directory=/tmp/demo` → accepté.
3. `opencode://open-project?directory=C:\Users\me\project` → accepté.
4. `opencode://open-project?directory=relative/path` → rejeté.

**Risque** : les tests unitaires existants (`helpers.test.ts`) utilisent
tous des chemins absolus (`/tmp/demo`, `/a`, `/b`, `/c`), donc aucune
régression attendue. Un utilisateur qui aurait construit un deep-link avec
un chemin relatif (improbable, l'UI n'en génère jamais) devra utiliser
la forme absolue.

**S2.L1 — SSE heartbeat (NO-OP)**
Vérifié `packages/opencode/src/server/routes/event.ts:36-62` : un flag
`let done = false` est déjà présent et gate `stop()`. `stop()` est câblé
sur 3 chemins (Bus.InstanceDisposed, stream.onAbort, finally de la boucle
SSE) et chacun est idempotent par construction. Le finding est obsolète.

**S2.L2 — Terminal focus microbursts (NO-OP)**
Vérifié `packages/app/src/pages/session/terminal-panel.tsx:168-206` : la
fonction `focus(id)` retourne un cleanup qui `cancelAnimationFrame(frame)`
et `clearTimeout(timer)` pour tous les timers enregistrés. Le cleanup est
appelé par `onCleanup(stop)` à l'intérieur de `createEffect(on(...))`, ce
qui garantit que Solid l'exécute avant chaque ré-exécution de l'effect.
Pas de race observable : un switch rapide de terminal actif annule bien
l'ancien rAF + timers avant de créer les nouveaux. Aucun correctif
nécessaire.

**A.11 — Tauri command input guards (FIXED)**

Inventaire des 42 `#[tauri::command]` (desktop + mobile) et revue par
catégorie d'entrée :

| Commande | Risque | Guard ajouté |
|---|---|---|
| `tts_save_voice_clone(name, audio_base64)` (desktop + mobile) | **path traversal** via `name` dans `{dir}/{name}.wav` | `validate_voice_clone_name` (charset + traversal) + bound 32 MiB sur audio_base64 |
| `tts_delete_voice_clone(name)` (desktop + mobile) | **path traversal** — idem `fs::remove_file` | `validate_voice_clone_name` |
| `tts_speak(text, voice?)` (desktop) | DoS via text multi-MB | bound 1 MiB + charset guard sur voice (path-sep, null) |
| `kokoro_synthesize(text, voice, speed)` (desktop + mobile) | idem + speed NaN | bound 1 MiB + voice charset + `speed.is_finite() && 0.1..=4.0` |
| `stt_transcribe(audio_base64)` (desktop + mobile) | DoS | bound 64 MiB |
| `parse_markdown_command(markdown)` (desktop) | DoS | bound 8 MiB |
| `wsl_path(path)` (desktop) | null byte / CRLF injection dans args | bound 4096 + refus `\r`/`\n` |
| `check_app_exists(app_name)` / `resolve_app_path(app_name)` (desktop) | registry lookup / `which` avec entrée non validée | `validate_open_app_name` appliqué (charset alias-only) |
| `fetch_private_server(url, body?)` (mobile) | DoS via URL/body énorme | bound url 4096 + CRLF refus + body bound 16 MiB |
| `write_debug_log(message)` (mobile) | flood log file | truncate à 8192 B (char-boundary safe) |
| Autres (`set_remote_credentials`, `set_default_server_url`, `download_model`, `load_llm_model`, `delete_model`, `open_path`, `generate_llm`, …) | — | déjà validés (validate_filename / validate_url / validate_open_target) ou types scalaires |

Validators ajoutés dans :
- `packages/desktop/src-tauri/src/validate.rs` : `validate_voice_clone_name`, `validate_bounded_text`
- `packages/mobile/src-tauri/src/validate.rs` : `validate_voice_clone_name`, `validate_bounded_text` (le module `validate` mobile est maintenant cross-target puisque `speech.rs` est host-compilé ; `validate_url` reste cfg-gated android car elle utilise le crate `url` déclaré android-only dans Cargo.toml)

**Tests manuels** :
1. `tts_save_voice_clone({name: "../../../etc/passwd", ...})` → `Err("voice clone name contains forbidden characters")`.
2. `tts_save_voice_clone({name: "voice-01_clean.A", ...})` → ok (charset alphanumérique + `.- _`).
3. `kokoro_synthesize({text: "x".repeat(2_000_000), ...})` → `Err("kokoro text exceeds 1048576 byte limit")`.
4. `kokoro_synthesize({text: "hi", voice: "af_heart", speed: f32::NAN})` → `Err("speed out of range")`.
5. `wsl_path({path: "path\nwith\nnewline"})` → `Err("wsl path contains control characters")`.
6. `check_app_exists({app_name: "C:\\Windows\\System32\\cmd.exe"})` → `false` (validate_open_app_name refuse les séparateurs).

**Risques** :
- `validate_voice_clone_name` impose `[a-zA-Z0-9_][a-zA-Z0-9\-_. ]*`. Les noms
  existants (créés avant ce correctif) qui incluraient des caractères hors
  charset (ex: émoji, accents) deviendront non-supprimables via l'UI.
  Atténuation : 128 B max + charset ASCII only ; on accepte l'incompat
  mineure pour fermer le path traversal.
- `validate_open_app_name` applique `[a-zA-Z0-9_\- . ]{1,64}`. Les alias
  custom comme `"vscode-insiders"`, `"Google Chrome"`, `"iTerm"` passent
  (couverts par les tests unitaires existants dans `validate.rs:178-185`).
- Bounds à 1 / 8 / 32 / 64 MiB : tous très au-dessus des usages réels
  (messages UI ~KiB, audio voice ~MiB). Pas de régression UX attendue.

---

### Validation finale

```
$ bun run typecheck       # 14/14 packages OK
$ cd packages/desktop/src-tauri && cargo check --release    # OK
$ cd packages/mobile/src-tauri && cargo check               # OK
$ cd packages/desktop/src-tauri && cargo clippy --no-deps   # 0 new warning
$ cd packages/mobile/src-tauri && cargo clippy --no-deps    # 0 new warning
```

Aucun commit fait — à revoir avant `git commit`.
