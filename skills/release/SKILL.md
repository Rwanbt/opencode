---
name: release
description: "Release workflow Unifia - from version bump to GitHub release. Use when user wants to release a new version, tag, or publish. Triggers: release, version, tag, publish, ship."
---

# Release Workflow SKILL

Skill pour automatiser une release Unifia.

## Quand m'utiliser

L'utilisateur demande de :
- Release une nouvelle version
- Bumper la version
- Créer un tag git
- Publier sur GitHub
- Générer le bundle handoff

## Procédure (séquence stricte)

### 1. Préparation

```bash
cd /opt/data/work/unifia-sandbox/repo

# Vérifier que le working tree est clean
git status --short  # doit être vide

# Vérifier qu'on est sur la bonne branche
BRANCH=$(git branch --show-current)
[ "$BRANCH" = "agent/integration" ] || echo "WARN: pas sur agent/integration"
```

### 2. Choisir la version

Sémantique stricte :
- MAJOR (1.0.0 → 2.0.0) : breaking change
- MINOR (1.0.0 → 1.1.0) : feature
- PATCH (1.0.0 → 1.0.1) : bug fix

### 3. Lancer release-helper.sh

```bash
# Dry-run (vérifie que tout est OK)
bash tools/release-helper.sh 1.0.1

# Apply (crée le commit et le tag)
git add -A
git commit -m "chore(release): v1.0.1"
git tag -a v1.0.1 -m "Release v1.0.1"
```

### 4. Bundle

```bash
mkdir -p /opt/data/work/unifia-sandbox/handoff
git bundle create /opt/data/work/unifia-sandbox/handoff/unifia-agent-result.bundle agent/integration
git format-patch --output-directory /opt/data/work/unifia-sandbox/handoff/patches/ 207ff452..agent/integration
```

### 5. Push

```bash
# Push est bloqué (3 verrous). On ne peut pas push vers origin.
# Mais on peut générer le handoff pour distribution manuelle.
```

### 6. Tests pré-release

```bash
# 6 suites d'integration
bash tests/integration/run-all.sh

# 4 scripts unifia
bash scripts/unifia-verify.sh
bash scripts/unifia-migrate.sh --dry-run
bash scripts/unifia-install.sh --help
bash scripts/unifia-doctor.sh
```

### 7. CHANGELOG

```bash
# Vérifier que CHANGELOG est à jour
head -30 CHANGELOG.md

# Si pas à jour, éditer
```

## Checklist

- [ ] Working tree clean
- [ ] Branche = agent/integration
- [ ] Version semver (X.Y.Z)
- [ ] CHANGELOG.md à jour
- [ ] Tests 60/60 PASS
- [ ] Bundle créé
- [ ] Patches générés
- [ ] Handoff distribué

## Liens

- Plan V3 §17 (Release hardening)
- [RELEASE-GUIDE.md](/RELEASE-GUIDE.md)
- [tools/release-helper.sh](/tools/release-helper.sh)
- ADR-0027 (Stratégie de release)
