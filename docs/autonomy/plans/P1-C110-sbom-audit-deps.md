# P1-C110 — Plan détaillé : SBOM enrichi + audit deps

**Carte parente :** P1-C110 (Phase 1, DEFERRED → DETAILED)
**Statut :** `PARTIAL` — SBOM initial généré, enrichissement à compléter
**Date :** 2026-07-31
**Source :** Plan V3 §13 « dependency scan + SBOM initiale »

## État actuel

- ✅ **P1-C110 v0** (commit `b887d50`) : SBOM CycloneDX 1.5 généré, 22 packages workspace documentés
- ⏳ SBOM v1 : doit inclure **toutes** les dépendances transitives (NPM + Cargo)

## Découpage en sous-cartes

### P1-C110a — SBOM NPM complet
- **Statut :** `PROPOSED`
- **Scope :** `scripts/generate-sbom-npm.ts` (~80 lignes)
- **Livrable :** SBOM avec 269 dépendances NPM directes + transitives
- **Outil :** `npx @cyclonedx/cyclonedx-npm --output-format JSON --output-file SBOM-npm.json`
- **Acceptance :** SBOM contient toutes les deps, format CycloneDX 1.5, MIT/Apache majoritaire

### P1-C110b — SBOM Cargo complet
- **Statut :** `PROPOSED`
- **Scope :** `scripts/generate-sbom-cargo.sh` (~50 lignes)
- **Livrable :** SBOM avec toutes les deps Cargo (Tauri + 8 plugins)
- **Outil :** `cargo install cargo-about && cargo about generate about.hbs`
- **Acceptance :** SBOM contient toutes les deps Cargo, format CycloneDX 1.5

### P1-C110c — Scan de licences incompatible
- **Statut :** `PROPOSED`
- **Scope :** `.github/workflows/license-check.yml` (~30 lignes)
- **Livrable :** CI qui bloque les PRs avec des deps GPL/AGPL/SSPL
- **Outil :** `cargo deny` (Rust) + `license-checker` (NPM)
- **Acceptance :** la CI échoue si une dep copyleft est introduite

### P1-C110d — Audit de vulnérabilités
- **Statut :** `PROPOSED`
- **Scope :** `.github/workflows/audit.yml` (~40 lignes)
- **Livrable :** Scan quotidien des vulnérabilités (NPM Audit + Cargo Audit)
- **Outil :** `npm audit` + `cargo audit`
- **Acceptance :** alerte automatique si CVE critique détectée

### P1-C110e — Documentation des deps critiques
- **Statut :** `PROPOSED`
- **Scope :** `docs/autonomy/CRITICAL-DEPS.md` (~100 lignes)
- **Livrable :** Doc qui liste les deps critiques (Tauri, SolidJS, Effect, etc.) avec rationale
- **Acceptance :** chaque dep critique a une justification documentée

## Critères de sortie Plan V3 §13

- [x] SBOM initiale (P1-C110 v0)
- [ ] SBOM NPM complet (P1-C110a)
- [ ] SBOM Cargo complet (P1-C110b)
- [ ] Scan de licences en CI (P1-C110c)
- [ ] Audit de vulnérabilités (P1-C110d)
- [ ] Doc deps critiques (P1-C110e)

## Estimation

- **P1-C110a** : 0.5 jour (script)
- **P1-C110b** : 0.5 jour (script)
- **P1-C110c** : 1 jour (config + tests)
- **P1-C110d** : 1 jour (config + alerte)
- **P1-C110e** : 0.5 jour (doc)
- **Total** : 3-4 jours solo
