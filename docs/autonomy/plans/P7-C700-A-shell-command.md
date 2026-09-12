# P7-C700-A — Shell command design

**Statut :** `INTEGRATED` (design documenté)
**Date :** 2026-08-01
**Parent :** P7-C700 (Shell Unifia)

## Objectif

Définir le **shell Unifia** : un CLI moderne avec auto-complétion, history, et intégration native des contrats Unifia.

## CLI structure

```
unifia [--version] [--help] [--debug]
       [command] [subcommand] [options] [args]
```

## Commandes principales

```bash
unifia init <path>            # Initialize workspace
unifia session create         # Create session
unifia session list           # List sessions
unifia session send <id> <msg># Send prompt
unifia session cancel <id>    # Cancel session
unifia workspace register     # Register workspace
unifia workspace open         # Open workspace
unifia file read <path>       # Read file
unifia file write <path>      # Write file
unifia search <query>         # Search workspace
unifia capability list        # List capabilities
unifia capability run <id>    # Run capability
unifia policy list            # List policies
unifia policy add <file>      # Add policy
unifia secret list            # List secrets (metadata only)
unifia secret get <key>       # Get secret (masked)
unifia audit log              # Show audit log
unifia workspace scan         # Scan workspace (security)
unifia migrate --apply        # Migrate opencode → unifia
unifia verify                 # Verify install
unifia doctor                 # Diagnose issues
```

## Architecture

```typescript
// packages/cli/src/cli.ts
import { parse, subcommand } from "yargs"
import { commands } from "./commands/index.js"

const cli = parse(process.argv.slice(2))
  .command(commands.init)
  .command(commands.session)
  .command(commands.workspace)
  // ...

await cli.argv
```

## UX

- **Colors** : `chalk`
- **Prompts** : `inquirer`
- **Spinner** : `ora`
- **Tables** : `table`
- **Progress** : `cli-progress`

## Tests

- Test chaque commande
- Test flags --help, --version, --dry-run
- Test completion bash/zsh

## Estimation

- CLI core : ~500 LOC
- Commands (20) : ~1500 LOC
- UX helpers : ~200 LOC
- Tests : ~500 LOC
- **Total : ~2700 LOC**

## Liens

- [ADR-0014 Provider unifia native](docs/adr/0014-provider-unifia-native.md)
- [unifia-migrate.sh](../../scripts/unifia-migrate.sh)
- [unifia-verify.sh](../../scripts/unifia-verify.sh)
- [unifia-doctor.sh](../../scripts/unifia-doctor.sh)