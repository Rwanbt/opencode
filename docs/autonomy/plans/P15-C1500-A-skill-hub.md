# P15-C1500-A — Skill Hub registry

**Statut :** `INTEGRATED` (design documenté, schema déjà livré)
**Date :** 2026-08-01
**Parent :** P15-C1500 (Skill Hub)

## Objectif

Implémenter le **Skill Hub** : marketplace communautaire de skills Unifia.

## Composants

### Registry

Stocke les métadonnées des skills :
```typescript
interface SkillRegistry {
  publish(input: SkillPackage): Promise<SkillHandle>
  search(input: { query: string; tags?: string[] }): Promise<SkillMetadata[]>
  install(handle: SkillHandle): Promise<InstalledSkill>
  rate(handle: SkillHandle, rating: number): Promise<void>
}
```

### Distribution

- **Local** : `~/.config/unifia/skills/`
- **Remote** : non planifié — le projet ne contrôle aucun domaine (voir G9)
- **Git** : `github.com/{user}/{skill}`

### Package format

```
my-skill/
├── SKILL.md         # Required
├── manifest.json    # Required
├── scripts/
│   └── run.sh
├── assets/
│   └── icon.png
└── README.md
```

### Security

- **Signature** : Ed25519 (publisher signs, user verifies)
- **Sandbox** : skills run in P3-C300 sandbox
- **Audit** : every install logged
- **Reputation** : community ratings

## Estimation

- Registry core : ~400 LOC
- Manifest validation : ~200 LOC
- Distribution layer : ~500 LOC
- Marketplace UI : ~600 LOC
- Tests : ~300 LOC
- **Total : ~2000 LOC**

## Liens

- [ADR-0017 OpenDesign](docs/adr/0017-opendesign-integration.md)
- [capability-packs/skill-hub-manifest.schema.json](../../capability-packs/skill-hub-manifest.schema.json)
- [skills/](../../skills/)