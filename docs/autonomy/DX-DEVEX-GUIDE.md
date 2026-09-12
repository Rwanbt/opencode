# Developer Experience Guide — Unifia Workbench

**Version :** 1.0
**Date :** 2026-07-31

## Pour les nouveaux contributeurs

Welcome ! Ce guide vous accompagne dans vos premières contributions.

### Quickstart (30 min)

1. **Clone** :
   ```bash
   git clone <repo> unifia
   cd unifia
   ```

2. **Install** :
   ```bash
   bash scripts/unifia-install.sh --from-source
   bun install
   ```

3. **Verify** :
   ```bash
   bash scripts/unifia-verify.sh
   ```

4. **Doctor** :
   ```bash
   bash scripts/unifia-doctor.sh --verbose
   ```

5. **Build** :
   ```bash
   bun turbo build
   ```

### Run tests

```bash
# All tests
bun turbo test

# Single package
cd packages/unifia
bun test

# E2E
cd packages/app
bun test:e2e
```

### Open a PR

```bash
# Branch
git checkout -b agent/phase-X/PX-CNNN-description

# Atomic commits
git commit -m "feat(scope): [PX-CNNN] description"

# Push locked (use local-only)
git log --oneline -10
```

## Outils de dev

| Outil | Usage |
|---|---|
| **Bun** | Runtime + package manager |
| **TypeScript** | Langage |
| **Vite** | Bundler |
| **SolidJS** | UI framework |
| **Tauri** | Desktop framework |
| **Effect** | Async effects |
| **Drizzle** | ORM |
| **Biome** | Lint + format |
| **Vitest** | Tests |
| **Playwright** | E2E |

## Conventions de code

### TypeScript

- **Strict mode** : `tsc --noEmit` doit exit 0
- **Pas de `any`** : utiliser des types précis
- **Interfaces** : utiliser `interface`, pas `type`
- **async/await** : pas de callbacks
- **Result types** : pas de throw pour les erreurs normales

### Naming

- **Files** : `kebab-case.ts`
- **Classes** : `PascalCase`
- **Functions** : `camelCase`
- **Constants** : `UPPER_SNAKE_CASE`
- **private** : `_` prefix recommandé

### Comments

```typescript
// Single-line comment
/* Multi-line */
// TODO: future improvement
// FIXME: known issue
// XXX: workaround
```

## Workflow quotidien

### Morning

1. Check `git status`
2. Pull `dev`
3. `bun install` (if deps changed)
4. `bun turbo build`

### Coding

1. Tests first (TDD)
2. Implement
3. `bun x biome@latest check .`
4. `bunx tsc --noEmit`
5. Commit

### Pre-commit

```bash
# Vérifier avant de commit
bash scripts/unifia-verify.sh --verbose
bash scripts/unifia-doctor.sh
```

## Debugging

### Logs

```bash
# Tracer un module
DEBUG=unifia:* bun run start

# Logs app
~/.config/unifia/logs/
```

### Tests

```bash
# Tests focalisés
bun test -t "specific test"

# Watch mode
bun test:watch

# Coverage
bun test --coverage
```

### Performance

```bash
# Profile
bun run --inspect

# Flame graph
bun run bench
```

## Conventions de PR

### Commit message

```
<type>(<scope>): <short description>

<long description>

<footer with Unifia-Card, etc.>
```

**Types** :
- `feat` : new feature
- `fix` : bug fix
- `docs` : documentation
- `style` : formatting
- `refactor` : code refactoring
- `test` : tests
- `chore` : maintenance

### PR body

Fix [PX-CNNN] [title]

## Description

[Bullet points]

## Tests

- [ ] Test X
- [ ] Test Y

## Checklist

- [ ] All tests pass
- [ ] Lint clean
- [ ] Typecheck pass
- [ ] Docs updated
- [ ] No secrets
- [ ] No /ee/
```

## Common pitfalls

| Pitfall | Solution |
|---|---|
| `Cannot find module` | `bun install` |
| `git push` rejected | Local-only, push is locked |
| `bunx` not found | Use `bun x` instead |
| Yargs version mismatch | Pin in package.json |
| Tauri build error | Check Rust toolchain |
| DB locked | Close other instances |

## Voir aussi

- [CONTRIBUTING.md](CONTRIBUTING.md)
- [unifia-tasks.md](unifia-tasks.md)
- [skills/unifia-rebrand/SKILL.md](skills/unifia-rebrand/SKILL.md)
- [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md)
- [docs/autonomy/](docs/autonomy/)
