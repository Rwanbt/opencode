# ADR-1030 : Migration, rollback et dérive SDK

**Date** : 2026-07-10 | **Statut** : Accepté

## Décision

- Utiliser le pipeline Drizzle/Bun SQLite existant (`packages/opencode/src/storage/db.ts`) et ses migrations timestampées.
- La première migration est additive : table/index observability uniquement, aucune modification destructive des tables existantes.
- Tester l’upgrade sur une DB existante et valider les plans avec `EXPLAIN QUERY PLAN`.
- Aucun downgrade automatique n’est promis. Le rollback Phase 1 est manuel et destructif pour la seule table observability; la procédure et le risque sont documentés avant release.
- Le SDK généré est régénéré en CI et `git diff --exit-code` bloque toute dérive non committée.
- Chaque événement porte `schema_version=1`.

## Conséquences

Les migrations suivent l’autorité déjà utilisée par OpenCode et évitent une seconde base ou un second migrateur. Un rollback applicatif nécessite une sauvegarde utilisateur et une procédure manuelle contrôlée.
