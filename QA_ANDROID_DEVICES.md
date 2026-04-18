# QA Android — Checklist physique par device

> Pré-release QA gate : chaque build mobile candidat doit être validé
> sur **au moins un device par OEM** listé ci-dessous avant publication.
> Sign-off obligatoire (cases à cocher + initiales + date).
>
> Références croisées :
> `MANUAL_TESTS.md` (checklist générique), `SPRINT1_NOTES.md` (B3
> network_security_config), `SPRINT3_NOTES.md` (I9 thermal listener),
> `SPRINT4_NOTES.md` (keychain desktop, pas mobile).

---

## 0. Pré-requis build

Avant de commencer le QA, vérifier :

- [ ] `bun run build --single` dans `packages/opencode` effectué
      (sidecar TS recompilé — voir memory `feedback_opencode_build_process`).
- [ ] `ORT_LIB_LOCATION` exporté (voir memory `reference_ort_android_build`).
- [ ] `bun tauri android build` exit 0 (5+ min, ne pas compiler sans
      revue préalable — memory `feedback_no_compile_without_verification`).
- [ ] APK signé par la clé de release (pas debug).
- [ ] SHA-256 de l'APK consigné (matchera la release asset).

---

## 1. Matrice OEM — comportements connus

| OEM | ROM | Point d'attention | Workaround connu |
|-----|-----|-------------------|------------------|
| Samsung | OneUI 6 / 7 | Background restrictions agressives (app kill après 5 min en background). Autostart désactivé par défaut. | Demander "Unrestricted" dans Battery settings. FOREGROUND_SERVICE_TYPE requis. |
| Xiaomi / Redmi / POCO | MIUI 14 / HyperOS | `adb shell input` bloqué par défaut. Battery Saver tue les foreground services. Autostart off par défaut. | Activer "USB debugging (Security settings)" (memory `reference_miui_adb_input`). Whitelist autostart + "No restrictions". |
| Oppo / Realme / OnePlus | ColorOS 14 / 15 | Doze mode très agressif. ColorOS tue les sockets TCP après ~30 s d'écran éteint. | Lock app in memory (Settings → Battery → App battery usage). |
| Google Pixel | Android stock 14 / 15 | Doze standard AOSP. FOREGROUND_SERVICE prompt explicite. | Aucun — baseline comportementale. |
| Vivo | FuntouchOS / OriginOS | Background restrictions similaires à Oppo, audit non systématique dans cette itération. | Ajouter l'app à "High background power consumption" whitelist. |
| Motorola | MyUX (stock-like) | Baseline AOSP. Rares différences. | Baseline Pixel. |

**Devices de référence recommandés** (au moins un par ligne) :

- Samsung : Galaxy S23 / S24 sous OneUI 6+.
- Xiaomi : Redmi Note 13 / POCO X6 sous MIUI 14+ ou HyperOS.
- Oppo : Find X6 / OnePlus 12 sous ColorOS 14+.
- Pixel : Pixel 7 / 8 sous stock Android 14+.

---

## 2. Tests critiques — à exécuter sur chaque device

Pour **chaque** device dans les §3–§6, exécuter la liste ci-dessous et
cocher au fur et à mesure.

### T1 — Install & first-run

1. `adb install -r opencode.apk`
2. Lancer l'app depuis le launcher.
3. Vérifier qu'aucun crash immédiat n'apparaît (watch `logcat | grep AndroidRuntime`).

### T2 — B3 Cleartext LAN (Sprint 1)

1. Démarrer un serveur `opencode serve --port 14097 --host 0.0.0.0` sur
   un PC du même Wi-Fi.
2. Dans l'app, mode "Remote Server" → coller `http://<IP LAN>:14097`.
3. **Attendu** : la connexion s'établit (RFC1918 autorisé par
   `network_security_config.xml`).
4. Tenter `http://example.com:14097` → **attendu** : `CLEARTEXT_NOT_PERMITTED`.
5. Tenter `http://127.0.0.1:14097` (via sidecar embedded) → **attendu** : OK.

**Risque spécifique MIUI** : `includeSubdomains="true"` sur IP n'est pas
strictement standard AOSP. Si MIUI refuse `192.168.1.x`, documenter la
version ROM et ouvrir un ticket.

### T3 — FOREGROUND_SERVICE permission prompt

1. Démarrer une session longue (LLM local ou remote).
2. Mettre l'app en background (home button).
3. Vérifier qu'Android affiche la notification persistante
   "OpenCode is running".
4. **Attendu** : aucun kill du service dans les 10 minutes.

### T4 — Thermal listener (I9, Sprint 3)

Le binding JNI `get_thermal_state` retourne "nominal" par défaut dans
la Sprint 3. Le test "vrai" nécessite le câblage JNI réel.

1. Vérifier que `invoke("get_thermal_state")` retourne `"nominal"` au
   démarrage.
2. Stresser le CPU (lancer une inférence locale 1B+ ou charger le CPU
   via une autre app).
3. Vérifier dans `logcat` qu'aucune erreur `IllegalStateException` /
   `NoSuchMethodError` n'est loggée autour de `PowerManager`.
4. **Note** : l'observation du throttling actif ne sera significative
   qu'une fois le binding JNI câblé (backlog I9).

### T5 — STT / TTS

1. Autoriser l'accès micro au premier prompt.
2. Tester une commande vocale (si STT activé).
3. Tester un prompt TTS (si TTS activé).
4. **Attendu** : pas de crash natif, latence < 2 s.

### T6 — Sidecar embedded spawn

1. Mode "Embedded server" dans l'app.
2. Vérifier dans `logcat` :
   - spawn du sidecar OK,
   - pas d'erreur `EACCES` / `SELinux denied`.
3. Ping `http://127.0.0.1:<port>/healthz`.
4. **Attendu** : `200 OK`.

### T7 — Remote Server auth passthrough

Voir memory `project_mobile_remote_auth_fix` : vérifier que
username/password saisis en mode Remote Server sont bien transmis.

1. Serveur distant avec Basic auth activé.
2. Se connecter avec creds valides → OK.
3. Se connecter avec creds invalides → 401 propre, pas de crash.

### T8 — Deep-link (reference_tauri_deeplink_2_4_8_config)

1. Déclencher un deep-link vers le scheme custom de l'app.
2. Vérifier que l'app s'ouvre sur la route cible.
3. **Attendu** : ouverture propre (config `plugins.deep-link.mobile`
   dans `tauri.conf.json` valide).

### T9 — Background + reprise

1. App active, session LLM en cours.
2. Écran éteint pendant 10 minutes.
3. Rallumer → l'app reprend le stream ou re-sync proprement.

---

## 3. Sign-off — Samsung OneUI

Device : `________________` | ROM : `________________` | Tester : `______` | Date : `____________`

- [ ] T1 Install & first-run
- [ ] T2 B3 Cleartext LAN (LAN OK / public refusé / loopback OK)
- [ ] T3 FOREGROUND_SERVICE persistant (pas de kill à 10 min)
- [ ] T4 Thermal `get_thermal_state` (nominal, pas de crash)
- [ ] T5 STT / TTS
- [ ] T6 Sidecar embedded spawn
- [ ] T7 Remote Server auth passthrough
- [ ] T8 Deep-link scheme
- [ ] T9 Background 10 min + reprise
- [ ] **OneUI spécifique** : settings → Battery → ajouter OpenCode en
      "Unrestricted". Re-tester T3 avec restriction.
- [ ] **OneUI spécifique** : Autostart on.

Initiales : `______` | Verdict : `[ ] GO  [ ] NO-GO`

---

## 4. Sign-off — Xiaomi MIUI / HyperOS

Device : `________________` | ROM : `________________` | Tester : `______` | Date : `____________`

- [ ] T1 Install & first-run
- [ ] T2 B3 Cleartext LAN (**watch** : `includeSubdomains` sur IP peut
      échouer sur certaines versions MIUI)
- [ ] T3 FOREGROUND_SERVICE persistant
- [ ] T4 Thermal `get_thermal_state`
- [ ] T5 STT / TTS
- [ ] T6 Sidecar embedded spawn
- [ ] T7 Remote Server auth passthrough
- [ ] T8 Deep-link scheme
- [ ] T9 Background 10 min + reprise
- [ ] **MIUI spécifique** : activer "USB debugging (Security settings)"
      si tests ADB input requis (memory `reference_miui_adb_input`).
- [ ] **MIUI spécifique** : Autostart on.
- [ ] **MIUI spécifique** : Battery Saver → "No restrictions" pour
      OpenCode. Re-tester T3.
- [ ] **MIUI spécifique** : "Lock in recent apps" activé.

Initiales : `______` | Verdict : `[ ] GO  [ ] NO-GO`

---

## 5. Sign-off — Oppo / OnePlus ColorOS

Device : `________________` | ROM : `________________` | Tester : `______` | Date : `____________`

- [ ] T1 Install & first-run
- [ ] T2 B3 Cleartext LAN
- [ ] T3 FOREGROUND_SERVICE persistant (**watch** : ColorOS doze tue
      les sockets TCP après 30 s écran éteint)
- [ ] T4 Thermal `get_thermal_state`
- [ ] T5 STT / TTS
- [ ] T6 Sidecar embedded spawn
- [ ] T7 Remote Server auth passthrough
- [ ] T8 Deep-link scheme
- [ ] T9 Background 10 min + reprise (**attendu difficile** sur ColorOS)
- [ ] **ColorOS spécifique** : Settings → Battery → App battery usage →
      "Allow background activity" + "Allow auto-launch".
- [ ] **ColorOS spécifique** : Lock app en mémoire via Recents.
- [ ] **ColorOS spécifique** : désactiver doze pour l'app si possible.

Initiales : `______` | Verdict : `[ ] GO  [ ] NO-GO`

---

## 6. Sign-off — Google Pixel (stock Android)

Device : `________________` | ROM : `________________` | Tester : `______` | Date : `____________`

- [ ] T1 Install & first-run
- [ ] T2 B3 Cleartext LAN
- [ ] T3 FOREGROUND_SERVICE persistant
- [ ] T4 Thermal `get_thermal_state`
- [ ] T5 STT / TTS
- [ ] T6 Sidecar embedded spawn
- [ ] T7 Remote Server auth passthrough
- [ ] T8 Deep-link scheme
- [ ] T9 Background 10 min + reprise
- [ ] **Pixel spécifique** : baseline AOSP — aucune modif OEM
      requise, sert de référence.

Initiales : `______` | Verdict : `[ ] GO  [ ] NO-GO`

---

## 7. Verdict global release

- [ ] Tous les sign-offs §3–§6 en GO.
- [ ] Aucun `NO-GO` non résolu.
- [ ] Logcat propre sur tous les devices (pas d'`AndroidRuntime`
      fatal non reproduit).
- [ ] SHA-256 APK consigné dans `RELEASE_NOTES_TEMPLATE.md` →
      section Checksums.

Release GO : `[ ] OUI  [ ] NON`
Commentaire : `________________________________________________`

---

## 8. Procédure en cas de NO-GO

1. Documenter le device, la ROM, le test qui échoue.
2. Ouvrir un issue GitHub avec label `android-qa` + `blocker`.
3. Attacher un `adb bugreport` + `logcat -d` filtré sur le package.
4. Bloquer la release jusqu'à résolution OU documenter le workaround
   utilisateur dans `RELEASE_NOTES_TEMPLATE.md` → section "Upgrade
   notes".
