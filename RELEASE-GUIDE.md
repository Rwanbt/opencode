# RELEASE-GUIDE — Unifia Workbench

**Date :** 2026-07-31

## Pre-release checklist

### Code

- [ ] **TypeScript** : `tsc --noemit` exit 0 sur tous les packages
- [ ] **Lint** : `bun x biome@latest check .` exit 0
- [ ] **Tests** : `bun test` exit 0 sur tous les packages
- [ ] **E2E** : Playwright 50+ scénarios pass
- [ ] **Test integration** : `bash tests/integration/run-all.sh` exit 0

### Sécurité

- [ ] **0 secret** : `gitleaks detect` exit 0
- [ ] **0 /ee/** : `bash scripts/unifia-verify.sh` no-/ee/ check PASS
- [ ] **SBOM** : `SBOM-cyclonedx.json` à jour
- [ ] **Security checklist** : `SECURITY-CHECKLIST.md` 100%

### Documentation

- [ ] **CHANGELOG.md** : nouvelle version en haut
- [ ] **RELEASE-NOTES.md** : à jour
- [ ] **TASK-GRAPH** : cartes INTEGRATED à jour
- [ ] **ADRs** : nouvelles décisions documentées

### Infrastructure

- [ ] **Build** : `bun turbo build` exit 0
- [ ] **Tauri** : binaires compilés (macOS, Linux, Windows)
- [ ] **Signing** : macOS Developer ID
- [ ] **SBOM** : validé (CycloneDX 1.5)

## Tagging

```bash
# 1. Update TASK-GRAPH + CHANGELOG
git checkout main
git pull origin main

# 2. Create tag
git tag -a v1.0.0 -m "Release v1.0.0 - Unifia Workbench"
git push origin v1.0.0

# 3. GitHub Action release-drafter crée automatiquement le release
# 4. Vérifier que le release contient les artefacts
```

## Rollback

En cas de problème critique :

```bash
# 1. Marquer le release comme "broken"
gh release edit v1.0.0 --draft

# 2. Yanked
gh release edit v1.0.0 --draft=false

# 3. Communication
echo "v1.0.0 est YANKED. Rollback à v0.9.x."
```

## Post-release

- [ ] **Tags** : v1.0.0 sur origin
- [ ] **Release notes** : publiés sur GitHub
- [ ] **Binaires** : téléchargeables
- [ ] **Announcement** : site web, Discord, Twitter
- [ ] **NPM** : `@unifia/contracts` publié
- [ ] **SDK** : `unifia install` fonctionne

## Communication templates

### Annonce Discord

```
🎉 Unifia Workbench v1.0.0 est disponible !

🌟 Nouveautés :
- Rebrand complet opencode → unifia
- 25 ADRs de gouvernance
- 22 plans détaillés
- 1 package @unifia/contracts
- 5 scripts (migrate, verify, install, doctor, migrate.cmd)

📥 Téléchargements : https://github.com/Rwanbt/unifia/releases/tag/v1.0.0
📚 Docs : https://unifia.dev
```

### Email aux contributeurs

```
Subject: Unifia v1.0.0 — Merci pour vos contributions !

Bonjour,

Unifia Workbench v1.0.0 est sorti aujourd'hui. Merci à tous les
contributeurs qui ont rendu ce projet possible.

Highlights :
- [Liste des features principales]
- [Crédits aux contributeurs]

Roadmap v1.5 :
- [Features prévues]

À bientôt,
Erwan
```

## Liens

- [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md)
- [SECURITY-CHECKLIST.md](SECURITY-CHECKLIST.md)
- [SECURITY-INCIDENT-RESPONSE.md](SECURITY-INCIDENT-RESPONSE.md)
- [TASK-GRAPH-v2.0.yaml](docs/autonomy/TASK-GRAPH-v2.0.yaml)
- [RELEASE-NOTES.md](RELEASE-NOTES.md)
- [CHANGELOG.md](CHANGELOG.md)
