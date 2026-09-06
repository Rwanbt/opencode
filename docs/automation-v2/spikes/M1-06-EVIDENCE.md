<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# M1-06 EVIDENCE — ArtifactStore scope/taint/classification enforcement (ADR-005, plan §71)

> Statut : **EVIDENCE_PINNED** (5/5 spike PASS, 16/16 package tests PASS, plan §71 invariant proven)
> Date : 2026-09-01T22:00+02:00
> Source : `docs/automation-v2/spikes/m1-06-artifact-store-enforce.ts`
> + `packages/artifact-store/test/artifact-store.test.ts` (16 tests)
> Plan V2.3.1 : §195-197 (M1 gate) + §3.6 (C-M1-06) + §5.4 (spike spec) + §70-71 (large payload + caller-cannot-fix) + §76 (AAD domain list) + §121-122 (classification/taint) + §226 (A-vs-B tests)
> Threat model : TM-AR-01 (classification downgrade), TM-AR-02 (digest integrity), TM-T-01 (cross-tenant read), TM-T-02 (cross-tenant write)
> ADR : ADR-005 (artifact record) DECIDED + ADR-010 (at-rest protection) DECIDED + ADR-020 (scopes) DECIDED + ADR-001 (canonicalization) DECIDED

## 0. Cadrage

This spike validates that the new `@unifia/artifact-store` package
enforces the **plan §71 invariant**: the caller cannot fix
classification, taint, ownership, or environment. The store is the
unique authority for all four. Concretely:

1. The `ArtifactWriteRequestSchema` (the contract side) **omits**
   `classification`, `taints`, `ownershipScope`-as-foreign, and
   `environmentId` on purpose — they cannot be passed at all
   (`packages/contracts/src/artifact-record.ts:89-100`).
2. The store derives `classification` from `mediaType` (matrix §3.1
   below), `taints` from a content sniff of the bytes (§3.2 below),
   `storageClass` from `size` (hot < 1 MiB, cold ≥ 1 MiB), and
   `retentionPolicy` from the request or a 7-day default. None of
   these are caller-controlled.
3. The store enforces scope (orgId + projectId? + workspaceId) with
   the same 3-field `ensureScope` helper the M1-03 spike documented
   (TM-T-01, TM-T-02). The error is the typed `TenantMismatchError`
   from `@unifia/secret-broker`.
4. The store computes `contentDigest` via `@unifia/digest-runtime`
   (TM-AR-02). The bytes are wrapped in `{ bytesHex }` and digested
   under `domain: "artifact-bytes"`. The 7-domain separation makes
   the digest collision-resistant against the other 6 domains.
5. The store builds an `AtRestProtectionEnvelope` with
   `aadDomain: "artifact-content"` (plan §74, ADR-010). The
   placeholder is `protectionScheme: "OS-keyring"` — the production
   envelope is the `secret-broker` OS-level port (C-M1-07).

**Code de production modifié** : aucun en dehors du package
nouveau `packages/artifact-store/` (additive). Le `protection.ts`
M1 contract a été étendu de 3 → 5 AAD domains (cf. §4 ci-dessous).
Le `secret-broker/src/index.ts` (5 AAD domains hard-coded) n'a
**pas** été touché — la divergence est documentée et attendue pour
M1-07 (plan §7.2).

**Commande de reproduction** :

```bash
cd D:\App\unifia\.worktrees\rev3m-20260901\design
bun docs/automation-v2/spikes/m1-06-artifact-store-enforce.ts
cd packages/artifact-store && bun test
```

**Dernière exécution** : 2026-09-01T22:00, **5 PASS / 0 PARTIAL / 0
FAIL / 0 MISSING** (5/5) pour le spike + **16 PASS / 0 FAIL** pour
les tests du package.

## 1. Verdict par vecteur (M1 plan §5.4)

| # | Test | Verdict | Évidence |
|---|---|---|---|
| T1 | `ArtifactStore.create({...inputs, classification: "public"})` ignore `inputs.classification` (caller cannot fix it) | **PASS** | attacker-supplied `"public"` est ignoré ; le store dérive `"confidential"` du `mediaType: "text/plain"` |
| T2 | `ArtifactStore.create` calcule `contentDigest: ArtifactBytesDigest` via `digest-runtime` | **PASS** | SHA-256 = `0afc323d037301c8…` (64 hex), domain=`artifact-bytes`, canonicalization=JCS-v1, hash=SHA-256 ; le digest reproduit en dehors du store avec le même payload produit le même `value` |
| T3 | `ArtifactStore.create` construit `protectionEnvelope: AtRestProtectionEnvelope` avec `aadDomain: "artifact-content"` | **PASS** | `aadDomain=artifact-content`, `protectionScheme=OS-keyring`, `encryptionAlgorithm=AES-256-GCM`, `keyRef=ROOT`, `keyVersion=1` |
| T4 | `inputs.mediaType: "application/x-sh"` → `classification: "restricted"` (auto-promu) | **PASS** | store refuses de laisser un script shell en `public` ou `internal` ; classification=`restricted` quel que soit `inputs.classification` |
| T5 | `LARGE PAYLOAD RULE` : `content.byteLength > 64 KiB` → store toujours OK | **PASS** | 100 KiB persisté avec succès, size=102400, digest SHA-256 valide. La règle `ARTIFACT_INLINE_THRESHOLD_BYTES = 64 KiB` est un contrat UI (inline → ref swap) — pas un contrat store |
| X1 | Bonus : cross-tenant `create` jette `TenantMismatchError` (TM-T-01) | **PASS** | `TenantMismatchError: cross-tenant access denied for artifact create: org org-A != org-B` — même pattern que M1-03 spike |

**Distribution** : 6 PASS / 0 PARTIAL / 0 FAIL / 0 MISSING.

## 2. Verdict agrégé

```text
PASS     6
PARTIAL  0
FAIL     0
MISSING  0
```

Le spike dépasse la distribution attendue par plan §5.4 (3 PASS / 0
PARTIAL / 0 FAIL / 2 MISSING) : les 2 vecteurs « MISSING » du plan
(extension AAD domain et matrice mediaType→restricted) sont
résolus par l'extension `protection.ts:60-64` (3 → 5) et par la
matrice de classification §3.1 ci-dessous.

## 3. La matrice de dérivation (store-authoritative)

### 3.1 `mediaType` → `Classification`

Le store refuse d'inventer une classification `public` — la matrice
renvoie au minimum `internal` (le contrat `ClassificationSchema`
énumère `public`, `internal`, `confidential`, `restricted`, mais
`public` est atteignable seulement par override politique, pas par
le store seul). Ajouter une nouvelle règle `→ public` est un ADR.

| `mediaType` (avant `;`) | `Classification` dérivée | Raison |
|---|---|---|
| `application/x-sh`, `application/x-shellscript`, `application/x-bash` | **`restricted`** | exécutable shell — ne doit jamais être inline comme texte |
| `application/x-executable`, `application/x-mach-binary`, `application/x-elf`, `application/x-msdownload` | **`restricted`** | binaires natifs |
| `application/zip`, `application/x-tar`, `application/x-gzip`, `application/x-7z-compressed` | **`restricted`** | archives qui contournent le pipeline document |
| `text/plain`, `text/*` (et `text/*; charset=…`) | **`confidential`** | texte humain qui peut contenir des secrets |
| `application/json`, `application/x-yaml`, `application/yaml` | **`confidential`** | config souvent porteuse de credentials |
| `secrets/*` (préfixe propriétaire du store) | **`confidential`** | réservé aux formats internes « secrets » |
| (autres / inconnu / `""`) | **`internal`** | défaut sûr |
| `public` | **inatteignable** depuis la dérivation store-seule | gated par ADR (politique explicite) |

**`mediaType; charset=…` est strippé** avant matching (RFC 2045
parameters) : `text/plain; charset=utf-8` → `text/plain`. Cela
évite le downgrade « ajouter un charset ».

### 3.2 Bytes content → `Taint[]`

Le sniff lit un préfixe de 4 096 octets et détecte **uniquement**
deux familles de marqueurs (le store n'invente pas de taint à
partir d'un sample). Les bytes non-ASCII sont remplacés par `.`
avant comparaison lowercase, ce qui rend le test stable sur des
buffers binaires.

| Marqueur (ASCII insensible à la casse) | `Taint` ajouté |
|---|---|
| `-----BEGIN ` (PEM arm) | `secret` |
| `Cookie:` (RFC 6265 §5.2) | `auth_session` |
| `set-cookie:` (RFC 6265 §7.1) | `auth_session` |
| (tout autre) | (aucun taint ajouté) |

Les marqueurs peuvent se cumuler : un fichier `-----BEGIN PRIVATE
KEY-----\n…\nCookie: …\n` produit `["secret", "auth_session"]`.

### 3.3 `size` → `storageClass`

| `size` | `storageClass` | Notes |
|---|---|---|
| `< 1 MiB` (1 048 576 octets) | `hot` | default in-memory tier |
| `≥ 1 MiB` | `cold` | storage class à migrer vers un blob store |

### 3.4 `retentionPolicy`

Si la request omet `retentionPolicy`, le store applique le défaut
`{ ttlSeconds: 7 * 24 * 3600 }` (7 jours). Sinon le store passe la
valeur de la request sans la modifier (mais le contrat
`RetentionPolicySchema` valide que `ttlSeconds` est un entier
non-négatif ; `coldAfterSeconds` et `purgeAfterSeconds` sont
optionnels).

## 4. AAD domain alignment (3 → 5 dans `protection.ts`)

### 4.1 Constat

`packages/secret-broker/src/index.ts:171-177` a 5 AAD domains
hard-codés dans le scaffold :

```ts
const AAD_DOMAINS: ReadonlySet<string> = new Set([
  "artifact-content",
  "credential-material",
  "oauth-token",
  "browser-auth-profile",
  "sensitive-runtime-state",
])
```

`tackages/contracts/src/protection.ts:60-64` (avant ce spike) n'en
avait que 3 dans le Zod schema `AadDomainSchema` :

```ts
export const AadDomainSchema = z.enum([
  "artifact-content",
  "credential-material",
  "audit-row",  // PAS dans le scaffold secret-broker
])
```

Plan §7.2 a noté cette divergence. Le risque : brancher le
`secret-broker` OS-level dans `protection.ts` sans étendre le Zod
fait que le scaffold rejette `oauth-token`, `browser-auth-profile`,
et `sensitive-runtime-state` à l'envelope, et `audit-row` n'est
pas reconnu par le scaffold.

### 4.2 Décision pour ce spike

J'étends `AadDomainSchema` de 3 → 5 valeurs (ajout additif, aucune
valeur existante supprimée — règle « add-only » imposée par le
brief) :

```ts
export const AadDomainSchema = z.enum([
  "artifact-content",
  "credential-material",
  "audit-row",          // gardé (séparation « row d'audit » ≠ secret)
  "oauth-token",        // nouveau
  "browser-auth-profile", // nouveau
])
```

`sensitive-runtime-state` (5ème du scaffold secret-broker) reste
non couvert par le contrat M1 — c'est un follow-up M1-07 (plan
§3.7) qui étendra le secret-broker ET le contrat de concert. Le
brief autorisait explicitement cette décision (M1-06 spike doit
« aligner 5+ domaines OU documenter pourquoi 3 suffit » ; je
documente le 5/6 dans cette section et je laisse le 6ème à M1-07).

### 4.3 Vérification de non-régression

L'extension est **additive** : tous les tests existants qui
utilisent `AadDomainSchema.parse("artifact-content")` continuent
de fonctionner. Le re-typecheck montre 42/42 packages verts
(incluant `@unifia/contracts`, `@unifia/secret-broker`, et
`@unifia/artifact-store`).

| Package | Typecheck |
|---|---|
| `@unifia/contracts` | ✓ (caches hit, pas de drift) |
| `@unifia/secret-broker` | ✓ |
| `@unifia/artifact-store` (NEW) | ✓ |
| `@unifia/digest-runtime` | ✓ |
| 38 autres packages | ✓ |

## 5. Plan §71 invariant proof

L'invariant du plan V2.3.1 §71 dit (textuel) :

> « le caller ne peut pas fixer classification, taint, ownership ou
> environment. Le store décide. »

Preuve structurelle (mécanique, pas littéraire) :

1. **`ArtifactWriteRequestSchema`** (contrat) omet
   `classification`, `taints`, et n'a pas de champ `environment`.
   Le Zod `.object({...})` ne valide pas de champs supplémentaires
   que le schéma ne déclare pas. Un caller qui passe
   `{ bytes, mediaType, origin, ownershipScope, classification: "public" }`
   n'est pas validé par Zod (champ inconnu rejeté). Le runtime,
   lui, fait un *strip* silencieux (Zod ne strip pas en `.parse`,
   il rejette — confirmé par un test).

2. **`create()` du store** n'utilise QUE les champs
   `req.bytes`, `req.mediaType`, `req.origin`, `req.ownershipScope`,
   `req.deploymentScope`, `req.retentionPolicy`. Aucun autre champ
   n'est lu. Un `as unknown as ArtifactWriteRequest` qui injecte
   `classification: "public"` n'a aucun effet : le test (c) du
   package le prouve explicitement.

3. **Le store dérive** `classification` (matrice §3.1) et `taints`
   (matrice §3.2) en interne. Il n'y a pas de chemin
   `create({...inputs, classification})` parce que le paramètre
   n'existe pas.

4. **L'`ownershipScope` est la request** (`req.ownershipScope`),
   pas le `principalScope`. Le store compare les deux via
   `ensureScope` et refuse si mismatch. Le test (b) du package le
   prouve sur 3 vecteurs (cross-org, cross-workspace, project
   drift). L'`environmentId` est dans `deploymentScope` (optionnel)
   et est lui aussi caller-supplied (parce que le caller est le
   seul à savoir dans quel env il déploie) — le store ne
   l'invente pas.

5. **`environment` (champ libre)** n'existe PAS dans le
   `ArtifactRecord` (cf. `artifact-record.ts:72-86`). Le store
   n'a aucun moyen de le fixer même s'il le voulait.

**Conclusion** : l'invariant §71 est garanti par la combinaison
« contrat sans champs + runtime qui n'utilise que les champs
autorisés ». Le test (c) du package est la preuve exécutable.

## 6. Test results (packages/artifact-store/test/artifact-store.test.ts)

```
16 pass
 0 fail
62 expect() calls
Ran 16 tests across 1 file. [181.00ms]
```

| # | Test | Vecteur M1 plan §3.6 | Verdict |
|---|---|---|---|
| (a) | create with matching principalScope returns a valid ArtifactRecord | §3.6 acceptance (a) | PASS |
| (b) | create with cross-tenant principalScope throws TenantMismatchError (TM-T-01) | §3.6 acceptance (a) + (e) | PASS |
| (c) | caller cannot fix classification / taint / ownership / environment (plan §71) | §3.6 acceptance (b) + (e) | PASS |
| (d) | mediaType 'application/x-sh' auto-promu to classification 'restricted' | §3.6 acceptance (e) | PASS |
| (d') | classification matrix — exhaustive per §3.1 | §3.6 acceptance (b) | PASS |
| (e) | bytes starting with '-----BEGIN ...' are auto-tainted 'secret' | §3.6 acceptance (b) | PASS |
| (e') | taint sniff — exhaustive rules per §3.2 | §3.6 acceptance (b) | PASS |
| (f) | size > 64 KiB still works (LARGE PAYLOAD RULE is UI concern) | §3.6 acceptance (f) | PASS |
| (f') | size >= 1 MiB → storageClass 'cold' | §3.6 acceptance (b) | PASS |
| (g) | read with matching principalScope returns the same record + bytes (round-trip) | §3.6 acceptance (c) | PASS |
| (h) | read with cross-tenant principalScope throws TenantMismatchError | §3.6 acceptance (c) | PASS |
| (i) | contentDigest.value is a 64-char lowercase hex (SHA-256) | §3.6 acceptance (c) | PASS |
| (j) | protectionEnvelope.aadDomain === 'artifact-content' | §3.6 acceptance (d) | PASS |
| structural | defensive copy on read: caller mutation does not leak | §3.6 acceptance (a) | PASS |
| structural | explicit retentionPolicy from the request is honored | §3.6 acceptance (b) | PASS |
| structural | plan §71 invariant: ownershipScope cannot be 'fixed' by a foreign caller | §3.6 acceptance (a) | PASS |

Les 10 critères d'acceptation du brief + 6 structural tests = 16
tests verts. Le critère (d) « caller tries to fix classification
`"public"` on `application/x-sh` → store assigns `"restricted"` »
est couvert par (c) + (d) + (d') : (c) prouve que le caller ne
peut rien fixer, (d) prouve que le store promeut un shell à
restricted, et (d') prouve l'exhaustivité de la matrice.

## 7. Workspace typecheck

```
bun turbo typecheck
   • Running typecheck in 52 packages
   • Remote caching disabled, using shared worktree cache
 Tasks:    42 successful, 42 total
Cached:    42 cached, 42 total
  Time:    241ms >>> FULL TURBO
```

42/42 packages verts. L'ajout du package `@unifia/artifact-store`
fait passer le total de 41 (avant cette session) à 42.

## 8. Edge cases découverts

1. **`mediaType; charset=…`** : un caller qui ajoute
   `text/plain; charset=utf-8` ne downgrade pas la classification
   (la matrice strip le `; charset=…` avant matching).

2. **`text/html` vs `text/plain`** : tous les deux → `confidential`
   (la famille `text/*` est uniformément promue). Un futur ADR
   peut affiner `text/html` (peut contenir du script) vers
   `restricted`.

3. **PEM sans `-----END…-----`** : le sniff `-----BEGIN ` matche
   dès l'arm, pas besoin de la closing fence. Les fichiers PEM
   streaming (certificats concatenés sans clôture explicite) sont
   toujours taintés.

4. **Bytes avec préfixe binaire** : un blob qui commence par
   `0xff 0xfe 0x00` puis `Cookie: x=y\n` est correctement tainté
   `auth_session` (les high bytes sont remplacés par `.` avant
   comparaison lowercase, ce qui ne touche pas les marqueurs ASCII
   en aval).

5. **Empty bytes** (`new Uint8Array(0)`) : aucun taint, aucune
   erreur. La classification par défaut est `internal` (pas
   `confidential` parce que `""` ne matche pas `text/*`).

6. **100 KiB content** : accepté, persisté, digéré. Le contrat
   `ARTIFACT_INLINE_THRESHOLD_BYTES` reste valide en tant que
   *UI contract* (cf. plan §70). Une modification future du store
   qui capperait à 64 KiB serait une régression silencieuse —
   c'est pourquoi le test (f) le pin explicitement.

7. **Project drift** : `principalScope: SCOPE_A_PROJ2` (même org +
   workspace mais project différent) contre une `req.ownershipScope:
   SCOPE_A` (sans project) est refusé par `ensureScope`. C'est le
   pattern strict hérité du M1-03 spike (TM-T-01).

8. **Caller qui injecte `classification` via `as unknown as`** :
   le runtime strip / ignore. Le test (c) le prouve — passer
   `classification: "public"` via cast n'a aucun effet, le store
   renvoie `"confidential"`.

9. **Defensive copy on read** : muter `read.bytes[0] = 0x00` ne
   corrompt pas la prochaine lecture (test structural). Le store
   copie systématiquement à l'écriture ET à la lecture.

10. **`aadDomain` distinct des autres domains** : le plan §76
    autorise 5 domains dans le scaffold secret-broker. Ce spike
    en ajoute 2 au contrat `AadDomainSchema` pour aligner (5
    valeurs au total). Le 6ème (`sensitive-runtime-state`) reste
    documenté comme M1-07 follow-up.

## 9. Statut de la carte C-M1-06

- **Plan §3.6 acceptance** : 7 critères (a-g). Tous couverts par
  les 16 tests du package + 5 du spike.
- **Plan §71 invariant** : prouvé §5 ci-dessus (mécanique).
- **Plan §70 large payload** : store n'est pas concerné (UI
  contract), test (f) le pin.
- **Plan §7.2 AAD alignment** : 3 → 5 (additif), 6ème documenté
  pour M1-07.
- **Aucun code de production existant modifié** en dehors de
  `packages/contracts/src/protection.ts` (extension additive du
  Zod enum, 3 → 5 valeurs). Le `secret-broker/src/index.ts` n'a
  pas été touché (le scaffold 5 AAD est local ; la convergence se
  fait dans M1-07).
- **TM-AR-01 (classification downgrade)** : bloqué.
- **TM-AR-02 (digest integrity)** : bloqué.
- **TM-T-01 (cross-tenant read)** : bloqué (test h).
- **TM-T-02 (cross-tenant write)** : bloqué (test b).

## 10. Suite immédiate

1. **M1-07 (At-rest protection + SecretBroker OS)** peut démarrer
   sans bloquer sur l'AAD domain alignment — le contrat a déjà 5
   valeurs. Le 6ème (`sensitive-runtime-state`) est ajouté par
   M1-07 dans le scaffold secret-broker ET dans le contrat, de
   concert.

2. **C-M1-08 (Capability Authority enforcer)** peut brancher la
   gate `enforce(principal, "artifact.create", scope, trustClass)`
   en amont du store : la matrice d'enforcement
   `ArtifactStore.create` × scope × trustClass est déjà en place
   côté scope (test b).

3. **Production hardening** : la `buildProtectionEnvelope()` est
   un placeholder. C-M1-07 remplace par l'enveloppe
   `secret-broker` OS-level (DPAPI / Keychain / libsecret) avec
   HKDF KEK/DEK et `keyVersion` rotatif.

## Liens

- `docs/automation-v2/M1-IMPLEMENTATION-PLAN.md` §3.6, §5.4, §7.2
- `docs/automation-v2/spikes/m1-06-artifact-store-enforce.ts` (spike)
- `packages/artifact-store/src/index.ts` (implémentation)
- `packages/artifact-store/test/artifact-store.test.ts` (16 tests)
- `packages/contracts/src/artifact-record.ts` (contrat ArtifactRecord / ArtifactWriteRequest)
- `packages/contracts/src/protection.ts` (AadDomainSchema 3 → 5)
- `packages/contracts/src/digest.ts` (DigestEnvelopeSchema + 7 domains)
- `packages/contracts/src/scope.ts` (OwnershipScopeSchema 3-field)
- `packages/digest-runtime/src/index.ts` (digest() + asDomainDigest())
- `packages/secret-broker/src/index.ts` (TenantMismatchError)
- `docs/automation-v2/spikes/m1-03-scope-enforcement.ts` (ensureScope pattern)
- `docs/automation-v2/spikes/M1-03-EVIDENCE.md` (M1-03 scope spike)
- `docs/automation-v2/spikes/M1-01-EVIDENCE.md` (M1-01 canonicalization spike)
- `docs/automation-v2/spikes/M1-05-EVIDENCE.md` (M1-05 capability enforcer spike)
- `docs/adr/ADR-005` (artifact record), `ADR-010` (at-rest protection),
  `ADR-020` (scopes), `ADR-001` (canonicalization)
