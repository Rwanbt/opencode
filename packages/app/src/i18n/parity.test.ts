import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { dict as en } from "./en"
import { dict as ar } from "./ar"
import { dict as br } from "./br"
import { dict as bs } from "./bs"
import { dict as da } from "./da"
import { dict as de } from "./de"
import { dict as es } from "./es"
import { dict as fr } from "./fr"
import { dict as ja } from "./ja"
import { dict as ko } from "./ko"
import { dict as no } from "./no"
import { dict as pl } from "./pl"
import { dict as ru } from "./ru"
import { dict as th } from "./th"
import { dict as zh } from "./zh"
import { dict as zht } from "./zht"
import { dict as tr } from "./tr"
import { dict as uiEn } from "@opencode-ai/ui/i18n/en"

const locales = [ar, br, bs, da, de, es, fr, ja, ko, no, pl, ru, th, tr, zh, zht]
const namedLocales: Record<string, typeof en> = { ar, br, bs, da, de, es, fr, ja, ko, no, pl, ru, th, tr, zh, zht }
const keys = ["command.session.previous.unseen", "command.session.next.unseen"] as const

const forkKeys = [
  "settings.localLlm.title",
  "settings.localLlm.searchPlaceholder",
  "settings.localConfig.title",
  "settings.localConfig.backendDescription",
] as const

const zhObservabilityKeys = [
  "settings.fork.observability.title",
  "settings.fork.observability.tabOverview",
  "settings.fork.observability.tabTraces",
  "settings.fork.observability.metricQueue",
] as const

// Settings scope covered by the 2026-07-17 fork-UI i18n audit. Every key
// under these prefixes must exist in en.ts and (outside the technical
// allowlist below) must carry a dedicated fr/zh translation, not an
// English fallback.
const AUDITED_SCOPE_PREFIXES = [
  "settings.fork.",
  "settings.localConfig.",
  "settings.localLlm.",
  "settings.desktop.remote.",
  "settings.providers.tag.",
  "settings.general.row.",
  "settings.models.",
  "settings.shortcuts.",
  "dialog.provider.",
  "dialog.debate.",
  "dialog.model.",
  "provider.",
]

// Legitimately identical across en/fr/zh: technical acronyms, proper nouns,
// cognates, units, punctuation, numeric/URL placeholders. Extending this
// list is fine; adding a real untranslated sentence here is not.
const TECHNICAL_ALLOWLIST = new Set([
  "provider.connect.opencodeZen.visit.link",
  "provider.custom.description.suffix",
  "provider.custom.models.id.label",
  "provider.custom.field.providerID.placeholder",
  "provider.custom.field.baseURL.placeholder",
  "provider.custom.models.id.placeholder",
  "provider.custom.headers.key.placeholder",
  "provider.custom.headers.value.placeholder",
  "settings.desktop.remote.mode.local",
  "settings.desktop.remote.mode.lan",
  "settings.desktop.remote.mode.internet",
  "settings.shortcuts.group.session",
  "settings.shortcuts.group.navigation",
  "settings.shortcuts.group.terminal",
  "settings.shortcuts.group.prompt",
  "settings.localLlm.visionReady",
  "settings.localLlm.vision",
  "settings.localConfig.title",
  "settings.localConfig.topP",
  "settings.localConfig.topK",
  "settings.localConfig.mode",
  "settings.localConfig.optionAuto",
  "settings.localConfig.optionCpu",
  "settings.localConfig.optionGpu",
  "settings.localConfig.optionNpu",
  "settings.localConfig.quantAuto",
  "settings.localConfig.offloadAuto",
  "settings.fork.audio.title",
  "settings.fork.benchmark.title",
  "settings.fork.observability.capture",
  "settings.fork.config.title",
  "settings.fork.android.ram",
  "settings.fork.android.diagnostics",
  "settings.fork.android.title",
  "settings.fork.android.thermalNormal",
  "settings.fork.android.megabytes",
  "settings.fork.android.gigabytes",
  "settings.fork.benchmark.model",
  "settings.fork.observability.host",
  "settings.fork.plugins.webviewSandbox",
  "settings.fork.gitAuth.httpsTokenActive",
  "settings.fork.gitAuth.tokenButton",
  "settings.localLlm.gpuInfo",
  "settings.fork.benchmark.ram",
  "settings.fork.benchmark.tokens",
  "settings.fork.benchmark.backendAuto",
  "settings.fork.observability.tabTraces",
  "settings.fork.observability.confirmation",
  "settings.fork.observability.type",
  "settings.fork.observability.session",
  "settings.fork.observability.maxEventsPlaceholder",
  "settings.fork.observability.sessions",
  "settings.fork.observability.sessionsCount",
  "settings.fork.audio.kokoro",
  "settings.fork.audio.kokoroOption",
  "settings.fork.audio.pocketOption",
  "settings.fork.plugins.local",
  "settings.fork.plugins.url",
  "settings.fork.plugins.title",
  "settings.fork.plugins.tabSkills",
  "settings.fork.plugins.serverNamePlaceholder",
  "settings.fork.plugins.commandPlaceholderExample",
  "settings.fork.plugins.urlPlaceholderExample",
])

// Recursively collect every language.t("literal.key") call from the
// components tree, ignoring dynamic template-literal keys (those are
// verified by direct code review, not mechanically checkable here).
function collectUsedKeys(dir: string, acc: Set<string> = new Set()): Set<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      collectUsedKeys(full, acc)
      continue
    }
    if (!/\.(tsx?|jsx?)$/.test(entry.name)) continue
    const content = readFileSync(full, "utf8")
    for (const match of content.matchAll(/\.t\(\s*"([a-zA-Z0-9_.]+)"/g)) {
      acc.add(match[1])
    }
  }
  return acc
}

describe("i18n parity", () => {
  test("all locales expose every English key", () => {
    for (const locale of locales) {
      for (const key of Object.keys(en)) {
        expect(locale[key as keyof typeof locale]).toBeDefined()
      }
    }
  })

  test("fork settings keys exist and French translates them", () => {
    for (const key of forkKeys) {
      expect(en[key]).toBeDefined()
      expect(fr[key]).toBeDefined()
    }
  })

  test("Chinese translates the observability settings surface", () => {
    for (const key of zhObservabilityKeys) {
      expect(zh[key]).toBeDefined()
      expect(zh[key]).not.toBe(en[key])
    }
  })
  test("non-English locales translate targeted unseen session keys", () => {
    for (const locale of locales) {
      for (const key of keys) {
        expect(locale[key]).toBeDefined()
        expect(locale[key]).not.toBe(en[key])
      }
    }
  })

  test("every language.t() key referenced in components exists in en.ts or the UI package dictionary", () => {
    const componentsDir = join(import.meta.dir, "..", "components")
    const used = collectUsedKeys(componentsDir)
    const missing = [...used].filter((key) => !(key in en) && !(key in uiEn)).sort()
    expect(missing).toEqual([])
  })

  test("audited settings scope (Audio/Configuration/Benchmark/Android/Plugins/RemoteAccess/GitAuth/LocalAI/Debate) has dedicated translations in every locale", () => {
    const scopeKeys = Object.keys(en).filter((key) => AUDITED_SCOPE_PREFIXES.some((prefix) => key.startsWith(prefix)))
    expect(scopeKeys.length).toBeGreaterThan(100)

    // Regression guard for 2026-07-17: the prior version of this test only checked
    // fr/zh, so ~26 real UI words (Audio, Configuration, Benchmark, Mode, Model,
    // Diagnostics, Plugins, Skills, ...) were silently left as literal English
    // copies in the other 14 locales. Loop over every locale so a future addition
    // can't reintroduce the same silent gap.
    for (const [name, dict] of Object.entries(namedLocales)) {
      const untranslated = scopeKeys.filter(
        (key) => !TECHNICAL_ALLOWLIST.has(key) && dict[key as keyof typeof dict] === en[key as keyof typeof en],
      )
      expect(untranslated, `${name}: untranslated keys outside the technical allowlist`).toEqual([])
    }
  })
})
