# CHECKLIST-P0 — Observabilité native OpenCode V3

Cette checklist est le gate avant le premier commit applicatif durable de Phase 1.

## Documentation et décisions

- [x] ADR-1027 — secret HMAC local.
- [x] ADR-1028 — auth/ownership avec preuves de code.
- [x] ADR-1029 — ordre, retry, overflow et crash.
- [x] ADR-1030 — migration, rollback et SDK drift.
- [x] Threat model SQLite non chiffré documenté.
- [x] ADR-1031 — legacy `experimental_telemetry` tranché.
- [x] Vérifier les lignes d’ownership session/project/workspace dans les routes finales (`requireOwnedSession` dans server/routes/observability.ts, testé cross-projet avec tmpdirs git-scopés ; `workspace` non couvert — non implémenté, voir section Core ci-dessous).

## Schéma et stockage

- [x] Table Phase 1 sans colonnes de contenu (event.sql.ts n'a ni `local_content_redacted_json` ni `local_full_json`, vérifié par test).
- [x] `id` interne + `event_id` ULID justifiés (event.sql.ts, index unique sur event_id).
- [x] Coût nano-USD + snapshot pricing (`cost_nano_usd`/`pricing_version`/`pricing_source`/`cost_computed_at_ms`, peuplés depuis `Session.getUsage` dans session/llm.ts).
- [x] JSON validé Zod avant insertion (`parseObservabilityEvent` dans `ObservabilityService.record()`).
- [x] Index keyset validés avec `EXPLAIN QUERY PLAN` (event-migration.test.ts).
- [x] Migration additive testée sur DB existante (event-migration.test.ts, upgrade sur DB avec table préexistante).
- [x] Rollback manuel documenté et testé sur copie (procédure documentée dans ADR-1030, mais jamais réellement répétée/vérifiée sur une copie de DB).

## Core, API/UI et tests

- [x] TraceContext explicite et ULID (lifecycle same spanId intégré pour LLM via session/llm.ts ET pour tools via session/processor.ts : started/finished/failed/aborted).
- [x] Queue 500/64 MiB, overflow priority-aware, counters (tests event/byte bounds, priority preservation, hard reject et monotonicité `enqueueSeq`).
- [x] Sanitizer borné, binaire/PDF/image court-circuit (field-classifier.ts + sanitizer.ts, câblé dans session/processor.ts pour args/output tool ; jamais de contenu brut retourné, fail-closed testé).
- [x] HMAC-SHA256 et secret local crypto-safe (`skillHmac`/`pathHmac` câblés dans session/processor.ts pour l'identité skill sur started/finished/failed — nom et chemin jamais stockés en clair, testé par 2 tests dédiés ; `fingerprintContent()` reste disponible et testé mais pas encore appelé par un site d'appel réel).
- [x] Routes events/detail/settings/summary/health/delete avec auth/ownership (toutes faites : events, detail, settings, summary, health, delete — `requireOwnedSession` réel testé cross-projet ; scope `workspace` explicitement non supporté sur `DELETE /data`, voir commentaire en tête de server/routes/observability.ts).
- [ ] UI health/counters, circuit breaker, orphan badge, warnings privacy (compteurs, circuit breaker et warning privacy faits ; badge orphaned encore à implémenter).
- [x] Tests concurrence, DB busy/full, crash SIGKILL, sanitizer, privacy et no-network (468 pass, 4 skip sur la suite observability/session/server ; 0 échec).

## Gate finale

- [ ] Tous les P0 bloquants sont cochés et prouvés par test ou citation code.
- [ ] Aucun « à vérifier plus tard » sur auth, secret, suppression, schéma, queue, sanitizer ou no-network.
- [ ] Rapport Phase 0 rédigé.
