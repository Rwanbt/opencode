import { describe, expect, test } from "bun:test"
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

const locales = [ar, br, bs, da, de, es, fr, ja, ko, no, pl, ru, th, tr, zh, zht]
const keys = ["command.session.previous.unseen", "command.session.next.unseen"] as const

const forkKeys = [
  "settings.localLlm.title",
  "settings.localLlm.searchPlaceholder",
  "settings.localConfig.title",
  "settings.localConfig.backendDescription",
] as const

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

  test("non-English locales translate targeted unseen session keys", () => {
    for (const locale of locales) {
      for (const key of keys) {
        expect(locale[key]).toBeDefined()
        expect(locale[key]).not.toBe(en[key])
      }
    }
  })
})
