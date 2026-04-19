# NEXT_SESSION_PLAN — QA réel Mi 10 Pro + Desktop (2026-04-19 → suivant)

> Plan d'exécution copié depuis `C:/Users/barat/.claude/plans/gleaming-bouncing-sutton.md`.
> Source de vérité : ce fichier pendant la session en cours.
> 9 bugs UX remontés par QA réel utilisateur, ouverts après `43d68b124`.

## Contexte

QA réelle Xiaomi Mi 10 Pro (MIUI 13, SDK 33) + desktop Windows → 9 bugs pas
encore fixés correctement. Sprints 1-6 + dette résiduelle + QA MIUI précédente
(`0b5dac32f` → `43d68b124`) solides, mais UX produit non prête tant que ces
9 items restent ouverts.

Objectif : fermer chaque bug par un correctif réellement vérifié sur le device
physique / desktop, pas un fix "en aveugle".

## Phase 0 — Docs (début de session) — DONE

- [x] Memory + LOG Obsidian déjà à jour (session précédente 2026-04-19).
- [x] `NEXT_SESSION_PLAN.md` créé (ce fichier).
- [x] `PROD_READINESS.md` mis à jour avec les 9 bugs "QA REAL" en bloquants.

## Bugs

### Bug 1 — Terminal portrait first-prompt invisible (HAUTE)

Fichier: `packages/app/src/components/terminal.tsx:577-599`.
Fix: après chaque `fit.fit()` dans la boucle `[50, 200, 500]`, appeler
`scheduleSize(t.cols, t.rows)` pour retransmettre au PTY Rust via
`client.pty.update({ ptyID, size })`. Sans ça, le PTY reste figé sur les dims
initiales (cols=40/rows=10) et mksh écrit son prompt hors champ.

Vérif: portrait → prompt `$` visible dès ouverture, sans frappe. Rotation
landscape→portrait→landscape : prompt visible dans les deux orientations.

### Bug 2 — `vim` → `toybox: unknown command vi` (HAUTE)

Solution retenue : bundle busybox-static aarch64 (~1 MB).

- `packages/mobile/src-tauri/assets/runtime/bin/busybox-aarch64` (statique, `https://busybox.net/downloads/binaries/`).
- `packages/mobile/src-tauri/src/runtime.rs` : extraction → symlinks
  `vi`/`less`/`nano`/`awk`/`sed` → `busybox-aarch64`.
- Retirer les alias maintenant inutiles (`vim=vi` conservé pour ergonomie).
- PATH runtime/bin doit rester en tête.

Vérif: `vi --help` OK, `vim fichier.txt` OK, `less`/`nano`/`sed`/`awk`.

### Bug 3 — Kokoro TTS silencieux sur mobile (HAUTE)

- `speech.rs::kokoro_download_model` : propager `Result<_, String>`. Emit
  `kokoro-download-error` en cas d'échec. Emit `kokoro-download-progress`
  pendant le download.
- `speech.rs::tts_speak` : si `!kokoro_available()` ET download échoue →
  retourne `Err(String)` explicite.
- `packages/mobile/src/hooks/use-speech.ts` : handler progress (toast %) +
  erreur (toast rouge). Ne pas swallow.
- URLs : `https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/onnx/model.onnx`
  + `voices-v1.0.bin`.

Vérif: 1er TTS après uninstall → progression 0→100% visible, fichiers dans
`<datadir>/kokoro/`. Wifi coupé pendant download → erreur explicite. Après
download, TTS produit du son.

### Bug 4 — Voice cloning desktop silencieux (HAUTE)

- `packages/app/src/components/settings-audio.tsx:372` : après record OK,
  `saveSettings({ ttsVoice: name })` + event custom `tts-voice-changed`.
- `packages/desktop/src-tauri/src/speech.rs:463` : si voix demandée absente
  en fichier local → fallback `"alba"` avec log warn explicite.
- Bouton "Test" dans VoiceClone → TTS court "test 1 2 3" juste après record.

Vérif: enregistrement → "Test" → son de test avec la voix clonée. Message
TTS réel → son cohérent. Sidecar down → message d'erreur clair.

### Bug 5 — OAuth Gemini + Anthropic manquants (MOYENNE) — **SKIPPED**

Investigation de faisabilité :

- **Anthropic** : pas d'OAuth public documenté pour l'API Anthropic. L'auth
  Claude.ai est réservée au site web (tokens de session non portables vers
  l'API `api.anthropic.com`). La seule auth programmatique publique reste
  la clé API `sk-ant-…`. → **non implémentable**.
- **Google Gemini** : l'API `generativelanguage.googleapis.com` (et
  `aiplatform.googleapis.com` via Vertex) est authentifiée par **API key**
  ou **service account**, pas par OAuth utilisateur. Les scopes
  `generative-language` existent mais uniquement pour les apps web qui
  parlent au backend de *leur* service, pas pour l'API Gemini directe. →
  **non implémentable en OAuth utilisateur sans service account**.

Décision : Bug 5 fermé en "won't fix". Clés API restent la seule voie pour
Gemini/Anthropic. Workflow utilisateur : `Settings → Providers → Connect`
continue de demander la clé.

Si plus tard Anthropic/Google ouvrent un OAuth public :
- Pattern à suivre : `packages/opencode/src/plugin/codex.ts` (plugin OAuth
  OpenAI Codex complet avec PKCE + callback server local).
- Enregistrer dans `packages/opencode/src/plugin/` puis câbler le plugin
  loader dans `ProviderAuth` (déjà générique, détecte `x.auth?.provider`).

### Bug 6 — CLI TUI : pas d'auto-spawn llama-server (HAUTE)

- `packages/opencode/src/cli/cmd/tui/component/dialog-model.tsx:148-161` :
  après `local.model.set(...)`, si provider local →
  `await LocalLLMServer.ensureRunning(modelID)` avec spinner
  "Démarrage du serveur local…". Fallback gracieux si échec.

Vérif: TUI CLI → sélection modèle local → spinner → chat OK sans étape
manuelle. Modèle absent → erreur claire.

### Bug 7 — Panneau git changes lent (MOYENNE)

- Parent `session.tsx` : `createMemo` invalidé uniquement sur events
  `file.changed`.
- Remplacer `git diff` full par `git status --porcelain=v2` +
  `git diff --name-status` pour la liste ; diff détaillé par fichier au clic.
- Virtualisation `@tanstack/solid-virtual` si >50 fichiers.

Vérif: repo 100 fichiers → toggle <500 ms. Clic fichier → diff à la demande.

### Bug 8 — QR code internet mode "impossible de joindre" (CRITIQUE)

3 causes :

1. Bind `127.0.0.1` au lieu de `0.0.0.0` même avec `RemoteConfig.enabled=true`.
2. Cert TLS self-signed non trusted mobile (UX install cert manquante).
3. `detect_lan_ip()` échoue si DNS 8.8.8.8 inaccessible.

Fix:

- `packages/desktop/src-tauri/src/server.rs` : si `RemoteConfig.enabled=true`
  → bind `0.0.0.0:<port>`. Warning UI Windows Firewall.
- QR encode `opencode://connect?host=<ip>&port=<p>&fp=<sha256>&token=<uuid>`.
  Mobile auto-trust cert sur la session via fingerprint.
- Fallback : si `detect_lan_ip` échoue → prompt IP manuel + aide `ipconfig`.
- Endpoint `GET /health` non-auth → `{ok, tlsFingerprint}`. Scan mobile ping
  avant handshake → message d'erreur détaillé.

Vérif: `netstat -an | grep <port>` → bind `0.0.0.0`. Scan QR mobile (même
wifi) → dialog fingerprint → chat. Wifi coupé → "Serveur non joignable".

### Bug 9 — LLM réponse très lente (BASSE, UX/docs)

- `packages/mobile/src/components/dialog-local-llm.tsx` : warning si modèle
  trop lourd pour device (<8 GB RAM ou sm8250 CPU-only) → recommandation
  Gemma-4-E2B Q4 (~1.5 GB) / Qwen3 2B Q4 (~1.2 GB).
- Preset "Eco" par défaut si <6 big cores ou <8 GB RAM.
- `README.md` + `MANUAL_TESTS.md` : table modèle par classe de device.

Vérif: 1er lancement mobile → badge "Recommandé pour ce device". Forcer E4B →
warning jaune.

## Ordre d'exécution

1. **Terminal** (1+2) → rebuild + install Mi 10 Pro → portrait + `vim`.
2. **Speech** (3+4) → TTS mobile + voice clone desktop.
3. **Local LLM** (6+9) → TUI + dialog mobile.
4. **OAuth** (5) → feasibility Anthropic d'abord, sinon skip ; Google.
5. **Remote** (7+8) → bind + QR fingerprint + git panel.

## Validation globale

- [ ] `bun test` packages/opencode → 0 fail
- [ ] `bun run typecheck` (monorepo) → 0 erreur
- [ ] `cargo check --release` desktop + `cargo check` mobile → 0 warning
- [ ] `bun run build:android` + sign + `adb install -r` Mi 10 Pro → pas de crash
- [ ] Logcat 30 s → aucun panic, LlamaEngine OK, PTY OK
- [ ] Screenshots terminal portrait + landscape avec prompt visible
- [ ] TTS mobile audible
- [ ] Voice clone desktop audible
- [ ] OAuth Google chat successful
- [ ] QR internet mode scan mobile → chat successful

## Commits attendus

1. `fix(terminal): portrait first-prompt via pty resize in refit loop` (Bug 1)
2. `feat(mobile): bundle busybox-static for vim/less/nano/etc` (Bug 2)
3. `fix(mobile): surface kokoro download errors + progress toast` (Bug 3)
4. `fix(desktop): voice clone immediate sync + test button` (Bug 4)
5. `feat(auth): google oauth flow` (Bug 5, Anthropic conditionnel)
6. `feat(tui): auto-spawn llama-server on local model select` (Bug 6)
7. `perf(app): memoize diffs + virtualize session-side-panel` (Bug 7)
8. `feat(server): bind 0.0.0.0 on remote mode + qr fingerprint` (Bug 8)
9. `docs: device-class model recommendation + eco preset` (Bug 9)
10. `docs: sprint 7 notes + update PROD_READINESS + obsidian vault`
