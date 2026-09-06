<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# EXIT_NATIVE — UNIFIA AUTOMATE V2.3.1

> Source normative : `docs/adr/ADR-000-DURABLE-EXECUTION-SUBSTRATE-M0-FROZEN.md`
> §20 (EXIT_*.md obligatoire) + §22 (exit/migration difficulty).

Si ADR-000 sélectionne **UNIFIA_NATIVE** comme substrate final, la
stratégie de sortie (migration vers un autre substrate) doit être
**documentée à l'avance**. Un substrate non-migratable est un cul-de-sac
opérationnel.

## 1. Données à exporter

| Table | Format d'export | Volume estimé |
|---|---|---|
| `runs` | JSON Lines, une ligne par run | O(N_runs) |
| `logical_invocations` | JSON Lines | O(N_invocations) |
| `attempts` | JSON Lines | O(N_attempts) |
| `effects` | JSON Lines | O(N_effects) |
| `approvals` | JSON Lines | O(N_approvals) |
| `timers` | JSON Lines | O(N_timers) |
| `backup_history` | JSON Lines | O(N_backups) |

**Sémantique** : les valeurs canoniques sont persistées comme JSON
UTF-8. L'export est lisible par tout autre substrate respectant le
contrat M0 (FC-31A, FC-31B).

## 2. Mécanisme d'export

```typescript
// In a hypothetical exit tool:
const db = new Database(nativeDbPath, { readonly: true })
for (const table of ["runs", "logical_invocations", "attempts", "effects", "approvals", "timers"]) {
  const rows = db.query(`SELECT * FROM ${table}`).all()
  writeJsonLines(`${table}.jsonl`, rows)
}
```

**Volume** : O(N_total_rows). Sur un deployment typique (1M runs,
10M attempts), l'export complet est ~1-5 GB JSON Lines.

## 3. Cible de migration

| Substrate cible | Effort | Compatibilité sémantique |
|---|---|---|
| DBOS Go + SQLite | Modéré | Bon (M0 IR-aligned) |
| DBOS TS + Postgres | Élevé | Moyen (Postgres vs SQLite) |
| Temporal | Élevé | Bon (workflow model) |
| Restate | Élevé | Bon (workflow model) |
| Custom (Rust, etc.) | Modéré | Bon (canonical value round-trip) |

**Caractéristique clé** : UNIFIA_NATIVE expose un schéma v1
aligné sur le M0 contract (FC-31A, FC-31B). Tout autre substrate
qui implémente le même contrat peut consommer l'export.

## 4. Stratégie de cutover

1. **Stand-up** : démarrer le nouveau substrate avec l'export
   Native (lecture seule)
2. **Shadow run** : nouveau substrate traite les nouveaux runs
   pendant 1-2 semaines
3. **Cutover** : flip du routage, Native devient lecture seule
4. **Cooldown** : 30 jours d'observation
5. **Decommission** : arrêt de Native, archive compressée

**Durée totale** : ~6-8 semaines.

## 5. Risques

- **Données en vol** : les runs in-flight au moment du cutover
  doivent être drainés ou rejoués sur le nouveau substrate.
- **Sémantique manquante** : si le nouveau substrate ne supporte
  pas un EdgeKind V2 ou un timer policy, l'export révèle le gap.
- **Performance** : ré-import massif peut prendre plusieurs heures
  (à benchmarker en PRE-1.1).

## 6. Migrations antérieures du même pattern

Aucun précédent connu dans Unifia V2 (le runtime V1 était trop
différent pour servir de référence).

## 7. Source

- `docs/adr/ADR-000-DURABLE-EXECUTION-SUBSTRATE-M0-FROZEN.md` §22
- `docs/automation-v2/m0/NATIVE_TOPOLOGY.md`
- `docs/automation-v2/m0/M0_RESULTS_UNIFIA_NATIVE.json`
