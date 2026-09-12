---
id: 0005
title: SandboxPort
status: PROPOSED
date: 2026-07-31
---

# ADR-0005: SandboxPort design

**Statut :** `PROPOSED`
**Date :** 2026-07-31
**Décideurs :** Erwan, Hermes Agent (MiniMax M3)
**Source :** Plan V3 §7.5, §8

## Contexte

Unifia doit exécuter du code non-trusted (scripts Python, bash, JS) dans des **environnements isolés** (sandbox). Le modèle doit supporter :
- **Multi-backend** : Docker, WSL2, Lima (macOS), Native (Linux only)
- **Inspect** : lister les backends disponibles
- **Prepare** : créer un environnement sandbox avec une policy
- **Execute** : lancer une commande dans le sandbox
- **Terminate** : détruire le sandbox

## Décision

Adopter le pattern **SandboxPort** avec 4 méthodes :

```typescript
interface SandboxPort {
  inspect(): Promise<SandboxBackendInfo[]>
  prepare(policy: SandboxPolicy): Promise<SandboxHandle>
  execute(handle: SandboxHandle, request: ExecutionRequest): Promise<Execution>
  terminate(handle: SandboxHandle): Promise<void>
}
```

**Backends supportés** (Plan V3 §7) :
- **Native restricted** (Linux) : UID/GID dedicated, no network, chroot
- **Docker** : container éphémère, `docker run --rm`
- **WSL2** (Windows) : distribution éphémère
- **Lima** (macOS) : VM éphémère
- **Browser profile** (Phase 10) : Chromium profile jetable

**Sélection du backend** : `policy.backend: "native" | "docker" | "wsl2" | "lima" | "auto"`

**Implémentations** :
1. `NativeSandboxPort` (Linux, Mac via sandbox-exec, Win via Job Objects)
2. `DockerSandboxPort` (Linux, Mac, Win via Docker Desktop)
3. `WslSandboxPort` (Windows)
4. `LimaSandboxPort` (macOS)
5. `CompositeSandboxPort` (auto-sélection selon OS)

## Conséquences

### Positives
- ✅ **Multi-backend** : Unifia fonctionne sur tous les OS
- ✅ **Security** : isolation des code non-trustés
- ✅ **Default deny** : default policy = aucun accès réseau, read-only filesystem
- ✅ **Audit** : chaque exécution est tracée

### Négatives
- ❌ **Performance** : Docker/WSL2/Lima = overhead vs Native
- ❌ **Complexité** : 4-5 implémentations backend à maintenir
- ❌ **Testing** : difficile de tester tous les backends en CI

### Neutres
- Le port est agnostique du backend, mais la policy est spécifique

## Alternatives considérées

### A. Docker only
- **Rejeté** : pas disponible sur tous les OS sans setup lourd

### B. gVisor / firecracker (micro-VMs)
- **À reconsidérer** : meilleure isolation, mais complexité++

### C. Native only (chroot/setuid)
- **Rejeté** : trop permissif sur certaines distros, pas portable

## Plan d'implémentation

- **Phase 2** : interfaces TypeScript + SandboxPolicy schema
- **Phase 8** : NativeSandboxPort, DockerSandboxPort, WslSandboxPort, LimaSandboxPort
- **Phase 8** : CompositeSandboxPort (auto-sélection)
- **Phase 10** : BrowserSandboxPort (pour computer use)

## Liens

- Plan V3 §7.5 (SandboxPort)
- Plan V3 §8 (SandboxBroker multi-backend)
- Plan V3 §8.3 (Sécurité avant computer use)
- ADR-0006 (PolicyEngine) — sandbox policies
- ADR-0010 (Computer Use broker) — futur