# P1-C100-E — Migration fixtures

**Statut :** `INTEGRATED` (fixtures créées dans tests/fixtures/workspaces/)
**Date :** 2026-08-01
**Parent :** P1-C100 (Harness multi-runtime)

## Objectif

Fournir des **fixtures workspace** pour tester le harness dans différents scénarios.

## Fixtures disponibles

Voir [tests/fixtures/workspaces/](../../tests/fixtures/workspaces/) :
- `monorepo-typescript.json`
- `monorepo-rust.json`
- `polyrepo.json`
- `empty-workspace.json`
- `single-file.json`
- `large-workspace.json`
- `opencode-fork.json`
- `unifia.json`
- 4 broken scenarios

## Format

```typescript
interface WorkspaceFixture {
  name: string
  description: string
  type: "monorepo-typescript" | "monorepo-rust" | "polyrepo" | ...
  structure: FileNode[]
  metadata: {
    expectedRuntime: "opencode" | "unifia"
    expectedFiles: number
    expectedLangs: string[]
  }
}
```

## Utilisation dans tests

```typescript
import fixtures from "@unifia/test-fixtures"

describe("Harness on monorepo-typescript", () => {
  for (const fixture of fixtures.monorepoTypescript) {
    test(`harness handles ${fixture.name}`, async () => {
      const harness = new OpenCodeHarnessAdapter()
      const handle = await harness.start({ workspace: fixture.path })
      // ...
      await harness.stop(handle)
    })
  }
})
```

## Tests à implémenter

- Harness démarre sur chaque fixture
- createSession fonctionne
- sendPrompt fonctionne
- Health report cohérent

## Estimation

- Tests : ~150 LOC
- **Total : ~150 LOC**

## Liens

- [tests/fixtures/workspaces/](../../tests/fixtures/workspaces/)
- [P1-C100-A](P1-C100-A-harness-contract.md)