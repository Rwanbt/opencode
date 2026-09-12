/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const INDEX_HTML = resolve(import.meta.dir, "../../../index.html")
const SITE_MANIFEST = resolve(
  import.meta.dir,
  "../../../../ui/src/assets/favicon/site.webmanifest",
)
const EN = resolve(import.meta.dir, "../../i18n/en.ts")
const FR = resolve(import.meta.dir, "../../i18n/fr.ts")

const indexHtml = readFileSync(INDEX_HTML, "utf-8")
const siteManifest = JSON.parse(readFileSync(SITE_MANIFEST, "utf-8"))
const en = readFileSync(EN, "utf-8")
const fr = readFileSync(FR, "utf-8")

// V09 — F-09 closure. The audit found three user-facing OpenCode
// references: the window title, the web manifest name, and the
// GitHub OAuth authorize title in en/fr. Each of these now reads
// "Unifia". The provider-level references (opencode, opencodeZen)
// are kept because they are technical names for a third-party
// provider, not the user-facing brand.
describe("V09 — Unifia replaces OpenCode in the user-facing brand", () => {
  test("the window title is Unifia, not OpenCode", () => {
    expect(indexHtml).toMatch(/<title>Unifia<\/title>/)
    expect(indexHtml).not.toMatch(/<title>OpenCode<\/title>/)
  })

  test("the web manifest is Unifia", () => {
    expect(siteManifest.name).toBe("Unifia")
    expect(siteManifest.short_name).toBe("Unifia")
    expect(siteManifest.name).not.toBe("OpenCode")
  })

  test("the GitHub OAuth authorize title in en is Unifia", () => {
    expect(en).toMatch(/"settings\.fork\.githubAuth\.authorizeTitle":\s*"Authorize Unifia on GitHub"/)
    expect(en).not.toMatch(/Authorize OpenCode on GitHub/)
  })

  test("the GitHub OAuth authorize title in fr is Unifia", () => {
    expect(fr).toMatch(/"settings\.fork\.githubAuth\.authorizeTitle":\s*"Autoriser Unifia sur GitHub"/)
    expect(fr).not.toMatch(/Autoriser OpenCode sur GitHub/)
  })

  test("the technical provider name 'opencode' is preserved (a third-party provider, not the brand)", () => {
    // The plan: "conserver les noms historiques uniquement dans les
    // contrats techniques nécessaires". `dialog.provider.opencode.*`
    // and `provider.connect.opencodeZen.*` are technical names for
    // a real third-party provider, not the user-facing brand. They
    // must NOT be rebranded to Unifia.
    expect(en).toMatch(/dialog\.provider\.opencode\.tagline/)
    expect(en).toMatch(/provider\.connect\.opencodeZen\.visit\.link/)
  })
})
