# UPSTREAM-STRATEGY.md — Stratégie de synchronisation upstream

**Statut :** `v1.0` — créé P0-C010
**Date :** 2026-07-31
**Référence :** Plan V3 §12 « Stratégie de branches »

## 1. Upstreams suivis

| Upstream | URL | Type | HEAD actuel |
|---|---|---|---|
| `anomalyco/opencode` | https://github.com/anomalyco/opencode | Unifia originel | (à synchroniser) |
| `Rwanbt/unifia` | https://github.com/Rwanbt/unifia | Fork Rwanbt (notre base) | `207ff452` |
| `different-ai/openwork` | https://github.com/different-ai/openwork | OpenWork (donneur structurel) | `2c558bcff` |
| `OpenCoworkAI/open-cowork` | https://github.com/OpenCoworkAI/open-cowork | Open Cowork (donneur fonctionnel) | `ec5bd27` |

## 2. Remotes

Configuration cible :

```bash
git remote add origin-unifia       https://github.com/Rwanbt/unifia.git     # NOTRE fork
git remote add upstream-unifia  https://github.com/Rwanbt/unifia.git   # fork actuel
git remote add upstream-anomalyco https://github.com/anomalyco/opencode.git # originel
git remote add upstream-openwork  https://github.com/different-ai/openwork.git
git remote add upstream-cowork    https://github.com/OpenCoworkAI/open-cowork.git
```

**Note** : les remotes `upstream-*` sont en **lecture seule** (pushurl invalide par convention pack v1.0).

## 3. Branches de synchronisation

| Pattern | Usage | Cycle |
|---|---|---|
| `upstream-sync/opencode` | Sync depuis `upstream-opencode/main` | Mensuel |
| `upstream-sync/openwork` | Sync depuis `upstream-openwork/dev` | Trimestriel |
| `upstream-sync/open-cowork` | Sync depuis `upstream-cowork/main` | Trimestriel |
| `integration/workbench` | Integration des adaptations OpenWork | Continu |
| `integration/document-packs` | Integration des Capability Packs Open Cowork | Continu |
| `integration/computer-use` | Integration computer use (Phase 10) | Quand prêt |

## 4. Règles d'import (Plan V3 §12)

1. **Importer des packages ciblés, pas les repos complets**
2. **Pinner chaque import à un commit** (SHA exact)
3. **Conserver les notices** (license + copyright)
4. **Maintenir les modifications sous forme de commits séparés**
5. **Générer un rapport de divergence upstream**
6. **Ne jamais synchroniser automatiquement une capacité dangereuse** (computer use, secrets, browser)
7. **Refaire les audits sécurité avant mise à jour majeure**

## 5. Politique `/ee/` (EXCLUSION STRICTE)

Tout chemin `**/ee/**` est **interdit** d'import :

| Source | Branches concernées | Action |
|---|---|---|
| OpenWork | 50 branches (`add-*`, `agent/*`, etc.) | Exclure par défaut |
| OpenWork | Branche `ee/*` | EXCLURE (licence propriétaire probable) |
| OpenWork | `/ee/` au HEAD actuel | Pas présent (vérifié Phase -1) |

**Verrou** : hook pre-commit + scan CI qui refuse tout chemin `**/ee/**`.

## 6. Politique d'import par phase du Plan V3

| Phase | Imports autorisés | Imports interdits |
|---|---|---|
| Phase -2 | aucun (audit seulement) | tout |
| Phase -1 | aucun (audit seulement) | tout |
| Phase 0 | Brand Unifia (logos), traductions i18n | code opencode/openwork |
| Phase 1 | Fixtures de tests depuis unifia | runtime openwork |
| Phase 2 | Contrats depuis unifia (types) | runtime |
| Phase 3 | aucun | tout (sécurité critique) |
| Phase 4 | Workspace runtime patterns | computer use |
| Phase 5 | OpenWork apps/server | /ee/, Swift, Electron |
| Phase 6 | Open Cowork skills bureautiques | runtime |
| Phase 7-10 | Patterns UI d'OpenWork/Cowork (INSPIRER) | runtime |
| Phase 11-16 | Capability packs tiers | runtime propriétaire |
| Phase 17-19 | polish, mobile natif (Swift/Dart) | tout upstream |

## 7. Cycle de synchronisation type

```bash
# 1. Créer branche de sync
git switch dev
git switch -c upstream-sync/opencode-$(date +%Y%m%d)

# 2. Fetch upstream
git fetch upstream-unifia

# 3. Voir les changements depuis le dernier sync
git log --oneline upstream-opencode/main ^main | head -20

# 4. Merger en revue (sans --no-ff pour traçabilité)
git merge --no-ff upstream-opencode/main

# 5. Résoudre conflits carte par carte (cf. protocole §8)
# Pour chaque conflit, créer une carte dédiée

# 6. Tests + lint + SBOM
bun install
bun turbo typecheck
bunx biome check .

# 7. PR vers dev (via intégration manuelle, pas de push auto)
```

## 8. Critères de blocage d'un sync upstream

Un sync upstream est **bloqué** si :

- `/ee/` code aurait été importé (sinon : revert)
- Conflits non résolus sur les autorités (Plan V3 §5)
- License incompatible détectée
- Tests rouges
- SBOM montre une nouvelle dépendance copyleft fort

## 9. Cycle d'audit des imports

Tous les 3 mois, faire un audit :

1. Comparer `UPSTREAM-SOURCES.lock.json` avec la réalité (HEAD upstream)
2. Vérifier que les pins (SHA) sont toujours valides
3. Identifier les changements upstream non intégrés
4. Décider : sync immédiat / différer / ignorer

## 10. Audit de divergence

À chaque release, générer `docs/autonomy/UPSTREAM-DIVERGENCE-<date>.md` :

- Nombre de commits divergents
- Fichiers modifiés upstream non intégrés
- Fichiers modifiés localement non upstream
- Risques de merge

## 11. Conclusion

La stratégie upstream d'Unifia est **conservatrice** : imports ciblés, pins par SHA, audits réguliers, exclusions strictes (`/ee/`). Cela protège l'identité Unifia tout en bénéficiant des améliorations upstream.