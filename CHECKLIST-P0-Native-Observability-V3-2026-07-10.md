# CHECKLIST-P0 — Observabilité native OpenCode V3

Cette checklist est le gate avant le premier commit applicatif durable de Phase 1.

## Documentation et décisions

- [x] ADR-1027 — secret HMAC local.
- [x] ADR-1028 — auth/ownership avec preuves de code.
- [x] ADR-1029 — ordre, retry, overflow et crash.
- [x] ADR-1030 — migration, rollback et SDK drift.
- [x] Threat model SQLite non chiffré documenté.
- [x] ADR-1031 — legacy `experimental_telemetry` tranché.
- [ ] Vérifier les lignes d’ownership session/project/workspace dans les routes finales.

## Schéma et stockage

- [ ] Table Phase 1 sans colonnes de contenu.
- [ ] `id` interne + `event_id` ULID justifiés.
- [ ] Coût nano-USD + snapshot pricing.
- [ ] JSON validé Zod avant insertion.
- [ ] Index keyset validés avec `EXPLAIN QUERY PLAN`.
- [ ] Migration additive testée sur DB existante.
- [ ] Rollback manuel documenté et testé sur copie.

## Core, API/UI et tests

- [x] TraceContext explicite et ULID (lifecycle same spanId encore à intégrer).
- [ ] Queue 500/64 MiB, overflow priority-aware, counters.
- [ ] Sanitizer borné, binaire/PDF/image court-circuit.
- [x] HMAC-SHA256 et secret local crypto-safe (fingerprints à intégrer au classifier).
- [ ] Routes events/detail/settings/summary/health/delete avec auth/ownership.
- [ ] UI health/counters, circuit breaker, orphan badge, warnings privacy.
- [ ] Tests concurrence, DB busy/full, crash, sanitizer, privacy et no-network.

## Gate finale

- [ ] Tous les P0 bloquants sont cochés et prouvés par test ou citation code.
- [ ] Aucun « à vérifier plus tard » sur auth, secret, suppression, schéma, queue, sanitizer ou no-network.
- [ ] Rapport Phase 0 rédigé.
