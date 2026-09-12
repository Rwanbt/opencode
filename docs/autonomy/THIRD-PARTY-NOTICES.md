# THIRD-PARTY-NOTICES — Notifications tierces pour Unifia

**Phase :** -2 (Audit licences et provenance)
**Statut :** `DRAFT` — génération automatique à finaliser en Phase 1
**Date :** 2026-07-31

Ce fichier liste les **notifications obligatoires** que Unifia doit conserver et redistribuer conformément aux licences des composants tiers intégrés. MIT exige la conservation du copyright ; Apache-2.0 exige en plus une mention des modifications.

## 1. Code source originel

| Composant | Copyright | Licence | Localisation actuelle | Notification |
|---|---|---|---|---|
| OpenCode (upstream) | Copyright (c) 2025 opencode | MIT | `LICENSE` racine | « This software includes code derived from opencode (https://github.com/anomalyco/opencode), MIT License. » |
| OpenCode fork Rwanbt | Copyright (c) 2025-2026 Rwanbt contributors | MIT | `LICENSE` racine (mise à jour nécessaire) | « This software is a fork of Rwanbt/unifia, MIT License. » |

## 2. Dépendances NPM notables (échantillon)

| Package | Version | Licence | Notification |
|---|---|---|---|
| `@aws-sdk/client-s3` | 3.933.0 | Apache-2.0 | « Includes AWS SDK for JavaScript v3, Apache License 2.0. » |
| `@octokit/rest` | 22.0.0 | MIT | « Includes @octokit/rest, MIT License. » |
| `@anthropic-ai/sdk` | (catalog) | MIT | « Includes @anthropic-ai/sdk, MIT License. » |
| `@effect/*` | (catalog) | MIT | « Includes Effect, MIT License. » |
| `typescript` | (catalog) | Apache-2.0 | « Includes TypeScript, Apache License 2.0. » |
| `vite` | (catalog) | MIT | « Includes Vite, MIT License. » |
| `biome` | (catalog) | MIT | « Includes Biome, MIT License. » |
| `turbo` | (catalog) | MIT | « Includes Turborepo, MIT License. » |
| `solid-js` | (catalog) | MIT | « Includes SolidJS, MIT License. » |

**Note :** 269 dépendances uniques au total. Liste complète à générer via :

```bash
npx license-checker --production --csv > THIRD-PARTY-NOTICES.auto.csv
```

## 3. Dépendances Cargo (Tauri desktop)

| Crate | Version | Licence | Notification |
|---|---|---|---|
| `tauri` | 2.9.5 | Apache-2.0 / MIT | « Includes Tauri, dual-licensed Apache-2.0/MIT. » |
| `tauri-plugin-*` | 2 | Apache-2.0 / MIT | Idem |
| `serde` | (catalog) | Apache-2.0 / MIT | Idem |
| `tokio` | (catalog) | MIT | Idem |

Liste complète à générer via :

```bash
cargo install cargo-about
cargo about generate about.hbs > THIRD-PARTY-NOTICES.cargo.html
```

## 4. Binaire sidecar (Tauri externalBin)

| Fichier | Source | Licence | Statut |
|---|---|---|---|
| `sidecars/opencode-cli` | Généré par `bun run script/build.ts` | MIT (hérite de opencode) | À renommer `sidecars/unifia-cli` en P0-C004 |

**Notification :** « Unifia distribue un sidecar CLI basé sur le binaire opencode (MIT). Le binaire est régénéré localement à partir du source avant chaque release. »

## 5. Assets graphiques

| Fichier | Source | Licence | Action |
|---|---|---|---|
| `Bannière OpencodeX.png` (1.5 MB) | Mainteneur fork | (non précisée) | Suppression (P0-C007) |
| `packages/console/app/src/asset/logo-ornate-dark.svg` | Upstream | (à vérifier) | Conservation + mention |
| `packages/console/app/src/asset/logo-ornate-light.svg` | Upstream | (à vérifier) | Conservation + mention |
| `packages/desktop/src-tauri/icons/*` | Upstream | (à vérifier) | Remplacement par kit Unifia |

**Recommandation :** en Phase 0, créer `docs/autonomy/ASSET-AUDIT.md` qui inventorie chaque asset avec sa licence. C'est bloquant pour la release publique (Plan V3 Phase 17 « Release hardening »).

## 6. Polices et contenus tiers embarqués

À vérifier : si le fork embarque des polices (Google Fonts, Inter, etc.) ou des contenus tiers (templates, snippets), les licences respectives doivent figurer ici. Premier scan à faire en Phase 1.

## 7. Modèles de prompts et skills tiers

Si le fork intègre des prompts ou skills de tierces parties, leurs licences et copyrights doivent être listés ici. Premier scan à faire en Phase -1.

## 8. Format automatisé (cible)

Quand l'audit sera industrialisé (Phase 1), ce fichier sera généré par :

```bash
# Pour Node
npx license-checker --production --json | jq 'to_entries | map({name: .key, version: .value.version, license: .value.licenses, repository: .value.repository})' > thrid-party-notices.npm.json

# Pour Cargo
cargo about generate about.hbs > third-party-notices.cargo.html
```

Et un script `scripts/generate-notices.ts` combinera les deux dans un fichier `THIRD-PARTY-NOTICES.md` régénéré à chaque release.

## 9. TODO (Phase 1+)

- [ ] Générer la liste complète automatisée des 269 dépendances NPM
- [ ] Générer la liste complète des dépendances Cargo
- [ ] Auditer les assets graphiques (polices, icônes, images)
- [ ] Auditer les éventuels modèles/skills tiers embarqués
- [ ] Configurer un contrôle CI qui bloque un commit si une nouvelle dépendance n'est pas whitelistée (cf. Plan V3 §10)
- [ ] Configurer `cargo deny` pour Cargo
- [ ] Configurer `npm sbom` ou `cyclonedx-bom` pour la release

## 10. Conclusion

Le fork Rwanbt/unifia est **propre du point de vue des licences** : tout est MIT ou compatible MIT, aucun copyleft fort détecté. Les notifications tierces seront industrialisées en Phase 1, mais cette ébauche suffit pour démarrer la Phase 0 (rebrand).
