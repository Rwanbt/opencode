import { $ } from "bun"

import { stageSidecar } from "./utils"

await $`bun ./scripts/copy-icons.ts ${process.env.UNIFIA_CHANNEL ?? "dev"}`

// Always rebuilds: `predev` exists so a dev session runs against the CLI in the
// working tree, not whatever `dist/` happens to hold. The staging itself is
// shared with `prepare` and `prepackage` so all three agree on the path and the
// binary name — the hand-composed variant here assumed the "-baseline"
// directory always exists and pointed at the pre-rebrand `bin/opencode`, so it
// never matched what the build had just written.
await stageSidecar({ rebuild: true })
