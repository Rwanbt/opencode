# Android Development — OpenCode Mobile

> Guide pratique pour développer, builder et déboguer l'app mobile.
> Dernière mise à jour : 2026-06-20.

---

## 1. Prérequis

- **Android SDK** : Platform 34 minimum. Commandes : `sdkmanager "platforms;android-34" "build-tools;34.0.0"`.
- **NDK** : r26b minimum (stocké par défaut dans `~/android-ndk`).
- **Rust** : `rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android i686-linux-android`.
- **Bun** : 1.3.11 minimum.
- **Keystore** de signing : `~/.keystores/opencode.keystore` (développement) ou secret CI.

---

## 2. Variables d'environnement requises

Avant tout `tauri android build`, définir :

```bash
# NDK toolchain
export NDK_HOME="$HOME/android-ndk"          # Linux/Mac
# export NDK_HOME="D:/android-ndk"           # Windows — adapter au chemin réel

export ANDROID_NDK_HOME="$NDK_HOME"

# ONNX Runtime for Android — binaires externes
export ORT_LIB_LOCATION="$HOME/ort-android"  # Linux/Mac
# export ORT_LIB_LOCATION="D:/tmp/ort-android" # Windows
# Doit contenir : libs/arm64-v8a/libonnxruntime.so, etc.

# Keystore — chemin absolu vers le keystore de signing
export ANDROID_KEYSTORE_PATH="$HOME/.keystores/opencode.keystore"

# Signing (build release)
export ANDROID_KEY_ALIAS="opencode"
export ANDROID_KEY_PASSWORD="..."
export ANDROID_STORE_PASSWORD="..."
```

### Config Cargo machine-spécifique

`packages/mobile/src-tauri/.cargo/config.toml` est **gitignored** — à créer localement :

```toml
# .cargo/config.toml — NE PAS committer (chemins machine-spécifiques)
[env]
ANDROID_NDK_HOME = "/home/user/android-ndk"  # adapter

[target.aarch64-linux-android]
linker = "/home/user/android-ndk/toolchains/llvm/prebuilt/linux-x86_64/bin/aarch64-linux-android35-clang"

[target.x86_64-linux-android]
linker = "/home/user/android-ndk/toolchains/llvm/prebuilt/linux-x86_64/bin/x86_64-linux-android35-clang"
```

> **Windows** : utiliser des chemins avec `/` (pas `\`) dans `.cargo/config.toml` — Cargo les supporte sur toutes les plateformes.

> **Dual-boot** : si tu alternes Windows/Linux sur la même machine, garde deux copies de `.cargo/config.toml` (`.cargo/config.toml.win` / `.cargo/config.toml.linux`) et symlinke la bonne avant de builder. Les paths ORT changent aussi.

---

## 3. Commandes principales

```bash
cd d:/App/OpenCode/opencode/packages/mobile

# Développement avec hot reload
bun tauri android dev

# Build APK debug
bun tauri android build --debug

# Build AAB release (Play Store)
bun tauri android build --aab --target aarch64

# Build APK release aarch64 uniquement (recommandé — voir note ci-dessous)
bun tauri android build --apk --target aarch64
```

> **Multi-target** : `--target armv7` échoue si `ORT_LIB_LOCATION` ne contient que des libs `arm64-v8a` (libonnxruntime.so est aarch64-only dans la distribution officielle). Toujours passer `--target aarch64` en premier ; ajouter les autres targets seulement si les `.so` correspondants sont présents.

**Note** : les builds Android prennent **5+ minutes**. Toujours vérifier le code rigoureusement avant de lancer un build (règle projet CLAUDE.md).

---

## 4. Debug ADB

```bash
# Installer l'APK
adb install -r app-debug.apk

# Logs filtrés
adb logcat | grep -i "opencode\|tauri\|llama"

# Logs crash natifs (Rust panics)
adb logcat | grep -i "rust_panic\|SIGSEGV\|CHECK failed"

# Phantom process killer (pertinent pour A.4 audit)
adb logcat | grep -i "PhantomProcessKiller\|killing process"

# Mémoire de l'app
adb shell dumpsys meminfo ai.opencode.mobile
```

### MIUI / Xiaomi — input bloqué

Les Xiaomi bloquent `adb shell input` par défaut. Activer :
- **Options développeur** → **Debug USB (Security settings)** → activer.
- Sans ça, pas de test automatisé possible.

---

## 5. Permissions runtime

**Implémenté.** Le manifeste déclare `MANAGE_EXTERNAL_STORAGE`, `POST_NOTIFICATIONS`, etc.
Les demandes runtime sont gérées nativement en Kotlin, sans commande Tauri :

| Permission | Implémentation | Référence code |
|---|---|---|
| `POST_NOTIFICATIONS` (Android 13+) | `ActivityCompat.requestPermissions()` au démarrage | `MainActivity.kt:51-61` |
| `MANAGE_EXTERNAL_STORAGE` | `ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION` via Intent | `MainActivity.kt:174-214` |
| `READ_MEDIA_*` (Android 13+) | Idem, batch avec storage perms | `MainActivity.kt:174-214` |

Côté TypeScript, les **notifications** passent par `platform.notify()` (`packages/mobile/src/platform.ts:226-238`),
qui vérifie `isPermissionGranted()` / `requestPermission()` avant l'envoi. Il n'y a pas de commande
Tauri `request_permissions` — les dialogs système sont ouverts directement par l'Activity.

**UX — diagnostics** : l'onglet "Android" dans Settings (`components/settings-android.tsx`) affiche
l'état de stockage, mémoire RAM, thermique et batterie. Pour ouvrir manuellement les permissions :
```ts
// settings-android.tsx — bouton "Ouvrir Paramètres"
await open("content://com.android.settings.application.APP_STORAGE_SETTINGS")
// fallback si intent échoue : ouvre support.google.com
```

> **Note** : `MANAGE_EXTERNAL_STORAGE` déclenche un avertissement Play Store (politique de
> données sensibles). Pour une publication publique, préférer SAF (`Intent.ACTION_OPEN_DOCUMENT_TREE`)
> et ne demander `MANAGE_EXTERNAL_STORAGE` que si le modèle GGUF réside hors du dossier scoped.

---

## 6. Lifecycle Android

**Implémenté.** Le cycle de vie est géré à deux niveaux.

### 6.1 Niveau TypeScript — `entry.tsx`

| Événement | Handler | Référence code |
|---|---|---|
| App passe en arrière-plan | `invoke("llm_idle_tick")` — signal Rust pour baisser la priorité LLM | `entry.tsx:197-218` |
| App revient au premier plan | `invoke("check_llm_health", { port: null })` — `null` = port par défaut 14097 ; si faux, dispatch `llm-needs-reload` | `entry.tsx:197-218` |
| Keyboard IME ouverte | `visualViewport.resize` → `--vvh` CSS var → évite le layout sous le clavier | `entry.tsx:220-249` |
| Deep-link reçu (cold-start) | `getCurrentDeepLink()` → `handleDeepLink()` | `entry.tsx:288-307` |
| Deep-link reçu (warm-start) | `onOpenUrl()` listener → `handleDeepLink()` | `entry.tsx:288-307` |

```ts
// Extrait simplifié — voir entry.tsx pour le code complet
let wasHidden = false
document.addEventListener("visibilitychange", async () => {
  if (document.hidden) {
    wasHidden = true
    try { await invoke("llm_idle_tick") } catch {}
  } else if (wasHidden) {
    wasHidden = false
    // port: null = laisser Rust utiliser le port LLM configuré (14097 par défaut)
    const ok = await invoke<boolean>("check_llm_health", { port: null })
    if (!ok) window.dispatchEvent(new CustomEvent("llm-needs-reload"))
  }
})
```

> **`RunEvent::Exit` ≠ background** : en Tauri, `RunEvent::Exit` se déclenche quand le processus se **termine** (utilisateur ferme l'app ou système la tue), pas quand elle passe en arrière-plan. L'arrière-plan est géré par `onStop` Kotlin (§6.2) + `visibilitychange` JS. Ne pas confondre les deux pour la gestion du LLM.

### 6.2 Niveau Kotlin — `MainActivity.kt`

| Callback | Action | Référence code |
|---|---|---|
| `onCreate` | Démarre `LlamaService` (FG), demande permissions, init PTY, charge dernier modèle | `MainActivity.kt:23-172` |
| `onStart` | Re-promeut `LlamaService` en foreground | `MainActivity.kt:216-221` |
| `onStop` | Dégrade `LlamaService` si pas d'inférence en cours (économie batterie) | `MainActivity.kt:223-233` |
| `onResume` | Détecte All-Files-Access OFF→ON et re-spawn PTY pour rafraîchir FUSE | `MainActivity.kt:235-276` |

### 6.3 Notifications — `NotificationBridge`

`NotificationBridge` (`packages/mobile/src/notifications.ts`) s'abonne au stream SSE du serveur
et envoie des notifications natives quand l'app est en arrière-plan. Il est instancié dans `FullApp`
(`entry.tsx`) dès que la connexion est établie.

```
SSE /event ──▶ NotificationBridge.handleMessage()
                    │
                    ├─ session.updated {completed} ──▶ sendNotification("Task Complete")
                    ├─ session.updated {failed}    ──▶ sendNotification("Task Failed")
                    └─ llm.status {loaded}         ──▶ sendNotification("Model Ready")
```

La permission `POST_NOTIFICATIONS` est demandée au démarrage par `MainActivity.kt:51-61`
(Android 13+) et vérifiée par le plugin JS avant tout envoi.

### 6.4 Deep-link étendu

Trois commandes reconnues par `handleDeepLink()` dans `entry.tsx` :

| URL | Action |
|---|---|
| `opencode://connect?url=...&user=...&pwd=...&fp=...` | Pré-remplit le formulaire Remote mode (QR code desktop) |
| `opencode://open?file=<path>&project=<dir>` | Dispatch `ide-open-file` CustomEvent → IDE panel |
| `opencode://session?id=<sessionId>` | Dispatch `navigate-to-session` CustomEvent → navigation session |

Les deep-links `open` et `session` sont gérés quand l'app est déjà en mode `ready` (warm-start
via `onOpenUrl`) ou dès le démarrage (cold-start via `getCurrentDeepLink`).

> **Intent filter** : le schéma `opencode://` est déclaré dans `tauri.conf.json`
> (plugin `deep-link`, section `mobile`) et généré dans `AndroidManifest.xml` par Tauri.

---

## 7. llama-server sur Android

**Runtime** : `llama-server` compilé pour `aarch64-linux-android` avec OpenCL/Vulkan. Binaire dans `packages/mobile/src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a/`.

**Lancement via JNI** :
1. `MainActivity.onCreate` → bind `.LlamaService` (foreground).
2. Service → `Process.Builder("llama-server", ...).start()` avec les bons env vars (`LLAMA_OPENCL_PLATFORM=0`, etc.).
3. Sidecar TS se connecte via `http://127.0.0.1:14097` (même loopback, WebView et service partagent le stack TCP local).

**Ports** : `14097` pour llama-server, `14099` pour opencode-cli (définis dans `runtime/server.rs` — ne pas changer sans mettre à jour les deux côtés).

**Model storage** : `/sdcard/Android/data/ai.opencode.mobile/files/models/*.gguf` (scoped storage).

---

## 8. Benchmarks Android

Voir [../PERFORMANCE_REPORT.md §3](../PERFORMANCE_REPORT.md) pour la suite complète. Spécifique Android :

```bash
# Cold start via maestro
maestro test bench/android-cold-start.yaml

# Tokens/s soutenu (nécessite adb shell loopback au serveur local)
adb forward tcp:14097 tcp:14097
curl -X POST http://127.0.0.1:14097/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"local","messages":[{"role":"user","content":"..."}],"stream":true}'
```

---

## 9. Signing et distribution

- **Debug** : auto-signed par Tauri, pas de config nécessaire.
- **Release APK/AAB** : nécessite `gen/android/app/keystore.properties` (gitignored) :

```properties
keyAlias=opencode
keyPassword=${ANDROID_KEY_PASSWORD}
storePassword=${ANDROID_STORE_PASSWORD}
# Chemin absolu vers le keystore (machine-spécifique)
storeFile=/home/user/.keystores/opencode.keystore
# Windows : storeFile=C:/Users/user/.keystores/opencode.keystore
```

> **Attention aux chemins** : `gen/android/app/keystore.properties` est régénéré par `tauri android init`. Mettre ce fichier dans `.gitignore` local (il l'est déjà) et le recréer après chaque `tauri android init`. `storeFile` doit être un **chemin absolu** (évite les ambiguïtés selon le dossier de lancement Gradle).

---

## 10. Pièges fréquents

| Symptôme | Cause probable | Remède |
|---|---|---|
| App crash au lancement Android 14 | Permission runtime manquante | Vérifier `MainActivity.kt:51-61` (POST_NOTIFICATIONS) ; ouvrir les permissions via l'onglet Android dans Settings |
| llama-server se relance tout le temps | `ensureCorrectModel` loop (audit A.8) | Vérifier alias modèle, ajouter cooldown |
| Deep-link `opencode://...` ouvre le navigateur | `assetlinks.json` manquant sur `opencode.ai` | Voir [../ANDROID_AUDIT.md §3](../ANDROID_AUDIT.md) |
| Inference lente après pause 2 min | Phantom process killer (A.4) | Implémenter `.LlamaService` binding |
| Config LLM perdue au redémarrage | `localStorage` effacé par Android si low-mem | Migrer vers Tauri Store |
| `ORT_LIB_LOCATION` not found | Env var non définie avant build | Voir §2 ci-dessus |
| Xiaomi : `adb shell input` ne fait rien | MIUI security settings | §4 ci-dessus |

---

## 11. OTA — Mise à jour des modèles

Les modèles GGUF sont indépendants des mises à jour de l'app. Workflow recommandé :

1. **Stockage scoped** : `/sdcard/Android/data/ai.opencode.mobile/files/models/` (pas de permission MANAGE_EXTERNAL_STORAGE requise pour ce chemin).
2. **Téléchargement** : via l'UI "Modèles" de l'app (download manager intégré) ou `adb push model.gguf /sdcard/Android/data/ai.opencode.mobile/files/models/`.
3. **Hot-swap** : changer de modèle dans les settings déclenche un restart de llama-server (pas de restart d'app nécessaire).
4. **Vérification** : après le swap, `check_llm_health` (port 14097) valide que le serveur répond avant de continuer.
5. **Rollback** : garder le modèle précédent sur le device ; re-sélectionner dans les settings.

> **Quantization** : les modèles K-quants (Q4_K_M, Q5_K_M…) ne sont pas compatibles OpenCL Adreno. Sur Adreno 6xx et antérieur, utiliser Q4_0 ou Q8_0 ; sur Adreno 7xx+ (SM8450+), OpenCL 3.0 supporte Q4_0. Le routing automatique est géré par `LlamaEngine.kt`.

---

## 12. CI — Intégration continue

> **Prérequis** : secrets GitHub `ANDROID_KEYSTORE_B64`, `ANDROID_KEY_PASSWORD`, `ANDROID_STORE_PASSWORD`, `ANDROID_KEY_ALIAS` configurés.

### Jobs recommandés

**Job PR** (bloquant, déclenché sur chaque push) :
```yaml
# .github/workflows/android.yml — extrait
- name: Build APK debug
  run: |
    cd packages/mobile
    bun tauri android build --debug --target aarch64
  env:
    NDK_HOME: ${{ steps.setup-ndk.outputs.ndk-path }}
    ORT_LIB_LOCATION: ${{ runner.tool_cache }}/ort-android

- name: Rust tests (host + proxy)
  run: cargo test -p opencode --features host-tests
```

**Job nightly** (non bloquant, AAB release signé) :
```yaml
- name: Build AAB release
  run: bun tauri android build --aab --target aarch64
  env:
    ANDROID_KEYSTORE_PATH: ${{ runner.temp }}/opencode.keystore
    ANDROID_KEY_ALIAS: ${{ secrets.ANDROID_KEY_ALIAS }}
    ANDROID_KEY_PASSWORD: ${{ secrets.ANDROID_KEY_PASSWORD }}
    ANDROID_STORE_PASSWORD: ${{ secrets.ANDROID_STORE_PASSWORD }}
```

### Cache agressif

```yaml
- uses: actions/cache@v4
  with:
    path: |
      ~/.cargo/registry
      ~/.cargo/git
      packages/mobile/src-tauri/target
      ~/.gradle/caches
      ~/.gradle/wrapper
    key: android-${{ runner.os }}-${{ hashFiles('**/Cargo.lock', '**/gradle/wrapper/gradle-wrapper.properties') }}
```

### Limites actuelles

- Zéro test émulateur (6-8 semaines d'effort pour setup CI Avd + ORT headless) — voir Phase 0 roadmap.
- `cargo test --target aarch64-linux-android` requiert un émulateur ou un device branché en adb — non disponible en CI standard.
- Tests Maestro (UI) : planifié, non implémenté.

---

## 13. Stratégie QA

### Niveaux de test

| Niveau | Outillage | Fréquence | État |
|---|---|---|---|
| Tests unitaires Rust (host) | `cargo test -p opencode` | Chaque commit | ✅ 23+ tests |
| Tests TypeScript (editor store, routes) | Vitest | Chaque commit | ✅ 124+ tests |
| Tests proxy (Rust, CI-friendly) | `cargo test` feature `proxy` | CI PR | ✅ |
| Tests émulateur Android (runtime) | Avd + adb | Planifié | ❌ |
| Tests UI Maestro | Maestro flows | Planifié | ❌ |
| Tests golden LLM (déterminisme) | Hash sortie modèle | Planifié | ❌ |

### Flows Maestro prioritaires (à implémenter)

1. **Permissions flow** : première ouverture → dialogs permissions → grant → retour app.
2. **Model switch** : changer de modèle GGUF → vérifier reload sans crash.
3. **IDE flow** : ouvrir fichier → éditer → sauver → vérifier via `GET /file/content`.
4. **Settings export/import** : exporter → réinstaller → importer → vérifier config identique.

### Tests Rust NDK (futurs)

Pour tester le code natif Android sur CI sans device physique :
```bash
# Cross-compile et push vers émulateur
cargo build --target aarch64-linux-android --release
adb push target/aarch64-linux-android/release/libruntime.so /data/local/tmp/
adb shell LD_LIBRARY_PATH=/data/local/tmp /data/local/tmp/test_runtime
```

---

## 14. Ressources

- Tauri Mobile : https://v2.tauri.app/start/prerequisites/#mobile-targets
- Android Developer — Foreground Services : https://developer.android.com/develop/background-work/services/fgs
- llama.cpp Android build : `llama.cpp/docs/build-android.md`
- Architecture : [./ARCHITECTURE.md](./ARCHITECTURE.md)
- Roadmap IDE : [./MOBILE-IDE-ROADMAP.md](./MOBILE-IDE-ROADMAP.md)
