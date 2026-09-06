<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-010 — Secret / Credential / Key Protection Model

> **Statut** : DECIDED
> **Date** : 2026-09-01
> **Source** : plan V2.3.1 §72-80, §123-127, THREAT_MODEL §1.4
> (TM-S-01..03), ADR-001, ADR-005, ADR-020, RISK_REGISTER §R-012.

## Status

DECIDED 2026-09-01. Dépend d'ADR-001 (canonicalisation), ADR-004
(history), ADR-005 (artifact), ADR-020 (ownership), R-012 (Secret
Broker manquant). Option A tranchée sur la base de la cartographie
`RISK_REGISTER.md#R-012` et du plan §72-80.

## Context

Plan V2.3.1 §72 fixe la couverture d'ADR-010 :

```text
Secret
Credential
Key Protection
```

§73 liste les décisions à prendre :
- key hierarchy
- key authority
- key references
- key versions
- encryption envelope
- rotation
- revocation
- re-keying
- algorithm migration
- backup/restore
- offline key availability
- key-unavailable behavior
- key destruction

§75 interdit le stockage en clair de `raw root key / master key / KEK /
encryption key` comme metadata durable.

§76 fixe les domaines de chiffrement :
- `artifact-content`
- `credential-material`
- `oauth-token`
- `browser-auth-profile`
- `sensitive-runtime-state`

§77 exige pour `local` :
- offline operation
- no mandatory cloud KMS
- local key authority
- restart-safe
- backup/recovery documented

§79 : un key indisponible retourne `KEY_UNAVAILABLE` (pas de corruption
silencieuse).

§80 : « Une sauvegarde chiffrée sans moyen de récupérer les clés
nécessaires n'est PAS une sauvegarde restaurable. Tester backup →
restore → decrypt. »

§123 fixe les références :
- `CredentialRef`
- `SecretRef`
- `OAuthConnectionRef`
- `BrowserAuthProfileRef`

Workflow et LLM ne voient **jamais** le secret en clair.

## Problem

Quel modèle pour les secrets :

1. **Key hierarchy** : root key → KEK → DEK (par domaine) ?
2. **Key authority** : OS secure storage (DPAPI on Windows, Keychain on
   macOS, libsecret on Linux) ou module dédié ?
3. **Key references** : typées (pas de `string` opaque).
4. **Key versions** : rotation sans downtime.
5. **Encryption envelope** : `AtRestProtectionEnvelope` typé.
6. **Rotation** : `current write key / historical readable keys /
   revoked keys / destroyed keys`.
7. **Algorithm migration** : sans réécriture des artefacts.
8. **Backup / restore** : test backup → restore → decrypt.
9. **Offline key availability** : `local` profile doit fonctionner sans
   réseau.
10. **Key-unavailable behavior** : `KEY_UNAVAILABLE` explicite.
11. **Key destruction** : purge sécurisée des anciennes clés.
12. **Secret Broker** : où vit-il (R-012) ?

## Requirements

| ID | Requirement | Source |
|---|---|---|
| REQ-1 | Secret jamais en clair dans history | TM-S-01 |
| REQ-2 | Secret jamais en clair dans logs/traces | TM-S-02 |
| REQ-3 | Secret jamais au LLM | TM-S-03, plan §4 |
| REQ-4 | `AtRestProtectionEnvelope` typé | plan §74 |
| REQ-5 | Domain separation (5 domaines) | plan §76 |
| REQ-6 | Local profile offline | plan §77 |
| REQ-7 | No mandatory cloud KMS | plan §77 |
| REQ-8 | Restart-safe | plan §77 |
| REQ-9 | Backup / restore testée | plan §80 |
| REQ-10 | `KEY_UNAVAILABLE` explicite | plan §79 |
| REQ-11 | Rotation sans downtime | plan §78 |
| REQ-12 | `CredentialRef` typé (pas de string opaque) | plan §123 |
| REQ-13 | Pas de raw root key en metadata durable | plan §75 |
| REQ-14 | Multi-tenant : `A cannot use B credential` | plan §226 |

## Constraints

| ID | Constraint |
|---|---|
| C-1 | Pas de cloud KMS obligatoire (local-first) |
| C-2 | Compatible Bun/Node (TS) |
| C-3 | Compatible Android (future) |
| C-4 | R-012 : aucun `@unifia/secret-broker` identifié. Cet ADR tranche. |

## Options

### Option A — OS secure storage + Secret Broker local

**Description** : la `root key` est stockée dans l'OS secure storage
(DPAPI/Keychain/libsecret). Un `Secret Broker` TS (`@unifia/secret-broker`,
nouveau package) résout les `CredentialRef` → material à la demande, au
plus proche de l'executor autorisé (plan §124). L'`AtRestProtectionEnvelope`
est construit par le broker, jamais par le caller.

**Preuves en faveur** :
- Local-first (C-1).
- Offline (C-2, C-3).
- Domain separation native (REQ-5).
- Pas de dépendance cloud.
- Standard OS secure storage : éprouvé.

**Preuves en défaveur** :
- Backup/restore plus complexe (il faut sauvegarder la root key).
- Android secure storage (Keystore) doit être vérifié (C-3).

### Option B — Custom encryption avec mot de passe utilisateur

**Description** : l'utilisateur dérive une clé d'un mot de passe (PBKDF2 /
Argon2).

**Preuves en défaveur** :
- Si l'utilisateur oublie le mot de passe → `KEY_UNAVAILABLE` total
  (REQ-10, REQ-9).
- UX dégradée.

### Option C — Cloud KMS (AWS KMS, GCP KMS)

**Description** : on délègue à un cloud KMS.

**Preuves en défaveur** :
- Contredit C-1 (no mandatory cloud KMS).
- REQ-6 (offline) violé.

## Evidence

| Source | Contenu | Statut |
|---|---|---|
| plan V2.3.1 §72-80 | key contract | MEASURED |
| plan §123-127 | références, broker, canary | MEASURED |
| THREAT_MODEL §1.4 | TM-S-01..03 | MEASURED |
| `RISK_REGISTER.md#R-012` | absence d'un Secret Broker identifié | MEASURED |
| OS secure storage (DPAPI, Keychain, Keystore) | standards | UNVERIFIED — spike requis |

## Decision

**Option PROPOSED : A — OS secure storage + Secret Broker local**,
sous réserve de la cartographie PRE-1.1 (R-012) et du spike M1-02.

**Justification** :
- C-1 (local-first) élimine C.
- C-2, C-3 (offline) couvertes par OS secure storage.
- REQ-12 (`CredentialRef` typé) demande un broker — option A le crée.

**Architecture** :

```text
@Hierarchy:
  Root Key: stockée dans OS secure storage (jamais exportée)
  KEK (Key Encryption Key): dérivée de Root Key via HKDF
  DEK (Data Encryption Key): par domaine (artifact-content, credential-material,
    oauth-token, browser-auth-profile, sensitive-runtime-state)
  Wrapped DEK: la DEK est chiffrée par la KEK, stockée avec les données

@Secret Broker:
  Secret Broker expose:
    resolve(ref: CredentialRef, scope: OwnershipScope & DeploymentScope?): Promise<SecretMaterial>
    rotate(ref: CredentialRef): Promise<CredentialRef>     // nouvelle version
    revoke(ref: CredentialRef): Promise<void>
    list(scope: OwnershipScope): Promise<CredentialRef[]>

@Envelope:
  AtRestProtectionEnvelope = {
    version, protectionScheme, encryptionAlgorithm, keyRef, keyVersion?,
    wrappedDataKey?, nonceOrIV, aadDomain
  }
  Construit par Secret Broker, jamais par caller.

@Workflow:
  Workflow ne voit que CredentialRef / SecretRef / OAuthConnectionRef /
  BrowserAuthProfileRef. SecretMaterial résolu au plus près de l'executor
  autorisé (plan §124).

@Canary gate (plan §125):
  secret_canary:
    required: true
    surfaces interdites: history, logs, traces, LLM, model-visible DOM,
      model-visible accessibility, model-visible screenshot, artifacts,
      debugger, audit export
    pass: secret leak count = 0
```

**Comportement face aux erreurs** (REQ-10) :

```text
KEY_UNAVAILABLE: la root key n'est pas accessible (OS secure storage vide,
  utilisateur révoqué, etc.)
  - Pas de corruption silencieuse
  - Pas de retry aveugle
  - Le run échoue avec status KEY_UNAVAILABLE
  - L'audit log trace l'événement (sans le secret)
```

**Backup / restore** (REQ-9) :

```text
Backup: chiffrer tous les artefacts + wrapped DEK
        + Root Key (export chiffré par mot de passe utilisateur ou HSM)
Restore: tester le triplet backup → restore → decrypt
         Si un seul échoue, le backup n'est PAS une sauvegarde restaurable
```

## Consequences

- `@unifia/secret-broker/` (nouveau) — package dédié.
- `@unifia/contracts/src/secrets.ts` étendu avec `CredentialRef`,
  `SecretRef`, `OAuthConnectionRef`, `BrowserAuthProfileRef`,
  `AtRestProtectionEnvelope`.
- `Capability Authority` est étendue pour valider qu'un `CredentialRef`
  est dans le scope du run.
- `ArtifactStore` enveloppe les `protectionEnvelope` via Secret Broker
  (cf. ADR-005).
- `WorkbenchAuthenticator` (auth.ts) doit intégrer le Secret Broker
  pour l'authentification OAuth.
- `audit-runtime` doit s'assurer qu'aucun secret n'est loggué.

## Trade-offs

| Trade-trade | A | B | C |
|---|---|---|---|
| Local-first | Oui | Oui | Non |
| Backup/restore | Moyen (root key) | Faible | Bon (KMS gère) |
| UX mot de passe | Aucun | Requis | Aucun |
| Android | Keystore natif | Custom | Cloud |
| REQ-1..14 | Couvre | Partiel | Couvre sauf REQ-6/7 |

## Rejected alternatives

- **B (mot de passe utilisateur)** : rejeté pour UX et risque de perte
  totale.
- **C (cloud KMS)** : rejeté (C-1).
- **Pas d'ADR** : rejeté (R-012 bloque).

## Security impact

- TM-S-01 (secret en history) : REQ-1 + canary gate.
- TM-S-02 (secret en logs) : REQ-2 + canary gate.
- TM-S-03 (secret au LLM) : REQ-3 + ADR-002.
- TM-T-02 (A utilise credential de B) : REQ-14 + ADR-020.

## Migration impact

- `auth.ts` (16 Ko) doit être refactoré pour utiliser le Secret Broker.
- Les secrets actuellement en clair (s'il y en a) doivent être migrés.
- La cartographie PRE-1.1 (R-012) confirme où vit la responsabilité
  actuelle.

## Testing strategy

1. **M1-02 spike** : OS secure storage, root key persistence,
   backup/restore.
2. **M1 tests** (plan §196) : crypto envelope migration compatibility
   contract tests.
3. **M3 tests** (plan §201) : crash matrix.
4. **Multi-tenant** (plan §226) : A cannot use B credential.
5. **Canary gate** (plan §125) : secret leak count = 0.
6. **Backup/restore E2E** : le script restore est exécuté et testé.

## Rollback / exit strategy

- Le Secret Broker est derrière une interface ; un autre broker peut
  être branché.
- Si un test casse un consumer, l'interface permet un fallback.
- `KEY_UNAVAILABLE` est explicite, jamais une corruption.

## Liens

- `plan V2.3.1` §72-80, §123-127
- `THREAT_MODEL.md` §1.4
- `RISK_REGISTER.md#R-012`
- ADR-001 (canonicalisation — `keyRef` typé)
- ADR-004 (history — l'`CredentialRef` est dans la history, pas le material)
- ADR-005 (artifact contract — `protectionEnvelope`)
- ADR-020 (ownership — scope)
- ADR-002 (WorkflowIR — le binding ne doit pas exposer le material)
- ADR-009 (policy)
- ADR-011 (MCP — auth)
- ADR-024 (extension isolation)
