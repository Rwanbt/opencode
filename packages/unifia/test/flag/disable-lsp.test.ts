// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
//
// Original work. No upstream derivation.

import { describe, expect, test, afterEach } from "bun:test"

// UNIFIA_DISABLE_LSP is an explicit way to stop installed language servers from
// starting. UNIFIA_DISABLE_LSP_DOWNLOAD only prevents missing servers from being
// fetched, so it cannot avoid startup costs for servers already on disk. The E2E
// runner deliberately leaves the stronger flag opt-in because measurement did
// not establish LSP startup as the source of its flakes.

const touched: string[] = []

function setEnv(key: string, value: string | undefined) {
  touched.push(key)
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

afterEach(() => {
  for (const key of touched.splice(0)) delete process.env[key]
})

async function freshFlag() {
  // Flag reads process.env at module load, so each case needs its own import.
  const module = await import(`../../src/flag/flag.ts?disable-lsp=${Math.random()}`)
  return module.Flag
}

describe("UNIFIA_DISABLE_LSP", () => {
  test("is off unless asked for", async () => {
    const Flag = await freshFlag()
    expect(Flag.UNIFIA_DISABLE_LSP).toBe(false)
  })

  test("accepts the two spellings truthy() accepts", async () => {
    setEnv("UNIFIA_DISABLE_LSP", "true")
    expect((await freshFlag()).UNIFIA_DISABLE_LSP).toBe(true)

    setEnv("UNIFIA_DISABLE_LSP", "1")
    expect((await freshFlag()).UNIFIA_DISABLE_LSP).toBe(true)
  })

  test("is independent of DISABLE_LSP_DOWNLOAD in both directions", async () => {
    setEnv("UNIFIA_DISABLE_LSP_DOWNLOAD", "true")
    const downloadOnly = await freshFlag()
    expect(downloadOnly.UNIFIA_DISABLE_LSP_DOWNLOAD).toBe(true)
    expect(downloadOnly.UNIFIA_DISABLE_LSP).toBe(false)

    setEnv("UNIFIA_DISABLE_LSP_DOWNLOAD", undefined)
    setEnv("UNIFIA_DISABLE_LSP", "true")
    const startOnly = await freshFlag()
    expect(startOnly.UNIFIA_DISABLE_LSP).toBe(true)
    expect(startOnly.UNIFIA_DISABLE_LSP_DOWNLOAD).toBe(false)
  })

  test("the OPENCODE_ spelling does not satisfy it — the flag is fork-owned", async () => {
    setEnv("OPENCODE_DISABLE_LSP", "true")
    expect((await freshFlag()).UNIFIA_DISABLE_LSP).toBe(false)
  })
})
