# Standards Review Checklist — OpenCode Fork

À utiliser avant tout commit significatif ou avant d'ouvrir une PR.

## Checklist Tier 1 — Code Quality

- [ ] `bun run typecheck` : 0 erreurs TypeScript
- [ ] `bun run lint` : 0 warnings Biome
- [ ] LOC dans packages/app/ : aucun nouveau fichier > 1500 LOC
- [ ] Fonctions nouvelles : ≤ 50 LOC, pas de > 200 LOC

## Checklist Tier 2 — Architecture

- [ ] Single Responsibility respecté (ce code appartient-il ici ?)
- [ ] Pas de variable globale ajoutée
- [ ] Pas de singleton introduit
- [ ] Si fichier modifié > 800 LOC → extraction proposée

## Checklist Tier 3 — Gouvernance

- [ ] CHANGELOG.md mis à jour avec le changement
- [ ] `docs/ownership-map.md` mis à jour si nouveau module
- [ ] ADR créé si décision architecturale prise
- [ ] Tests écrits si nouvelle logique métier

## Checklist Tier 4 — Sécurité

- [ ] Pas de secret/credential dans le code ou les logs
- [ ] Validation des inputs utilisateur sur les frontières API
- [ ] `innerHTML` audité (pattern allowlist uniquement)

## Après le commit

- [ ] CI verte (typecheck + test + CodeQL)
- [ ] VERSION + CHANGELOG.md synchronisés si release
