<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# M1-07 EVIDENCE — Observability zero-alloc + secret-leak canary (C-M1-12)

> Statut : **EVIDENCE_PINNED** (foundation design validated, production lift = C-M1-12)
> Date : 2026-09-01
> Source : `docs/automation-v2/spikes/m1-07-observability-foundation.ts`
> Plan : V2.3.1 §3.12 + §5.7, Plan §125 (secret-leak canary gate),
>        ADR-009 (Policy), ADR-010 (no-secret-in-log, TM-CP-02)
> Production : `packages/observability/src/index.ts` + `test/observability.test.ts`
> Commit : `feat(observability): M1-12 zero-alloc structured logger + secret-leak canary` (à committer)

---

## 0. Cadrage

Ce spike ferme la **fondation d'observabilité du kernel** (C-M1-12,
plan V2.3.1 §3.12) en proposant la couche `structured-logger` qui
satisfait les deux invariants critiques de la M1 :

1. **Zero-alloc sur le chemin chaud** — la même règle absolue que
   Seno DAW pour le callback audio : `1 000 000 log.info(...)` ne
   doit jamais faire grossir le heap. Sinon, sous charge, le GC
   s'invite dans la boucle et transforme un logger en bombe à
   latence.
2. **Secret-leak canary** (plan §125, TM-CP-02) — *aucun* champ
   credential-shaped ne doit jamais atteindre le ring buffer. Le
   canary est le **gate** qui throw `SecretLeakageError` AVANT
   l'écriture. C'est la dernière ligne de défense : les premières
   sont la discipline du caller (ne pas passer de secret), la
   deuxième est la politique (ADR-010 — ne pas persister), la
   troisième est ce canary.

**Code de production modifié** : oui, et c'est l'objet de cette
session. Le spike `m1-07-observability-foundation.ts` est jetable
(throwaway), mais il valide la forme de la production
`@unifia/observability/` créée par cette session :

- `packages/observability/src/index.ts` (≈ 460 LOC, exports publics
  + ring buffer + canary + sinks + decorators)
- `packages/observability/test/observability.test.ts` (≈ 330 LOC,
  33 tests verts : canary exhaustif + scope binding + zero-alloc +
  back-pressure + Zod)
- `packages/observability/test/bench.ts` (script de mesure
  reproductible, jette `delta_bytes` sur stdout)
- `packages/observability/package.json` + `tsconfig.json`

**Commandes de reproduction** :

```bash
cd D:\App\unifia\.worktrees\rev3m-20260901\design
# Spike throwaway (5 tests acceptance)
bun docs/automation-v2/spikes/m1-07-observability-foundation.ts
# Production tests (33 verts)
bun test packages/observability
# Production typecheck
bun run --filter @unifia/observability typecheck
# Bench du delta heap après 1 000 000 emits
bun --expose-gc packages/observability/test/bench.ts
```

**Dernière exécution** : 2026-09-01, **5 PASS / 0 PARTIAL / 0 FAIL / 0
MISSING** (distribution §5.7 exacte) + **production 33/0 + app
1192/0 + capability-runtime 17/0 + contracts 141/0** (le 141
inclut le +33 d'ADR-026 par un agent parallèle, hors scope).

---

## 1. Verdict par vecteur

| # | Vecteur | Verdict | Évidence |
|---|---|---|---|
| 1 | 1 000 000 `log.info("bench")` → heap stable, pas de fuite | **PASS** | `delta_bytes=0` (avant=179 758, après=179 758), buffered=1024, dropped=998 976 |
| 2 | `log.info({token: "abc"})` jette `SecretLeakageError` | **PASS** | `SecretLeakageError(field="token", value="***")` (string trop courte → entièrement redactée) |
| 3 | `log.info({password: "abc"})` jette `SecretLeakageError` | **PASS** | `SecretLeakageError(field="password", value="***")` (idem) |
| 4 | `log.audit("approve", {grant: "granted"})` écrit dans le in-memory sink | **PASS** | `flushed=1, level=audit, message="approve", fields={"grant":"granted"}` |
| 5 | 100 000 entries poussées plus vite qu'elles ne drainent → back-pressure non-bloquante, drop-oldest, counter incrémenté | **PASS** | `non_blocking=true (18ms), buffered=1024, dropped=98976 (expected 98976)` |

---

## 2. Verdict agrégé (§5.7 distribution)

```text
PASS     5
PARTIAL  0
FAIL     0
MISSING  0
```

**Verdict** : la fondation d'observabilité tient. Les 5 vecteurs
acceptance du plan §5.7 sont verts. Le delta heap est **exactement 0
byte** après 1 000 000 emits (avec ou sans `--expose-gc`), le canary
rejette AVANT l'écriture, l'audit est un event de première classe, et
la back-pressure est drop-oldest + counter (non-bloquante,
non-couplée au consumer).

---

## 3. Architecture du logger

### 3.1 Hot path — zero-alloc garanti

Le hot path est `logger.info(msg, fields?)` (et ses 4 sœurs).
L'ordre des opérations est fixe :

1. **Canary** (si `redactSecrets !== false`) — scan des clés de
   `fields` avec un regex pré-compilée
   `/\b(password|secret|token|api_?key|cookies?|authorization|bearer|private_?key)\b/i`.
   Throw `SecretLeakageError` AVANT toute écriture si une clé
   matche. Allocation : zéro (regex sans capture, `in` loop sans
   boxing). Throw = cold path, alloue le `Error` et son message
   uniquement.
2. **Stamp du template** — un `LogEntry` pré-alloué est réécrit
   in-place : `timestamp = Date.now()` (boxed number), `level`,
   `message` (string ref), `fields = fields ?? EMPTY_FIELDS`
   (sentinelle `Object.freeze({})` réutilisée). Pas de nouvelle
   `{}` créée par emit.
3. **Ring buffer write** — `Float64Array` (timestamps, 8 bytes ×
   1024 = 8 KiB) + `Uint32Array` (level codes, 4 bytes × 1024 =
   4 KiB) + `string[]` × 3 (messages, runIds, capabilities, 1024
   refs × 8 bytes ≈ 8 KiB) + `Record[]` (fields refs, 1024 refs
   × 8 bytes ≈ 8 KiB) = **~28 KiB total** pour la structure
   interne, alloués **une fois** à la création du logger.

Le Date.now() est le seul appel « coûteux » du hot path, et V8 le
traite comme un primitif. Le `template` est partagé entre tous
les emits. Les `fields` sont passés par référence. Résultat
mesuré : 0 byte de delta heap après 1M emits (Test 1).

### 3.2 Sinks — boundary, pas hot path

`LogSink` est l'interface de sortie : `{write(entry) → Promise<void> | void}`.
Deux sinks sont fournis :

- `consoleSink` — `console.log(JSON.stringify(entry))`. JSON.stringify
  est sur la boundary sink, JAMAIS sur le hot path.
- `createInMemorySink()` — `entries: LogEntry[]` pour les tests.

Les sinks PEUVENT appeler `LogEntrySchema.parse(entry)` pour valider
à la frontière (c'est l'endroit où l'allocation a un sens), mais le
logger ne le fait pas sur le hot path.

### 3.3 Flush — drain du ring vers le sink

`await logger.flush()` itère le ring buffer en ordre chronologique
(du plus ancien au plus récent) et appelle `sink.write(entry)` pour
chacun. Le flush est le seul moment où des objets `LogEntry`
« propres » sont construits (les 5 champs optionnels sont
rematerialisés). C'est l'API correcte pour un sink lent (disque,
réseau) : le kernel emit à toute vitesse, un scheduler drain
periodique (ou sur seuil) pousse vers le sink.

### 3.4 Decorators — `withScope` / `withDeployment`

`logger.withScope(scopeA)` retourne un **nouveau** `Logger` dont
les entries portent `scope: scopeA`. L'impl est un shallow closure
: le nouveau logger partage le même ring buffer que le parent
(donc zéro extra-allocation), et le `boundScope` est stocké en
field du closure `createStructuredLogger({...opts, scope})`.

`logger.withDeployment(deploymentA)` est l'équivalent pour
`DeploymentScope`. Les deux decorators sont **composables** :
`logger.withScope(A).withDeployment(D)` est valide.

### 3.5 `createNoopLogger()` — test fixture

Logger qui ne fait rien : pas de canary, pas de ring buffer, pas
de sink. Utilisé par les tests qui veulent explicitement passer
un `fields: {token: "..."}` pour exercer un chemin downstream
sans que le canary se déclenche. Sémantique documentée dans la
JSDoc.

---

## 4. Le canary — détails

### 4.1 Regex

```
/\b(password|secret|token|api_?key|cookies?|authorization|bearer|private_?key)\b/i
```

- `\b...\b` — word-boundary anchored. Empêche `cookieCount` de
  matcher (le `e` et le `C` sont tous deux word-chars, donc pas de
  boundary). Idem pour `secretery`, `tokens`, `apikeyChanged`.
  Seules les clés où le token est **un mot complet** matchent.
- `cookies?` — couvre `cookie` ET `cookies`.
- `api_?key` — couvre `apiKey` ET `api_key`.
- `private_?key` — couvre `privateKey` ET `private_key`.
- Case-insensitive (`/i`).

### 4.2 Comportement par type de valeur

| Type de valeur | Match ? | Action |
|---|---|---|
| `string` non vide | oui | Throw `SecretLeakageError(field, value_preview)` |
| `string` vide (`""`) | oui | **Allowed** — fixture test explicite |
| `Uint8Array` non vide | oui | Throw `SecretLeakageError(field, "<bytes:N>")` |
| `Uint8Array` vide | oui | **Allowed** |
| `number` | non-regex (clé match) | Allowed (canary ne s'applique qu'à string/bytes) |
| `boolean` | idem | Allowed |
| `null` / `undefined` | idem | Allowed |
| objet / array | non-regex | Allowed |

La règle est : **match sur le nom de la clé, action sur la valeur**.
Un champ `cookieCount: 5` n'est PAS matché par la regex. Un
champ `count: 0` (sans clé suspecte) n'est pas matché non plus.
Mais `token: ""` EST matché par la regex, et la valeur vide
explicitement allowed (cf. test (i)).

### 4.3 Pourquoi pas de scan récursf profond ?

Un scan récursf (`{user: {password: "..."}}`) allouerait des
strings concaténées ou des objects traversés sur le hot path. Le
canary est un **gate**, pas un *deep inspector*. La convention
documentée est `flattenBeforeLog(fields)` côté caller. C'est
explicitement noté dans la JSDoc de `scanSecretsInFields`.

### 4.4 `SecretLeakageError` — shape stable

```ts
class SecretLeakageError extends Error {
  override readonly name = "SecretLeakageError" as const
  readonly field: string   // clé offending (case-preserved)
  readonly value: string    // preview redactée, jamais la valeur brute
  toJSON(): { name: "SecretLeakageError"; field: string; value: string }
}
```

Le preview de la valeur :
- ≤ 4 chars → `"***"` (entièrement redacté)
- > 4 chars → `${value.slice(0, 4)}***` (4 premiers chars + `***`)
- `Uint8Array` → `"<bytes:N>"` (taille uniquement)

Le test (m) de la production vérifie que `password: "hunter2hunter2"`
produit `value: "hunt***"`.

---

## 5. Back-pressure — drop-oldest + counter

Le ring buffer est **drop-oldest** : quand `written >= capacity`,
le head avance, l'ancien slot est écrasé, `droppedCount++`. Le
sink drain ensuite lit les `capacity` entries les plus récentes.

- Le `droppedCount` est exposé via `logger.dropped()`.
- Le `buffered()` (entries actuellement dans le ring) est exposé.
- La capacité par défaut est 1024, paramétrable via
  `createLogger({capacity: N})`.
- Le test (m) de la production vérifie : 10 emits sur un buffer
  de capacité 4 → `buffered()=4, dropped()=6`, et `flush()`
  retourne les 4 plus récents (`msg-6, msg-7, msg-8, msg-9`).
- Le test 5 du spike vérifie : 100 000 emits en 18ms sur un sink
  lent (1ms/write) → non-bloquant, `buffered()=1024,
  dropped()=98976` (exactement `100 000 - 1024`).

### 5.1 Pourquoi drop-oldest, pas block-on-full ?

Un logger kernel-side doit **toujours** être non-bloquant. Si le
sink est en retard (disque plein, réseau saturé), bloquer
l'emit revient à bloquer le kernel — exactement ce que la
fondation M1 refuse. Drop-oldest est le bon compromis : on perd
les events les plus anciens (qui sont les moins actionables), on
garde les plus récents (qui sont les plus utiles au diagnostic),
et on incrémente un compteur que l'observability peut elle-même
remonter.

### 5.2 Pourquoi un compteur et pas une exception ?

Une exception sur overflow forcerait le caller à wrapper chaque
`logger.info(...)` dans un try/catch. C'est inacceptable sur le
hot path. Un compteur (`logger.dropped()`) permet à un
monitoring loop de détecter la back-pressure sans coupler
l'emit au monitoring.

---

## 6. Production tests (33 verts)

Le fichier `packages/observability/test/observability.test.ts`
couvre 33 cas (au-delà des 15 acceptance minimums du brief).
Distribution :

- **Basic emit (2)** : (a) info → 1 entry, (b) audit → level=audit
- **Canary (15)** : (c)-(h) 6 credentials distinctes + (i) empty
  string allowed + (j) non-string allowed + case-insensitive
  (`TOKEN`, `Password`, `API_KEY`) + `Uint8Array` non-vide
  throw + `Uint8Array` vide allowed + `SecretLeakageError`
  carries `field` + `value` (preview 4 chars) + short value fully
  redacted + no-fields + empty-fields + `redactSecrets=false`
  bypasses canary
- **withScope / withDeployment (3)** : (k) scope bind + (l)
  deployment bind + chained rebind
- **Zero-alloc (3)** : (m) 1M info → delta < 1MB + drop-oldest
  policy + drain returns 4 most recent
- **Noop logger (4)** : (n) canary skipped + flush 0 + withScope
  returns same noop + 0 buffered / 0 dropped
- **Zod schema (5)** : (o) valid entry + invalid level + empty
  workspaceId + LogLevelSchema 5 values + scanSecretsInFields
  exported

Tous verts : `33 pass / 0 fail / 60 expect() calls`. Rejouable
par `bun test packages/observability` en ~170ms.

---

## 7. Workspace impact

### 7.1 Typecheck

```
@unifia/observability typecheck: Exited with code 0
```

Exclusion de `@unifia/secret-broker` (échoue sur des erreurs
pré-existantes dans `os-broker.ts` owned par M1-07, agent
parallèle en cours — hors scope de cette session) :

```
Tasks:    42 successful, 42 total
Cached:   42 cached, 42 total
Time:     218ms >>> FULL TURBO
```

Avec secret-broker, total = 43 packages (le 43ème étant
`@unifia/observability`).

### 7.2 Tests des autres packages (non-régression)

| Package | Tests | Statut |
|---|---|---|
| `@unifia/observability` | 33 / 0 | NEW ✓ |
| `@unifia/app` | 1192 / 0 | ✓ préservé |
| `@unifia/capability-runtime` | 17 / 0 | ✓ préservé |
| `@unifia/contracts` | 141 / 0 | ✓ (le +33 vs. 108 baseline vient d'ADR-026 par un agent parallèle) |

### 7.3 Lockfile

`bun install` après ajout de `packages/observability/` régénère
le lockfile proprement (résolution transitive).

---

## 8. Edge cases découverts

### 8.1 `Object.freeze({})` réutilisable comme sentinel

Découverte pendant la productionisation : `template.fields =
fields ?? {}` alloue une nouvelle `{}` à chaque emit sans
fields. Fix : `const EMPTY_FIELDS: Record<string, unknown> =
Object.freeze({})` alloué une fois et réutilisé. Effet mesuré :
delta passe de ~1.07 MB à exactement 0 bytes pour 1M emits.

### 8.2 Regex anchored — `cookies?` vs `cookie`

Le brief du test (f) utilise `cookies` (pluriel) ; le brief du
regex du canary utilise `cookie` (singulier). Fix : `cookies?`
dans le regex. Test (f) désormais vert ; le test (e) sur
`apiKey` reste vert (couvert par `api_?key`).

### 8.3 `globalThis.gc` typing sous Bun

Le test zero-alloc de la production appelle `globalThis.gc?.()`
pour réduire le bruit de mesure. Les types Bun ne déclarent pas
`gc`, donc cast via `unknown` requis : `(globalThis as unknown as
{ gc?: () => void }).gc?.()`. Le bench file `test/bench.ts` est
appelé avec `bun --expose-gc` pour la mesure canonique.

### 8.4 Sink lent ≠ sink bloquant

Test 5 du spike : un sink qui busy-wait 1ms par write ne
bloque PAS l'emit. Le ring buffer absorbe 100 000 emits en
18ms, le drain asynchrone pousse vers le sink en tâche de
fond. C'est la garantie que la back-pressure est non-bloquante.

### 8.5 Cas non couverts (futurs M3, hors C-M1-12)

- Nested objects (`{user: {password: "..."}}`) — la convention
  `flattenBeforeLog` est documentée mais pas enforced. Pourrait
  être ajouté en M3 (avec un coût alloc).
- Arrays de strings (mots de passe en clair dans un
  `String[]`) — non couvert par le regex, à discuter en M3.
- JSON-stringified fields (un `fields: {data: JSON.stringify({token: "..."})}`)
  — non couvert, le canary regarde la clé `data` qui n'est pas
  suspecte. Limitation assumée du scan shallow.

---

## 9. Reproduction rapide

```bash
# 1. Spike
cd D:\App\unifia\.worktrees\rev3m-20260901\design
bun docs/automation-v2/spikes/m1-07-observability-foundation.ts
# → 5 PASS / 0 PARTIAL / 0 FAIL / 0 MISSING, delta_bytes=0

# 2. Production tests
cd packages/observability
bun test
# → 33 pass / 0 fail / 60 expect() calls

# 3. Production typecheck
bun run --filter @unifia/observability typecheck
# → Exited with code 0

# 4. Bench zero-alloc
bun --expose-gc test/bench.ts
# → {"before_bytes":179919,"after_bytes":179919,"delta_bytes":0,...}

# 5. Workspace typecheck (excluant secret-broker en cours ailleurs)
cd ..
bun turbo typecheck --filter='!@unifia/secret-broker'
# → Tasks: 42 successful, 42 total
```

---

## 10. Conclusion

La fondation d'observabilité du kernel (C-M1-12) est **prête
pour le lift de production**. Le spike prouve les 5 vecteurs
acceptance du plan §5.7, la production ajoute 33 tests verts
couvrant le canary exhaustif + scope binding + zero-alloc +
back-pressure + Zod, et le delta heap est de **0 byte** pour
1 000 000 emits.

Le secret-leak canary (plan §125, TM-CP-02) fonctionne comme
attendu : regex anchored sur 8 patterns, throw avant l'écriture,
preview redactée. La back-pressure drop-oldest + counter garantit
un emit non-bloquant quel que soit le consumer.

Aucun impact sur les autres packages : `app 1192/0`,
`capability-runtime 17/0`, `contracts 141/0` (avec le +33
d'ADR-026 par un agent parallèle). Le seul package
typecheck-failing est `@unifia/secret-broker`, owned par M1-07
en cours par un autre worker — explicitement hors scope.
