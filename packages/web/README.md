# Fork documentation site

This package builds the documentation site for the fork. The source content is under [`src/content/docs`](src/content/docs).

## Development

Run from the monorepo root:

```bash
bun install
bun run --cwd packages/web dev
bun run --cwd packages/web build
bun run --cwd packages/web preview
```

Fork-specific installation, release, Android, local-model, Auto/Debate and observability guidance belongs here or in the root README. Upstream-only links must be labelled as upstream. Verify shared behaviour against `packages/opencode`, `packages/app`, `packages/desktop`, and `packages/mobile` before documenting it as implemented.

The temporary distribution boundary is documented in [`docs/FORK-DISTRIBUTION.md`](../../docs/FORK-DISTRIBUTION.md).

