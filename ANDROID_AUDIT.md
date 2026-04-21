# ANDROID AUDIT — OpenCode Mobile (2026-04-17)

> Audit ciblé de `packages/mobile` pour un fonctionnement sans bug sur Android, avec réactivité et gestion correcte du lifecycle.

---

## 1. Manifeste Android — état actuel

Fichier : [packages/mobile/src-tauri/gen/android/app/src/main/AndroidManifest.xml](packages/mobile/src-tauri/gen/android/app/src/main/AndroidManifest.xml)

✅ **Bien déclaré** :
- `INTERNET`, `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`, `MANAGE_EXTERNAL_STORAGE`
- `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_SPECIAL_USE`, `POST_NOTIFICATIONS`
- `<uses-native-library libOpenCL.so>` (GPU inference)
- Service `.LlamaService` avec `foregroundServiceType="specialUse"` + `PROPERTY_SPECIAL_USE_FGS_SUBTYPE`
- `networkSecurityConfig="@xml/network_security_config"` (TLS self-signed)
- `requestLegacyExternalStorage="true"` (transitoire)

⚠️ **Manquant ou à vérifier** :
- Demande **runtime** des permissions `POST_NOTIFICATIONS`, `MANAGE_EXTERNAL_STORAGE` (API 30+/33+ nécessitent un dialog système dynamique — pas juste la déclaration).
- `WAKE_LOCK` si l'inference longue (>1 min) doit maintenir le CPU/GPU actifs quand l'écran s'éteint.
- `RECEIVE_BOOT_COMPLETED` si l'app veut restaurer l'état au reboot (optionnel).

---

## 2. Lifecycle — points critiques

### 2.1 — Spawn/kill llama-server en fonction de l'Activity lifecycle

Pattern recommandé :

```
Activity.onCreate     → bind + startForegroundService(.LlamaService)
Activity.onStart      → (re)establish IPC with sidecar if needed
Activity.onPause      → signal "idle tick" (garde service vivant, baisse priorité)
Activity.onStop       → unload du modèle si trop gros, garde sidecar vivant
Activity.onDestroy    → stopService + kill sidecar + cleanup refs
onTrimMemory(MODERATE)→ drop caches, keep model
onTrimMemory(CRITICAL)→ unload model, garder sidecar connecté
```

### 2.2 — État actuel dans le code

- [packages/opencode/src/local-llm-server/index.ts:262-281](packages/opencode/src/local-llm-server/index.ts#L262-L281) : handlers `SIGTERM`/`SIGINT`/`exit` → `syncCleanup()`.
- [packages/mobile/src-tauri/src/lib.rs](packages/mobile/src-tauri/src/lib.rs) : à lire pour confirmer si un `RunEvent::Exit` ou `OnPause` hook est implémenté.
- [packages/mobile/src/entry.tsx](packages/mobile/src/entry.tsx) : pas de `document.addEventListener("visibilitychange", ...)` — aucun signal côté JS quand l'app passe en background.

**Action** : ajouter un hook visibility côté JS + côté Rust écouter `onPause`/`onResume` de l'Activity via le JNI bridge Tauri (`tauri::RunEvent::WindowEvent` — vérifier si exposé sur Android).

---

## 3. Deep-links — cohérence config ↔ manifeste

- [packages/mobile/src-tauri/tauri.conf.json:44-49](packages/mobile/src-tauri/tauri.conf.json#L44-L49) déclare `scheme: ["opencode"]`.
- [AndroidManifest.xml:40-61](packages/mobile/src-tauri/gen/android/app/src/main/AndroidManifest.xml#L40-L61) contient **deux** `intent-filter` : `https://opencode.ai/mobile` (auto-verify) + `opencode://`.

Incohérence : le manifeste est auto-généré par le plugin Tauri `deep-link` selon la config, mais le second intent-filter https ne provient pas du scheme `opencode`. Soit il y a eu un override manuel, soit un autre plugin l'a ajouté.

**Risque** :
- L'auto-verify `https` nécessite `.well-known/assetlinks.json` hébergé sur `opencode.ai`. Si absent, Android ignore l'intent et ouvre le navigateur.
- Pour un fork qui ne contrôle pas `opencode.ai`, cet intent-filter devrait être supprimé ou remplacé par un domaine contrôlé.

**Actions** :
1. Vérifier si `opencode.ai/.well-known/assetlinks.json` contient le SHA256 du signing key APK du fork.
2. Sinon : ne conserver que `opencode://` (custom scheme), retirer l'intent-filter `https` du manifeste.
3. Mettre à jour la doc de pairing pour ne mentionner que `opencode://`.

---

## 4. PTY bridge (remote desktop sidecar)

D'après les notes `_memory/memory.md` du vault :
- Bridge TCP entre le device Android et le desktop via port dédié.
- QR code embarque URL + username + password + TLS fingerprint.

**Points à auditer** :
- Resync après `onResume` : le socket TCP survit-il à un `onPause` long ? Sinon, handshake de reconnexion automatique.
- Timeout du deep-link `opencode://...?fp=...&pw=...` : la ligne [entry.tsx:119-120](packages/mobile/src/entry.tsx#L119-L120) pousse `setPrivateServerFp(fp)` — vérifier que le scoping est per-session, pas globalement persisté.
- Rotation du fingerprint TLS (desktop side) : si le desktop rotate sa CA (via [tls.rs:76-126](packages/desktop/src-tauri/src/tls.rs#L76-L126), cert 10 ans — pas urgent), le client Android doit redemander le pairing plutôt que d'échouer silencieusement.

---

## 5. WebView quirks

Android WebView (Chromium) a quelques spécificités à respecter :

- **Fetch + self-signed TLS** : géré par `networkSecurityConfig` (ok).
- **WebSocket sur 127.0.0.1** : bloqué par défaut sur Android 9+, nécessite `cleartextTrafficPermitted=true` dans `network_security_config.xml` (à vérifier).
- **localStorage quota** : ~10 MB per origin, peut saturer si RAG cache y est stocké. Préférer IndexedDB ou Tauri store.
- **Copier/coller** : `navigator.clipboard` demande un HTTPS/geste utilisateur. Si deep-link sans geste, le write échoue silencieusement.

---

## 6. Normalisation des chemins cross-platform

**Risque** : un utilisateur appaire un desktop Windows avec un mobile Android via QR code. Le JSON embarqué peut contenir des paths `C:\Users\…\models\…` qui cassent côté Android.

**Actions** :
- Tous les chemins sérialisés doivent utiliser `/` (normalisation via un helper `normalizePath(p) = p.replace(/\\/g, "/")`).
- Au décodage sur Android, re-normaliser explicitement.
- Éviter de persister des chemins absolus dans des structures partagées (utiliser un identifiant stable et résoudre côté device).

---

## 7. Batterie et thermal throttling

Les modèles locaux 3-8B en GPU mobile (Adreno/Mali) tirent 3-8 W soutenu. Sur 20 minutes d'inference continue :
- **Thermal throttling** kick in → tokens/s baisse de 30-50 %.
- **Batterie** : ~20-30 % en 20 min d'inference lourde.

**Actions proposées** :
- UI : afficher un warning "Inference peut chauffer" au premier démarrage local-llm sur batterie <40 %.
- Exposer une toggle "Charge requise pour inference lourde" (refuse si batterie + pas sur secteur).
- Telemetry locale (opt-in) : tokens/s moyen par modèle, corrélé avec température CPU → aider à la future matrice décisionnelle (voir [PERFORMANCE_REPORT.md](PERFORMANCE_REPORT.md) §2.3).

---

## 8. Checklist de régression Android

Pour chaque release candidate :

| Test | Device cible | Succès si |
|---|---|---|
| Cold start jusqu'à écran chat | Pixel 7, Redmi 10 | <3 s (haut de gamme), <6 s (milieu) |
| Chat 10 messages sans erreur | Tous | 0 crash logcat |
| Pause 2 min puis reprise | Tous | Model toujours chargé, réponse <2 s |
| Inference continue 10 min | Flagship | Tokens/s dégrade <20 % |
| Appairage QR desktop-mobile | Tous | Fingerprint stocké, requête OK |
| Permissions refusées (storage, notif) | Tous | UI de fallback, pas de crash |
| Deep-link `opencode://pair?…` depuis navigateur | Tous | Ouvre l'app, pré-remplit le pairing |
| Batterie 15 % démarrage inference | Flagship | Warning affiché |

**Automatisation** : `maestro` (Mobile.dev) supporte Tauri WebView. Écrire 8 scénarios YAML correspondants → CI nightly sur émulateur Android 14 + 1 device physique via Firebase Test Lab.

---

## 9. Références croisées

- Bugs critiques mobiles : A.4, A.5, A.7, A.9, A.10 dans [AUDIT_REPORT.md](AUDIT_REPORT.md)
- Auto-adaptation device : §2 de [PERFORMANCE_REPORT.md](PERFORMANCE_REPORT.md)
- Patterns Tauri : [docs/ANDROID_DEVELOPMENT.md](docs/ANDROID_DEVELOPMENT.md)

---

**Auteur** : Claude Opus 4.7 (audit 2026-04-17)
