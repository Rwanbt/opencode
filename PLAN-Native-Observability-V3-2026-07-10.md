# PLAN-Native-Observability-V3 — Production-safe → Production-ready

Date: 2026-07-10  
Statut: **GO conditionnel Phase 0**, puis **GO Phase 1 uniquement si les gates P0 V3 sont résolues et testées**.  
Remplace: `PLAN-Native-Observability-V2-Production-Ready.md`.

Ce plan V3 intègre la review V2 par GLM, Gemini, Mistral, Minimax, DeepSeek, Qwen et Claude. La V2 a été globalement validée, mais les reviews ont identifié des trous de précision autour de la clé HMAC locale, de l’auth/ownership, de l’ordre de la queue, du comportement crash, des suppressions de session, de la migration/rollback, du schéma Phase 1 et des tests de résilience.

---

## 0. Résumé exécutif

Le pivot vers une observabilité native locale reste validé. Le cœur reste SQLite/Drizzle, Hono/Zod/OpenAPI/SDK et UI SolidJS intégrée. OTel/Langfuse restent exclus du cœur et ne reviennent qu’en Phase 4 comme exporters optionnels recevant une projection déjà redacted.

La V3 ne change pas la direction du plan. Elle transforme la V2 en plan directement implémentable, avec les décisions manquantes explicitement tranchées.

### Ce que la V3 confirme

- **TraceContext explicite**, jamais `AsyncLocalStorage`, pour la corrélation canonique.
- **Aucun contenu lisible en Phase 1**, même dans `local_redacted`.
- **Lifecycle complet** `started` → `finished|failed|aborted` pour LLM et tools.
- **Queue bornée, batchée, avec retry, circuit breaker et métriques**, mais jamais bloquante pour le flux produit.
- **Pagination keyset** sur `(ts_ms, id)`.
- **HMAC-SHA256 avec clé locale d’installation**, jamais SHA brut.
- **Sanitizer borné, chunké, fail-closed**, avec court-circuit binaire/MIME.
- **Events append-only**; les états dérivés (`orphaned`) sont calculés à la lecture.

### Ce que la V3 ajoute par rapport à V2

- ADR-1027: source, stockage, permissions, wipe et rotation de `localInstallSecret`.
- Validation Zod stricte de `TraceContext`, `ObservabilityInput` et JSON avant insertion.
- Modèle d’auth Phase 1 explicite: aucune supposition non prouvée; preuve fichier:ligne ou gate bloquante.
- Stratégie d’ordre queue/retry: FIFO logique, `enqueue_seq`, reconciliation par `span_id`.
- Politique claire sur perte queue au hard crash: limitation connue, testée, non survendue.
- Suppression minimale à la demande en Phase 1: `DELETE /observability/data` pour session/project/workspace/all.
- Purge applicative des events quand une session est supprimée ailleurs dans l’app.
- Schéma Phase 1 simplifié: pas de colonnes `local_content_redacted`/`local_full` avant Phase 3.
- Queue par défaut réduite et bornée en octets: `maxQueueEvents=500`, `maxQueueBytes=64 MiB`.
- `record()` retourne `RecordResult` au lieu de `void`.
- Coût en `nano_usd` entier + snapshot de pricing.
- Stratégie migration/rollback et CI SDK drift.
- Threat model at-rest: SQLite non chiffré par défaut, documenté explicitement.

### Verdict V3

**GO conditionnel pour Phase 0.**  
**GO Phase 1 seulement après validation des P0-1 à P0-14 ci-dessous.**

Le produit n’est “production-ready” qu’à la fin Phase 4, après effacement/export, UI privacy, exporters redacted-only, soak/fuzz, docs et threat model final. La Phase 1 vise une **fondation production-safe metadata**, pas un produit complet.

---

## 1. Gates P0 V3 avant le premier commit applicatif de Phase 1

### P0-1 — Corrélation canonique par `TraceContext` explicite

Décision: `AsyncLocalStorage` est interdit dans le chemin observability Phase 1.

```ts
export interface TraceContext {
  traceId: string        // ULID, stable pour un tour/opération agent
  spanId: string         // ULID, stable pour started + terminal du même span
  parentSpanId?: string  // ULID
  sessionId?: string
  projectId?: string
  workspaceId?: string
  messageId?: string
  turnId?: string
  stepIndex?: number
  userIdHmac?: string
}
```

Règles:
- `traceId` et `spanId` sont générés par `observability/id.ts` via ULID ou UUIDv7 si déjà disponible dans le repo. Phase 1 recommande ULID pour ordre temporel + unicité pratique.
- `started` et son event terminal réutilisent **le même `spanId`**.
- `parentSpanId` exprime la hiérarchie logique, mais son absence ne bloque pas l’écriture.
- `TraceContext` est validé par Zod avant enqueue.
- Aucun appel `Observability.record()` ne lit ALS, OTel Context ou Baggage.

Acceptation:
- test 100 sessions concurrentes × 100 events: aucune contamination `sessionId/projectId/traceId`.
- test `TraceContext` invalide: event rejeté, compteur `eventsRejectedInvalidContext` incrémenté, session produit continue.
- grep/AST CI: aucun import `AsyncLocalStorage` dans `observability/*` hors tests de non-régression.

---

### P0-2 — `local_redacted` sans texte libre

Décision: Phase 1 ne persiste aucun texte lisible utilisateur/assistant/tool/error.

Niveaux:
- `local_metadata`: types, statuts, durées, tokens, coût, tailles, enums, HMACs.
- `local_redacted`: dérivés non reconstructibles supplémentaires: classes de secret, flags de redaction/troncature, HMACs, tailles.
- `local_content_redacted`: Phase 3 uniquement; texte redacted borné, opt-in TTL.
- `local_full`: Phase 3 uniquement; texte brut borné, opt-in TTL court.

Règles Phase 1:
- Pas de prompt/réponse redacted lisible.
- Pas de tool args/output redacted lisible.
- Pas de `error.message` excerpt, même “100 chars redacted”. Pour la debuggabilité Phase 1, stocker `error_kind`, `error_code`, `error_message_hmac`, `error_template_id` si disponible.
- Les extraits redacted lisibles sont reportés à `local_content_redacted` Phase 3.

Acceptation:
- snapshot DB négatif sur prompts, réponses, args, outputs, stacks, chemins absolus, chemins relatifs sensibles, usernames, emails, secrets, URL `file://`.
- `resolveCapturePolicy()` Phase 1 ne peut retourner que `local_metadata|local_redacted`.

---

### P0-3 — Schéma SQL Phase 1 figé, minimal, append-only

Décision: créer une table `observability_event` Phase 1 sans colonnes de contenu Phase 3.

Décision sur `id` vs `event_id`:
- `id`: entier auto-incrémenté interne, optimisé pour keyset pagination et joins.
- `event_id`: ULID public non énumérable, utilisé par API detail/export et corrélation externe future.
- Le coût d’un index unique sur `event_id` est accepté pour éviter d’exposer un identifiant séquentiel dans l’API. Si benchmark d’écriture échoue, reconsidérer en Phase 1 avant merge.

Colonnes Phase 3 **non créées en Phase 1**:
- pas de `local_content_redacted_json`;
- pas de `local_full_json`.

Acceptation:
- migration additive uniquement;
- `drizzle-kit generate` propre;
- `EXPLAIN QUERY PLAN` validé;
- JSON validé par Zod avant insertion;
- aucune FK bloquante tant que l’ownership/purge applicative n’est pas prouvé;
- aucune colonne de contenu lisible en Phase 1.

---

### P0-4 — Lifecycle complet LLM/tools

Chaque opération observable produit:
- un event `*.started`;
- exactement zéro ou un event terminal `*.finished|*.failed|*.aborted`.

Events:
- `llm.call.started`
- `llm.call.finished`
- `llm.call.failed`
- `llm.call.aborted`
- `tool.call.started`
- `tool.call.finished`
- `tool.call.failed`
- `tool.call.aborted`
- `observability.write.dropped`

Règles:
- Le terminal réutilise le `spanId` du `started`.
- Les events `started` sans terminal après `orphanAfterMs` sont **affichés comme orphaned à la lecture**, sans UPDATE.
- Un timeout provider est `failed` ou `aborted` selon source.
- Une annulation utilisateur est `aborted`.
- Une exception tool est `tool.call.failed`.

Acceptation:
- tests LLM success/failure/abort.
- tests tool success/failure/abort.
- test started sans terminal → `derivedStatus=orphaned` dans API après seuil.

---

### P0-5 — HMAC local et ADR-1027 obligatoire

Décision: tout pseudonyme ou hash sensible utilise HMAC-SHA256 avec `localInstallSecret`.

#### ADR-1027 — Source et cycle de vie de la clé HMAC locale

1. **Génération**  
   À la première activation de l’observabilité, générer 32 bytes cryptographiquement sûrs via `crypto.getRandomValues(new Uint8Array(32))` ou `node:crypto.randomBytes(32)`. `Bun.randomUUID()` est interdit pour une clé.

2. **Stockage Phase 1**  
   Stocker la clé dans un fichier dédié, hors DB observability, dans le répertoire config local OpenCode existant. Nom recommandé: `observability_hmac.key`.  
   Permissions:
   - fichier: `0600`;
   - dossier parent: `0700` si OpenCode contrôle sa création;
   - ne jamais écrire la clé dans logs, DB, exports ou UI.

   Le chemin exact doit être dérivé des primitives de config existantes d’OpenCode. Si aucun chemin config canonique n’est identifié avec citation code, ajouter un gate bloquant avant implémentation.

3. **Wipe / perte de clé**  
   Si la clé est supprimée alors que la DB reste présente, les HMACs historiques ne sont plus corrélables avec les nouveaux. C’est un comportement accepté et documenté: la continuité des stats par utilisateur/chemin peut être perdue, mais la confidentialité augmente.

4. **Rotation**  
   Phase 1: rotation manuelle documentée = supprimer la clé + redémarrer, avec warning sur perte de corrélation.  
   Phase 2+: option UI/CLI `rotate-secret` possible, sans réécriture rétroactive des events.

5. **Backup**  
   Pas de backup automatique de la clé en Phase 1, pour éviter de multiplier les secrets. Documenter que sauvegarder la DB sans la clé rend les HMACs historiques non corrélables.

Acceptation:
- tests permissions si OS le permet;
- test clé stable au redémarrage;
- test clé différente → HMAC différent;
- test suppression clé → nouvelle clé + stats corrélation rompues documentées.

---

### P0-6 — Bornes payload/sanitizer/SQL et court-circuit binaire

Limites Phase 1:
- `maxObservedInputBytes`: 256 KiB par champ analysé.
- `maxStoredJsonBytes`: 64 KiB par event Phase 1.
- `maxQueueEvents`: 500.
- `maxQueueBytes`: 64 MiB.
- `sanitizerChunkBytes`: 4 KiB.
- `maxSanitizerScanBytes`: 256 KiB.
- `maxToolOutputClassifyBytes`: 64 KiB.

Règles:
- Troncature avant regex/entropie.
- `payload_truncated=true` si troncature.
- `original_size_bytes` si disponible.
- Base64/binaire/PDF/image: court-circuit par MIME ou signature; stocker seulement type, taille, hash HMAC borné si utile. Pas d’analyse entropique complète.
- Pas de HMAC sur payload géante complète: HMAC du préfixe borné + taille + type.
- Timeout sanitizer optionnel; fail-closed si timeout/exception.

Acceptation:
- payload 10 MiB ne bloque pas la session;
- base64/PDF/image ne déclenche pas de scan coûteux;
- code minifié ne cause pas ReDoS;
- `redaction_status=failed_closed` si sanitizer échoue.

---

### P0-7 — Queue bornée, ordre défini, retour `RecordResult`

API:

```ts
export type RecordResult =
  | { ok: true; accepted: true; enqueueSeq: number }
  | { ok: false; reason: "disabled" | "invalid_context" | "invalid_event" | "queue_full" | "circuit_open" | "sanitizer_failed" }

export namespace Observability {
  export function record(ctx: TraceContext, event: ObservabilityInput): RecordResult
  export async function flush(opts?: { timeoutMs?: number }): Promise<FlushResult>
  export function stats(): ObservabilityStats
}
```

Paramètres Phase 1:
- `batchSize`: 100.
- `flushIntervalMs`: 250.
- `maxQueueEvents`: 500.
- `maxQueueBytes`: 64 MiB.
- `maxRetries`: 3.
- `retryBackoffMs`: 50, 250, 1000.
- `flushTimeoutMs`: 1000.

Ordre:
- Un compteur monotone `enqueueSeq` est assigné à l’acceptation.
- La queue est FIFO à consommateur unique en Phase 1.
- Le batch insère en ordre `enqueueSeq`.
- En cas d’échec partiel, retry conserve `enqueueSeq`.
- La lecture ne dépend pas de l’ordre d’insertion pour corréler `started`/terminal; elle utilise `span_id`.

Overflow:
- Politique: **priority-aware drop oldest**.
- Priorité haute: terminal `finished|failed|aborted` avec coût/tokens/erreur.
- Priorité basse: `started` sans payload critique.
- Si full, tenter de libérer de l’espace en dropant les plus vieux events basse priorité.
- Si impossible, dropper le nouvel event et retourner `queue_full`.
- Toujours incrémenter `eventsDroppedQueueFull`.
- Si possible, émettre ensuite `observability.write.dropped`, mais ne pas boucler si la queue est pleine.

Crash:
- Crash dur/SIGKILL avant flush peut perdre la queue mémoire.
- Cette perte est **acceptée comme limite connue** et n’est pas détectable parfaitement au redémarrage en Phase 1.
- Le plan ne prétend plus que cette classe de perte est “non silencieuse”. Les pertes normales non-crash sont exposées par counters.

Acceptation:
- test ordre started→finished même `spanId`.
- test retry sans réordonnancement logique.
- test overflow: terminal récent préservé autant que possible.
- test crash recovery: DB non corrompue; perte queue documentée.

---

### P0-8 — API keyset, auth/ownership prouvé, route names

Routes Phase 1:
- `GET /observability/events`
- `GET /observability/events/:eventId`
- `GET /observability/settings`
- `GET /observability/summary` minimal
- `GET /observability/health`
- `DELETE /observability/data` minimal privacy

Pagination:
- keyset uniquement, jamais OFFSET;
- `ORDER BY ts_ms DESC, id DESC` pour listing récent;
- cursor opaque base64url `{ tsMs, id, direction }`;
- filtre stable: `(ts_ms < cursor.tsMs OR (ts_ms = cursor.tsMs AND id < cursor.id))` pour ordre DESC;
- `limit` défaut 100, max 200.

Auth/ownership:
- Phase 0 doit identifier avec citation fichier:ligne le mécanisme d’auth/ownership serveur existant.
- Si le mécanisme existe: le réutiliser et tester workspace/project/session ownership.
- Si le mécanisme n’existe pas: gate P0-8 bloque jusqu’à l’ajout d’un modèle minimal.

Modèle minimal acceptable si app locale:
- serveur bind loopback par défaut;
- token local ou mécanisme équivalent déjà utilisé par OpenCode;
- CORS/origin restrictif;
- aucune exposition à webviews/extensions non fiables;
- accès remote explicitement opt-in et authentifié.

Ownership par filtres:
- Pour `sessionId`, vérifier que la session appartient au workspace/project courant avant requête events.
- Pour `traceId`, vérifier au moins un event/session lié accessible au scope courant via requête préalable ou join applicatif.
- Ne jamais utiliser `userIdHmac` comme preuve d’autorisation.

Acceptation:
- tests 403/404 selon modèle choisi;
- cursor forgé → 400;
- traceId d’un autre workspace → 403 ou 404 non révélateur;
- disabled capture: lecture/suppression historique autorisées si auth OK.

---

### P0-9 — Invariant d’innocuité produit

L’observabilité ne doit jamais casser la session LLM/tool.

Cas testés:
- DB locked / `SQLITE_BUSY`;
- `SQLITE_FULL` simulé si possible;
- `SQLITE_CORRUPT` simulé si possible;
- sanitizer throw;
- payload 10 MiB;
- queue full;
- circuit open;
- config invalid;
- auth route invalid.

Comportement:
- le flow produit continue;
- record retourne un `RecordResult` non-ok;
- counters/health exposent l’état;
- logs rate-limited;
- circuit breaker s’ouvre si nécessaire.

---

### P0-10 — Suppression et orphelins de session

Décision: les events d’observabilité ne doivent pas survivre indéfiniment à la suppression explicite d’une session/projet/workspace.

Phase 1 inclut:
- purge par rétention;
- `DELETE /observability/data` minimal;
- fonction applicative `Observability.deleteByScope(scope)`;
- raccord au flux existant de suppression de session si identifiable avec preuve code.

Règles:
- Si une session est supprimée via l’app, les events de cette session doivent être supprimés dans le même workflow applicatif ou lors d’une purge compensatrice au prochain démarrage.
- Sans FK stricte, une purge applicative est obligatoire.
- Les events sans sessionId restent purgeables par project/workspace/retention.

Acceptation:
- supprimer une session puis vérifier absence d’events `session_id` correspondant.
- `DELETE /observability/data` exige confirmation explicite, clone du pattern GDPR si disponible.

---

### P0-11 — Migration, rollback et SDK drift

Migration:
- `up`: création table + index uniquement.
- aucune modification des tables existantes.
- pas de migration destructive.
- `schema_version=1` sur chaque event.

Rollback:
- Drizzle ne garantit pas un down automatique. Le rollback Phase 1 est manuel et destructif: `DROP TABLE observability_event` + suppression routes/UI si besoin.
- Downgrade applicatif après migration: non supporté sauf procédure manuelle documentée.
- Avant release, documenter la procédure de restauration depuis backup utilisateur si OpenCode en a une.

SDK drift CI:
- Ajouter un step CI: régénérer SDK puis `git diff --exit-code` sur le SDK généré.
- Toute route observability modifiée sans SDK regen fait échouer la CI.

Acceptation:
- test migration sur DB existante avec données.
- test `EXPLAIN QUERY PLAN`.
- CI SDK drift documentée.

---

### P0-12 — Pricing snapshot et précision coût

Décision: stocker le coût calculé au moment de l’appel, sans recalcul rétroactif.

Colonnes:
- `cost_nano_usd`: entier nullable, nano-dollar.
- `pricing_version`: string nullable.
- `pricing_source`: string nullable (`Session.getUsage`, table locale, provider metadata, unknown).
- `cost_computed_at_ms`: integer nullable.

Règles:
- Ne pas utiliser `microusd` en Phase 1 pour éviter arrondis à zéro sur petits coûts.
- Les coûts historiques ne sont jamais réécrits quand le pricing change.
- Si le prix est inconnu, `cost_nano_usd` null + `pricing_source=unknown`.

Acceptation:
- test modèle très bon marché: coût non arrondi à zéro si calculable.
- test changement pricing: historique inchangé.

---

### P0-13 — Threat model at-rest et backups

Décision Phase 1:
- SQLite observability n’est pas chiffré par défaut.
- Sécurité at-rest = permissions OS + dossier utilisateur + absence de contenu lisible en Phase 1.
- Documentation obligatoire: vol de laptop / accès disque local = attacker peut lire metadata/HMACs.
- Pas de backup automatique Phase 1 pour éviter de retenir des données que l’utilisateur pense avoir supprimées.

Phase 3 local_full:
- warning UI rouge obligatoire;
- documentation chiffrement at-rest obligatoire;
- si OpenCode a une primitive de secret/chiffrement locale, l’évaluer avant activation générale de `local_full`.

Acceptation:
- docs limites SQLite non chiffré;
- warning UI pour `local_full` prévu;
- `DELETE /observability/data` documente que les exports/backups externes ne sont pas supprimés automatiquement.

---

### P0-14 — Legacy telemetry et test zéro réseau

Décision:
- `experimental_telemetry` legacy ne doit pas être présenté comme chemin de persistance native.
- Phase 0 doit trancher: décommissionner, renommer, ou documenter explicitement comme OTel legacy externe.

Test zéro réseau:
- Avec `experimental.observability.enabled=true` et `exporters=[]`, mocker/espionner `fetch`, `Bun.connect` ou primitives réseau pertinentes.
- Vérifier qu’aucun appel réseau n’est causé par l’observabilité locale.
- Les appels provider LLM normaux restent autorisés; le test doit isoler l’observability path.

Acceptation:
- test no-network observability.
- doc/warning pour telemetry legacy.

---

## 2. Invariants V3

1. Le fonctionnement local ne dépend d’aucun serveur externe.
2. La liste d’exporters est vide par défaut.
3. Aucun blocage du réseau global: LLM/MCP/skills distantes continuent.
4. Le stockage local d’observabilité ne connaît aucun client réseau.
5. Un exporter ne reçoit qu’une `ExportProjection` validée Zod, jamais la ligne brute.
6. Aucun contenu lisible prompt/réponse/tool output/tool args/error n’est persisté en Phase 1.
7. `local_content_redacted` et `local_full` exigent opt-in visible UI, TTL et révocation.
8. Aucun username/email/secret/chemin absolu/URL `file://`/stack brute persisté dans les niveaux non-full.
9. Identifiants, chemins, skill names et MCP servers sensibles sont HMACés avec clé locale.
10. Aucune donnée de corrélation n’est propagée au réseau.
11. La corrélation Phase 1 est explicite par paramètre, jamais ALS/Baggage/OTel Context.
12. Réutilisation de Drizzle/SQLite existant, sauf preuve chiffrée de contention.
13. Events append-only; pas d’UPDATE applicatif pour changer leur statut.
14. Les états dérivés (`orphaned`) sont calculés à la lecture.
15. Purge par rétention et suppression à la demande incluses dès Phase 1.
16. Queue, sanitizer, JSON et DB write path sont bornés en temps/taille.
17. Aucun flush asynchrone non borné dans `process.on("exit")`.
18. API via Hono + Zod/OpenAPI + SDK généré.
19. Keyset pagination obligatoire.
20. L’observabilité ne casse jamais la session produit.
21. Les échecs normaux d’observability sont visibles via `/observability/health`; les pertes sur hard crash avant flush sont documentées comme limite.
22. SQLite local non chiffré par défaut est une décision documentée, pas une omission.

---

## 3. Matrice de capture privacy V3

| Champ | `local_metadata` | `local_redacted` | `local_content_redacted` Phase 3 | `local_full` Phase 3 | Règle |
|---|---:|---:|---:|---:|---|
| Prompt brut | Non | Non | Non | Oui borné | Opt-in TTL court |
| Réponse brute | Non | Non | Non | Oui borné | Opt-in TTL court |
| Prompt/réponse redacted lisible | Non | Non | Oui borné | Oui | Jamais Phase 1 |
| Tool args | Non | Non; seulement classes/HMAC/tailles | Redacted borné par tool policy | Oui borné | Classification par tool obligatoire avant Phase 3 |
| Tool output | Non | Non; seulement taille/type/MIME/HMAC borné | Redacted borné | Oui borné | Binaire court-circuité |
| Error message | Non | Non; `error_kind/code/template_id/message_hmac` | Sanitized excerpt borné | Oui borné | Aucun excerpt Phase 1 |
| Stack trace | Non | Non | Non par défaut | Oui optionnel | Très sensible |
| Chemin absolu | Non | Non | Non | Non par défaut | Toujours interdit; HMAC seulement |
| Chemin relatif | Non | HMAC + extension/kind seulement | Optionnel redacted | Oui optionnel | Peut révéler client/projet |
| Extension/file kind | Oui | Oui | Oui | Oui | `ts`, `md`, `binary`, `pdf`, etc. |
| `skill.name` | HMAC ou absent | HMAC | Redacted opt-in | Oui opt-in | Jamais brut Phase 1 |
| MCP server | `mcp_transport` + HMAC endpoint si utile | idem | Redacted opt-in | Oui opt-in | Pas d’URL brute |
| Token counts | Oui | Oui | Oui | Oui | Side-channel accepté |
| Cost | Oui | Oui | Oui | Oui | `nano_usd`, snapshot pricing |
| Model/provider | Oui | Oui | Oui | Oui | Nécessaire, mais documenter sensibilité |
| User id | HMAC | HMAC | HMAC | HMAC | Jamais brut |
| Session/project/workspace | ID interne si autorisé, sinon HMAC | idem | idem | idem | Auth obligatoire |
| Content hash | HMAC borné seulement | HMAC borné seulement | HMAC | HMAC | Jamais hash nu |
| Binary/PDF/image | MIME + taille | MIME + taille + HMAC borné | Pas de texte sauf parser dédié validé | Opt-in | Pas de scan entropie complet |

Clarification des cases ambiguës:
- “HMAC ou absent” signifie: absent par défaut si non nécessaire à l’UX Phase 1; HMAC si besoin de regroupement/statistiques.
- “Redacted opt-in” signifie: activé uniquement par PrivacyPanel Phase 3, avec TTL, affichage UI, et audit local.
- `mcp_transport` est un enum non sensible (`stdio|http|sse|unknown`). Endpoint/URL = HMAC uniquement en Phase 1.

---

## 4. Architecture V3

```text
session/processor.ts LLM lifecycle
  ├─ before/provider call ───────────────→ llm.call.started
  ├─ finish-step ────────────────────────→ llm.call.finished
  ├─ catch/provider error ───────────────→ llm.call.failed
  └─ abort/timeout/user cancel ──────────→ llm.call.aborted

session/prompt.ts tool lifecycle
  ├─ tool.execute.before ────────────────→ tool.call.started
  ├─ tool.execute.after success ─────────→ tool.call.finished
  └─ tool.execute.after/error catch ─────→ tool.call.failed/aborted

Explicit TraceContext (validated Zod)
  ↓
CapturePolicy V3
  ↓
FieldClassifier + bounded Sanitizer
  ↓
Observability.record(ctx, event) -> RecordResult
  ↓
Priority-aware bounded FIFO queue + enqueueSeq
  ↓
Batch transaction Drizzle
  ↓
observability_event append-only
  ↓
Hono /observability/events|summary|health|settings|data
  ↓
SDK generated + drift check
  ↓
settings-observability.tsx
```

Aucune dépendance à OTel/Langfuse dans le cœur. Phase 4 exporters reçoivent uniquement `ExportProjection`.

---

## 5. Schéma SQL Phase 1

Fichier: `packages/opencode/src/observability/observability.sql.ts`.

```ts
export const observabilityEvent = sqliteTable("observability_event", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventId: text("event_id").notNull().unique(), // ULID public, non énumérable
  schemaVersion: integer("schema_version").notNull().default(1),

  tsMs: integer("ts_ms").notNull(),
  enqueueSeq: integer("enqueue_seq"),

  eventType: text("event_type", {
    enum: [
      "llm.call.started",
      "llm.call.finished",
      "llm.call.failed",
      "llm.call.aborted",
      "tool.call.started",
      "tool.call.finished",
      "tool.call.failed",
      "tool.call.aborted",
      "observability.write.dropped"
    ],
  }).notNull(),

  status: text("status", {
    enum: ["started", "succeeded", "failed", "aborted", "dropped"],
  }).notNull(),

  traceId: text("trace_id").notNull(),
  spanId: text("span_id").notNull(),
  parentSpanId: text("parent_span_id"),

  workspaceId: text("workspace_id"),
  projectId: text("project_id"),
  sessionId: text("session_id"),
  messageId: text("message_id"),
  turnId: text("turn_id"),
  stepIndex: integer("step_index"),

  userIdHmac: text("user_id_hmac"),

  provider: text("provider"),
  model: text("model"),
  toolNameHmac: text("tool_name_hmac"),
  toolKind: text("tool_kind"),
  fileKind: text("file_kind"),
  pathHmac: text("path_hmac"),
  mcpTransport: text("mcp_transport"),
  mcpServerHmac: text("mcp_server_hmac"),

  durationMs: integer("duration_ms"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  totalTokens: integer("total_tokens"),

  costNanoUsd: integer("cost_nano_usd"),
  pricingVersion: text("pricing_version"),
  pricingSource: text("pricing_source"),
  costComputedAtMs: integer("cost_computed_at_ms"),

  captureLevel: text("capture_level", {
    enum: ["local_metadata", "local_redacted"],
  }).notNull(),

  redactionStatus: text("redaction_status", {
    enum: ["none", "applied", "truncated", "failed_closed"],
  }).notNull().default("none"),

  payloadTruncated: integer("payload_truncated", { mode: "boolean" }).notNull().default(false),
  originalSizeBytes: integer("original_size_bytes"),
  storedSizeBytes: integer("stored_size_bytes"),

  errorKind: text("error_kind"),
  errorCode: text("error_code"),
  errorTemplateId: text("error_template_id"),
  errorMessageHmac: text("error_message_hmac"),

  localMetadataJson: text("local_metadata_json").notNull().default("{}"),
  localRedactedJson: text("local_redacted_json").notNull().default("{}"),
})
```

Indexes Phase 1:

```ts
index("obs_ts_id_idx").on(table.tsMs, table.id)
index("obs_session_ts_id_idx").on(table.sessionId, table.tsMs, table.id)
index("obs_project_ts_id_idx").on(table.projectId, table.tsMs, table.id)
index("obs_workspace_ts_id_idx").on(table.workspaceId, table.tsMs, table.id)
index("obs_type_ts_id_idx").on(table.eventType, table.tsMs, table.id)
index("obs_trace_ts_idx").on(table.traceId, table.tsMs, table.id)
index("obs_span_idx").on(table.spanId)
index("obs_status_ts_id_idx").on(table.status, table.tsMs, table.id)
```

Contraintes applicatives:
- `eventId`, `traceId`, `spanId` validés ULID.
- `sessionId` nullable en DB, obligatoire pour events de session.
- Pas de FK stricte Phase 1 sauf preuve que suppression/cascade ne casse pas les writes.
- JSON sérialisé via helper validé:

```ts
function safeJsonForDb(schema: z.ZodTypeAny, value: unknown, maxBytes: number): string {
  const parsed = schema.parse(value)
  const json = JSON.stringify(parsed)
  if (byteLength(json) > maxBytes) throw new ObservabilityValidationError("json_too_large")
  JSON.parse(json) // sanity check
  return json
}
```

Phase 3 migrations:
- ajouter `local_content_redacted_json`;
- ajouter `local_full_json`;
- ajouter table opt-in;
- ajouter purge prioritaire contenu.

---

## 6. Modèle d’événements et corrélation

### 6.1 Génération IDs

- `traceId`: ULID généré au début du tour utilisateur ou opération agent.
- `spanId`: ULID généré au début de chaque opération LLM/tool; réutilisé pour l’event terminal.
- `eventId`: ULID par event.
- `id`: entier DB interne.

### 6.2 LLM

`llm.call.started`:
- juste avant appel provider;
- provider/model/session/message/turn/step si disponibles;
- aucun prompt.

`llm.call.finished`:
- sur `finish-step`;
- tokens, coût, durée;
- aucun texte prompt/réponse Phase 1.

`llm.call.failed`:
- exception provider, parsing, rate limit, SDK;
- `errorKind`, `errorCode`, `errorTemplateId`, `errorMessageHmac`;
- pas de message brut ni stack.

`llm.call.aborted`:
- abort utilisateur, timeout contrôlé, cancellation;
- `reason` enum si non sensible.

### 6.3 Tools

`tool.call.started`:
- depuis `tool.execute.before`;
- `toolKind`, `toolNameHmac` si utile, classification args;
- pas d’args bruts.

`tool.call.finished`:
- depuis `tool.execute.after` succès;
- durée, taille output, classe output, MIME/fileKind;
- pas d’output brut.

`tool.call.failed`:
- exception ou résultat erreur;
- `errorKind/errorCode/template/hmac`;
- pas de message brut.

`tool.call.aborted`:
- timeout/cancellation.

### 6.4 Orphaned sans UPDATE

`orphaned` n’est pas une valeur `status` stockée en Phase 1. C’est un `derivedStatus` calculé par API:

```text
status = started
AND NOT EXISTS terminal event with same span_id
AND now - ts_ms > orphanAfterMs
=> derivedStatus = orphaned
```

UI Phase 1 affiche badge “orphelin probable” si `derivedStatus=orphaned`.

---

## 7. CapturePolicy V3

```ts
export type CaptureLevel = "local_metadata" | "local_redacted"

export interface ObservabilityConfig {
  enabled?: boolean
  captureMode?: "local_metadata" | "local_redacted"
  retentionDays?: number
  maxEvents?: number
  maxDbBytes?: number
  maxQueueEvents?: number
  maxQueueBytes?: number
}

export interface CapturePolicy {
  enabled: boolean
  level: CaptureLevel
  userIdHmac?: string
  policyVersion: 3
}
```

Rules:
- `enabled === true` seul active les writes.
- `captureMode` absent → `local_metadata`.
- `local_content_redacted`/`local_full` impossibles en Phase 1, absents du type config Phase 1.
- `enabled=false` stoppe nouvelles écritures, mais lecture/suppression restent disponibles.
- policy résolue au moment de chaque event.

---

## 8. Sanitizer / FieldClassifier V3

Ordre:
1. `boundPayload()` avant toute opération.
2. `detectBinaryOrMime()` court-circuite image/PDF/base64 binaire.
3. `classifyStructuredFields()` extrait types, tailles, extensions, MIME.
4. `sanitizeKnownError()` normalise erreurs sans message brut.
5. `sanitizePaths()` interdit chemins absolus et `file://`.
6. `sanitizeSecretsRegex()` sur chunks bornés.
7. `entropyScanChunked()` seulement si type textuel et taille bornée.
8. `validateNoForbiddenPatterns()` fail-closed.

Fail closed:
- payload non stocké;
- `redactionStatus="failed_closed"`;
- `errorKind="sanitizer_failed"`;
- compteur `sanitizerFailed++`;
- session produit continue.

Bench obligatoire:
- 256 KiB textuel scan < 5 ms p95 ou seuil à ajuster.
- 10 MiB input borné sans OOM.
- base64/PDF/image court-circuit < 2 ms p95 pour classification bornée.

---

## 9. Observability module V3

Phase 1: module simple, pas `Effect.Service`.  
Nuance: le rejet n’est pas définitif. Si Phase 4 exporters/backpressure/flush coordonné justifient un lifecycle scoped, `Effect.Service` peut être réévalué.

```ts
export namespace Observability {
  export function record(ctx: TraceContext, event: ObservabilityInput): RecordResult
  export async function flush(opts?: { timeoutMs?: number }): Promise<FlushResult>
  export function stats(): ObservabilityStats
  export async function health(): Promise<ObservabilityHealth>
  export async function purgeRetention(now?: Date): Promise<PurgeResult>
  export async function deleteByScope(scope: DeleteScope): Promise<DeleteResult>
}
```

Counters en mémoire Phase 1:
- `eventsAccepted`
- `eventsInserted`
- `eventsRejectedInvalidContext`
- `eventsRejectedInvalidEvent`
- `eventsDroppedQueueFull`
- `eventsDroppedCircuitOpen`
- `eventsFailedDb`
- `eventsFailedBusy`
- `eventsFailedFull`
- `eventsFailedCorrupt`
- `sanitizerFailed`
- `lastErrorAt`
- `lastErrorKind`
- `circuitOpen`
- `queueSize`
- `queueBytes`

Limite connue:
- counters non persistés Phase 1; ils repartent à zéro au redémarrage.
- Phase 2 peut ajouter `observability_health_snapshot` si historique santé nécessaire.

---

## 10. API V3

### GET `/observability/events`

Query:
- `limit?: number` max 200;
- `cursor?: string` opaque;
- `sessionId?: string`;
- `projectId?: string`;
- `workspaceId?: string`;
- `traceId?: string`;
- `eventType?: enum`;
- `status?: enum`;
- `derivedStatus?: "orphaned"`;
- `startMs?: number`;
- `endMs?: number`.

Response:

```ts
{
  items: ObservabilityEventSummary[]
  nextCursor?: string
}
```

### GET `/observability/events/:eventId`

- `eventId` = ULID public.
- Retourne détail metadata/redacted Phase 1.
- Jamais de contenu brut Phase 1.

### GET `/observability/summary`

Phase 1 minimal:
- total events par type/status;
- total tokens/coût par plage;
- counters santé;
- orphaned count.

### GET `/observability/health`

Retourne:
- queue size/bytes;
- circuit breaker;
- last error kind/time;
- dropped counters;
- DB degraded state.

### GET `/observability/settings`

Retourne:
- enabled;
- captureMode;
- retentionDays;
- maxEvents/maxDbBytes;
- localFullAvailable=false;
- SQLite encrypted=false;
- health summary.

### PUT `/observability/settings`

Phase 2 sauf si config existante rend Phase 1 trivial.

### DELETE `/observability/data` — Phase 1 minimal

Request:
- header `X-Confirm-Delete: yes`;
- body `{ scope: "all"|"workspace"|"project"|"session", id?: string }`.

Règles:
- auth/ownership obligatoire;
- audit avant purge si pattern existant;
- supprime events observability dans le scope;
- ne supprime pas exports déjà créés;
- ne fait pas `VACUUM` automatique Phase 1.

### POST `/observability/export`

Phase 2/4.

---

## 11. Sécurité API / modèle d’accès

Phase 0 doit répondre avec preuve code:

1. Le serveur OpenCode a-t-il déjà une authentification locale/token ?
2. Le serveur peut-il être exposé hors loopback ?
3. Les routes existantes vérifient-elles workspace/project/session ownership ?
4. Quelle convention Hono existe pour 401/403/404 ?

Si réponse inconnue: **NO-GO Phase 1**.

Modèle minimal Phase 1 si aucune auth fine existante:
- bind loopback par défaut;
- token local obligatoire pour clients non internes;
- CORS allowlist stricte;
- remote server mode = observability routes désactivées ou protégées explicitement;
- 404 non révélateur possible pour cross-scope.

Tests:
- autre workspace/session inaccessible;
- traceId cross-workspace inaccessible;
- cursor forgé 400;
- eventId inexistant 404;
- origin non autorisée refusée;
- disabled capture n’empêche pas delete historique.

---

## 12. Purge, effacement, stockage long terme

Phase 1:
- purge par `retentionDays`;
- `maxEvents` défaut 100 000;
- `maxDbBytes` à définir après benchmark;
- `DELETE /observability/data` minimal;
- hook suppression session si point d’intégration trouvé;
- pas de backup automatique;
- pas de `VACUUM` automatique.

Purge strategy:
- delete borné par batch;
- éviter long lock;
- après gros delete, option `PRAGMA wal_checkpoint(TRUNCATE)` si benchmark OK;
- `VACUUM` complet seulement manuel/Phase 3, car bloquant.

Phase 2:
- export NDJSON local;
- summary complet;
- data management UI;
- documentation exports/backups.

Phase 3:
- table opt-in TTL;
- job purge opt-ins expirés;
- auto-révocation vérifiée passivement à chaque policy + purge active périodique;
- suppression prioritaire contenu.

Opt-in cleanup Phase 3:
- l’expiration est évaluée à chaque `resolveCapturePolicy()`;
- un job purge supprime les opt-ins expirés au démarrage puis périodiquement;
- aucun cache ne peut prolonger `local_full` après `expires_at`.

---

## 13. Migration / rollback / plateformes

Migration:
- générée via `drizzle-kit generate`;
- migration additive;
- testée sur DB existante;
- `EXPLAIN QUERY PLAN` post-migration.

Rollback:
- manuel, destructif pour observability;
- pas de downgrade supporté sans procédure;
- documenter la commande SQL et le risque de perte.

Desktop/mobile:
- Phase 1 cible `packages/opencode` backend.
- Desktop Tauri: vérifier chemin config/secret et accès DB via même backend.
- Mobile Android: hors support Phase 1 sauf preuve que le chemin storage/secret est compatible. Documenter “observability native mobile deferred” si non vérifié.

---

## 14. Performance et seuils d’acceptation

### Écriture

Scénarios:
- 1 session, 100 events.
- 5 sessions concurrentes, 1 000 events.
- 100 sessions concurrentes synthétiques pour contexte.
- tool output 10 MiB tronqué.
- DB locked (`SQLITE_BUSY`).
- disque plein (`SQLITE_FULL`) si simulable.
- purge pendant lecture.

Seuils:
- `enabled=false`: < 1 ms p95 par hook ET < 50 ms total sur 100 hooks.
- `enabled=true metadata`: < 3 ms p95 par hook hors flush DB.
- batch insert p95: < 20 ms pour 100 events.
- queue < 80% en scénario normal.
- session produit continue dans tous les cas d’erreur.

### Lecture

Scénarios:
- 10k, 100k, 1M events synthétiques.
- page 1, 100, 1000.
- filtre session/type/date.
- traceId ownership.

Seuils:
- GET `/events` p95 < 100 ms à 100k events.
- GET `/events` p95 < 250 ms à 1M events.
- index utilisé selon `EXPLAIN QUERY PLAN`.

### Sanitizer

- 256 KiB text scan < 5 ms p95 ou seuil révisé explicitement.
- 10 MiB input borné sans OOM.
- base64/PDF/image court-circuit.
- aucun ReDoS sur fixtures.

---

## 15. Tests obligatoires Phase 1

### Unitaires

- `trace-context.test.ts`
  - ULID validation;
  - missing required context;
  - started/terminal same `spanId`;
  - invalid context returns `RecordResult` non-ok.
- `hmac-secret.test.ts`
  - key generation crypto-safe;
  - permissions 0600 si OS;
  - stable across restart;
  - deleted key changes HMAC.
- `capture-policy.test.ts`
  - enabled undefined false;
  - mode default metadata;
  - no full/content redacted Phase 1.
- `sanitizer.test.ts`
  - secrets, paths, stacks, ReDoS, huge payloads, binary/PDF.
- `event-schema.test.ts`
  - Zod JSON;
  - max bytes;
  - invalid enum;
  - no content columns.
- `queue.test.ts`
  - FIFO/enqueueSeq;
  - retry preserves order;
  - priority overflow;
  - circuit breaker;
  - flush timeout.
- `pricing.test.ts`
  - nano USD precision;
  - historical cost not recalculated.

### Intégration

- migration additive on existing DB.
- batch insert.
- keyset pagination stable with equal `ts_ms`.
- route filters.
- route auth/ownership.
- traceId ownership.
- DELETE data by session/project/workspace.
- session deletion purges events.
- SDK generation + git diff CI.
- UI minimal render.
- disabled mid-session.
- no network observability with exporters empty.

### Résilience

- `SQLITE_BUSY` with busy timeout forced low.
- `SQLITE_FULL` if possible.
- `SQLITE_CORRUPT` if possible.
- hard crash/SIGKILL during queued writes: DB not corrupt; possible loss documented.
- sanitizer throw.
- payload 10 MiB.

### Privacy snapshots

Absence en DB Phase 1 de:
- prompt text;
- response text;
- tool args text;
- tool output text;
- error message excerpt;
- stack trace;
- absolute path;
- sensitive relative path;
- username/email;
- API key/JWT;
- URL `file://`;
- skill name brut;
- MCP URL brute.

---

## 16. UI V3

### Phase 1

`settings-observability.tsx`:
- enabled/capture mode;
- SQLite encrypted=false warning;
- localFull unavailable;
- retentionDays;
- health/counters;
- table events keyset;
- filters;
- manual refresh + optional auto-refresh 5s désactivable;
- warning circuit breaker;
- delete data minimal with confirmation;
- orphan badge.

Pas de prompt/réponse/tool output/error message affiché.

### Phase 2

- export local NDJSON;
- summary costs/errors;
- data management complet;
- docs utilisateur.

### Phase 3 — **Livré** (2026-07-12, commits `490d15cdf1`/`c369e2f52e`/`c80406ae0b`, branche `observability`)

- [x] PrivacyPanel — `settings-observability-privacy.tsx`, scope session/project, niveau, TTL (max 30j), bouton "Grant opt-in".
- [x] opt-in TTL — `observability_content_optin` (table dédiée), `expires_at_ms` dérivé, jamais un booléen permanent.
- [x] revoke now — `POST /observability/privacy/revoke` : supprime l'opt-in ET efface le contenu déjà capturé pour le scope, immédiat.
- [x] Timeline — `settings-observability-timeline.tsx`, groupe les events d'une session par `traceId`, barre à largeur relative par trace.
- [x] TraceDetail — drill-down au clic sur une trace, `GET /observability/trace/:traceId`, affiche le contenu capturé inline.
- [x] CostDashboard — `settings-observability-cost.tsx`, totaux + coût/tour par (modèle, skill), réutilise `/summary/aggregate` et `/compare`.
- [x] warnings rouges `local_content_redacted`/`local_full` — bannière rouge dans PrivacyPanel (statut actif) et TraceDetail (par event), icône `warning`.
- Workspace scope supporté côté backend (routes + `capture-content.ts`) mais pas exposé dans le PrivacyPanel UI — pas de sélecteur de workspace existant dans ce panneau à réutiliser ; extension possible sans changement API.
- Détails : [[OpenCode/Checkpoint-Native-Observability-V3-2026-07-11-Compare-UI]] section "Suite 2026-07-12 (Phase 3)", ADR-1032.

### Phase 4 — **Partiellement livré** (2026-07-12, branche `observability`)

- [x] exporter config — via `experimental.observability.exporters` dans `opencode.json` (ADR-1026, `docs/observability-phase4-admin.md`); pas de panneau UI dédié (voir gap ci-dessous).
- [ ] preview projection — non livré. Pas de panneau UI pour prévisualiser une `ExportProjection` avant envoi.
- [ ] test export — non livré. Pas de bouton "tester la connexion" dans une UI; validation manuelle possible via smoke-test du script soak (`bun run script/observability-soak-test.ts --duration-ms=10000`) ou activation directe sur un projet Langfuse de test.
- [x] logs export — chaque échec d'exporter est loggé (`log.warn`, `runtime.ts`), visible dans les logs process standards.
- [x] aucune table brute accessible — `ExportProjectionSchema` (`.strict()`) exclut structurellement tout champ de contenu; testé (`toExportProjection never surfaces Phase 3 opt-in content`, `ExportProjectionSchema is strict`).

Gap documenté : pas de panneau `settings-observability` pour configurer/tester un exporter depuis l'UI — seule la configuration via fichier JSON est disponible. Le réutilisateur devra ajouter ce panneau s'il souhaite une configuration UI plutôt que fichier.

Détails : ADR-1026, `docs/observability-phase4-admin.md`, `docs/security/observability-threat-model.md` (addendum Phase 4).

---

## 17. ExportProjection boundary

Phase 4 uniquement.

Règles:
- Interface exporter accepte seulement `ExportProjection`.
- `ExportProjectionSchema.parse()` obligatoire.
- Aucun `local_full_json` ou raw event type ne compile comme input exporter.
- Test anti-fuite: secrets, prompts, paths, raw errors absents.
- `shouldExportSpan` appliqué à la projection, pas à la ligne brute.

---

## 18. Phasage V3

### Phase 0 — Réconciliation finale P0 (4–7 jours)

Livrables:
- mettre à jour ADR 1020–1026;
- ajouter ADR-1027 local secret;
- ajouter section auth avec preuve code;
- ajouter stratégie queue ordering/crash;
- ajouter migration/rollback;
- ajouter threat model at-rest;
- finaliser schéma Phase 1;
- ajouter checklist tests P0;
- décider legacy `experimental_telemetry`.

Gate sortie:
- P0-1 à P0-14 tranchés;
- aucun “à vérifier plus tard” sur auth, secret, schema, queue, delete.

### Phase 1 — Fondation metadata production-safe (12–18 jours)

Créer:
- `observability/id.ts`
- `observability/trace-context.ts`
- `observability/hmac-secret.ts`
- `observability/hmac.ts`
- `observability/capture-policy.ts`
- `observability/field-classifier.ts`
- `observability/sanitizer.ts`
- `observability/event-schema.ts`
- `observability/observability.sql.ts`
- `observability/service.ts`
- `observability/purge.ts`
- `server/routes/observability.ts`
- `app/components/settings-observability.tsx`

Modifier:
- `storage/schema.ts`;
- `config/config-schema.ts`;
- `session/processor.ts`;
- `session/prompt.ts`;
- session delete workflow si trouvé;
- `server/instance.ts`;
- `dialog-settings.tsx`;
- SDK build/CI.

Scope:
- LLM session success/failure/abort;
- tools success/failure/abort;
- API events/detail/settings/health/summary/delete minimal;
- UI settings read-only + delete;
- purge retention;
- no content.

Gate sortie:
- tests Phase 1 verts;
- benchmarks OK;
- privacy snapshots OK;
- no-network observability OK;
- auth/ownership OK;
- crash/DB locked OK;
- SDK drift CI OK.

### Phase 2 — Couverture métier + export local (8–13 jours)

- export NDJSON local;
- summary complet;
- instrumentation `agent/agent.ts`;
- enrichissements file/skill/MCP;
- docs utilisateur;
- health history optionnel.

### Phase 3 — UI complète + contenu opt-in (10–16 jours) — **Livré 2026-07-12**

- [x] PrivacyPanel;
- [x] opt-in table + TTL cleanup (`observability_content_optin`, `purgeExpiredOptIns`);
- [x] `local_content_redacted`;
- [x] `local_full`;
- [x] Timeline/TraceDetail/CostDashboard;
- [x] purge prioritaire contenu (`purgeExpiredContent`, indépendante de la rétention metadata);
- [x] at-rest threat model renforcé (`docs/security/observability-threat-model.md`, addendum Phase 3).

Commits : `490d15cdf1` (backend), `c369e2f52e` (fix précision purge), `c80406ae0b` (UI). Voir §16 pour le détail par livrable.

### Phase 4 — Exporters + durcissement (8–12 jours) — **Partiellement livré 2026-07-12**

- [x] `Exporter` interface (`observability/exporter.ts`);
- [x] `ExportProjection` runtime/type boundary (`observability/export-projection.ts`, ADR-1026, `.strict()` schema, zero content fields);
- [x] Langfuse optional (`observability/exporters/langfuse.ts`, config via `experimental.observability.exporters`; mapping vers l'API d'ingestion publique Langfuse UNVERIFIED contre une instance réelle — voir `docs/observability-phase4-admin.md`);
- [x] fuzz sanitizer (`test/observability/sanitizer-fuzz.test.ts`, PRNG seedé, 120 itérations × propriété : jamais de throw, bornes respectées, pas de temps pathologique, needle-embedding pour la redaction);
- [ ] soak test 24h — **non exécuté**. Harness livré et smoke-testé (`script/observability-soak-test.ts`), mais un run réel de 24h nécessite un process qui tourne 24h d'horloge réelle, ce qu'un agent ne peut pas accomplir dans une session — doit être lancé manuellement;
- [x] no-network when exporters empty (`test/observability/exporter.test.ts`, spy `fetch` + preuve structurelle : liste vide → boucle d'export jamais exécutée);
- [x] docs admin (`docs/observability-phase4-admin.md`).

Commits : voir `git log` branche `observability`, section Phase 4 du 2026-07-12 (ADR-1026 + implémentation + tests + docs).

Gap documenté : pas de panneau UI exporter config/preview/test (voir §16 Phase 4 ci-dessus) — configuration fichier JSON uniquement.

Estimation révisée:
- réaliste: **42–66 jours**;
- pessimiste: **65–90 jours**.

---

## 19. ADR status V3

| ADR | Statut V3 |
|---|---|
| 1001 Langfuse vs alternatives | Superseded; exporter Phase 4 seulement |
| 1002 Self-host vs Cloud | Superseded; Phase 4 |
| 1003 Full Bun | Amendé; Bun OK mais pas ALS source de vérité |
| 1004 Single OTel provider | Non applicable au cœur; Phase 4 uniquement |
| 1005 Effect.Service | Superseded Phase 1; réévaluable Phase 4 si lifecycle justifié |
| 1006 Buffer bun:sqlite séparé | Superseded; DB séparée Drizzle seulement si benchmark |
| 1007 recordInputs/Outputs | Superseded |
| 1008 Redaction | Amendé: borné, chunké, fail-closed, MIME short-circuit |
| 1009 Config V1 | Amendé: caps, queue, maxEvents, maxDbBytes |
| 1010 trace_level | Amendé: event/trace/span |
| 1011 Single Langfuse project | Superseded |
| 1012 Budget | Amendé: `cost_nano_usd`, snapshot pricing |
| 1013 Release strategy | Superseded par Phases V3 |
| 1014 Prompt registry | Inchangé |
| 1015 Eval LLM-as-judge | Hors scope |
| 1016 UI Langfuse | Superseded |
| 1017 Baggage | Superseded/interdit |
| 1018 shouldExportSpan | Phase 4 sur ExportProjection |
| 1019 Skills/Markdown | Amendé: HMAC skill/path, tool errors, caps |
| 1020 Drizzle storage | Amendé: schéma Phase 1 minimal + delete + migration/rollback |
| 1021 ALS correlation | Superseded: TraceContext explicite |
| 1022 Capture policy | Amendé: no content Phase 1 |
| 1023 API/UI | Amendé: events/keyset/auth/health/delete |
| 1024 Event lifecycle | Accepted |
| 1025 Sanitizer borné | Accepted |
| 1026 ExportProjection boundary | Accepted Phase 4 — livré 2026-07-12 (docs/adr/1026-exportprojection-boundary.md) |
| 1027 Local HMAC secret lifecycle | Nouveau, Accepted avant Phase 1 |
| 1028 Auth/ownership local model | Nouveau, Accepted avant Phase 1 avec preuve code |
| 1029 Queue ordering/crash semantics | Nouveau, Accepted avant Phase 1 |
| 1030 Migration/rollback/SDK drift | Nouveau, Accepted avant Phase 1 |

---

## 20. Décisions rejetées ou différées

### Rejetées

- `AsyncLocalStorage` comme corrélation canonique.
- Texte redacted lisible en `local_redacted` Phase 1.
- OFFSET/LIMIT.
- Fire-and-forget silencieux.
- SHA/hash nu.
- Sanitizer non borné.
- Exporter lisant raw events.
- `experimental_telemetry` comme chemin de persistance.
- `Effect.Service` obligatoire en Phase 1.
- Utiliser `userIdHmac` comme preuve d’autorisation.

### Différées

- Chiffrement SQLite intégré: Phase 3/4 après threat model.
- Backup automatique: Phase 2+ seulement si compatible avec effacement.
- Rotation UI HMAC secret: Phase 2+.
- FTS prompt/réponse: Phase 3+, seulement avec opt-in contenu.
- Partitionnement mensuel: après benchmark réel.
- SSE/WebSocket live: non nécessaire Phase 1; auto-refresh suffit.
- Mobile support: après vérification storage/secret Android.

### Acceptées avec justification malgré critique

- `event_id` public unique conservé malgré `id` interne: non redondant fonctionnellement, car évite d’exposer un identifiant séquentiel et prépare export/corrélation. À reconsidérer uniquement si benchmark échoue.
- Pas d’extrait error redacted Phase 1: privilégie invariant privacy. Debuggabilité par `error_kind/code/template/hmac`; excerpts reportés Phase 3.
- Pas de backup automatique Phase 1: éviter rétention involontaire de données supprimées.

---

## 21. Checklist P0 directement applicable

### Documentation/ADR

- [x] ADR-1027 localInstallSecret ajouté (docs/adr/1027-local-install-secret.md).
- [x] ADR-1028 auth/ownership avec preuve fichier:ligne (docs/adr/1028-local-auth-ownership.md).
- [x] ADR-1029 queue ordering/crash semantics (docs/adr/1029-queue-ordering-crash-semantics.md).
- [x] ADR-1030 migration/rollback/SDK drift (docs/adr/1030-migration-rollback-sdk-drift.md).
- [x] Threat model at-rest documenté (docs/security/observability-threat-model.md).
- [x] Legacy `experimental_telemetry` tranché (docs/adr/1031-legacy-experimental-telemetry.md).

### Schéma/API

- [x] Schéma Phase 1 sans colonnes content Phase 3 (event.sql.ts n'a ni `local_content_redacted_json` ni `local_full_json`, vérifié par test).
- [x] `cost_nano_usd` + pricing snapshot (peuplés depuis `Session.getUsage` dans session/llm.ts).
- [x] Zod TraceContext/Event/JSON (event-schema.ts, `parseObservabilityEvent` utilisé dans `ObservabilityService.record()`).
- [x] Keyset `(ts_ms,id)` stable (index dédiés dans event.sql.ts, vérifiés par `EXPLAIN QUERY PLAN` et exploités par `ObservabilityRepository.page()`).
- [x] `/health` ajouté (`GET /observability/health` : server/routes/observability.ts, expose `ObservabilityRuntime.service().stats()` + capture policy résolue de l'instance courante — pas de scope cross-projet à vérifier, c'est déjà per-instance via Instance.state).
- [x] `GET /observability/events` (keyset `(ts_ms,id)` scopé par session) + `GET /observability/events/:eventId` ajoutés.
- [x] `GET /observability/summary` ajouté (agrégats par type/status + coût total, même ownership que `/events`).
- [x] `DELETE /observability/data` avec scopes `all`/`workspace`/`project`/`session`, ownership workspace vérifié via `Workspace.get` et `projectID courant`.
- [x] Auth/ownership prouvé et testé pour session/project/workspace (`requireOwnedSession` + `requireOwnedWorkspace`, 404 non-révélateur).

### Implémentation core

- [x] ULID generator.
- [x] explicit `TraceContext`.
- [x] local HMAC secret file + permissions.
- [x] bounded sanitizer + binary short-circuit (field-classifier.ts + sanitizer.ts: 4KiB chunked scan, PNG/JPEG/GIF/PDF/ZIP/WEBP signature + base64 short-circuit, path/email/secret/entropy detection, fail-closed on exception; wired into tool.call.started/finished args+output classification; fingerprintContent() ready but not yet called by a real site).
- [x] queue 500/64MiB + priority overflow.
- [x] `RecordResult`.
- [x] lifecycle LLM (session/llm.ts: started/finished/failed/aborted, same spanId, non-blocking, gated by experimental.observability.enabled).
- [x] lifecycle tools (session/processor.ts: started on tool-call → running, finished/failed from tool-result/tool-error, aborted from cleanup() for spans still open; toolKind clear, errorKind bounded, no raw error text).
- [x] Skills/Markdown identity HMAC (session/processor.ts: skillHmac from requested name at tool-call, skillHmac+pathHmac from resolved skill.name/dir at tool-result, skillHmac from requested/last-known name at tool-error; skill tool reuses the generic tool.call lifecycle — no separate span kind needed; name/path never stored raw, only HMAC-SHA256).
- [x] session delete purge hook (session/projectors.ts: the existing `Session.Event.Deleted` projector now also deletes `ObservabilityEventTable` rows matching `session_id`, in the SAME transaction as the `SessionTable` delete — no FK, applicative cascade, atomic with the triggering workflow per ADR-1030. Note: a second separate `SyncEvent.project(Session.Event.Deleted, ...)` entry would have silently overwritten the first in the projectors Map — combined into the single existing callback instead).
- [x] `deleteByScope(scope)` (new `observability/purge.ts`, `DeleteScope = {scope:"all"|"workspace"|"project"|"session", id?}` matching the `DELETE /observability/data` body shape from the plan; separate from the session-delete cascade above — this is the manual/API-triggered path for a future delete route).
- [x] purge by retention (`retentionDays`/`maxEvents`) — implémenté dans `observability/purge.ts` et déclenché par `ObservabilityRuntime`; `maxDbBytes` reste différé.

### Tests

- [x] 100 sessions concurrentes (resilience.test.ts : 100 sessions × 100 events entrelacés round-robin, marqueur par event vérifié contre la ligne DB réelle au lecture — pas de contamination croisée).
- [x] started/terminal same spanId (lifecycle.test.ts, pour LLM et tool).
- [x] queue ordering/retry (queue.test.ts : FIFO, priorité terminale préservée sur overflow, rejet low-priority quand seuls des high-priority restent).
- [x] crash recovery SIGKILL (`test/observability/sqlite-crash-recovery.test.ts`, commit `cd9f123b1b`: real child process spawned, starts an uncommitted transaction against a real file-backed WAL-mode DB, killed by the OS with SIGKILL mid-transaction; verified no partial row, `PRAGMA integrity_check` clean, table still writable after recovery).
- [x] SQLITE_BUSY (sqlite-busy.test.ts : reproduction réelle via bun:sqlite direct + fichier temp, délibérément découplée du singleton `Database` process-wide partagé par tout le reste de la suite — voir commentaire du fichier pour le raisonnement).
- [x] SQLITE_FULL simulé par plafond SQLite (`sqlite-full.test.ts`).
- [x] no-network observability (resilience.test.ts : override de `fetch` + scan statique de tous les fichiers observability/*.ts, `crash-reporter.ts` exclu car opt-in par design).
- [x] privacy snapshots (resilience.test.ts : `record()` rejette tout champ metadata hors de l'allow-list Zod strict ; round-trip des 8 types d'event avec vérification que les clés persistées restent dans l'allow-list).
- [x] SDK drift CI (`.github/workflows/observability-sdk-drift.yml` régénère puis exécute `git diff --exit-code`).
- [x] migration existing DB (event-migration.test.ts, upgrade testé sur DB avec table préexistante).
- [x] DELETE data (DELETE /observability/data, testé : header de confirmation, scopes session/project/all, ownership cross-projet).

---

## 22. Définition de “production ready”

Le chantier est production-ready uniquement si:

1. Phase 1 est stable, bornée, testée, privacy-safe metadata.
2. Phase 2 apporte export local, summaries, docs et couverture agent.
3. Phase 3 encadre strictement contenu redacted/full via UI, TTL, revoke, purge.
4. Phase 4 prouve que les exporters ne peuvent pas recevoir de brut — **fait** (2026-07-12) : `ExportProjectionSchema` `.strict()` sans champ de contenu, testé par anti-leak (`test/observability/exporter.test.ts`).
5. Soak test 24h et fuzz sanitizer passent — fuzz sanitizer **fait** (`test/observability/sanitizer-fuzz.test.ts`); soak test 24h **non exécuté**, harness livré et smoke-testé seulement (`script/observability-soak-test.ts`) — reste un run manuel avant que ce point 5 soit pleinement satisfait.
6. Auth/ownership est prouvé sur le code réel.
7. Les limites connues sont documentées:
   - queue mémoire perdue sur hard crash avant flush;
   - SQLite non chiffré par défaut;
   - backups/exports externes hors contrôle après création;
   - HMAC secret perdu = corrélation historique perdue;
   - mobile non supporté tant que storage/secret non vérifié;
   - `local_full` augmente fortement le risque privacy;
   - Phase 4 : pas de backfill export, pas de retry export, mapping Langfuse non vérifié en conditions réelles, pas de panneau UI exporter (`docs/observability-phase4-admin.md`).

---

## 23. Verdict final V3

**GO Phase 0 immédiat.**  
**GO Phase 1 seulement si les gates P0 V3 sont résolues dans le document et testées.**

La V3 corrige les derniers trous structurels remontés par les reviews V2. Le plan est désormais suffisamment précis pour servir de checklist d’implémentation, de contrat de review PR et de base de tests.

La règle finale reste simple: si un point touche privacy, auth, suppression, stockage, réseau ou résilience, il doit être prouvé par test ou par citation code avant de sortir de Phase 1.