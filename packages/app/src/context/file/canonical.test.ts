import { describe, expect, test } from "bun:test"
import { canonical } from "./canonical"

describe("canonical()", () => {
  describe("single source of truth (R2 regression)", () => {
    // WHY: the original bug was two cache keys for the same file
    // (`"src/app.ts"` from tab URL, `"src\\app.ts"` from native watcher path).
    // Every variant below must produce the SAME canonical key.
    test("file:// URL and native path collapse to the same key", () => {
      expect(canonical("file://src/deep/file.ts", "D:\\repo")).toBe("src/deep/file.ts")
      expect(canonical("D:\\repo\\src\\deep\\file.ts", "D:\\repo")).toBe("src/deep/file.ts")
      expect(canonical("D:/repo/src/deep/file.ts", "D:\\repo")).toBe("src/deep/file.ts")
    })

    test("query and hash are stripped before keying", () => {
      expect(canonical("src/app.ts#L12?x=1", "D:\\repo")).toBe("src/app.ts")
      expect(canonical("src/app.ts?x=1#L12", "D:\\repo")).toBe("src/app.ts")
      expect(canonical("file:///repo/src/app.ts?x=1#h", "/repo")).toBe("src/app.ts")
    })

    test("mixed separators normalize to forward slashes", () => {
      // The file lives INSIDE root's last segment; the relative key drops that segment.
      expect(canonical("D:\\dev\\projects/opencode\\README.md", "D:\\dev\\projects\\opencode")).toBe("README.md")
    })

    test("Windows case-insensitive root matching", () => {
      expect(canonical("C:\\Repo\\src\\app.ts", "c:\\repo")).toBe("src/app.ts")
      expect(canonical("c:\\REPO\\src\\app.ts", "C:\\repo")).toBe("src/app.ts")
    })

    test("git octal-quoted paths decode then normalize", () => {
      expect(canonical('"a/\\303\\251.txt"', "D:\\repo")).toBe("a/é.txt")
      expect(canonical('"plain\\nname"', "D:\\repo")).toBe("plain\nname")
    })

    test("URI-encoded segments decode then normalize", () => {
      expect(canonical("file:///repo/src/My%20File.ts", "/repo")).toBe("src/My File.ts")
    })
  })

  describe("root stripping", () => {
    test("strips exact root prefix (Unix)", () => {
      expect(canonical("/repo/src/app.ts", "/repo")).toBe("src/app.ts")
      expect(canonical("/repo/src/components/Button.tsx", "/repo")).toBe("src/components/Button.tsx")
    })

    test("strips exact root prefix (Windows)", () => {
      expect(canonical("C:\\repo\\src\\app.ts", "C:\\repo")).toBe("src/app.ts")
      expect(canonical("C:/repo/src/app.ts", "C:\\repo")).toBe("src/app.ts")
    })

    test("does not strip when input is not inside root", () => {
      expect(canonical("/other/src/app.ts", "/repo")).toBe("other/src/app.ts")
    })

    test("no root → returns canonicalized path (leading slash may be stripped)", () => {
      // Without a root, canonical() is still expected to be deterministic and separator-clean.
      // The leading-`/` strip is intentional: it keeps the result uniformly relative-shape.
      expect(canonical("D:\\repo\\src\\app.ts")).toBe("D:/repo/src/app.ts")
    })
  })

  describe("leading prefix cleanup", () => {
    test("strips leading ./", () => {
      expect(canonical("./src/app.ts", "D:\\repo")).toBe("src/app.ts")
      expect(canonical(".\\src\\app.ts", "D:\\repo")).toBe("src/app.ts")
    })

    test("strips leading slash (absolute inside root)", () => {
      expect(canonical("/repo/src/app.ts", "/repo")).toBe("src/app.ts")
      // Input must also be inside the Windows root for the prefix to be stripped.
      expect(canonical("D:\\repo\\src\\app.ts", "D:\\repo")).toBe("src/app.ts")
    })
  })

  describe("invariants", () => {
    test("output never contains backslash", () => {
      const cases = [
        canonical("D:\\repo\\src\\app.ts", "D:\\repo"),
        canonical("D:/repo/src/app.ts", "D:\\repo"),
        canonical("file://D:/repo/src/app.ts", "D:\\repo"),
      ]
      for (const c of cases) {
        expect(c).not.toContain("\\")
      }
    })

    test("output never starts with / or ./", () => {
      const cases = [
        canonical("./src/app.ts", "D:\\repo"),
        canonical("/repo/src/app.ts", "/repo"),
        canonical(".\\src\\app.ts", "D:\\repo"),
        canonical("\\repo\\src\\app.ts", "D:\\repo"),
      ]
      for (const c of cases) {
        expect(c.startsWith("/")).toBe(false)
        expect(c.startsWith("./")).toBe(false)
      }
    })

    test("is deterministic — same input always produces same output", () => {
      const input = "file://D:\\repo\\src\\deep\\file.ts#L10?x=1"
      const a = canonical(input, "D:\\repo")
      const b = canonical(input, "D:\\repo")
      expect(a).toBe(b)
    })

    test("is idempotent — canonical(canonical(x)) === canonical(x)", () => {
      const inputs = [
        "D:\\repo\\src\\app.ts",
        "file:///repo/src/app.ts?x=1#h",
        "./src/components/Button.tsx",
        '"a/\\303\\251.txt"',
      ]
      for (const input of inputs) {
        const once = canonical(input, "D:\\repo")
        const twice = canonical(once, "D:\\repo")
        expect(twice).toBe(once)
      }
    })
  })

  describe("edge cases", () => {
    test("empty input is empty output", () => {
      expect(canonical("", "D:\\repo")).toBe("")
    })

    test("already-canonical input is unchanged", () => {
      expect(canonical("src/app.ts", "D:\\repo")).toBe("src/app.ts")
    })

    test("root equals input", () => {
      expect(canonical("D:\\repo", "D:\\repo")).toBe("")
    })
  })
})
