---
id: 0008
title: SecretStore
status: PROPOSED
date: 2026-07-31
---

# ADR-0008: SecretStore — stockage sécurisé des secrets

**Statut :** `PROPOSED`
**Date :** 2026-07-31
**Décideurs :** Erwan, Hermes Agent (MiniMax M3)
**Source :** Plan V3 §3.3, §8.7

## Contexte

Unifia doit stocker des **secrets** utilisateur (API keys, tokens, credentials) de manière sécurisée :
- **Chiffrement at-rest** : pas de plaintext sur disque
- **Isolation** : pas accessible aux capabilities non autorisées
- **Audit** : chaque accès est tracé
- **Migration** : les installations OpenCode existantes ont des secrets en clair (`.env`, Infisical)

## Décision

Adopter le pattern **SecretStore** comme composant de gouvernance (Plan V3 §5) avec :

```typescript
interface SecretStore {
  set(name: string, value: string, metadata?: SecretMetadata): Promise<void>
  get(name: string): Promise<string | null>
  delete(name: string): Promise<void>
  list(filter?: SecretFilter): Promise<SecretDescriptor[]>
  rotate(name: string, newValue: string): Promise<void>
}
```

**Architecture** :
- **Backend** : `keyring` natif (Windows Credential Manager, macOS Keychain, Linux Secret Service)
- **Fallback** : fichier chiffré AES-256-GCM avec clé dérivée de mot de passe utilisateur
- **Chiffrement** : libsodium / `node:crypto` (AES-256-GCM + Argon2id)
- **Taint tracking** : chaque secret lu est marqué (cf. ADR-0010)

**Implémentations** :
1. `KeyringSecretStore` (défaut, utilise `keytar` ou `node-keytar`)
2. `EncryptedFileSecretStore` (fallback, chiffrement fichier)
3. `MemorySecretStore` (pour tests)

**Migration depuis OpenCode** :
- Plan V3 §3.3 : "ne pas adopter Infisical, réécrire SecretStore"
- `unifia-migrate.sh` (déjà livré) inclut une étape `migrate_secrets()` qui :
  1. Lit les anciens secrets depuis `~/.config/opencode/secrets.json` (legacy)
  2. Demande le mot de passe utilisateur (si chiffrement)
  3. Réécrit dans `~/.config/unifia/secrets.json` (chiffré)

## Conséquences

### Positives
- ✅ **Sécurité** : secrets chiffrés at-rest
- ✅ **OS integration** : utilise les credentials managers natifs
- ✅ **Migration** : transition non-breaking depuis OpenCode
- ✅ **Audit** : chaque accès tracé

### Négatives
- ❌ **UX** : demander le mot de passe à chaque accès (si fallback fichier)
- ❌ **Compatibilité** : keytar est un projet mature mais avec peu de mainteneurs
- ❌ **Cross-platform** : chaque OS a son API native

### Neutres
- SecretStore ne décide pas qui peut accéder (c'est PolicyEngine)

## Alternatives considérées

### A. Infisical (SaaS)
- **Rejeté** : Plan V3 §3.3, dépendance SaaS externe

### B. HashiCorp Vault
- **Rejeté** : trop lourd pour desktop, infrastructure requise

### C. Plain JSON file (legacy OpenCode)
- **Rejeté** : pas chiffré, sécurité faible

## Plan d'implémentation

- **Phase 2** : interfaces TypeScript + SecretMetadata schema
- **Phase 3** : KeyringSecretStore (keytar)
- **Phase 3** : EncryptedFileSecretStore (fallback)
- **Phase 3** : `unifia-migrate.sh migrate-secrets` (étape additionnelle)

## Liens

- Plan V3 §3.3 (Ne pas adopter Infisical)
- Plan V3 §8.7 (Lecture de secrets = default deny)
- Plan V3 §15 (secret.read = sensible)
- ADR-0006 (PolicyEngine) — autorise l'accès
- ADR-0007 (ApprovalBroker) — peut demander approbation
- ADR-0009 (AuditRuntime) — trace chaque accès
- ADR-0010 (TaintTracker) — marque les secrets lus