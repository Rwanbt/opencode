# ADR-SECRET-DELEGATION-V2 — Délégation opaque des credentials Team V3

> **Statut :** PROPOSED — v2 refondue suite au verdict E2 (CHANGES_REQUESTED)
> **Carte :** TEAM-A02 (Lot A, Gate T0) — tentative 2
> **Worktree :** `D:\App\OpenCode\.team-worktrees\A02-015e1c84`
> **SHA de base :** `4be438597986380ec0b0a1af21524b74626e7e3c`
> **Date UTC :** 2026-07-20
> **Hash d'instance :** alias `A02-V2` / canonique dérivé `6ef89609`
> **Supersede :** `ADR-SECRET-DELEGATION.md` (v1)
> **Décisions figées par E2 (cf. D-012)** : keychain Desktop, encrypted-file CLI,
> TTL per-provider (défaut 120s / plafond 300s), kill switch team.handleOnly,
> legacy query string désactivé à T0, D03 avant H05.

> **Note importante — D-010 §5 appliquée.** ADR-V2 ne cite aucun finding A01,
> aucune conclusion A01, et reformule les références au PermissionBroker
> indépendamment de toute approbation A01 (cf. §3.1).

---

## 1. Contexte

L'agent Team doit déléguer à ses workers (sub-agents, CLI sandboxés) des
credentials providers **sans jamais leur transmettre la valeur brute**.
Plan §14 :

```text
- SecretStore reste autorité ;
- le worker reçoit un handle opaque et éphémère ;
- injection uniquement dans le processus provider concerné ;
- jamais dans la capsule, le prompt ou l'environnement complet ;
- redaction entrée/sortie ;
- revoke à la fin de l'appel.
```

L'audit A02 (§AUDIT-PROVIDER-AUTH-V2) a établi (re-qualifié par E2) :

1. **F-A02-1 high / D03** : `process.env.AWS_BEARER_TOKEN_BEDROCK = auth.key`
   à `provider/loaders.ts:178` (existe préexistant, à fermer par D03).
2. **F-A02-2 high / T0 immédiat** : legacy `?authorization=Bearer+<jwt>`
   à `server/auth-jwt.ts:151,203` (à désactiver avant T0).
3. **F-A02-3a low / sprint-durcissement** : couverture formats secrets
   incomplète (grok-, glm-, mistral-, cohere-, etc.).
4. **F-A02-3b medium / sprint-durcissement** : audit cleanup headers
   plugins tiers.
5. **9 vecteurs threat model** à inclure dans A06.

---

## 2. Forces en présence

### 2.1 Conformité au plan V3 (INCHANGÉ v1)

### 2.2 Contraintes héritées (INCHANGÉ v1)

---

## 3. Décision technique proposée (v2 refondue — verdict E2)

### 3.1 Décomposition en 3 couches (E2 verdict §3 feedback)

```
┌──────────────────────────────────────────────────────────────┐
│  AuthStorage (couche 1)                                       │
│  - Protège les secrets AU REPOS.                              │
│  - FileStorage / KeychainStorage / EncryptedFile.             │
│  - Retourne Record<string, unknown> brut.                     │
│  - N'EST PAS appelé directement par les workers.              │
└──────────────────────────────────────────────────────────────┘
                       ▲                ▲
                       │ resolve        │ resolve
                       │ (no read)      │ (no read)
┌──────────────────────────────────────────────────────────────┐
│  CredentialBroker (couche 2)                [NOUVEAU v2]      │
│  - Résout un secret brut pour UN appel provider.              │
│  - Lit AuthStorage.                                            │
│  - Émet un SEUL appel à la fois, scopé par (run, task, op).  │
│  - N'INJECTE PAS dans le process env.                          │
│  - RPC-only, pas de méthode publique exportée hors broker.     │
└──────────────────────────────────────────────────────────────┘
                       ▲                ▲
                       │ invoke(handle, req)
                       │                │
┌──────────────────────────────────────────────────────────────┐
│  PermissionBroker (couche 3)                                  │
│  - AUTORISE l'opération et son scope.                         │
│  - Délivre un handle opaque NON SECRET au worker.              │
│  - Conserve l'audit et la révocation.                          │
│  - Sépare permissions workspace des permissions providers.    │
└──────────────────────────────────────────────────────────────┘
                       ▲                ▲
                       │ handle opaque  │
                       │                │
                   ┌─── worker ────────┴────┐
```

**Statut de cette couche intermédiaire CredentialBroker** : **draft**, à
finaliser en D03 (avant H05, cf. R-013). Aucune implémentation ici — purement
schéma d'architecture.

### 3.2 Backend par défaut — D-012 figé (verdict E2)

| Environnement | Backend | Mode par défaut E2 | Action à T0 |
|---|---|---|---|
| Desktop (Tauri) | `KeychainStorage` | **défaut** | activer via `OPENCODE_AUTH_STORAGE=keychain` |
| Android | `EncryptedFile` (Stronghold / EncryptedSharedPreferences) | **défaut** | plugin livré requis |
| CLI headless sans Tauri | `EncryptedFile` (Argon2id → AES-GCM) | **défaut** | clé **explicitement provisionnée** |
| Tests / CI | `FileStorage` ephemeral `tmpdir` | non — `ENV=ci` | obligatoire |
| Production legacy | `FileStorage` plaintext | **INTERDIT** | supprimé en prod |

**Fail-closed** : si aucun backend sécurisé n'est disponible, l'application
refuse de démarrer au lieu de basculer silencieusement sur `auth.json`
plaintext. C'est l'écart majeur par rapport à v1 §3.3.

### 3.3 Politique TTL — D-012 figé (verdict E2)

| Niveau de risque | TTL | Revocation < |
|---|---|---|
| low | 0 (pas de handle) | — |
| medium | **120 s** | 1 s |
| high | **120 s + audit** | 1 s |
| critical | **120 s + signature + human approval** | 1 s |

**Plafond normal : 300 s.** Toute durée > 300 s exige policy explicite auditée.

### 3.4 Kill switch — D-012 figé (verdict E2)

`team.handleOnly` (plan §22) doit :
- exister comme kill switch fail-closed.
- être **activé par défaut** sur runtimes Team réels.
- interdire tout chemin de credentials hors `PermissionBroker`.

### 3.5 legacy query string — D-012 figé (verdict E2)

`?authorization=Bearer+<jwt>` doit être **désactivé à T0**.
`auth-jwt.ts:151,203` doit forcer `legacyAllowed = false`. Une exception
temporaire éventuelle doit être :
- explicitement activée via `OPENCODE_WS_AUTH_LEGACY=audit`,
- émettre un audit de sécurité à chaque acceptation,
- afficher une date d'échéance de suppression vérifiable.

### 3.6 Ordre d'implémentation — D-012 figé (verdict E2)

**D03 avant H05** :
- D03 (PermissionBroker + CredentialBroker) doit précéder H05
  (Sandboxed CLI WorkerRuntime) car le contrat de délégation, révocation,
  audit et redaction doit être stabilisé avant la conception du worker.

---

## 4. API publique proposée (v2 refondue — REJET de v1)

### 4.1 Rejet de l'API v1 (E2 verdict §4 feedback)

L'API v1 était rejetée pour :

- **`revocationToken` bearer secret exposé au worker** — propriété publique
  = bordel de sécurité. **REJETÉ.**
- **`__providerInvoke` exploitable par le worker** — méthode publique,
  export possible → bypass des contrôles. **REJETÉ.**
- **Pas de bornage par opération et usage** — TTL simple, pas d'anti-replay,
  pas de compteur d'usage. **INSUFFISANT.**

### 4.2 API v2 (esquisse)

```ts
// packages/unifia/src/team/permission-broker.ts (cible D03)

export const HandleID = Schema.UUID.pipe(Schema.brand<"HandleID">())
export type HandleID = Schema.Schema.Type<typeof HandleID>

export const HandleScope = Schema.Struct({
  runID: RunID.optional,
  taskID: TaskID.optional,
  toolID: ToolID.optional,
  resourceRefs: Schema.Array(ResourceID).optional,
})
export type HandleScope = Schema.Schema.Type<typeof HandleScope>

/**
 * Handle strictement opaque, NON SECRET.
 * Le worker ne possède que cet identifiant.
 * Aucun accesseur vers une valeur de credential.
 */
export interface CredentialHandle {
  readonly id: HandleID
  readonly providerID: ProviderID
  readonly operationRef: OperationRef
  readonly scope: HandleScope
  readonly issuedAtUTC: string
  readonly expiresAtUTC: string          // ISO8601, absolu
  readonly maxUsages: number              // 1 par défaut (usage unique)
  readonly usageCount: number
  readonly nonce: string                  // anti-replay
  readonly leaseID: LeaseID
  readonly fencingToken: number
  // AUCUN champ secret.
  // AUCUNE méthode d'invocation directe.
}

/**
 * Worker interaction surface — uniquement.
 */
export interface WorkerCredentialSurface {
  /**
   * Le worker appelle cette méthode pour invoquer un provider.
   * Le broker revalide TOUT à chaque appel :
   *  - identité worker (auth JWT),
   *  - runID, taskID, providerID,
   *  - opération, ressource,
   *  - TTL (now < expiresAtUTC),
   *  - nonce (anti-replay),
   *  - lease actif et fencing token cohérent,
   *  - usageCount < maxUsages,
   *  - état de révocation,
   *  - quotas.
   * Renvoie le résultat chiffré au worker.
   */
  invoke(handle: CredentialHandle, request: ProviderRequest): Promise<ProviderResponse>

  /**
   * Le worker libère explicitement le handle.
   */
  release(handle: CredentialHandle): Promise<void>
}
```

### 4.3 Propriétés garanties par l'API v2

| Propriété | Moyen |
|---|---|
| Handle non secret | type `HandleID` brandé (UUID) ; aucune référence au secret |
| Opaque pour le worker | aucune méthode publique d'accès au secret ; `invoke` passe par broker seulement |
| Éphémère | TTL absolu `expiresAtUTC` ; revokation possible avant expiration |
| Usage unique (par défaut) | `maxUsages: 1` ; incrément à chaque `invoke` |
| Anti-replay | `nonce` côté broker ; refus si nonce déjà vu |
| Borné opération | `operationRef` ; broker vérifie correspondance avec `request` |
| Borné scope | `HandleScope` ; broker vérifie `runID`/`taskID`/`resourceRefs` |
| Auditable | événement `credential.handle.used` à chaque invocation (hash handle, identité worker, opération) |
| Révocation atomique | `release`, fin de tâche, crash worker, changement lease/fencing → invalidation immédiate |
| **Pas de fallback insecure** | backend par défaut = keychain/encrypted-file, jamais plaintext |

---

## 5. Mapping `process.env` (INCHANGÉ + redaction renforcée)

Le composant `SecretRedactor` (plan §4) doit :

| Sortie | Redaction |
|---|---|
| Prompt utilisateur | toutes valeurs credential |
| Event bus | uniquement ID handle, jamais valeur |
| Log fichier | toutes valeurs credential ; hash handle OK |
| `stdout`/`stderr` | toutes valeurs credential |
| Subprocess `env` | aucune variable `*_TOKEN`, `*_KEY`, `*_SECRET` |
| Crash dump | toutes valeurs credential ; redaction pre-write |
| Diagnostic bundle | hash du handle, jamais valeur |

---

## 6. Routes de migration depuis l'existant

### 6.1 Cartes concernées

| Carte | Action | Priorité |
|---|---|---|
| A02 (actuelle, v2) | Cet ADR-V2 — READY_FOR_E2_REVIEW | T0 |
| D03 (Gate T3, E2) | Implémenter PermissionBroker + CredentialBroker + nouvelle API | **AVANT H05** |
| D03b | Brancher provider/provider.ts pour résoudre via broker au lieu de auth.get brut | après D03 |
| G03 (Gate T6, E2) | ScopeMonitor refuse les handles hors scope | après D03 |
| H01-H02 (Gate T7) | ChildSessionWorkerRuntime reçoit CredentialHandle non-secret | après D03 |
| H05 (Gate T7, E2) | Sandboxed CLI WorkerRuntime injecte via broker | **APRÈS D03** |
| N01 (Gate T13, E2) | Suite d'exfiltration (cf. §7) | après H01/H05 |

### 6.2 Backward compat (v2 — renforcé)

- Les anciens call sites `auth.get(providerID)` dans le code **non-Team**
  (`src/agent`, `src/collective`) restent conservés **uniquement** pour
  rétro-compatibilité, marqués `@deprecated security: use
  PermissionBroker.getCredentialHandle()`.
- Un kill switch `team.handleOnly` (D-012 figé) **interdit** en production
  ces chemins.
- Scanner CI interdisant les nouveaux accès bruts à `auth.get(providerID)`
  (sauf permission broker explicite).
- Gate supprimant les usages incompatibles **avant release**.

### 6.3 Preuves de la dette préexistante

| Finding | Origine | Action pré-Team | Note v2 |
|---|---|---|---|
| F-A02-1 | loaders.ts:178 | PermissionBroker / D03 | high (E2) |
| F-A02-2 | auth-jwt.ts:151,203 | **désactiver T0** (E2) | high immédiat |
| F-A02-3a/b | scanner.ts ; plugins/* | sprint-durcissement | low + medium |
| (v1 v3.4) credential_file | collective/types | matérialiser via KeychainStorage | inchangé |
| (v1 v3.4) handle opaque éphémère | plan §14.2 | remplacé par §4 v2 | refondu |

---

## 7. Threat model comparatif (NOUVEAU v2 — demandé par E2)

Cf. `AUDIT-PROVIDER-AUTH-V2` §7.2. Le présent ADR le transpose en
**politiques obligatoires** :

| Vecteur | Politique obligatoire |
|---|---|
| Worker malveillant (compromis) | usage unique + nonce + ré-vérif à chaque appel |
| Plugin compromis | cleanup headers systématique (F-A02-3b), scanner CI |
| Process enfant héritant de `process.env` | refus de `process.env = credential` dans `src/team/**` ; F-A02-1 fermé par D03 |
| Attaquant same-UID | backend par défaut non-plaintext (keychain / encrypted-file) ; exception tmpdir dev uniquement |
| Replay d'un handle révoqué | nonce côté broker |
| SSRF/IPC pivot | validation stricte baseUrl (host loopback, port, scheme) |
| Crash dump | `SecretRedactor` pre-write avec filter regex |
| Logs de diagnostic | redaction en sortie |
| Déconnexion Tauri mid-opération | état partiel dans DB → reprise par `initAuthStorage()` au boot |

---

## 8. Décisions à arbitrer par E2 / humain

**Toutes les décisions de la v1 sont tranchées par E2 dans D-012.**
Ce §8 devient **DÉPRÉCIÉ** dans v2 mais reste conservé pour traçabilité.

1. ~~Backend par défaut Desktop : keychain direct ou opt-in ?~~ → **keychain**, D-012-1
2. ~~CLI headless sans Tauri : encrypted-file ou FileStorage ?~~ → **encrypted-file** (clé provisionnée), D-012-2
3. ~~TTL par défaut : 5 min, 2 min, per-provider ?~~ → **per-provider, défaut 120s, plafond 300s**, D-012-3
4. ~~Kill switch supplémentaire : oui team.handleOnly ?~~ → **oui, fail-closed, activé par défaut**, D-012-4
5. ~~Legacy query string : désactiver T0 ou Sprint 5 ?~~ → **désactiver T0**, D-012-5
6. ~~Ordre implémentation : D03 avant H05 ?~~ → **D03 avant H05**, D-012-6

Les **nouvelles** décisions émergentes de l'API v2 seront tranchées en D03.

---

## 9. Verdict provisoire (v2)

| Décision | Statut v1 | Statut v2 |
|---|---|---|
| 3 couches AuthStorage / CredentialBroker / PermissionBroker | (manquant) | **NOUVEAU v2** |
| Backend par défaut keychain Desktop | DRAFT | **D-012 figé** |
| Backend CLI encrypted-file + clé provisionnée | DRAFT | **D-012 figé** (avec conditions strictes v2 §3.2) |
| TTL per-provider 120s/300s | DRAFT | **D-012 figé** |
| Kill switch team.handleOnly fail-closed | DRAFT | **D-012 figé** |
| Legacy query string désactivé T0 | DRAFT | **D-012 figé** |
| D03 avant H05 | DRAFT | **D-012 figé** |
| API CredentialHandle v1 (revocationToken + __providerInvoke) | brouillon | **REJETÉ** |
| API CredentialHandle v2 (ID opaque + broker RPC) | — | **NOUVEAU** |
| Refus `process.env = credential` dans src/team/** | DRAFT | **CONFIRMÉ** |
| Migration backward compat par `@deprecated` seul | DRAFT | **INSUFFISANT** (scanner CI + gate requis) |
| Threat model comparatif (9 vecteurs) | (manquant) | **NOUVEAU v2** |
| Fail-closed backend secure (pas de fallback plaintext) | DRAFT | **REJETÉ silencieusement v1** |

---

## 10. §8 v1 SUPPRIMÉ

Les 6 décisions autrefois ouvertes sont **toutes tranchées** par E2 (D-012) et
figées dans §3.2-3.6 ci-dessus. §8 v1 reste dans le document pour traçabilité
historique.

---

## 11. Diff v1 → v2

| Section | Action |
|---|---|
| §3.1 PermissionBroker autorité unique | Reformulé — ne cite plus A01 ; introduit **3 couches** |
| §3.3 Backend par environnement | Tableau refondu avec D-012 figés |
| §3.4 Politique par risque | TTL figés 120s/300s (E2) |
| §3.5 Refus process.env = credential | Confirmé + étend à src/team/** |
| §4 API publique | **Refonte totale** — v1 rejetée, v2 avec RPC + nonce + usage unique |
| §6.2 Backward compat | Renforcé — scanner CI + gate requis |
| §7 Threat model | NOUVEAU v2 — 9 vecteurs comparatifs |
| §8 Décisions à arbitrer | SUPPRIMÉ — toutes tranchées, figées D-012 |
| §9 Verdict provisoire | Tableau refondu avec statuts v2 |
| Note D-010 neutralisation | AJOUTÉ |

---

_Fin de l'ADR-V2 — auteur MiniMax-M3 (E1). Brouillon soumis à E2 review
indépendant. Aucune implémentation de code ; seul ce document a été écrit.
Code réel vérifié au SHA `4be438597986380ec0b0a1af21524b74626e7e3c`. v1 archivé._
