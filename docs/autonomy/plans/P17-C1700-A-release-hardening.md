# P17-C1700-A — Release hardening

**Statut :** `INTEGRATED` (design documenté)
**Date :** 2026-08-01
**Parent :** P17-C1700 (Release hardening)

## Objectif

Implémenter le **process de release** production-ready.

## Checklist pre-release

### Code quality
- [ ] `bun run test` PASS
- [ ] `bun run lint` PASS
- [ ] `bun run typecheck` PASS
- [ ] Coverage >= 80%

### Security
- [ ] SBOM generated
- [ ] Vuln scan (`npm audit`)
- [ ] No secrets in repo
- [ ] LICENSE-AUDIT up to date

### Documentation
- [ ] CHANGELOG.md updated
- [ ] RELEASE-NOTES.md generated
- [ ] API docs generated
- [ ] Migration guide tested

### Infra
- [ ] CI green
- [ ] Docker build OK
- [ ] Handoff bundle OK
- [ ] Backward compatibility checked

### Tests
- [ ] Unit tests >= 200
- [ ] Integration tests >= 100
- [ ] E2E tests >= 50
- [ ] Manual QA on 3 devices

## Process

```
[Commit]
   ↓
[CI green]
   ↓
[bunx release-it]
   ↓
[GitHub Release]
   ↓
[Discord announcement]
   ↓
[Email contributors]
   ↓
[Update website]
```

## Canaux de release

- **latest** : stable, recommandée
- **next** : pre-release, beta testeurs
- **lts** : support étendu (3 ans)

## Estimation

- Scripts release : ~300 LOC (déjà partiel)
- CI/CD : ~500 LOC
- Tests automatisés : ~1000 LOC
- Docs : ~300 LOC
- **Total : ~2100 LOC**

## Liens

- [ADR-0027 Release Strategy](docs/adr/0027-release-strategy.md)
- [RELEASE-GUIDE.md](../../RELEASE-GUIDE.md)
- [tools/release-helper.sh](../../tools/release-helper.sh)
- [.github/workflows/release.yml](../../.github/workflows/release.yml)