# Known Failure Patterns — OpenCode

> Patterns de bugs récurrents validés sur le terrain. Avant tout debug, scanner cette liste.
> Mis à jour : 2026-05-27.

---

### Build & Deploy

#### Sidecar stale après modification TypeScript
**Symptôme** : l'app desktop se comporte comme avant la modification, sans erreur.
**Cause** : `bun tauri build` ne recompile pas `opencode-cli.exe` automatiquement.
**Fix** : `bun run build --single --baseline` dans `packages/opencode`, puis copier dans `sidecars/`.
**Fichier** : [packages/desktop/src-tauri/src/server.rs](../packages/desktop/src-tauri/src/server.rs)

#### Android build hang sur pipe
**Symptôme** : `bun tauri android build | tail -N` ne retourne jamais.
**Cause** : les daemons Gradle gardent le pipe ouvert.
**Fix** : rediriger vers un fichier `> log.txt 2>&1` + `tail -f log.txt` en parallèle.

#### armv7 ORT mismatch
**Symptôme** : `bun tauri android build` échoue avec erreur ONNX Runtime.
**Cause** : `libonnxruntime.so` est aarch64, armv7 non supporté.
**Fix** : toujours passer `--target aarch64`.

---

### Sidecar & Server

#### llama-server dupliqué (port 14097)
**Symptôme** : décodage 5-10x plus lent que prévu, VRAM en deux moitiés.
**Cause** : deux instances llama-server sur le même port, résultat du split de VRAM.
**Fix** : vérifier le PID avant spawn, tuer l'instance précédente.
**Fichier** : [packages/mobile/src-tauri/src/llm.rs](../packages/mobile/src-tauri/src/llm.rs)

#### Sidecar port déjà occupé
**Symptôme** : sidecar refuse de démarrer, erreur EADDRINUSE.
**Cause** : PID lock non nettoyé d'une session précédente.
**Fix** : `lsof -i :14096` (ou port configuré) + kill manuel.

---

### LLM & Inference

#### Bash tool schema bug (Gemma-4)
**Symptôme** : `cargo check`/`build` échouent systématiquement en agent mode, 5+ retries identiques.
**Cause** : Gemma-4 E4B envoie `dry_run` au lieu de `description` requis dans le schema bash tool.
**Fix** : patcher `tool/bash.ts` — field `description` obligatoire, ignorer `dry_run`.
**Fichier** : [packages/opencode/src/tool/bash.ts](../packages/opencode/src/tool/bash.ts)

#### OpenCL Adreno K-quants crash
**Symptôme** : llama-server exit 134 (`SET_ROWS`) avec Q4_K_M sur Adreno.
**Cause** : kernels OpenCL Adreno incompatibles avec K-quants (Q4_K_M, Q5_K_M…).
**Fix** : router sur CPU pour tous les K-quants, OpenCL uniquement pour Q4_0/Q8_0 sur SM8450+.
**Fichier** : [packages/mobile/src/model-catalog.ts](../packages/mobile/src/model-catalog.ts)

#### OpenCL non engagé (stdout non drainé)
**Symptôme** : llama-server démarre mais reste sur CPU, perf non améliorée.
**Cause** : stdout llama-server non drainé → le process se bloque en écriture avant d'initialiser OpenCL.
**Fix** : thread daemon `forEachLine Log.d` sur le stdout de LlamaService.

#### Gemma-4 SWA — pas de cache multi-turn
**Symptôme** : chaque message re-prefill complet, latence croissante.
**Cause** : Gemma-4 utilise SWA (Sliding Window Attention) → `--cache-reuse` ignoré.
**Fix** : changer de modèle (Qwen2.5, Llama-3.2) pour les sessions multi-turn longues.

#### Adreno 6xx OpenCL plus lent que CPU (Q4_0)
**Symptôme** : perf inférieure après activation OpenCL sur Mi 10 Pro (Adreno 650).
**Cause** : overhead kernel launch OCL 2.0 > gain NEON REPACK sur Adreno 6xx.
**Fix** : OpenCL Q4_0 uniquement sur SM8450+ (Adreno 730+, OCL 3.0+).

---

### Android Mobile

#### WebView cache stale après `adb install -r`
**Symptôme** : modifications UI non visibles malgré APK correcte.
**Cause** : `adb install -r` conserve le cache WebView.
**Fix** : `adb shell pm clear <package>` + reinstall complète.

#### MIUI `adb shell input` bloqué
**Symptôme** : `adb shell input tap/text` sans effet sur Xiaomi.
**Cause** : MIUI bloque les inputs ADB par défaut.
**Fix** : activer "USB debugging (Security settings)" dans les options développeur MIUI.

#### Alpine hardlinks — SELinux bloque `link()`
**Symptôme** : `tar` avorte lors de l'extraction du rootfs Alpine sur Android.
**Cause** : SELinux interdit `link()` sur `app_data_file`.
**Fix** : exécuter `fix_hardlinks.py` via WSL avant le build Gradle.

#### Mobile CLI bundle stale
**Symptôme** : comportement backend stale sur Android malgré recompilation.
**Cause** : `prepare-android-runtime.sh` ne rebuild `opencode-cli.js` qu'à la 1ère compilation.
**Fix** : forcer la recompilation explicitement avant le build Android. Le bundling
CLI a une **source unique** : `scripts/bundle-mobile.mjs` (appelé par
`prepare-android-runtime.sh` ET la CI). Ne jamais réintroduire un second `bun build`
divergent (dette D-17).

#### Chaîne d'exécution toolchain on-device (shebang + LD_PRELOAD)
**Contexte** : sur Android 13+, la policy SELinux `untrusted_app` refuse
`execute_no_trans` sur les fichiers labellisés `app_data_file` (tout ce qui est
écrit dans le data dir privé de l'app, donc le rootfs Alpine extrait). musl libc
résout `execve`/`posix_spawn` en visibilité cachée → un interposeur LD_PRELOAD ne
peut pas intercepter les sous-process spawnés par chemin absolu (`cc1`, `collect2`,
`ld`, `as`, `rustc`…). Le kernel renvoie EACCES (rapporté ENOENT par le hook SELinux).

**Chaîne mise en place** (`runtime.rs::prepare_toolchain_wrappers`) :

```
  invocation (cargo / gcc / rustc …)
        │
        ▼
  binfmt_script   ── le kernel lit la 1re ligne "#!<...>" du wrapper
        │
        ▼
  libbash_exec.so  ── vit dans nativeLibraryDir (label apk_data_file,
        │              EXEC autorisé) → contourne l'EACCES du script
        ▼
  libmusl_linker.so <name>.elf64   ── relance l'ELF musl réel (mmap+reloc)
        │
        ▼
  ELF cible (<name>.elf64)         ── le binaire d'origine, renommé
```

Deux étages :
1. **Wrap in-rootfs** : chaque ELF musl spawné par chemin absolu est renommé
   `<name>.elf64` et remplacé par un script `#!<nlib>/libbash_exec.so` qui
   re-exec via `libmusl_linker.so <name>.elf64`.
2. **Wrappers d'entrée** : `<cache>/wrappers/{cargo,rustc,…}` ; le PATH les met
   en tête et `RUSTC` épingle le wrapper rustc.

**Invariants critiques** (testés par `prepare_toolchain_wrappers_is_idempotent`) :
- **Idempotence** : un 2e passage ne doit jamais produire `<name>.elf64.elf64` ni
  altérer le `.elf64` sauvegardé. Le script est en revanche **toujours réécrit** car
  `nativeLibraryDir` contient le hash d'install APK : un wrapper d'une install
  précédente pointe vers un `libbash_exec.so` mort.
- **`liblto_plugin.so` reste un .so** (dlopen-able), jamais wrappé.
- **`ld` → `ld.bfd`** doit exister (collect2 le cherche par nom nu).

**Symptômes d'une chaîne cassée** :
- `cc: cannot execute: required file not found` → wrapper pointe vers un
  `libbash_exec.so` d'une install précédente (path APK périmé).
- `collect2: ld: No such file or directory` → symlink `ld` perdu par un wrap pass.
- `Not a valid dynamic program` → double-wrap (`.elf64.elf64`).
- Échec silencieux d'un `force_symlink`/`repair_rootfs_hardlinks` → un binaire
  critique (gcc/g++) absent ; depuis D-12/D-13 ces échecs sont loggés
  (`[OpenCode] … failed to …`), donc à scanner dans `adb logcat`.

---

### Desktop / Tauri

#### Deep-link ignoré silencieusement
**Symptôme** : le deep-link ne déclenche rien, même avec intent-filter dans le manifest.
**Cause** : le scheme doit être déclaré dans `tauri.conf.json plugins.deep-link.mobile`.
**Fix** : ajouter le scheme dans `tauri.conf.json` — le manifest seul ne suffit pas.

#### TLS HTTPS calls échouent (Internet mode)
**Symptôme** : les requêtes HTTPS vers des services externes échouent silencieusement.
**Cause** : `https://*:*/*` absent du scope `tauri.conf.json`.
**Fix** : ajouter le scope HTTPS + `DangerousSettings` pour les certificats auto-signés.

#### Config LLM non propagée au backend
**Symptôme** : `invoke("set_llm_config", {...})` semble réussir mais le backend utilise l'ancienne config.
**Cause** : `pushConfigToEnv` nécessite les 12 champs — un champ manquant = propagation silencieusement ignorée.
**Fix** : vérifier que tous les 12 champs de `LlmConfig` sont présents dans l'invoke.

---

### Frontend / UI

#### `100dvh` figé au keyboard toggle (MIUI)
**Symptôme** : l'UI ne se redimensionne pas quand le clavier virtuel apparaît.
**Cause** : `dvh` est figé sur MIUI au keyboard toggle.
**Fix** : `--vvh` CSS var settée via `visualViewport.resize` listener, `height: var(--vvh, 100dvh)`.

#### IPC postMessage lent / `<audio>` "no supported source"
**Symptôme** : l'IPC est lent ou les éléments `<audio>` génériques ne fonctionnent pas.
**Cause** : CSP manquant `http://ipc.localhost` (connect-src) et/ou `http://asset.localhost` (media-src).
**Fix** : ajouter ces deux origins dans la CSP Tauri.

#### Decorum — div title bar flottante
**Symptôme** : un div supplémentaire flotte en haut de la fenêtre.
**Cause** : placeholder `[data-tauri-decorum-tb]` absent du DOM au chargement.
**Fix** : le placeholder est LOAD-BEARING — ne pas le retirer ou le conditionner.

---

### Sécurité (open items)

#### CORS regex trop permissif
**Pattern** : `*.opencode.ai` accepte des sous-domaines arbitraires.
**Fichier** : [packages/opencode/src/server/server.ts](../packages/opencode/src/server/server.ts)

#### WebSocket auth en query param
**Pattern** : `?authorization=` visible dans les logs réseau.
**Fichier** : [packages/opencode/src/server/auth-jwt.ts](../packages/opencode/src/server/auth-jwt.ts)

#### `auth.json` plaintext
**Pattern** : tokens stockés en clair avec mode 0o600.
**Fichier** : [packages/opencode/src/auth/index.ts](../packages/opencode/src/auth/index.ts)
