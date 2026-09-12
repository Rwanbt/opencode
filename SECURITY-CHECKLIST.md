# Security Checklist — Unifia Workbench

**Version :** 1.0
**Date :** 2026-07-31

## Checklist pré-release

### Code

- [ ] **0 secret** dans le repo (gitleaks scan PASS)
- [ ] **0 code `/ee/`** importé (ADR-0012)
- [ ] **0 dépendance copyleft** (cargo deny + license-checker)
- [ ] **SBOM CycloneDX** généré (22+ packages)
- [ ] **DO-NOT-IMPORT hooks** actifs (pre-commit)
- [ ] **Provenance** tracée pour tout import upstream
- [ ] **TypeScript strict** (`tsc --noEmit` exit 0)
- [ ] **Lint** (`biome check` exit 0)
- [ ] **Tests unitaires** 80%+ coverage
- [ ] **Tests E2E** 50+ scénarios pass

### Sécurité runtime

- [ ] **PolicyEngine** active par défaut
- [ ] **Default-deny** sur 9 surfaces
- [ ] **6 combinaisons critiques** bloquées
- [ ] **ApprovalBroker** fonctionnel
- [ ] **SecretStore** chiffré at-rest
- [ ] **AuditRuntime** trace 100% actions sensibles
- [ ] **TaintTracker** propagation correcte
- [ ] **Sandbox** multi-backend fonctionnel
- [ ] **Computer use** désactivé par défaut

### Distribution

- [ ] **Binaires signés** (macOS, Windows)
- [ ] **Auto-update** sécurisé
- [ ] **Checksums SHA256** sur releases
- [ ] **Pas de HTTPS downgrade**

### Documentation

- [ ] **SECURITY.md** politique de sécurité
- [ ] **SECURITY-INCIDENT-RESPONSE.md** process
- [ ] **THREAT-MODEL.md** modèle de menace
- [ ] **License audit** (LICENSE-AUDIT-UNIFIA.md)
- [ ] **CHANGELOG** complet

### Operations

- [ ] **0 push non-vérouillé** (verrous actifs)
- [ ] **CVE monitoring** (Renovate + Snyk)
- [ ] **Penetration test** (interne ou externe)
- [ ] **Audit security** (interne pour v1, externe pour v2+)

## Validation script

```bash
# Run all checks
bash scripts/unifia-verify.sh --verbose
bash scripts/unifia-doctor.sh --json

# Manual checks
test -z "$(git ls-files | grep -E '\.env' | grep -v '\.env\.example$')" && echo "no secrets"
git ls-tree -r HEAD | grep -E '/ee/' | grep -v 'docs/' && echo "FAIL" || echo "no /ee/"
test -f docs/autonomy/SBOM-cyclonedx.json && echo "SBOM present"
```

## Sign-off

Pour chaque release, **2 reviewers** doivent signer :

- [ ] Reviewer 1 : _________________ Date : _____
- [ ] Reviewer 2 : _________________ Date : _____
- [ ] BDFL : _________________ Date : _____

## Voir aussi

- [SECURITY.md](SECURITY.md)
- [SECURITY-INCIDENT-RESPONSE.md](SECURITY-INCIDENT-RESPONSE.md)
- [ADR-0006](docs/adr/0006-policy-engine.md)
- [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md)
