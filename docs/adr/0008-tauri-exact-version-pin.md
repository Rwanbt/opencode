# ADR-0008 : Tauri JS / Rust version pin exact (no caret/tilde)

**Date** : 2026-06-26 | **Statut** : Accepté

## Contexte

Le projet utilise Tauri 2.x côté Rust (via `Cargo.toml`) ET côté JS (via `package.json`). Les versions doivent matcher au major.minor près — Tauri 2.x runtime check rejette les mismatches entre les deux côtés. Historiquement `packages/desktop/package.json` pinnait `@tauri-apps/*` avec `^2` ou `~2` (bun résolvait 2.10.x) alors que `Cargo.toml` pinnait 2.9.5. Symptôme : `bun run tauri build` exit 1 (B-001).

## Décision

Pinner **exact** (sans caret/tilde) les versions JS `@tauri-apps/*` aux versions matching `Cargo.lock` (Cargo.toml `tauri = "2.9.5"` → JS `@tauri-apps/api: 2.9.1` closest 2.9.x disponible sur npm, tous les plugins en versions exactes correspondantes).

## Alternatives rejetées

- **Caret/tilde range** : bun résout une version plus récente que Rust, mismatch au runtime, build échoue.
- **Cargo.toml upgrade à 2.10.x** : hors-scope Phase 9, attend validation manuelle.
- **Patch post-install** : fragile, à refaire à chaque `bun install`.

## Conséquences

- ✅ `bun run tauri build` exit 0, installable NSIS produit
- ✅ Version JS/Rust synchronisée au major.minor près
- ⚠️ Upgrade Tauri Rust → 2.10.x = 2 étapes (Cargo.toml + update JS pins) — pas un simple `cargo update`
- ⚠️ Tout nouveau plugin Tauri ajouté au package.json doit être pinné exact dès le départ

Refs : B-001 commit `0c91f8a497` (Phase 9)
