# Unifia brand kit

Canonical, repository-native source for every Unifia visual asset — decision A9
of the rebrand plan. Nothing here resolves a path outside the repo, so a fresh
clone can rebuild the whole kit.

```bash
bun run brand:generate   # rebuild every derived asset (Python 3.10+ and Pillow)
bun run brand:check      # verify the committed tree matches the manifest (Node only)
```

`brand:check` runs in CI via `.github/workflows/brand.yml`. Generating and
checking have deliberately different requirements: CI must be able to reject
brand drift without installing an image toolchain.

## What is source, what is derived

| Path | Status |
|---|---|
| `masters/` | **source** — the 15 approved variants as SVG + PNG, the only generator input |
| `source-user-approved/` | **source** — the originals as delivered, kept for provenance |
| `cli/` | **source** — the approved 38x5 CLI/TUI lockup specification |
| `unifia.tokens.json`, `unifia.css`, `unifia.theme.ts`, `unifia.tailwind.ts` | **source** — design tokens |
| `brand.config.json` | **source** — declares what gets generated and where |
| `variants/` | **generated** |
| `brand-manifest.json` | **generated** for its `generated` map; its `masters` hashes are the provenance record |
| `.unifia-brand-backup/` (repo root) | **local backup** — gitignored, never committed, never packaged |

Derived assets also land outside this directory — the app and web brand
directories and the Tauri icon sets for desktop and mobile. `brand.config.json`
is the list; do not hand-edit any of those files, since `brand:check` will
reject the change and the next generate will overwrite it.

## Typography is not bundled

The tokens declare Manrope for UI text and Roboto Mono for code, but **neither
font ships in this repository** — verified, zero font files match either name.
Both fall back through the stacks in `unifia.css`: Inter then Noto Sans then the
system UI font, and Cascadia Mono then SF Mono then the generic monospace.

That has one good consequence and one bad one. Nothing is redistributed, so
there is no font licence to satisfy. But the brand typography only renders as
designed on machines that already have Manrope installed, which is a minority —
in practice most users see a fallback.

Fixing it means vendoring the fonts under their licences (both are SIL OFL 1.1,
which permits redistribution with the licence text alongside) and wiring
`@font-face` in. That is a deliberate size and licensing decision, not a
generator change, so it is left open rather than done silently.

The fonts that *are* committed — JetBrains Mono, IBM Plex Mono and Rubik under
`packages/console/mail/emails/templates/static/` — predate this kit, are used
only by the transactional email templates, and ship without their licence text
alongside. Worth correcting, but it belongs to the console surface, not here.
