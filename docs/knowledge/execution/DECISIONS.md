<!--
SPDX-License-Identifier: MIT
Copyright (c) 2026 Unifia contributors
-->

# DECISIONS — Sovereign Knowledge Core V1

> Log des décisions autonomes. Format : date · carte · décision · preuves ·
> alternative rejetée · rollback. Append-only.

---

## D-0001 — Scope de cette session d'implémentation

- **Date** : 2026-08-29
- **Carte** : 0000
- **Décision** : cette session exécute Phase -1 + Phase 0.1 baseline +
  Phase 0.8 ADRs (au moins en ébauche), puis s'arrête sur un checkpoint
  documenté. Les phases 1–11 (contrats, Rust core, FTS, lifecycle,
  semantic, ai-native-dev-stack, Code/Work/Design, Git, MCP, Android,
  hardening) restent à exécuter dans des sessions ultérieures, reprenant
  depuis `STATE.md` sans question.
- **Preuves** : périmètre source ~20 M tokens (3 219 fichiers source-like,
  2 204 TS, 48 Rust), 13 phases, ~50 cartes, frontières externes
  (Android device, embedding model download, MCP remote). Budget session
  est borné.
- **Alternative rejetée** : tenter d'implémenter 13 phases en une session
  — impossible, conduirait à du code partiel sans preuve, qui violerait
  l'interdiction de "PASS hypothétique".
- **Rollback** : aucun code applicatif écrit à ce stade. Le seul artefact
  est la documentation de cadrage.

---

## D-0002 — Origine des cas réels P-1.1

- **Date** : 2026-08-29
- **Carte** : 0001
- **Décision** : les cas réels pour P-1.1 sont extraits de
  `docs/KNOWN_FAILURE_PATTERNS.md` (≥ 14 incidents documentés), du
  `CHANGELOG.md`, de l'ANDROID_AUDIT, et de l'ARCHITECTURE.md. Aucun
  incident inventé.
- **Preuves** : `docs/KNOWN_FAILURE_PATTERNS.md` lisible, déjà structuré
  par section (Build & Deploy, Sidecar & Server, LLM & Inference, Android
  Mobile). Chaque cas réel cite le path du fix historique.
- **Alternative rejetée** : inventer des cas plausibles — interdit par
  le runbook §9 P-1.1 ("Ne jamais inventer un incident").
- **Rollback** : retirer le cas du document `PRODUCT-CASES.md`.

---

## D-0003 — Runbook authority > plan master authority > ADR pré-existants

- **Date** : 2026-08-29
- **Carte** : 0000
- **Décision** : en cas de divergence entre runbook V2 et plan master,
  runbook prévaut (runbook §1.1 : "Le présent runbook V2 pour la méthode
  d'exécution autonome"). En cas de divergence entre plan master et ADR
  pré-existants (`docs/adr/0001..1032`), ADR pré-existant est respecté
  sauf contradiction explicite du plan. AGENTS.md applicable reste premier.
- **Preuves** : runbook V2 §1.1 fixe la hiérarchie.
- **Alternative rejetée** : traiter plan master et runbook comme autorité
  égale — risque d'incohérence d'exécution.
- **Rollback** : la décision est de cadrage, pas d'artefact à rollback.

---

## D-0004 — BruteForceIndex plutot qu'un ANN

- **Date** : 2026-08-29
- **Carte** : 0001
- **Décision** : ADR-KNOW-0008 §3 retient `BruteForceIndex` (O(n)
  par query) plutot qu'un index ANN (HNSW, IVF, etc.) pour V1.
- **Preuves** : bench-large (100 notes x 256 chunks) < 100 ms ;
  vault V1 typique < 5 000 notes. ANN n'apporterait un gain
  qu'au-dela de 50 000 notes (seuil documenté).
- **Alternative rejetée** : HNSW natif Rust — coût d'integration
  + dépendance externe + sur-ingenierie pour le volume V1.
- **Rollback** : remplacer `BruteForceIndex` par un wrapper
  generique sans toucher aux call-sites (interface stable).

---

## D-0005 — Embedding `disabled` par defaut (runbook §8.8)

- **Date** : 2026-08-29
- **Carte** : 0002
- **Décision** : le modele ONNX n'est pas telecharge en V1 ; la
  capability d'embedding reste `disabled`. P5.5 utilise un fake
  embed deterministe (4-dim, byte-mixed) pour les tests.
- **Preuves** : `semantic/embedScore.ts` gere le flag `disabled`
  ; `bench-large` reste vert sans le modele.
- **Alternative rejetée** : telecharger un modele OpenAI
  all-MiniLM (~25 MB) sans validation upstream — incompatible
  avec la posture offline-first.
- **Rollback** : ajouter le modele + flag `enabled` au runtime
  sans casser les tests existants (le fake embed reste valide).

---

## D-0006 — Default deny partout

- **Date** : 2026-08-29
- **Carte** : 0003
- **Décision** : PERMISSIONS.md, policy.json, sovereignty-runner,
  GC (`safeToApply=false` si sidecars manquants), precommit hook
  — tous en default-deny. L'operateur doit explicitement allow
  une destination pour qu'un egress passe.
- **Preuves** : ADR-KNOW-0006, PERMISSIONS.md §2 (5 KB), 5 crash
  scenarios sovereignty.
- **Alternative rejetée** : default-allow (l'AX par défaut) —
  incompatible avec la souverainete.
- **Rollback** : aucun, c'est un invariant architectural.

---

## D-0007 — Append-only strict sur `LifecycleAuditLog`, `STATE.md`, control store

- **Date** : 2026-08-29
- **Carte** : 0004
- **Décision** : trois stores sont append-only by design :
  `LifecycleAuditLog` (TS), `STATE.md` (Markdown), Class C
  control store (Rust). Aucune mutation retro-active possible.
- **Preuves** : P11.14 audit log queryable, STATE.md 74k+ chars
  appendes, WAL Rust append-only avec replay idempotent.
- **Alternative rejetée** : reecriture retro-active — detruit
  l'audit trail et la reproductibilite.
- **Rollback** : aucun (invariant protege par ADR + tests).

---

## D-0008 — P10.2/P10.3 STATUS = `PASS_WITH_SAFE_FALLBACK`

- **Date** : 2026-08-29
- **Carte** : 0221 + 0222
- **Décision** : le device-side container est alive (adb, app
  installed, app running, fs writable, deep-link works) mais la
  chaine complete vault/FTS/graph/policy n'est pas exercable
  sans APK rebuild avec `rootfs.tgz` integre. Le statut est
  documente honnetement au lieu d'un faux `PASS`.
- **Preuves** : `.artifacts/p10-device-{screen.png, report.json,
  run.md}` (Xiaomi Mi 10 Pro, cmi_eea, Android 13, PID 22883).
- **Alternative rejetée** : declarer PASS sans preuve — viole
  le runbook §10.2 ("ne jamais inventer un PASS").
- **Rollback** : lancer `bun --cwd packages/mobile build:android`
  (30-60 min native compile) pour obtenir un vrai PASS.

---

## D-0009 — `useDefineForClassFields` shadow — renommer `events` en `evts`

- **Date** : 2026-08-29
- **Carte** : 0005
- **Décision** : sous le mode strict `useDefineForClassFields`,
  un field prive et un method public de meme nom shadow. Le
  fix : nommer le field `#evts` (ou `#listeners`) et garder
  `events()` comme method public.
- **Preuves** : P11.0 events/bus.ts — capture d'un `TypeError:
  this.events is not a function` en mode strict.
- **Alternative rejetée** : desactiver `useDefineForClassFields`
  globalement — perd les garanties de TS 5.x.
- **Rollback** : renommer le field ; aucun impact API.

---

## D-0010 — `windowDays=0` = "no filter" (recent / stale)

- **Date** : 2026-08-29
- **Carte** : 0006
- **Décision** : pour les conventions de filtre temporel, `0`
  signifie "pas de filtre" (pas "seulement les notes de
  l'instant"). Convention documentee dans `recent.ts` et
  `stale.ts`, et couverte par test dedie.
- **Preuves** : P11.44 (`recent`), P11.39 (`stale`), 16 tests
  cumulés.
- **Alternative rejetée** : `0` = "toutes les notes" en SQL
  brut — semantiquement ambigu cote UI.
- **Rollback** : changer la convention + adapter les tests
  (cohérence required).

---

## D-0011 — `pairKey` symetrique pour tag co-occurrence

- **Date** : 2026-08-29
- **Carte** : 0007
- **Décision** : pour le comptage des paires de tags co-occurrents,
  `pairKey(a, b) = a < b ? a + NUL + b : b + NUL + a`. NUL ne peut
  pas apparaitre dans un tag donc la cle est unique.
- **Preuves** : P11.48 tag-cooccurrence (10 tests).
- **Alternative rejetée** : utiliser un tuple ordonne — donne
  2x plus de clés (a,b) et (b,a), pollue les résultats.
- **Rollback** : trivial, fonction pure.

---

## D-0012 — Fingerprint deterministe (sort locators avant hash)

- **Date** : 2026-08-29
- **Carte** : 0008
- **Décision** : pour `fingerprint.ts`, les locators sont tries
  AVANT le hash. Deux creations dans un ordre different donnent
  sinon deux hash differents — non-reproductible.
- **Preuves** : P11.41 fingerprint (9 tests dont determinism).
- **Alternative rejetée** : hash dans l'ordre de parcours —
  bug subtil qui resiste aux tests aleatoires.
- **Rollback** : trivial, fonction pure.

---

## D-0013 — V1 lifecycle set : exactement 4 etats

- **Date** : 2026-08-29
- **Carte** : 0009
- **Décision** : ADR-KNOW-0009 fixe `candidate | active |
  superseded | archived` comme ensemble ferme. P11.51
  `lifecycle-transitions.ts` est l'unique miroir runtime de
  la matrice ALLOWED dans `memory/lifecycle.ts`.
- **Preuves** : 9 ADR, lifecycle.ts matrice Zod, P11.51 (6 tests).
- **Alternative rejetée** : 5 etats (ajouter `deprecated`) —
  sur-ingenierie pour V1.
- **Rollback** : extension de la matrice + tests de transition
  additionnels.

---

## D-0014 — V1 frontmatter strict = 9 champs

- **Date** : 2026-08-29
- **Carte** : 0010
- **Décision** : `coerceFrontmatterShape` n'accepte QUE les 9
  champs unifies (unifia_schema, unifia_id, unifia_type,
  unifia_lifecycle, unifia_project_ref, unifia_created_at,
  unifia_updated_at, unifia_tags, unifia_supersedes). Tout
  champ supplementaire est silencieusement droppé.
- **Preuves** : parser/frontmatter.ts ligne 30 `StrictFrontmatterSchema`
  + P11.56 (7 tests dont strict behavior).
- **Alternative rejetée** : frontmatter permissif (laisser passer
  les champs custom) — casse la portabilite entre outils.
- **Rollback** : extension de la matrice + tests de round-trip.

---

## D-0015 — Admin tools en lecture seule (sauf mutations explicites)

- **Date** : 2026-08-29
- **Carte** : 0011
- **Décision** : les 33+ admin tools sont read-only par defaut.
  Seules 6 sous-commandes ecrivent : `supersede` (plan + intent
  CAS), `mcp-token` (issue/revoke), `policy` (set-egress/
  set-feature), `portable` (upsert/remove), `gc` (apply),
  `migrate` (rollback). Chaque mutation a un dry-run.
- **Preuves** : docstrings des modules admin, audit log queryable.
- **Alternative rejetée** : admin tools avec side-effects caches
  — incompatible avec la souverainete (runbook §8).
- **Rollback** : aucun, c'est un invariant architectural.

---

## D-0016 — Embedding V1 desactive, fake embed P5.5

- **Date** : 2026-08-29
- **Carte** : 0012
- **Décision** : pour V1, capability d'embedding = `disabled`.
  P5.5 utilise un fake embed deterministe (4-dim, byte-mixed)
  pour permettre `BruteForceIndex` + `embedScore` testables
  sans ONNX runtime. Activation V1.1 si le modele est valide.
- **Preuves** : `semantic/embedScore.ts`, `simulate.ts`, 14 tests
  semantic.
- **Alternative rejetée** : bundler ONNX runtime dans l'APK
  (V1) — overhead 50-80 MB incompatible avec contrainte mobile.
- **Rollback** : flag `embedding=enabled` + chemin ONNX.

---

## D-0017 — Frontmatter V1 strict : `added`/`removed` toujours vides

- **Date** : 2026-08-29
- **Carte** : 0013
- **Décision** : `frontmatterDiff` ne retournera JAMAIS
  `added.length > 0` ou `removed.length > 0` en pratique, parce
  que les 9 champs sont obligatoires dans toutes les notes
  V1. La distinction `changed`/`unchanged` reste utile pour
  detecter les mises a jour de `unifia_updated_at`,
  `unifia_lifecycle`, `unifia_tags`.
- **Preuves** : P11.56 (7 tests dont "V1 strict behavior").
- **Alternative rejetée** : autoriser des champs custom — viole
  D-0014.
- **Rollback** : aucun, comportement emergent du contrat.

---

## D-0018 — V1 admin tools read-only renoncent a `note-stats-batch`

- **Date** : 2026-08-29
- **Carte** : 0014
- **Décision** : pour P11.52 `note-stats`, on reste en mode
  single-note (un locator OU un id a la fois). Un mode batch
  (`note-stats-batch`) est reporte en V1.1 car la complexite
  (pagination, agreagtion) ne justifie pas un admin tool V1.
- **Preuves** : P11.52 interface `NoteStatsInput { locator?, id? }`.
- **Alternative rejetée** : batcher en V1 — sur-ingenierie.
- **Rollback** : ajouter une option `--batch` ; interface additive.

---

## D-0019 — `edge-density` self-link ignore dans `in`/`out`

- **Date** : 2026-08-29
- **Carte** : 0015
- **Décision** : pour P11.55 `edge-density`, un wikilink qui
  pointe vers la note elle-meme (`[[self]]` dans self.md) est
  EXCLU du degre in+out. C'est une convention pour eviter que
  les notes auto-referentielles polluent les stats de connexion.
- **Preuves** : P11.55 (5 tests dont "self-link ignored").
- **Alternative rejetée** : compter les self-links comme in+out=2
  — gonfle artificiellement le degre.
- **Rollback** : option `--include-self-links` (additive).

---

## D-0020 — Sources de verite (single source of truth)

- **Date** : 2026-08-29
- **Carte** : 0016
- **Décision** : la matrice V1 lifecycle transition a UNE seule
  source de verite : `src/knowledge/memory/lifecycle.ts` (avec
  tests derives). `admin/lifecycle-transitions.ts` (P11.51) est
  un DERIVE qui ne fait que formatter pour le CLI. Pareil pour :
  parser (frontmatter.ts), decideEgress (policy/decide.ts),
  embedScore (semantic/embedScore.ts).
- **Preuves** : imports croises verifies, tests 1:1 entre la
  source et le miroir.
- **Alternative rejetée** : dupliquer la matrice dans plusieurs
  modules — derive inevitable.
- **Rollback** : aucun, c'est un invariant architectural.

---

## Bilan au 2026-08-29 (111 commits, 635 verts, HEAD c67a7e22)

20+ decisions documentees (D-0001..D-0020). Append-only.
Runbook V2 + plan master + ADR pre-existants respectes.
Aucune decision prise contre la souverainete (default-deny,
offline-first, provider-independent, append-only).
