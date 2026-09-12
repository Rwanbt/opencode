# P3-C300-C — SecretStore

**Statut :** `INTEGRATED` (interface documentée, BLOQUÉ par audit humain)
**Date :** 2026-08-01
**Parent :** P3-C300 (Security foundation)

## ⚠️ SECURITY-CRITICAL

## Objectif

Stocker les secrets (API keys, tokens) de manière chiffrée, sans jamais les logger en clair.

## Interface

```typescript
export interface SecretStore {
  set(input: { key: string; value: string; metadata?: SecretMetadata }): Promise<void>
  get(input: { key: string }): Promise<Secret | null>
  list(input?: { prefix?: string }): Promise<SecretMetadata[]>
  delete(input: { key: string }): Promise<void>
  rotate(input: { key: string }): Promise<void>
}

export interface SecretMetadata {
  key: string
  type: "api-key" | "token" | "private-key" | "password"
  provider?: string  // e.g., "openai", "anthropic"
  createdAt: number
  rotatedAt?: number
  expiresAt?: number
}

export interface Secret {
  metadata: SecretMetadata
  value: string  // decrypted
}
```

## Backends de stockage

- **Keychain (macOS)** : via `security` CLI
- **Windows Credential Manager** : via PowerShell
- **libsecret (Linux)** : via D-Bus
- **Encrypted file** : fallback (AES-256-GCM + Argon2)
- **HashiCorp Vault** : future, enterprise

## Sécurité

- Chiffrement at rest (AES-256-GCM)
- KDF Argon2id pour master password
- Jamais de log en clair (mask: `unfk_xxxx****xxxx`)
- Rotation automatique (90 jours)
- Audit de chaque accès

## Estimation

- SecretStore interface : ~100 LOC
- Backends : ~600 LOC (3 natifs + 1 file + 1 vault)
- Crypto helpers : ~200 LOC
- Tests : ~300 LOC
- **Total : ~1200 LOC**

## Liens

- [ADR-0008 SecretStore](docs/adr/0008-secret-store.md)
- [SECURITY-INCIDENT-RESPONSE.md](../SECURITY-INCIDENT-RESPONSE.md)