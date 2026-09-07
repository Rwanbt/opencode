/* SPDX-License-Identifier: MIT */
/**
 * D12 (§9.4 Lane D4) — secret-separation tests.
 *
 * Two layers of defence:
 *
 *  1. Compile-time — the three brand types
 *     (DesktopKeychainToken / MobileEncryptionKey / WorkbenchIpcBearer)
 *     are nominally distinct. A value of one brand cannot be passed
 *     where another is expected, even though all three are strings at
 *     runtime. The `// @ts-expect-error` directives below are the test
 *     for that — if the cross-type assignment ever stops being an
 *     error, this file fails to compile.
 *
 *  2. Runtime — `tryDecode*` rejects a raw string that matches the
 *     format of one secret but not the one expected. A 32-byte base64
 *     MobileEncryptionKey therefore cannot be promoted to a
 *     WorkbenchIpcBearer at the migration boundary.
 *
 * The migration test in §3 documents the behaviour the 4.0 plan
 * §9.4 step 3 requires: the old env var name still works, but logs a
 * deprecation warning. The deletion date is 2026-12-31.
 */
import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test"
import {
  type DesktopKeychainToken,
  type MobileEncryptionKey,
  type WorkbenchIpcBearer,
  makeDesktopKeychainToken,
  makeMobileEncryptionKey,
  makeWorkbenchIpcBearer,
  tryDecodeDesktopKeychainToken,
  tryDecodeMobileEncryptionKey,
  tryDecodeWorkbenchIpcBearer,
  readWorkbenchIpcBearerFromEnv,
  readMobileEncryptionKeyFromEnv,
} from "../src/secrets.ts"

// A 64-char lowercase hex string — valid format for DesktopKeychainToken
// and WorkbenchIpcBearer. Not a valid MobileEncryptionKey (the regex
// rejects hex; it requires base64 alphabet).
const HEX_64 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

// A 44-char base64 string encoding exactly 32 raw bytes (the bytes
// 0..31, encoded with standard base64 padding). Valid format for
// MobileEncryptionKey; rejected by both DesktopKeychainToken and
// WorkbenchIpcBearer decoders.
const B64_32 = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="

// A second 64-char hex string, distinct from HEX_64. Used in the
// distinctness tests.
const HEX_64_BIS = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210"

describe("secrets — D12 brand types", () => {
  describe("make* producers", () => {
    it("makeDesktopKeychainToken accepts 64 lowercase hex chars", () => {
      const t = makeDesktopKeychainToken(HEX_64)
      expect(t).toBe(HEX_64)
    })

    it("makeDesktopKeychainToken rejects 64 uppercase hex chars", () => {
      // The format is lowercase to match the uuid::Uuid::simple() output
      // on the Rust side (auth_storage.rs:282-283). An uppercase value
      // would be a producer bug.
      expect(() => makeDesktopKeychainToken(HEX_64.toUpperCase())).toThrow(/64 lowercase hex chars/)
    })

    it("makeDesktopKeychainToken rejects 32-byte base64 (the encryption key shape)", () => {
      // Critical: a MobileEncryptionKey-shaped value must not be
      // promotable to a DesktopKeychainToken. This is the §9.4 rule
      // "interdire cle de chiffrement comme bearer IPC".
      expect(() => makeDesktopKeychainToken(B64_32)).toThrow(/64 lowercase hex chars/)
    })

    it("makeMobileEncryptionKey accepts 32-byte base64", () => {
      const k = makeMobileEncryptionKey(B64_32)
      expect(k).toBe(B64_32)
    })

    it("makeMobileEncryptionKey rejects 64 hex chars (the keychain bearer shape)", () => {
      // The reverse direction: a DesktopKeychainToken-shaped value
      // must not be accepted as a MobileEncryptionKey.
      expect(() => makeMobileEncryptionKey(HEX_64)).toThrow(/base64-encoded 32-byte key/)
    })

    it("makeWorkbenchIpcBearer accepts 64 lowercase hex chars", () => {
      const b = makeWorkbenchIpcBearer(HEX_64)
      expect(b).toBe(HEX_64)
    })

    it("makeWorkbenchIpcBearer rejects 32-byte base64 (the encryption key shape)", () => {
      // §9.4 step 4: "interdire cle de chiffrement comme bearer IPC et
      // inversement". A value that is shaped like a MobileEncryptionKey
      // must not be a valid WorkbenchIpcBearer.
      expect(() => makeWorkbenchIpcBearer(B64_32)).toThrow(/64 lowercase hex chars/)
    })
  })

  describe("tryDecode* consumers (runtime rejection of cross-type values)", () => {
    it("tryDecodeDesktopKeychainToken accepts 64 hex chars", () => {
      const t = tryDecodeDesktopKeychainToken(HEX_64)
      expect(t).toBe(HEX_64)
    })

    it("tryDecodeDesktopKeychainToken rejects 32-byte base64", () => {
      // This is the runtime counterpart of the compile-time brand
      // check. Even at the migration boundary, a value that is shaped
      // like a MobileEncryptionKey must not be promoted to a
      // DesktopKeychainToken.
      expect(tryDecodeDesktopKeychainToken(B64_32)).toBeNull()
    })

    it("tryDecodeMobileEncryptionKey accepts 32-byte base64", () => {
      const k = tryDecodeMobileEncryptionKey(B64_32)
      expect(k).toBe(B64_32)
    })

    it("tryDecodeMobileEncryptionKey rejects 64 hex chars", () => {
      // Reverse direction.
      expect(tryDecodeMobileEncryptionKey(HEX_64)).toBeNull()
    })

    it("tryDecodeWorkbenchIpcBearer accepts 64 hex chars", () => {
      const b = tryDecodeWorkbenchIpcBearer(HEX_64)
      expect(b).toBe(HEX_64)
    })

    it("tryDecodeWorkbenchIpcBearer rejects 32-byte base64", () => {
      // The headline test of the §9.4 rule. A 32-byte base64 value
      // is exactly the shape of a MobileEncryptionKey. The workbench
      // IPC path must reject it.
      expect(tryDecodeWorkbenchIpcBearer(B64_32)).toBeNull()
    })

    it("tryDecode* all return null on null / undefined / empty string", () => {
      expect(tryDecodeDesktopKeychainToken(null)).toBeNull()
      expect(tryDecodeDesktopKeychainToken(undefined)).toBeNull()
      expect(tryDecodeDesktopKeychainToken("")).toBeNull()
      expect(tryDecodeMobileEncryptionKey(null)).toBeNull()
      expect(tryDecodeMobileEncryptionKey(undefined)).toBeNull()
      expect(tryDecodeMobileEncryptionKey("")).toBeNull()
      expect(tryDecodeWorkbenchIpcBearer(null)).toBeNull()
      expect(tryDecodeWorkbenchIpcBearer(undefined)).toBeNull()
      expect(tryDecodeWorkbenchIpcBearer("")).toBeNull()
    })
  })

  describe("compile-time brand incompatibility", () => {
    // These blocks exist solely to make the @ts-expect-error
    // directives type-check. If the brand types ever lose their
    // nominality, the @ts-expect-error comments become a compile
    // error and the test file fails to build — which is the
    // intended signal.
    it("MobileEncryptionKey cannot be passed where DesktopKeychainToken is expected", () => {
      const key: MobileEncryptionKey = makeMobileEncryptionKey(B64_32)
      const acceptDesktop = (t: DesktopKeychainToken): string => t
      // @ts-expect-error — the brands are nominally distinct
      acceptDesktop(key)
      // The line above is the test. If it stops being an error,
      // the secret-separation guarantee is broken.
      expect(acceptDesktop(makeDesktopKeychainToken(HEX_64))).toBe(HEX_64)
    })

    it("MobileEncryptionKey cannot be used as a WorkbenchIpcBearer", () => {
      const key: MobileEncryptionKey = makeMobileEncryptionKey(B64_32)
      const acceptBearer = (b: WorkbenchIpcBearer): string => b
      // @ts-expect-error — encryption key is not a bearer
      acceptBearer(key)
      expect(acceptBearer(makeWorkbenchIpcBearer(HEX_64))).toBe(HEX_64)
    })

    it("WorkbenchIpcBearer cannot be used as a MobileEncryptionKey", () => {
      const bearer: WorkbenchIpcBearer = makeWorkbenchIpcBearer(HEX_64)
      const acceptKey = (k: MobileEncryptionKey): string => k
      // @ts-expect-error — bearer is not an encryption key
      acceptKey(bearer)
      expect(acceptKey(makeMobileEncryptionKey(B64_32))).toBe(B64_32)
    })

    it("DesktopKeychainToken cannot be used as a WorkbenchIpcBearer", () => {
      // Same wire format today, but the types are distinct on
      // purpose. A future refactor (HKDF-derived mobile bearer) can
      // change the bearer format without touching the desktop
      // producer.
      const t: DesktopKeychainToken = makeDesktopKeychainToken(HEX_64)
      const acceptBearer = (b: WorkbenchIpcBearer): string => b
      // @ts-expect-error — desktop keychain token is not the workbench IPC bearer
      acceptBearer(t)
      expect(acceptBearer(makeWorkbenchIpcBearer(HEX_64_BIS))).toBe(HEX_64_BIS)
    })
  })
})

describe("secrets — D12 migration boundary", () => {
  // The 4.0 plan §9.4 step 3 requires a migration-compatibility
  // window: the old env var name `UNIFIA_KEYCHAIN_TOKEN` continues to
  // work but logs a deprecation warning. The new name
  // `UNIFIA_WORKBENCH_BEARER` is preferred. Deletion 2026-12-31.

  let savedWorkbench: string | undefined
  let savedKeychain: string | undefined
  let savedEncryption: string | undefined

  beforeEach(() => {
    savedWorkbench = process.env.UNIFIA_WORKBENCH_BEARER
    savedKeychain = process.env.UNIFIA_KEYCHAIN_TOKEN
    savedEncryption = process.env.UNIFIA_AUTH_ENCRYPTION_KEY
    delete process.env.UNIFIA_WORKBENCH_BEARER
    delete process.env.UNIFIA_KEYCHAIN_TOKEN
    delete process.env.UNIFIA_AUTH_ENCRYPTION_KEY
  })

  afterEach(() => {
    if (savedWorkbench === undefined) delete process.env.UNIFIA_WORKBENCH_BEARER
    else process.env.UNIFIA_WORKBENCH_BEARER = savedWorkbench
    if (savedKeychain === undefined) delete process.env.UNIFIA_KEYCHAIN_TOKEN
    else process.env.UNIFIA_KEYCHAIN_TOKEN = savedKeychain
    if (savedEncryption === undefined) delete process.env.UNIFIA_AUTH_ENCRYPTION_KEY
    else process.env.UNIFIA_AUTH_ENCRYPTION_KEY = savedEncryption
  })

  it("UNIFIA_WORKBENCH_BEARER is the preferred env var (no warning)", () => {
    const warn = mock(() => {})
    const bearer = readWorkbenchIpcBearerFromEnv(
      { UNIFIA_WORKBENCH_BEARER: HEX_64 },
      warn,
    )
    expect(bearer).toBe(HEX_64)
    expect(warn).not.toHaveBeenCalled()
  })

  it("UNIFIA_KEYCHAIN_TOKEN still works but logs a deprecation warning", () => {
    const warn = mock(() => {})
    const bearer = readWorkbenchIpcBearerFromEnv(
      { UNIFIA_KEYCHAIN_TOKEN: HEX_64 },
      warn,
    )
    expect(bearer).toBe(HEX_64)
    expect(warn).toHaveBeenCalledTimes(1)
    const message = warn.mock.calls[0]?.[0] as string
    expect(message).toMatch(/UNIFIA_KEYCHAIN_TOKEN is deprecated/)
    expect(message).toMatch(/UNIFIA_WORKBENCH_BEARER/)
    expect(message).toMatch(/deletion 2026-12-31/)
  })

  it("UNIFIA_KEYCHAIN_TOKEN is rejected if it has the encryption key shape (32-byte base64)", () => {
    // This is the bug today: on mobile, UNIFIA_KEYCHAIN_TOKEN is set
    // to the 32-byte base64 encryption key (server.rs:267, 340-341).
    // After D12, the workbench IPC path rejects that shape outright,
    // even through the legacy env name.
    const warn = mock(() => {})
    const bearer = readWorkbenchIpcBearerFromEnv(
      { UNIFIA_KEYCHAIN_TOKEN: B64_32 },
      warn,
    )
    expect(bearer).toBeNull()
    // The deprecation warning still fires — the operator needs to
    // know the legacy name is in use. The deprecation message
    // is the only signal that points them at the right fix.
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it("readMobileEncryptionKeyFromEnv reads UNIFIA_AUTH_ENCRYPTION_KEY and rejects the bearer shape", () => {
    expect(readMobileEncryptionKeyFromEnv({ UNIFIA_AUTH_ENCRYPTION_KEY: B64_32 })).toBe(B64_32)
    // 64 hex chars is the bearer shape; the encryption key path
    // rejects it.
    expect(readMobileEncryptionKeyFromEnv({ UNIFIA_AUTH_ENCRYPTION_KEY: HEX_64 })).toBeNull()
  })

  it("readMobileEncryptionKeyFromEnv does NOT accept the legacy OPENCODE_AUTH_ENCRYPTION_KEY (B08 F2 / DA-SEC-02)", () => {
    // The legacy name is intentionally excluded. Code that reads
    // OPENCODE_AUTH_ENCRYPTION_KEY directly (github/auth.ts:48, 69)
    // is the F2 finding; the migration shim lives there, not here.
    expect(readMobileEncryptionKeyFromEnv({ OPENCODE_AUTH_ENCRYPTION_KEY: B64_32 })).toBeNull()
  })
})
