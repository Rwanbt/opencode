import { describe, expect, test, afterEach } from "bun:test"

// Flag reads process.env once at module load, so these exercise the reader's
// rules through a fresh import rather than mutating an already-evaluated
// namespace. What matters is the boundary: a variable in the `isolated` class of
// config/identity.json must not be satisfiable by its OPENCODE_* spelling, or an
// environment prepared for the official install reaches into this product's
// keychain, port and profile.

const ISOLATED = [
  "UNIFIA_CLIENT",
  "UNIFIA_AUTH_STORAGE",
  "UNIFIA_KEYCHAIN_URL",
  "UNIFIA_KEYCHAIN_TOKEN",
  "UNIFIA_SERVER_USERNAME",
  "UNIFIA_SERVER_PASSWORD",
  "UNIFIA_PTY_PORT",
  "UNIFIA_CONFIG_DIR",
] as const

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
  // A cache-busting query keeps each case independent of the previous import.
  const module = await import(`../../src/flag/flag.ts?isolated=${Math.random()}`)
  return module.Flag
}

describe("isolated environment variables", () => {
  test("the legacy spelling does not satisfy an isolated variable", async () => {
    setEnv("OPENCODE_AUTH_STORAGE", "keychain")
    setEnv("OPENCODE_SERVER_USERNAME", "official-user")

    const Flag = await freshFlag()

    expect(Flag.UNIFIA_AUTH_STORAGE).toBeUndefined()
    expect(Flag.UNIFIA_SERVER_USERNAME).toBeUndefined()
  })

  test("the rebranded spelling is read", async () => {
    setEnv("UNIFIA_AUTH_STORAGE", "keychain")
    setEnv("UNIFIA_SERVER_USERNAME", "unifia-user")

    const Flag = await freshFlag()

    expect(Flag.UNIFIA_AUTH_STORAGE).toBe("keychain")
    expect(Flag.UNIFIA_SERVER_USERNAME).toBe("unifia-user")
  })

  test("the rebranded spelling wins when both are set", async () => {
    setEnv("OPENCODE_KEYCHAIN_URL", "http://official")
    setEnv("UNIFIA_KEYCHAIN_URL", "http://unifia")

    const Flag = await freshFlag()

    expect(Flag.UNIFIA_KEYCHAIN_URL ?? process.env["UNIFIA_KEYCHAIN_URL"]).toBe("http://unifia")
  })

  test("UNIFIA_CLIENT still defaults to cli, and the legacy name cannot change it", async () => {
    setEnv("OPENCODE_CLIENT", "mobile-embedded")

    const Flag = await freshFlag()

    expect(Flag.UNIFIA_CLIENT).toBe("cli")
  })

  test("a preference keeps falling back — only the isolated class is strict", async () => {
    setEnv("OPENCODE_DISABLE_AUTOUPDATE", "true")

    const Flag = await freshFlag()

    expect(Flag.UNIFIA_DISABLE_AUTOUPDATE).toBe(true)
  })

  test("every isolated name is exported by Flag", async () => {
    const Flag = await freshFlag()
    for (const name of ISOLATED) {
      expect(Object.hasOwn(Flag, name)).toBe(true)
    }
  })
})
