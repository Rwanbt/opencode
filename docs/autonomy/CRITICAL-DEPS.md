# Critical Dependencies — Unifia Workbench

**Carte :** P1-C110e
**Statut :** `INTEGRATED` — v1.0
**Date :** 2026-07-31
**Source :** P1-C110 plan détaillé

## Objectif

Lister les **dépendances critiques** d'Unifia (celles qui, si elles cassent, bloquent le projet) avec rationale, alternative, et plan de mitigation.

## Catégories de risques

### Tier 1 — Core runtime (CRITIQUE)

Ces dépendances sont **impossibles à remplacer** sans réécrire Unifia.

#### Bun — runtime JavaScript

| Champ | Valeur |
|---|---|
| **Version** | 1.3+ |
| **License** | MIT |
| **Nature** | Runtime + package manager + test runner |
| **Justification** | 10× plus rapide que Node, support natif TS, intégralité de la toolchain |
| **Alternative** | Deno (compat ESM moins propre), Node (5× plus lent) |
| **Risque** | `Bun 2.0` breaking change (peu probable mais à surveiller) |
| **Monitoring** | Renovate avec automerge des patches |

#### Tauri — framework desktop

| Champ | Valeur |
|---|---|
| **Version** | 2.0+ |
| **License** | MIT ou Apache 2.0 |
| **Nature** | Framework desktop (Rust + webview) |
| **Justification** | Bundle 10× plus petit qu'Electron, sécurité native, performance |
| **Alternative** | Electron (bundle ~150 MB, sécurité à implémenter) |
| **Risque** | API unstable entre 2.x et 3.x |
| **Monitoring** | ADR-0013 (dépréciation desktop-electron) |

#### SolidJS — UI framework

| Champ | Valeur |
|---|---|
| **Version** | 1.8+ |
| **License** | MIT |
| **Nature** | Framework réactif |
| **Justification** | Plus simple que React, perf comparable, types stricts |
| **Alternative** | React (overkill), Vue (trop différent) |
| **Risque** | Communauté plus petite que React |
| **Monitoring** | Releases SolidJS |

#### TypeScript — langage

| Champ | Valeur |
|---|---|
| **Version** | 5.6+ |
| **License** | Apache 2.0 |
| **Nature** | Langage de compilation |
| **Justification** | Standard de fait, types stricts, écosystème |
| **Alternative** | Aucune viable (sauf retour à JS, refusé) |
| **Risque** | Breaking changes entre 5.x et 6.x |
| **Monitoring** | Renovate avec automerge des patches |

#### Effect — functional effects library

| Champ | Valeur |
|---|---|
| **Version** | 3.x |
| **License** | MIT |
| **Nature** | Functional effects / IO monad |
| **Justification** | Gestion des effets de bord élégante, types forts |
| **Alternative** | fp-ts (legacy), Promise (insuffisant) |
| **Risque** | Courbe d'apprentissage, complexité |
| **Monitoring** | ADR sur le choix Effect |

### Tier 2 — Persistance (CRITIQUE)

#### better-sqlite3 — DB SQLite

| Champ | Valeur |
|---|---|
| **Version** | 11+ |
| **License** | MIT |
| **Nature** | Driver SQLite natif |
| **Justification** | Performances, sync API, simplicité |
| **Alternative** | node-sqlite3 (callback, plus lent), libsql (forks) |
| **Risque** | Binding natif = recompilation requise si nouvelle Node ABI |
| **Monitoring** | Releases better-sqlite3, suivi Node ABI |

#### drizzle-orm — ORM

| Champ | Valeur |
|---|---|
| **Version** | 0.34+ |
| **License** | Apache 2.0 |
| **Nature** | ORM TypeScript-first |
| **Justification** | Types forts, SQL-like, perf bonne |
| **Alternative** | Prisma (over-engineering), kysely (plus bas-niveau) |
| **Risque** | Breaking changes entre 0.x et 1.x |
| **Monitoring** | ADR sur le choix ORM |

### Tier 3 — Frontend (HAUTE)

#### Vite — bundler

| Champ | Valeur |
|---|---|
| **Version** | 5+ |
| **License** | MIT |
| **Nature** | Bundler + dev server |
| **Justification** | ESM natif, HMR rapide, écosystème |
| **Alternative** | Webpack (legacy), Turbopack (jeune) |
| **Risque** | Configurations complexes pour Tauri |
| **Monitoring** | Vite releases |

#### @solidjs/start — meta-framework

| Champ | Valeur |
|---|---|
| **Version** | 1.x |
| **License** | MIT |
| **Nature** | SSR + routing SolidJS |
| **Justification** | Officiel SolidJS, types forts |
| **Alternative** | Build custom (plus de maintenance) |
| **Risque** | Encore jeune |
| **Monitoring** | ADR sur le méta-framework |

### Tier 4 — Sécurité (CRITIQUE)

#### argon2 — hash mots de passe

| Champ | Valeur |
|---|---|
| **Version** | 0.40+ |
| **License** | MIT |
| **Nature** | Hash Argon2id |
| **Justification** | Standard moderne, anti-GPU |
| **Alternative** | bcrypt (legacy), scrypt (moins robuste) |
| **Risque** | Binding natif = recompilation |
| **Monitoring** | argon2 releases |

#### libsodium-wrappers — crypto

| Champ | Valeur |
|---|---|
| **Version** | 0.7+ |
| **License** | ISC |
| **Nature** | Wrapper libsodium |
| **Justification** | Library crypto standard (XChaCha20, Poly1305) |
| **Alternative** | node:crypto (moins complet) |
| **Risque** | Faible |
| **Monitoring** | libsodium releases |

#### @noble/ed25519 — signatures

| Champ | Valeur |
|---|---|
| **Version** | 2+ |
| **License** | MIT |
| **Nature** | Signatures ed25519 |
| **Justification** | Pure TypeScript, audit-friendly |
| **Alternative** | tweetnacl (plus bas-niveau) |
| **Risque** | Faible |
| **Monitoring** | noble releases |

### Tier 5 — Infrastructure (HAUTE)

#### @tauri-apps/api — bindings Tauri

| Champ | Valeur |
|---|---|
| **Version** | 2.x |
| **License** | MIT ou Apache 2.0 |
| **Nature** | API JS pour Tauri |
| **Justification** | Officiel Tauri |
| **Alternative** | Aucune (couplage nécessaire) |
| **Risque** | API unstable entre 2.x et 3.x |
| **Monitoring** | Tauri releases |

#### Cargo + Rust toolchain

| Champ | Valeur |
|---|---|
| **Version** | 1.80+ |
| **License** | MIT ou Apache 2.0 |
| **Nature** | Toolchain Rust |
| **Justification** | Requis par Tauri |
| **Alternative** | Aucune (Tauri = Rust) |
| **Risque** | Longues compilations |
| **Monitoring** | rustup |

## Dépendances à surveiller de près

| Nom | Tier | Risque | Mitigation |
|---|---|---|---|
| Bun | 1 | Faible | Pin version, CI sur 2 versions |
| Tauri | 1 | Moyen | Pas de blockers connus |
| SolidJS | 1 | Faible | Pin version |
| Effect | 1 | Moyen | ADR dédié |
| better-sqlite3 | 2 | Moyen | Pin version Node, CI multi-ABI |
| drizzle-orm | 2 | Moyen | Pin version 0.x |
| argon2 | 4 | Faible | Pin version, audit natif |

## Renouvellement des deps

Renovate est configuré :
- **Patches & security** : automerge
- **Tauri/Rust** : manual review (build risk)
- **@unifia/*** : manual review (workspace packages)
- **TypeScript types** : automerge

## Audit de vulnérabilités

```bash
# Audit NPM
bun audit

# Audit Cargo
cargo audit
```

Ces deux audits sont à exécuter **quotidiennement** en CI.

## Sources

- [package.json](/package.json) — deps workspace
- [pnpm-lock.yaml](/pnpm-lock.yaml) — versions verrouillées
- [Cargo.toml](/packages/desktop/src-tauri/Cargo.toml) — deps Rust
- [SBOM-cyclonedx.json](SBOM-cyclonedx.json) — SBOM complet

---

Voir aussi :
- [ADR-0014 : Provider unifia natif](docs/adr/0014-provider-unifia-native.md)
- [SBOM-cyclonedx.json](SBOM-cyclonedx.json)
- [TASK-GRAPH-v2.0.yaml](TASK-GRAPH-v2.0.yaml)
