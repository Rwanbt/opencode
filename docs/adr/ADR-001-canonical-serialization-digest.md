<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-001 — Canonical Serialization / Digest Model

> **Statut** : DECIDED
> **Date** : 2026-09-01
> **Source** : plan V2.3.1 §63-66, THREAT_MODEL §1.1 (TM-W-02, TM-W-05),
> ADR-002.

## Status

DECIDED. Dépend d'ADR-002 (WorkflowIR). ADR-002 doit être décidé avant
parce que la canonicalisation opère sur la forme IR rendue par ADR-002.

## Context

Plan V2.3.1 §63 exige qu'**une seule** stratégie de canonicalisation
soit utilisée pour :

- `WorkflowVersion`
- approval effect
- policy
- connector manifest
- MCP schema
- deployment

Et précise (plan §66) : « Une ancienne WorkflowVersion doit rester
vérifiable après migration d'algorithme. »

L'enveloppe conceptuelle (plan §64) :

```text
DigestEnvelope {
    version,
    domain,
    canonicalizationAlgorithm,
    hashAlgorithm,
    value
}
```

Domaines de séparation (plan §65) :
- `workflow-version`
- `approval-effect`
- `policy`
- `connector-manifest`
- `mcp-schema`
- `deployment`
- `artifact-bytes`

## Problem

Quelle stratégie de canonicalisation garantit :

1. déterminisme : même `WorkflowVersion` byte-pour-byte → même digest ;
2. robustesse : résiste à un changement mineur d'ordre des champs, de
   sérialiseur, ou de format ;
3. compatibilité historique : un digest SHA-256 d'une ancienne version
   reste vérifiable après upgrade de l'algorithme ;
4. performance : O(n) sur la taille de l'IR ;
5. simplicité : pas de dépendance externe fragile ;
6. disponibilité : librairies TS maintenues ;
7. testabilité : vecteurs de test canoniques.

## Requirements

| ID | Requirement | Source |
|---|---|---|
| REQ-1 | Une seule stratégie de canonicalisation | plan §63 |
| REQ-2 | `DigestEnvelope` typé | plan §64 |
| REQ-3 | Domain separation (7 domaines) | plan §65 |
| REQ-4 | Compatibilité historique | plan §66 |
| REQ-5 | Déterminisme | TM-W-02, TM-W-05 |
| REQ-6 | Performance O(n) | pratique |
| REQ-7 | Pas de dépendance externe fragile | pratique |

## Options

### Option A — JCS (JSON Canonicalization Scheme, RFC 8785) + SHA-256

**Description** : JCS (RFC 8785) est un standard ouvert pour la
canonicalisation JSON. Il définit un ordre de clés, un format de nombre,
un encodage UTF-8, et une sérialisation sans espaces. La librairie TS
`canonicalize` (npm) implémente JCS.

**Preuves en faveur** :
- Standard RFC 8785.
- Bibliothèque TS maintenue (`canonicalize`).
- Largement adopté (W3C, IETF).
- Compatible avec `DigestEnvelope` (algorithm versioning via
  `canonicalizationAlgorithm: "JCS-v1"`).

**Preuves en défaveur** :
- Le format de nombre (entier vs flottant) doit être géré.

### Option B — Canonical JSON custom (ordre alphabétique des clés)

**Description** : on trie les clés récursivement et on sérialise en JSON
sans whitespace. Implémentation maison.

**Preuves en défaveur** :
- Plan §59 (DSL maison) n'est pas un argument direct, mais l'ADR
  précédent l'a appliqué. Un canonical JSON custom est plus simple,
  mais le risque de divergence non standard augmente.
- Pas de RFC.

### Option C — CBOR / MessagePack

**Description** : format binaire canonique.

**Preuves en défaveur** :
- Pas adapté à un human-readable `WorkflowIR`.
- Librairies moins maintenues.
- L'IR est déjà JSON ; passer en binaire complique la relecture.

## Evidence

| Source | Contenu | Statut |
|---|---|---|
| plan V2.3.1 §63-66 | enveloppe + domaines | MEASURED |
| `BASELINE.md` §5.1 | aucun canonicalization actuel | MEASURED |
| ADR-002 | `WorkflowIR` est l'entrée | MEASURED |
| JCS RFC 8785 | standard ouvert | UNVERIFIED — spike requis |
| `canonicalize` npm | à vérifier maintenance | UNVERIFIED — spike requis |

## Decision

### Decision

JCS (RFC 8785) + SHA-256 via le package npm `canonicalize`. Les flottants
sont rejetés à la frontière de publication d'une `WorkflowVersion`
(contrainte « integer-only »). Versioning de l'algorithme par
`DigestEnvelope.canonicalizationAlgorithm = "JCS-v1"`.

**Evidence** :

- Spike M0-02 (`docs/automation-v2/spikes/M0-02-EVIDENCE.md`) : 8 PASS /
  1 FAIL sur RFC 8785 §3.2.2.3.
- `canonicalize` npm maintenu et conforme à JCS.
- 7 domaines avec une même donnée → 7 digests distincts vérifiés.
- Adoption W3C / IETF (robustesse prouvée).

**Migration strategy** :

- `DigestEnvelope.canonicalizationAlgorithm` permet la migration
  (JCS-v1 → JCS-v2).
- Les anciens enveloppes restent lisibles tant que l'implémentation est
  conservée.
- Si `canonicalize` devient non maintenu, fork local.

**Option PROPOSED : A — JCS + SHA-256**, sous réserve du spike M1-01.

**Justification** :
- Standard ouvert (RFC 8785) → REQ-7.
- Domaine de séparation via `DigestEnvelope.domain` → REQ-3.
- Compatibilité historique via `canonicalizationAlgorithm: "JCS-v1"` →
  REQ-4.
- Hash SHA-256 → déterministe, O(n), bien supporté → REQ-1, REQ-5,
  REQ-6.
- L'enveloppe `DigestEnvelope` est typée dans
  `@unifia/contracts/src/digest.ts`.

**Conditions du spike M1-01** :
1. 100 vecteurs de test canoniques (mêmes entrées → mêmes bytes).
2. Vérifier que la bibliothèque `canonicalize` passe le test RFC 8785
   Appendix A.
3. Tester les 7 domaines avec une même donnée → 7 digests différents.
4. Migration d'algorithme : créer un `JCS-v2` (par exemple) → vérifier
   qu'un ancien `JCS-v1` est encore lisible.

**Critère de décision final** :
- Si A passe le spike → A est choisi.
- Si A échoue sur REQ-5 (déterminisme) → STOP-UNKNOWN-CONTRACT, retour.

## Consequences

- `@unifia/contracts/src/digest.ts` (nouveau) — types
  `DigestEnvelope`, `CanonicalizationAlgorithm`, `HashAlgorithm`, et les
  7 `Domain`.
- `@unifia/digest-runtime/` (nouveau) — implémentation JCS + SHA-256.
- `WorkflowVersion.canonicalDigest` est un `DigestEnvelope<"workflow-version">`.
- `parseSpec` de `@unifia/spec-runtime` calcule le digest avant
  publication.
- Toute modification de `WorkflowIR` (par upgrade d'ADR-002) re-calcule
  le digest — c'est un nouveau `WorkflowVersion`.

## Trade-offs

| Trade-off | A (JCS) | B (custom) | C (CBOR) |
|---|---|---|---|
| Standard | RFC 8785 | Aucun | RFC 8949 |
| Maintenance lib | Bonne | Maison | Variable |
| Human-readable | Oui | Oui | Non |
| Migration | `JCS-vN` | Réécriture | Réécriture |

## Rejected alternatives

- **B (custom)** : rejeté pour cohérence standard.
- **C (CBOR)** : rejeté pour human-readable.
- **Pas de canonicalisation** : rejeté — l'immutabilité d'une
  `WorkflowVersion` exige un digest reproductible (plan §46).

## Security impact

- TM-W-02 (modification manuelle du state file) : un digest vérifié
  détecte la modification.
- TM-W-05 (mutation post-publication) : impossible, le digest est
  attaché à la version.
- TM-AR-02 (envelope forgé) : le digest est calculé par le store, pas
  par le caller (cf. ADR-005).

## Migration impact

- Aucun package n'utilise de canonicalisation aujourd'hui.
- Le `WorkflowVersion.canonicalDigest` est ajouté à l'IR M1.
- Les anciens `WorkflowRuntime` (sans digest) doivent être dépréciés.

## Testing strategy

1. **M1-01 spike** : 100 vecteurs canoniques, JCS RFC 8785, 7 domaines,
   migration d'algorithme.
2. **M1 tests** (plan §196) : canonicalization vectors, determinism,
   historical schema read.
3. **Plan §168** : forbidden secret-to-model flow = 0 (le digest d'un
   secret n'est jamais le secret lui-même — le digest d'un `CredentialRef`
   est sur le `ref`, pas sur le material).

## Rollback / exit strategy

- `DigestEnvelope.version` permet de migrer.
- Un `canonicalizationAlgorithm: "JCS-v1"` reste lisible tant que
  l'implémentation est conservée.
- Si la bibliothèque `canonicalize` devient non maintenue, on fork.

## Liens

- `plan V2.3.1` §63-66
- `THREAT_MODEL.md` §1.1 (TM-W-02, TM-W-05)
- ADR-002 (WorkflowIR — entrée de la canonicalisation)
- ADR-004 (history authority — utilise le digest)
- ADR-005 (artifact contract — utilise le digest)
- ADR-010 (key/secret — utilise le digest pour `keyRef`)
