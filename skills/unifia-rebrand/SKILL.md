---
name: unifia-rebrand
description: "Rebrand opencode fork to Unifia Workbench. Use when rebrand substitution, dependency migration, package renaming, brand assets integration, or governance ADRs/plans creation is needed."
---

# Unifia Workbench Rebrand Skill

Skill procédural pour **rebrand** un fork opencode en **Unifia Workbench V3**.

## Quand m'utiliser

- "Rebrand opencode → Unifia"
- "Installer le brand kit Unifia"
- "Créer un ADR pour..."
- "Décomposer un plan en sous-cartes"
- "Auditer les licences"
- "Migrer les versions"

## Procédure

### 1. Initialiser le sandbox

```bash
git clone <fork-url> /opt/data/work/unifia-sandbox/repo
cd /opt/data/work/unifia-sandbox/repo
git checkout -b agent/integration
```

### 2. Installer le brand kit Unifia

Drop-in pack de Unifia (logo, icônes, themes, tokens) :

```bash
git clone <unifia-dropin-url> /tmp/unifia-dropin
cd /tmp/unifia-dropin
node scripts/install-brand.mjs --repo /opt/data/work/unifia-sandbox/repo --apply
```

### 3. Rebrand cosmétique (substitution)

Whitelist stricte qui protège :
- URLs upstream (`github.com/.../opencode`)
- Paths packages (`packages/unifia/`)
- Workspace deps (`opencode-ai/*`)
- localStorage keys (`opencode.global.dat:language`)
- Theme IDs (`opencode-theme-id`)

Patterns à protéger (regex) :
- `https?://[^\s\)\]"'`]*opencode[^\s\)\]"'`]*`
- `github\.com/[^\s]*`
- `packages/unifia...`
- `opencode-cli...`
- `@unifia/...`
- `Rwanbt/unifia`, `anomalyco/opencode`

Substitution :
- `OPENCODE_X` → `UNIFIA_X` (env vars)
- `OpenCode` → `Unifia` (Title Case)
- `opencode` → `unifia` (lowercase standalone)

### 4. Vérifier après rebrand

```bash
git status --short | grep enterprise/
bash scripts/unifia-verify.sh
```

### 5. Créer la gouvernance

ADRs (Architecture Decision Records) :
```bash
docs/adr/0001-runtime-adapter.md
docs/adr/0002-workspace-port.md
```

Plans détaillés :
```bash
docs/autonomy/plans/P1-C100-harness-multi-runtime.md
docs/autonomy/plans/P2-C200-contracts-unifia.md
```

### 6. Créer le package @unifia/contracts

```typescript
export interface RuntimeAdapter {
  getInfo(): Promise<RuntimeInfo>
  listSessions(scope: WorkspaceScope): Promise<Session[]>
  createSession(input: { workspaceId: string }): Promise<Session>
  sendPrompt(input: SendPromptInput): Promise<void>
  subscribeEvents(input: { sessionId: string }): AsyncIterable<RuntimeEvent>
  cancelSession(sessionId: string): Promise<void>
}
```

Validation : `tsc --noEmit` doit exit 0.

### 7. Migration non-breaking

```bash
bash scripts/unifia-migrate.sh --apply
# ou sous Windows:
scripts\unifia-migrate.cmd --apply
```

## Pièges à éviter

- **Ne PAS** rebrand les localStorage keys (breaking change)
- **Ne PAS** rebrand les theme IDs (breaking change)
- **Ne PAS** rebrand les workspace deps (`opencode-ai/*` dans package.json)
- **Ne PAS** importer de code `/ee/` (license violation)
- **Ne PAS** push avant validation manuelle (3 verrous actifs)
- **TOUJOURS** vérifier qu'aucun `/ee/` n'est commit
- **TOUJOURS** utiliser des commits atomiques (1 carte = 1 commit)

## Validation fresh

Avant de clore une session :
```bash
# TypeScript valide
tsc --noEmit

# bash syntaxe
bash -n scripts/unifia-*.sh

# JSON validity
python3 -c "import json; json.load(open('...'))"

# YAML validity  
uv venv /tmp/v && source /tmp/v/bin/activate && uv pip install pyyaml
python3 -c "import yaml; yaml.safe_load(open('...'))"
```

## Liens

- [Plan V3](docs/autonomy/PLAN-DIRECTEUR-V3.md)
- [TASK-GRAPH v2.0](docs/autonomy/TASK-GRAPH-v2.0.yaml)
- [MIGRATION-PLAN](docs/autonomy/MIGRATION-PLAN.md)
- [20 ADRs](docs/adr/)
- [14 plans détaillés](docs/autonomy/plans/)
- [Contracts package](packages/contracts/)
