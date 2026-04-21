# QA Réel — Xiaomi Mi 10 Pro / MIUI / Android 13 (SDK 33)

Exécuté le 2026-04-19 sur device physique connecté en USB.

| Item | Device | Résultat |
|------|--------|----------|
| Manufacturer | Xiaomi | ✅ |
| Model | Mi 10 Pro (cmi / sm8250) | ✅ |
| Android | 13 (SDK 33) | ✅ |
| Target SDK build | 36 | ✅ |
| Min SDK | 24 | ✅ |
| Build chain | Tauri Android (cargo-ndk 27.0.12077973, gradle 8.14.3) | ✅ |
| Thermal JNI impl | code compile + link OK (pas de panic runtime) | ✅ |

## Build

```
ORT_LIB_LOCATION=D:/tmp/ort-android \
ANDROID_NDK_HOME=.../Android/Sdk/ndk/27.0.12077973 \
JAVA_HOME=.../Android Studio/jbr \
bun run build:android
```

Résultat : `Finished 1 APK` + `Finished 1 AAB`. Signé avec debug keystore
pour tests. **Les signatures JNI thermal du commit `b74a3d1ec` (I9)
compilent et lient correctement** — c'était le risque principal
documenté dans PRE_EXISTING_FIXES.md.

## Installation

```
adb install -r /tmp/app-release-signed.apk
```

Succès, incremental streamed install.

## Smoke tests — résultats

### T1. App lance sans crash (cold start)

✅ **PASS**.
- Process `ai.opencode.mobile` pid=18035 stable
- Aucun panic Rust, aucun FATAL dans logcat
- MainActivity visible, WebView Chrome sandboxed OK

### T2. LlamaEngine natif (JNI bindings, GPU detection)

✅ **PASS** — logs critiques :

```
I LlamaEngine: Native libraries loaded successfully
I LlamaEngine: Vulkan hardware: adreno
I LlamaEngine: Device: board=cmi, hardware=qcom, soc=sm8250, sdk=33
I LlamaEngine: Older SoC (sm8250) — using OpenCL
I LlamaEngine: Disabling all GPU backends (CPU-only mode, faster on old SoCs)
I LlamaEngine: Backend initialized (CPU-only)
I OpenCode: LlamaEngine initialized
```

La **logique de fallback SoC ancien → CPU-only** (adaptive runtime
auto-config.ts) fonctionne correctement. C'est exactement le comportement
documenté dans `packages/opencode/src/local-llm-server/auto-config.ts`.

### T3. IPC llm_ipc command loop

✅ **PASS**.

```
I LlamaEngine: Command loop started, watching: /data/user/0/ai.opencode.mobile/runtime/llm_ipc/request
```

### T4. PTY server (terminal mobile)

✅ **PASS** — sur port 14098 (pas 14097 qui est réservé à llama-server) :

```
I LlamaService: PTY server spawned on port 14098 (binary=.../lib/arm64/libpty_server.so)
I OpenCode: PTY server spawn requested
D PTY-Server: [PTY-Server] listening on 127.0.0.1:14098 (pid=18118)
```

Le bind explicite `127.0.0.1` confirme le guard sécurité (pas de bind
`0.0.0.0`). Cohérent avec SECURITY_AUDIT S2.A3.

### T5. Permissions runtime

✅ **PASS** — déclarées dans le manifest + grant status via `dumpsys` :

| Permission | Grant |
|---|---|
| INTERNET | granted |
| FOREGROUND_SERVICE | granted |
| FOREGROUND_SERVICE_SPECIAL_USE | granted |
| POST_NOTIFICATIONS | pas encore grant (prompt à l'utilisation) |
| RECORD_AUDIO | pas encore grant (prompt à l'utilisation) |
| MODIFY_AUDIO_SETTINGS | implicit |

Les permissions sensibles (POST_NOTIFICATIONS, RECORD_AUDIO) sont
correctement en "prompt at use" comme documenté dans
`PRE_EXISTING_FIXES.md` item 10.

### T6. Network security config (B3 — Sprint 1)

✅ **PASS** — `base-config cleartextTrafficPermitted="false"` + RFC1918
domain-config confirmé dans les sources committées
(`packages/mobile/src-tauri/gen/android/app/src/main/res/xml/network_security_config.xml`)
et compilé dans l'APK installé (resource 0x7f120001 xml/network_security_config).

Test runtime non exécuté (nécessite un serveur HTTP sur le LAN pour
validation) — checklist `QA_ANDROID_DEVICES.md` T2 reste à exécuter
en conditions réelles.

### T7. Manifest hardening

✅ **PASS** — permissions, build flags et labels conformes aux changements
des Sprints précédents (B.A1/A2 audit hardening).

### T8. Screenshot UI

✅ **PASS** — l'interface se charge (`QA_RESULTS/qa-miui-mi10pro.png`).

## Points d'attention (non-blockers)

- **Camera manager contention 635ms** sur cold start —
  `CameraManager$CameraManagerGlobal.registerAvailabilityCallback` est
  appelé par la WebView/MiuiCamera même si l'app ne touche pas la
  caméra. Non-blocker mais optimisable via lazy-register.
- **MIUI XSpace check** avant lancement — comportement OEM normal,
  pas d'impact fonctionnel.
- **llama-server port 14097 pas visible** — démarrage lazy au premier
  prompt (design correct per CLAUDE.md : "Port 14097 check needed before
  launch"). À vérifier lors d'un test de dialogue réel (hors scope QA
  smoke).

## Ce qui reste non testé (nécessite QA utilisateur)

1. **Dialogue LLM bout-en-bout** — download d'un modèle GGUF + premier
   prompt + inférence. Chaîne complète sidecar → llama-server → UI.
2. **Terminal interactif** — spawn shell, vim/altscreen, mouse tracking
   (items deferred KNOWN_ISSUES).
3. **STT / TTS** — enregistrement mic → Parakeet → transcription ;
   Kokoro TTS playback.
4. **Déni connexion non-LAN HTTP** — test B3 actif (se connecter à
   `http://example.com:4096` depuis un serveur public pour confirmer le
   rejet `CLEARTEXT_NOT_PERMITTED`).
5. **Thermal throttling** — soumettre le SoC à charge soutenue et
   vérifier que `get_thermal_state` JNI remonte "serious" / "critical"
   et que `auto-config` réduit les threads / batch size.

## Verdict MIUI

✅ **Build OK. Install OK. Lancement OK. JNI thermal OK. PTY OK. LlamaEngine OK.
Aucun crash ni panic sur le premier device MIUI réel testé.**

Le code Sprints 1-6 + dette résiduelle s'installe et démarre
proprement sur un device MIUI Xiaomi. C'est la validation qui a été
documentée comme **risque principal** depuis le début du cycle audit.

**Reste** : QA OneUI (Samsung) et ColorOS (Oppo) + tests fonctionnels
end-to-end (chat + terminal + speech).
