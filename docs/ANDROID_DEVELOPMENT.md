# Android Development — OpenCode Mobile

> Guide pratique pour développer, builder et déboguer l'app mobile.
> Dernière mise à jour : 2026-04-17.

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
export NDK_HOME="$HOME/android-ndk"
export ANDROID_NDK_HOME="$NDK_HOME"

# ONNX Runtime for Android — binaires externes
export ORT_LIB_LOCATION="D:/tmp/ort-android"
# Doit contenir : libs/arm64-v8a/libonnxruntime.so, etc.

# Signing (build release)
export ANDROID_KEY_ALIAS="opencode"
export ANDROID_KEY_PASSWORD="..."
export ANDROID_STORE_PASSWORD="..."
```

Config machine-spécifique : `packages/mobile/src-tauri/.cargo/config.toml` (gitignored — à créer localement).

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

# Build APK release toutes archis
bun tauri android build --apk --target aarch64 --target armv7 --target i686 --target x86_64
```

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

## 5. Permissions runtime (à implémenter)

Le manifeste déclare correctement `MANAGE_EXTERNAL_STORAGE`, `POST_NOTIFICATIONS`, etc. (voir [../ANDROID_AUDIT.md §1](../ANDROID_AUDIT.md)).

**Mais** : sur Android 13+, ces permissions nécessitent une demande runtime. Flow recommandé :

```ts
import { invoke } from "@tauri-apps/api/core"

async function ensurePermissions() {
  const result = await invoke<string[]>("request_permissions", {
    names: ["POST_NOTIFICATIONS", "MANAGE_EXTERNAL_STORAGE"],
  })
  const missing = result.filter(p => p !== "granted")
  if (missing.length > 0) {
    // UI fallback : bannière "Certaines fonctions sont désactivées"
    showPermissionsWarning(missing)
  }
}
```

Côté Rust, exposer une commande qui ouvre le dialog via JNI :

```rust
// packages/mobile/src-tauri/src/permissions.rs
#[tauri::command]
pub async fn request_permissions(app: AppHandle, names: Vec<String>) -> Result<Vec<String>, String> {
  // JNI call to Activity.requestPermissions()
  ...
}
```

---

## 6. Lifecycle Android — pattern recommandé

Voir [../ANDROID_AUDIT.md §2](../ANDROID_AUDIT.md) pour le détail. Implémentation à prévoir :

```ts
// packages/mobile/src/lifecycle.ts
import { invoke } from "@tauri-apps/api/core"

let wasHidden = false

document.addEventListener("visibilitychange", async () => {
  if (document.hidden) {
    wasHidden = true
    await invoke("llm_idle_tick")  // garde FG service, baisse priorité
  } else if (wasHidden) {
    wasHidden = false
    const healthy = await invoke<boolean>("check_llm_health", { port: null })
    if (!healthy) {
      // recharger le modèle
      await reloadCurrentModel()
    }
  }
})
```

Côté Rust, écouter `tauri::RunEvent` :

```rust
builder.build(tauri::generate_context!())?.run(|_app, event| match event {
  tauri::RunEvent::Exit => graceful_cleanup(),
  tauri::RunEvent::ExitRequested { .. } => prepare_shutdown(),
  _ => {}
});
```

Pour `onPause`/`onResume` spécifiquement, utiliser les plugin hooks Tauri mobile (à vérifier dans la version Tauri courante — 2.4.x expose `on_app_event` pour Android).

---

## 7. llama-server sur Android

**Runtime** : `llama-server` compilé pour `aarch64-linux-android` avec OpenCL/Vulkan. Binaire dans `packages/mobile/src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a/`.

**Lancement via JNI** :
1. `MainActivity.onCreate` → bind `.LlamaService` (foreground).
2. Service → `Process.Builder("llama-server", ...).start()` avec les bons env vars (`LLAMA_OPENCL_PLATFORM=0`, etc.).
3. Sidecar TS se connecte via `http://127.0.0.1:14097` (même loopback, WebView et service partagent le stack TCP local).

**Ports** : `14097` pour llama-server, `14099` pour opencode-cli.

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
- **Release APK/AAB** : nécessite `android/app/keystore.properties` (gitignored) :

```properties
keyAlias=opencode
keyPassword=${ANDROID_KEY_PASSWORD}
storePassword=${ANDROID_STORE_PASSWORD}
storeFile=../../../keystores/opencode.keystore
```

---

## 10. Pièges fréquents

| Symptôme | Cause probable | Remède |
|---|---|---|
| App crash au lancement Android 14 | Permission runtime manquante | Ajouter `request_permissions` au boot |
| llama-server se relance tout le temps | `ensureCorrectModel` loop (audit A.8) | Vérifier alias modèle, ajouter cooldown |
| Deep-link `opencode://...` ouvre le navigateur | `assetlinks.json` manquant sur `opencode.ai` | Voir [../ANDROID_AUDIT.md §3](../ANDROID_AUDIT.md) |
| Inference lente après pause 2 min | Phantom process killer (A.4) | Implémenter `.LlamaService` binding |
| Config LLM perdue au redémarrage | `localStorage` effacé par Android si low-mem | Migrer vers Tauri Store |
| `ORT_LIB_LOCATION` not found | Env var non définie avant build | Voir §2 ci-dessus |
| Xiaomi : `adb shell input` ne fait rien | MIUI security settings | §4 ci-dessus |

---

## 11. Ressources

- Tauri Mobile : https://v2.tauri.app/start/prerequisites/#mobile-targets
- Android Developer — Foreground Services : https://developer.android.com/develop/background-work/services/fgs
- llama.cpp Android build : `llama.cpp/docs/build-android.md`
- Architecture : [./ARCHITECTURE.md](./ARCHITECTURE.md)
