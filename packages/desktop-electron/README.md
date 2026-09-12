# Unifia Preview (Electron)

**This is not the stable Unifia desktop.** That is `packages/desktop`, built with
Tauri. This package is the Preview channel: an Electron shell around the same
frontend, released separately so desktop changes can be tried without touching
the stable app.

Decision A5 of the rebrand plan makes that split explicit, and it has three
consequences you will notice:

- **Its own identity.** App IDs are `ai.unifia.desktop.preview{,.beta,.dev}` and
  the visible names are "Unifia Preview*". It installs beside the stable desktop,
  not over it.
- **Its own profile.** `userData` resolves under its own app ID, so settings,
  sessions and window state are not shared with the stable desktop — and not with
  an OpenCode install either. Until recently this resolved under
  `ai.opencode.desktop`, which is the identifier upstream's own Electron app
  uses, so it read and wrote that application's profile.
- **No protocol association.** Preview never registers `unifia://`. The stable
  desktop owns the scheme; if both claimed it, whichever launched last would
  capture every deep link on the machine, OAuth callbacks included. Preview still
  handles a link the OS routes to it, but it never takes the association.

`bun run identity:check` enforces all three against `config/identity.json`.

## Development

From the repo root:

```bash
bun run --cwd packages/desktop-electron dev
```

## Build

```bash
bun run --cwd packages/desktop-electron build
```

Packaging targets are declared per platform in `electron-builder.config.ts`; on
Windows, `bun run --cwd packages/desktop-electron package:win`.

The channel comes from the `UNIFIA_CHANNEL` build-time variable and defaults to
`dev`. It selects the app ID, the visible name and the update feed together —
see `src/main/constants.ts` and `electron-builder.config.ts`.
