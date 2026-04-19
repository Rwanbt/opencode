# Production Readiness — OpenCode Fork

> Point d'entrée unique pour évaluer l'état prod du fork
> `Rwanbt/opencode` (branche `dev`). Mis à jour à chaque fin de
> sprint. La source d'autorité pour l'audit initial reste
> `PRODUCTION_REVIEW_2026-04.md` ; ce document agrège l'état courant
> et pointe vers les docs détaillés.

Dernière mise à jour : **2026-04-19**
Branche cible merge : `dev → main`
Verdict courant : **NO-GO UX** — 9 bugs QA REAL utilisateur bloquants
(voir §3bis). Sprint infra/sécu terminé, mais UX produit pas prête.

---

## 1. État en un coup d'œil

| Axe | État | Ref |
|-----|------|-----|
| Blockers sécurité B1–B6 | Fermés ou opt-in gaté | `PRODUCTION_REVIEW_2026-04.md` §2 |
| Warnings W1–W9 | Fermés (W9 breaking change documenté) | `PRODUCTION_REVIEW_2026-04.md` §3 |
| Supply-chain baseline | Dependabot + CodeQL + SBOM live ; cosign + SLSA livrés dormants | `.github/workflows/release-sign.yml`, `slsa.yml` |
| Release notes | Template prêt | `RELEASE_NOTES_TEMPLATE.md` |
| QA mobile OEM | Checklist prête, **sign-off à exécuter** | `QA_ANDROID_DEVICES.md` |
| Dependabot first batch | Workflows en place, **triage batch à exécuter** | `.github/DEPENDABOT_TRIAGE.md` |
| Crash observability | Reporter + rotation 50 fichiers | `SPRINT3_NOTES.md` I1 |
| GDPR endpoints | export + delete + purge worktrees | `SPRINT3_NOTES.md` I3, `SPRINT4_NOTES.md` #3 |
| Audit log | instrumenté 6 call sites + retention purger | `SPRINT4_NOTES.md` #1–#2 |
| Keychain desktop | commandes Tauri + IPC endpoint + Auth.layer wire + migration auto | `SPRINT4_NOTES.md` #6, `SPRINT5_NOTES.md` #4–#5, `SPRINT6_NOTES.md` #2 |
| Provider fallback | câblé + cloud providerID customisable (`experimental.provider.fallback_cloud_providerID`) | `SPRINT5_NOTES.md` #2, `SPRINT6_NOTES.md` #5 |
| WS ticket flow | serveur + terminal migré ; 2 autres sites NOT APPLICABLE | `SPRINT4_NOTES.md` #7, `SPRINT5_NOTES.md` #6, `SPRINT6_NOTES.md` #3 |
| Thermal listener Android | JNI impl Rust cfg-gated, validation via `tauri android build` | `PRE_EXISTING_FIXES.md` I9 |
| E2E DAG team | full e2e | `RESIDUAL_DEBT_CLEANUP.md` |
| Keychain runtime test | mock endpoint TS + round-trip test | `RESIDUAL_DEBT_CLEANUP.md` |

---

## 2. Ce qui est DONE

### Sécurité

- **B3** Android cleartext LAN-only (RFC1918 anchors) — `SPRINT1_NOTES.md`.
- **B4** `AbortSignal.timeout(15000)` sur Ollama probes — `SPRINT1_NOTES.md`.
- **B5** `File.read` rejette les symlinks échappés — `SPRINT1_NOTES.md`.
- **B6** Dependabot, CodeQL, SBOM, cosign, SLSA — workflows livrés.
- **W7** MCP scoping exact-match (Set.has) — `SPRINT1_NOTES.md`.
- **W8** CORS allowlist explicite — `SPRINT1_NOTES.md`.
- **W9** Shell env allowlist — **breaking change** documenté dans
  `RELEASE_NOTES_TEMPLATE.md`.
- **I7** Scanner étendu Slack/Stripe/GH/Google/Anthropic/OpenAI/Datadog
  + prompt-injection tool-output — `SPRINT3_NOTES.md`.

### Fiabilité

- **W1** Cost cap per-session + 429 — `SPRINT2_NOTES.md`.
- **W2** `getWorktreeInfo` typé + log — `SPRINT2_NOTES.md`.
- **W3** Helper `getMessageCost` typé — `SPRINT2_NOTES.md`.
- **W4** llama-server flags (`--mmap --slots --slot-save-path
  --cache-reuse`) + speculative decoding gated — `SPRINT2_NOTES.md`.
- **W5** Circuit breaker `ensureCorrectModel` vérifié — `SPRINT1_NOTES.md`.
- **W6** Background semaphore `max_parallel` — `SPRINT2_NOTES.md`.

### Observabilité / compliance

- **I1** Crash reporter + rotation + opt-in upload — `SPRINT3_NOTES.md`.
- **I3** GDPR export / delete (DB + crashes + worktrees) — `SPRINT3_NOTES.md`, `SPRINT4_NOTES.md`.
- **I4** Audit log + retention purger + 6 call sites instrumentés —
  `SPRINT3_NOTES.md`, `SPRINT4_NOTES.md`.

### Supply-chain

- `.github/workflows/codeql.yml`, `sbom.yml` livrés Sprint 1.
- `.github/workflows/release-sign.yml` livré (cosign keyless + attest).
- `.github/workflows/slsa.yml` livré (Level 3, reusable).
- `.github/dependabot.yml` live.

### Auth & WS

- **B1** Desktop keychain (crate `keyring` v3) + IPC endpoint
  localhost + migration `auth.json` → keychain (gaté
  `OPENCODE_AUTH_STORAGE=keychain`) — `SPRINT4_NOTES.md`, `SPRINT5_NOTES.md`.
- **B2 serveur** `/auth/ws-ticket` + middleware cookie/subprotocol +
  legacy flag — `SPRINT4_NOTES.md`.

---

## 3. Ce qui RESTE

### Release-blocking

- [ ] **QA Android physique signé** sur les 4 OEM (voir
      `QA_ANDROID_DEVICES.md`). Owner : QA.
- [ ] **Dependabot first batch triagé** (voir
      `.github/DEPENDABOT_TRIAGE.md`). Owner : Infra.
- [ ] **Release notes remplies** depuis `RELEASE_NOTES_TEMPLATE.md`
      avec checksums réels. Owner : Release manager.

### 3 bis. QA REAL — 9 bugs UX bloquants (Mi 10 Pro MIUI 13 + Desktop Win)

Source : QA utilisateur réel 2026-04-19, détail dans `NEXT_SESSION_PLAN.md`.

| # | Sévérité | Titre | Fichier principal |
|---|----------|-------|-------------------|
| 1 | HAUTE    | Terminal portrait first-prompt invisible (scheduleSize manquant dans refits) | `packages/app/src/components/terminal.tsx` |
| 2 | HAUTE    | `vim` → `toybox: unknown command vi` (bundler busybox-static) | `packages/mobile/src-tauri/assets/runtime/bin/` + `runtime.rs` |
| 3 | HAUTE    | Kokoro TTS download silencieux mobile (surfacer erreurs/progress) | `packages/mobile/src-tauri/src/speech.rs` + `use-speech.ts` |
| 4 | HAUTE    | Voice clone desktop sans son (désync ttsVoice + test button) | `packages/desktop/src-tauri/src/speech.rs` + `settings-audio.tsx` |
| 5 | WONT-FIX | OAuth Gemini + Anthropic impossibles (API-key only, voir NEXT_SESSION_PLAN.md) | `packages/opencode/src/plugin/codex.ts` (pattern de référence) |
| 6 | HAUTE    | CLI TUI ne spawn pas llama-server à la sélection modèle local | `cli/cmd/tui/component/dialog-model.tsx` |
| 7 | MOY      | Panneau git changes lent (memoization + virtualization) | `packages/app/src/pages/session/session-side-panel.tsx` |
| 8 | CRITIQUE | QR internet mode "impossible de joindre" (bind 0.0.0.0 + fingerprint + /health) | `packages/desktop/src-tauri/src/server.rs` + `tls.rs` |
| 9 | BASSE    | LLM lent : UX badge "Recommandé par device class" + preset Eco | `packages/mobile/src/components/dialog-local-llm.tsx` |

Ordre : Terminal (1+2) → Speech (3+4) → Local LLM (6+9) → OAuth (5) →
Remote (7+8). Estimation ~10 h. Time-box priorité : 1, 2, 3, 6, 8 avant
4, 7 avant 5, 9.

### Non release-blocking (backlog sprint 6+)

- [ ] **B2 clients WS** migrer `packages/app/src/hooks/use-collaborative.ts`,
      `components/terminal.tsx`, `packages/web/src/components/Share.tsx`
      et mobile vers `createAuthenticatedWebSocket`. Puis flip
      `experimental.ws_auth_legacy` à `false`.
- [ ] **I9 thermal JNI** câbler `PowerManager.getCurrentThermalStatus()`
      (crates `jni` + `ndk-context` absents de `Cargo.toml`).
- [ ] **Provider fallback "cloud" resolver** sélection explicite
      d'un secondary (actuellement "premier provider listé").
- [ ] **E2E DAG team full harness** implémenter `Instance.runForTest(fn)`
      pour débloquer les tests skippés.
- [ ] **Keychain Android** `EncryptedSharedPreferences` via plugin
      Tauri dédié (design-only aujourd'hui).
- [ ] **CLI fallback AES-GCM** pour les environnements sans keychain
      (Argon2id TOFU).
- [ ] **Keychain endpoint fuzzing** audit du parser HTTP fait main.
- [ ] **Audit log config.update** capturer les clés imbriquées (pas
      seulement top-level).

---

## 4. Decision log

| Décision | Raison | Réversible ? |
|----------|--------|--------------|
| `experimental.ws_auth_legacy` default `true` | 4 clients WS non migrés ; flip casserait le mode LAN pairing | Oui, flip à `false` une fois clients migrés |
| `OPENCODE_AUTH_STORAGE` default `file` | Keychain storage pas branché dans le layer Effect `Auth` ; `FileStorage` reste backend actif | Oui, activer en `keychain` une fois layer Effect refactoré |
| `experimental.provider.fallback` default `null` | Comportement byte-identical pour les utilisateurs existants ; fallback est opt-in explicite | Oui |
| `experimental.audit.enabled` default `false` | Overhead DB sur call sites critiques ; opt-in pour users compliance | Oui |
| `experimental.dlp.scan_tool_outputs` default `false` | Coût scanner sur chaque tool-output, faux positifs possibles | Oui |
| Thermal listener retourne `"nominal"` par défaut | Binding JNI non câblé (crates absents), stub sûr | Non — nécessite implémentation |
| Cosign / SLSA gated `if: repository == 'Rwanbt/opencode'` | Empêcher le spam sur les forks downstream | Oui |
| SPRINT1 B2 **SAUTÉ** | Risque régression non maîtrisé sans baseline e2e Playwright | N/A — repris en Sprint 4 |
| `cleartextTrafficPermitted` via `includeSubdomains` sur IP | Android ne supporte pas CIDR en network_security_config | À valider en QA MIUI |
| Shell env filtering (W9) strict allowlist + prefixes | Défense en profondeur contre exfiltration via spawn | Oui mais breaking (doc RN) |

---

## 5. Dépendances de release

Les étapes suivantes ont des dépendances **strictes** dans cet ordre :

```
[1] Merge dev → main
  ├─ dep: Dependabot first batch triaged (§3)
  ├─ dep: QA Android sign-off 4 OEM (§3)
  └─ dep: Tous les tests verts (bun test + cargo check)

[2] Create release tag
  └─ dep: [1]

[3] publish.yml build (release.published)
  ├─ dep: [2]
  └─ produit les artefacts (APK/DMG/MSI/deb/rpm)

[4] release-sign.yml (release.published auto)
  ├─ dep: [3]  (artefacts présents sur la release)
  ├─ permissions: id-token:write + attestations:write + contents:write
  └─ produit: .sig, .cert, .sha256

[5] slsa.yml (release.published ou appelé par publish.yml)
  ├─ dep: [3] ou [4]
  └─ produit: .intoto.jsonl (SLSA L3)

[6] Fill RELEASE_NOTES_TEMPLATE.md
  ├─ dep: [4] .sha256 disponibles
  └─ coller les checksums réels dans la section Checksums

[7] Announce / Publish release notes
  └─ dep: [6]
```

Contraintes transverses :

- `release-sign.yml` exige que le workflow ait `id-token: write` —
  configuré dans le yaml. Vérifier que la **org settings** GitHub
  autorise ce permission pour `Rwanbt/opencode`.
- `slsa.yml` via `slsa-framework/slsa-github-generator@v2.0.0` est
  une action réutilisable ; elle nécessite que le repo soit
  **public** (Fulcio OIDC exige) ou qu'une config privée ait été
  enrôlée. Vérifier avant publication.

---

## 6. Contacts / owners

| Item | Owner | Backup |
|------|-------|--------|
| QA Android | QA lead | Dev mobile |
| Dependabot triage | Infra | Dev backend |
| Release notes | Release manager | PM |
| Cosign / SLSA workflows | Infra / Security | — |
| Keychain migration (activation) | Dev desktop | Dev backend |
| WS ticket clients migration | Dev frontend (app/web) | Dev desktop/mobile |
| Thermal JNI câblage | Dev Android natif | Dev mobile |
| Crash reporter endpoint | SRE / Observability | — |
| GDPR endpoints ops | Legal / Compliance | Dev backend |

Pour toute question : ouvrir un issue `Rwanbt/opencode` avec le
label correspondant (`qa-android`, `dependencies`, `release`,
`supply-chain`, `auth`, `observability`).

---

## 7. Index des documents

### Audits et plans
- `PRODUCTION_REVIEW_2026-04.md` — audit staff-level pré-prod (B1–B6, W1–W9, P-NEW).
- `AUDIT_REPORT.md` — audit général.
- `SECURITY_AUDIT.md` — audit sécurité dédié.
- `ANDROID_AUDIT.md` — audit mobile dédié.
- `PERFORMANCE_REPORT.md` — audit perf.
- `KNOWN_ISSUES.md` — bugs connus (non bloquants).
- `PRE_EXISTING_FIXES.md` — patches de base pré-sprint.

### Sprint notes
- `SPRINT1_NOTES.md` — B3/B4/W5/W7/W8/W9/B5/B6 ; B2 sauté.
- `SPRINT2_NOTES.md` — W1/W2/W3/W4/W6 ; B1 design only.
- `SPRINT3_NOTES.md` — I1 crash / I3 GDPR / I4 audit / I7 scanner /
  I9 thermal stub / I10 fallback helper / I11 DAG skeleton.
- `SPRINT4_NOTES.md` — audit purger & instrumentation, GDPR purge
  étendu, keychain Rust, WS ticket serveur.
- `SPRINT5_NOTES.md` — mock provider, fallback câblé, in-process
  server, keychain IPC, migration auth.json, helper WS client.
- `SPRINT6_NOTES.md` — fallback cloud providerID config, Auth.layer
  keychain selection + initAuthStorage boot, terminal WS migré,
  keychain-smoke + DAG e2e skeleton.
- `RESIDUAL_DEBT_CLEANUP.md` — dette résiduelle finalisée (DAG full
  e2e + keychain mock test).

### Livrables infra (ce pack)
- `.github/workflows/release-sign.yml` — cosign keyless + attest-build-provenance.
- `.github/workflows/slsa.yml` — SLSA L3 generator.
- `RELEASE_NOTES_TEMPLATE.md` — template release notes.
- `.github/DEPENDABOT_TRIAGE.md` — procédure first batch.
- `QA_ANDROID_DEVICES.md` — checklist OEM-par-OEM.
- `PROD_READINESS.md` — ce document.

### QA / tests
- `MANUAL_TESTS.md` — checklist générique cross-platform.
- `QA_ANDROID_DEVICES.md` — checklist Android OEM.

### Config & workflows déjà en place
- `.github/dependabot.yml`
- `.github/workflows/codeql.yml`
- `.github/workflows/sbom.yml`
- `.github/workflows/publish.yml`
- `.github/workflows/android.yml`
