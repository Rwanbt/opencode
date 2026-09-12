<!--
SPDX-License-Identifier: MIT
Copyright (c) 2026 Unifia contributors
-->

# PRODUCT-CASES — Cas réels justifiant le Sovereign Knowledge Core V1

> 10 cas réels, vérifiables, extraits du dépôt Unifia. Pour chaque cas :
> **tâche**, **workflow actuel**, **échec observé**, **contexte requis**,
> **contexte interdit**, **comportement attendu avec Knowledge Core V1**,
> **preuve**.

> Aucun cas n'est inventé. Chaque référence pointe vers un fichier du
> dépôt ou un ADR/issue vérifiable.

---

## PC-01 — Sidecar stale après modification TypeScript

- **Tâche** : modifier une fonction dans `packages/unifia/src/...` et
  voir le changement prendre effet dans l'app desktop.
- **Workflow actuel** : `bun tauri build` côté `packages/desktop` ;
  copie manuelle de `opencode-cli.exe` (devenu `unifia-cli`) vers
  `sidecars/`.
- **Échec observé** : "l'app desktop se comporte comme avant la
  modification, sans erreur". Symptôme silencieux (pas d'erreur), le
  sidecar sert l'ancien binaire.
- **Contexte requis** : "rebuild CLI requis après modif TS ;
  `bun run build --single --baseline` est la commande canonique".
- **Contexte interdit** : aucune note privée utilisateur ne doit être
  embarquée dans la chaîne de build.
- **Comportement attendu V1** : une note `KNOWN_FAILURE_PATTERNS.md` /
  un mémoire `failure` doit être lue par le ContextRouter dès que
  l'agent touche `packages/unifia/src/**`. Le rappel doit précéder
  la commande, pas la suivre.
- **Preuve** :
  `docs/KNOWN_FAILURE_PATTERNS.md` §"Build & Deploy" → "Sidecar stale
  après modification TypeScript" + lien vers
  `packages/desktop/src-tauri/src/server.rs`.

---

## PC-02 — Bash tool schema bug (Gemma-4)

- **Tâche** : un agent sous Gemma-4 E4B exécute `cargo check` en mode
  boucle.
- **Workflow actuel** : Gemma-4 envoie `dry_run` au lieu de
  `description` ; le schéma exige `description`. Résultat :
  `cargo check`/`build` échouent systématiquement, 5+ retries
  identiques.
- **Échec observé** : boucle de retries sans progression. Perte de
  temps, tokens brûlés.
- **Contexte requis** : contrainte "Gemma-4 envoie `dry_run` ; patcher
  `tool/bash.ts` pour rendre `description` obligatoire et ignorer
  `dry_run`".
- **Contexte interdit** : aucune.
- **Comportement attendu V1** : le `unifia_type: constraint` est
  indexé et hydraté par le ContextRouter. L'agent le voit avant la
  première tentative, pas après 5 retries.
- **Preuve** : `docs/KNOWN_FAILURE_PATTERNS.md` §"LLM & Inference"
  → "Bash tool schema bug (Gemma-4)" + lien vers
  `packages/unifia/src/tool/bash.ts`.

---

## PC-03 — WebSocket auth en query param

- **Tâche** : un agent se connecte au serveur local via WebSocket.
- **Workflow actuel** : le token d'auth est passé en query string
  `?authorization=...`. Les navigateurs strippent le header
  Authorization, donc le projet a choisi le query — mais le query
  apparaît dans les logs réseau (proxy, mitm, capture).
- **Échec observé** : fuite de token dans les logs intermédiaires.
- **Contexte requis** : "WebSocket auth en query est interdit en
  environnement non-isolé".
- **Contexte interdit** : le token lui-même ne doit jamais être copié
  dans une note Markdown, et encore moins vers un provider cloud.
- **Comportement attendu V1** : le `unifia_type: failure` est indexé ;
  toute note contenant le token se voit appliquer
  `unifia_restrictions.remote_model: deny` (et probablement
  `local_model: deny` aussi).
- **Preuve** : `docs/KNOWN_ISSUES.md` "S1.S1" + lien
  `packages/unifia/src/server/auth-jwt.ts:110-145`.

---

## PC-04 — `auth.json` plaintext

- **Tâche** : un agent doit réutiliser un token de provider pour une
  tâche.
- **Workflow actuel** : `auth.json` est stocké en clair, mode `0o600`.
  Pas d'utilisation d'OS keychain.
- **Échec observé** : le token est lisible par tout processus du même
  utilisateur. Risque d'exfiltration par un autre agent.
- **Contexte requis** : "tokens en clair interdits de duplication
  dans le vault, interdits d'egress vers un provider non
  autorisé".
- **Contexte interdit** : tout texte de note qui reprend le token
  mot pour mot.
- **Comportement attendu V1** : le `DataFlowGuard` refuse l'écriture
  dans le vault d'un contenu classifié `credential`. Les notes qui
  référencent le token sont marquées `unifia_restrictions.remote_model:
  deny`.
- **Preuve** : `docs/KNOWN_ISSUES.md` "S1.S2" + lien
  `packages/unifia/src/auth/index.ts`.

---

## PC-05 — Mobile CLI bundle stale

- **Tâche** : recompiler `opencode-cli` (devenu `unifia-cli`) et
  l'embarquer dans l'APK Android.
- **Workflow actuel** : `prepare-android-runtime.sh` ne rebuild
  `opencode-cli.js` qu'à la 1ère compilation.
- **Échec observé** : le bundle embarqué dans l'APK est obsolète. Le
  runtime Android sert l'ancien comportement.
- **Contexte requis** : "la source unique du bundling CLI est
  `scripts/bundle-mobile.mjs`. Ne pas introduire un second
  `bun build` divergent (dette D-17)."
- **Contexte interdit** : aucune.
- **Comportement attendu V1** : la dette D-17 est stockée comme
  `unifia_type: failure` avec lien canonique. L'agent qui touche au
  pipeline Android est averti avant l'action.
- **Preuve** : `docs/KNOWN_FAILURE_PATTERNS.md` §"Android Mobile" →
  "Mobile CLI bundle stale" + référence à `scripts/bundle-mobile.mjs`
  et dette D-17.

---

## PC-06 — Alpine hardlinks — SELinux bloque `link()`

- **Tâche** : extraire le rootfs Alpine dans l'environnement de
  build Android.
- **Workflow actuel** : `tar` essaie de créer un hardlink sur
  `app_data_file`, refusé par SELinux.
- **Échec observé** : `tar` avorte, le build casse.
- **Contexte requis** : "exécuter `fix_hardlinks.py` via WSL avant
  le build Gradle".
- **Contexte interdit** : aucune.
- **Comportement attendu V1** : la contrainte est liée au type
  `unifia_type: failure` + `unifia_space: project` (projet
  `unifia`). L'agent qui lance le build Android la voit
  automatiquement.
- **Preuve** : `docs/KNOWN_FAILURE_PATTERNS.md` §"Android Mobile" →
  "Alpine hardlinks — SELinux bloque `link()`".

---

## PC-07 — OpenCL Adreno K-quants crash

- **Tâche** : faire tourner un modèle quantifié K-quants
  (Q4_K_M/Q5_K_M) sur GPU Adreno 6xx.
- **Workflow actuel** : llama-server exit 134 (`SET_ROWS`), kernel
  OpenCL incompatible.
- **Échec observé** : crash runtime, batterie et temps perdus.
- **Contexte requis** : "K-quants → CPU only ; OpenCL Q4_0/Q8_0
  uniquement sur Adreno 730+ (SM8450+, OCL 3.0+)".
- **Contexte interdit** : aucune.
- **Comportement attendu V1** : la contrainte est indexée avec tags
  `device:adreno-6xx`, `quant:k-quants`. Le routeur refuse la
  combinaison incompatible.
- **Preuve** : `docs/KNOWN_FAILURE_PATTERNS.md` §"LLM & Inference"
  → "OpenCL Adreno K-quants crash" + lien
  `packages/mobile/src/model-catalog.ts`.

---

## PC-08 — Reasoning budget capped 1024 (audit A.2)

- **Tâche** : un agent avec un modèle thinking (Qwen/DeepSeek) doit
  raisonner longuement.
- **Workflow actuel** : budget reasoning capped à 1024 tokens,
  tronqué silencieusement.
- **Échec observé** : la chaîne de pensée est coupée net, l'agent
  hallucine ou échoue.
- **Contexte requis** : "`getThinkingCap()` retourne 8192 pour
  Qwen/DeepSeek thinking, 2048 par défaut, 0.15 fraction du model
  output max".
- **Contexte interdit** : aucune.
- **Comportement attendu V1** : la décision est un ADR accepté, indexé
  comme `unifia_type: decision` avec tags `model:qwen,deepseek`. Le
  ContextRouter la sert quand le provider actif est un thinking model.
- **Preuve** : `docs/KNOWN_ISSUES.md` "A.2" + ADR
  `docs/adr/0011-adaptive-context-sizing.md`.

---

## PC-09 — `ragIndexedDirs` leak (audit B.1)

- **Tâche** : un long processus garde un `Set` de chemins indexés.
- **Workflow actuel** : le `Set` grossit sans borne.
- **Échec observé** : fuite mémoire long-terme, ralentissement
  progressif.
- **Contexte requis** : "remplacer par LRU 64 entries, TTL 30 min".
- **Contexte interdit** : aucune.
- **Comportement attendu V1** : la décision est
  `unifia_type: decision`, hydratée à chaque fois qu'un agent
  propose d'utiliser un Set pour un cache long-terme.
- **Preuve** : `docs/KNOWN_ISSUES.md` "B.1 ragIndexedDirs Set leak".

---

## PC-10 — `static mut PROXY_PORT` race (audit B.A6)

- **Tâche** : un serveur local choisit un port libre.
- **Workflow actuel** : `static mut PROXY_PORT: u16` partagé entre
  threads sans atomicité.
- **Échec observé** : race, deux binds concurrents possibles.
- **Contexte requis** : "remplacer par `AtomicU16` +
  `compare_exchange`".
- **Contexte interdit** : aucune.
- **Comportement attendu V1** : la décision est
  `unifia_type: decision` avec tag `concurrency:rust`. L'agent qui
  propose du `static mut` voit l'ADR avant le commit.
- **Preuve** : `docs/KNOWN_ISSUES.md` "B.A6 `static mut PROXY_PORT`"
  + ADR à créer/nommer.

---

## Mapping capabilities ↔ cas

| Capability V1 | PCs qui la justifient |
|---|---|
| Lifecycle (`candidate`/`active`/`superseded`/`archived`) | PC-01, PC-02, PC-05, PC-08, PC-10 |
| Restrictions portables + egress | PC-03, PC-04 |
| Contexte device-aware (Android, GPU) | PC-06, PC-07 |
| Authority isolation (write/delete) | PC-04, PC-06 |
| Provider independence | PC-08 |
| FTS + graph (backlinks) | PC-01, PC-02, PC-05 |
| External editor safety | PC-01, PC-05, PC-06 |
| Rebuildable indexes | PC-01, PC-05, PC-09 |

**Chaque capability V1 est reliée à au moins un cas réel.** Condition
remplie du Gate P-1 (≥ 5 cas, mapping complet, runbook §9 P-1).

## Source de vérité

- `docs/KNOWN_FAILURE_PATTERNS.md` (207 lignes) — 14+ incidents
- `docs/KNOWN_ISSUES.md` (≈150 lignes lues) — open security, deferred
  mobile, fixed tree
- `docs/adr/0017..0021`, `1026..1032` — décisions pré-existantes à
  réutiliser

## Limites assumées

- Le vault personnel d'Erwan Barat (`D:\Documents\Obsidian\IA_Dev_Brain`)
  contient d'autres incidents qui justifieraient des cas
  additionnels. Ils sont hors périmètre de cette baseline
  (non vérifiables dans le repo `unifia` lui-même, mais leur
  pattern est déjà couvert par les 10 cas ci-dessus).
- Les cas "open" du SECURITY_AUDIT (CORS regex, etc.) sont aussi
  valides ; ils sont laissés en référence pour la Phase 6/8
  (intégration ai-native-dev-stack et Git).
