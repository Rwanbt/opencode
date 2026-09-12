# Unifia Tasks — Cheat Sheet

Cheat sheet pour les devs qui veulent contribuer à Unifia Workbench.

## Quick links

| Tâche | Commande |
|---|---|
| Installer | `bash scripts/unifia-install.sh` |
| Migrer depuis opencode | `bash scripts/unifia-migrate.sh --apply` |
| Doctor (diagnostic) | `bash scripts/unifia-doctor.sh --verbose` |
| Verify (validation) | `bash scripts/unifia-verify.sh --verbose` |
| Lint | `bun x biome@latest check .` |
| Typecheck | `bunx tsc --noEmit` (per package) |
| Test | `bun test` (per package) |
| Build | `bun turbo build` |

## Scripts

| Script | Description |
|---|---|
| `unifia-migrate.sh` | Migrate opencode → unifia (dry-run/apply) |
| `unifia-verify.sh` | Verify installation (7 checks) |
| `unifia-install.sh` | Install from source or download |
| `unifia-doctor.sh` | Diagnostic (10 categories) |
| `unifia-migrate.cmd` | Windows equivalent of migrate.sh |

## Adrs

Read `docs/adr/0001-runtime-adapter.md` first.
Then in order:
- 0001-0005: Core ports (runtime, workspace, capability, artifact, sandbox)
- 0006-0010: Governance (policy, approval, secret, audit, taint)
- 0011-0015: Transition (migration, provenance, deprecation, native, i18n)
- 0016-0020: Strategy (gates, opendesign, memory, workflow, mcp)
- 0021-0025: Operational (spec, org, license, roadmap, community)

## Plans détaillés

22 plans dans `docs/autonomy/plans/` :
- 12 plans par phase (P1-C100 à P18-C1800)
- 3 Gates (A, B, C)
- 7 plans additionnels (P11-P18)

## Tests

| Type | Path |
|---|---|
| E2E | `packages/app/e2e/` |
| Unit | `packages/*/test/` |
| Fixtures | `tests/fixtures/workspaces/` |
| Contracts | `packages/contracts/test/` |

## Builds

| Package | Path |
|---|---|
| CLI | `packages/unifia/` |
| App | `packages/app/` |
| Desktop | `packages/desktop/` |
| Mobile | `packages/mobile/` |
| Console | `packages/console/` |
| Web | `packages/web/` |
| SDK | `packages/sdk/` |
| Contracts | `packages/contracts/` |

## Releases

- `Rwanbt/unifia` (target)
- Tag format : `v1.0.0`
- Release notes auto via `release-drafter.yml`

## Git workflow

```bash
git checkout dev
git pull origin dev
git checkout -b agent/phase-X/PX-CNNN-card-name
# Push is locked. Use atomic commits locally.
git commit -m "feat(module): [PX-CNNN] description"
git log --oneline
```

## Liens rapides

- [README.md](README.md)
- [GOVERNANCE.md](GOVERNANCE.md)
- [docs/autonomy/TASK-GRAPH-v2.0.yaml](docs/autonomy/TASK-GRAPH-v2.0.yaml)
- [packages/contracts/README.md](packages/contracts/README.md)
- [skills/unifia-rebrand/SKILL.md](skills/unifia-rebrand/SKILL.md)

## Debugging

```bash
# Logs
journalctl -u unifia --since "1 hour ago"

# DB direct
sqlite3 ~/.config/unifia/unifia.db

# Reset
rm -rf ~/.config/unifia/
bash scripts/unifia-migrate.sh --apply
```

## Voir aussi

- [CONTRIBUTING.md](CONTRIBUTING.md)
- [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md)
- [SECURITY-CHECKLIST.md](SECURITY-CHECKLIST.md)
