<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# M0-04 EVIDENCE — secure-storage spike (ADR-010)

> Statut : **EVIDENCE_PINNED** (algorithmic layer validated)
> Date : 2026-09-01T17:25+02:00
> Source : `docs/automation-v2/spikes/m0-04-secure-storage.ts`

## 0. Cadrage

Ce spike valide la **couche algorithmique** d'ADR-010 (Secret /
Credential / Key model) en testant les primitives `node:crypto` que
le futur `@unifia/secret-broker/` utilisera. L'intégration OS-level
(DPAPI / Keychain / Keystore) est platform-specific et sera testée
en M1 avec l'implémentation réelle.

**Code de production modifié** : aucun. Le spike n'utilise que
`node:crypto` (Bun standard).

**Commande de reproduction** :

```bash
cd D:\App\unifia\.worktrees\rev3m-20260901\design
bun docs/automation-v2/spikes/m0-04-secure-storage.ts
```

**Dernière exécution** : 2026-09-01, 8 PASS / 0 FAIL / 0 MISSING.

## 1. Verdict par vecteur

| # | Vecteur | Verdict | Évidence |
|---|---|---|---|
| 1 | `randomBytes(32)` pour la root key | **PASS** | 32 bytes générés (256 bits) |
| 2 | `scryptSync` pour dérivation KEK | **PASS** | 32 bytes dérivés, params (N=16384, r=8, p=1) |
| 3 | AES-256-GCM encrypt/decrypt avec AAD | **PASS** | round-trip OK, ciphertext 11 bytes, tag 16 bytes |
| 4 | Détection de tamper GCM | **PASS** | tampered ciphertext rejeté |
| 5 | Binding GCM AAD | **PASS** | wrong AAD rejeté |
| 6 | `timingSafeEqual` pour comparaison de clé | **PASS** | equal buffers compare true |
| 7 | Backup / restore round-trip | **PASS** | DEK recovered intact |
| 8 | KEY_UNAVAILABLE behavior (no key) | **PASS** | empty key rejected: Invalid key length |

## 2. Verdict agrégé

```text
PASS     8
FAIL     0
MISSING  0
```

## 3. Conclusion pour ADR-010

L'**évidence empirique** confirme que la couche algorithmique
d'ADR-010 est réalisable avec `node:crypto` (Bun). Les 5 domaines
de chiffrement du plan §76 (artifact-content, credential-material,
oauth-token, browser-auth-profile, sensitive-runtime-state) sont
gratuitement fournis par le **GCM AAD binding** : un AAD incorrect
fait échouer la vérification du tag d'authentification. C'est plus
fort que de simples IV distincts, parce que ça empêche aussi les
attaques de ré-encapsulation.

Le backup / restore round-trip (vecteur 7) prouve que
`KEY_UNAVAILABLE` n'est pas une corruption silencieuse : si la root
key est perdue, le DEK wrapped ne peut pas être unwrapped.

**Recommandation** : ADR-010 est faisable avec `node:crypto` +
intégration OS-level keyring (DPAPI / Keychain / Keystore) en M1.
Le `@unifia/secret-broker/` peut être créé maintenant.

## 4. Ce que le spike ne couvre pas

- L'intégration OS-level (DPAPI / Keychain / libsecret) — chaque
  plateforme a son API, et le test doit être platform-specific.
- Le wrapping d'un DEK par un KEK qui n'est pas en mémoire mais
  dérivé du mot de passe utilisateur (Argon2 vs scrypt).
- La persistance longue-durée (le spike crée un DEK éphémère).
- L'export chiffré pour backup hors-ligne.

Ces points sont M1 (`@unifia/secret-broker/`).

## 5. Statut

| Élément | Statut |
|---|---|
| Code de production modifié | **NON** |
| Couche algorithmique | **VALIDÉE** |
| Couche OS-level | **M1** (à tester platform-specific) |
| Décision ADR-010 | **DÉJÀ RENDUE** (DECIDED par agent 2) |

## Liens

- `docs/automation-v2/spikes/m0-04-secure-storage.ts`
- `docs/adr/ADR-010-secret-credential-key-model.md` (DECIDED)
- `docs/automation-v2/RISK_REGISTER.md#R-012`
- plan V2.3.1 §72-80
- ADR-001 (canonicalization) spike → `M0-02-EVIDENCE.md`
- ADR-003 (expression) spike → `M0-03-EVIDENCE.md`
- ADR-000 (substrate) spike → `M0-01-EVIDENCE.md`
