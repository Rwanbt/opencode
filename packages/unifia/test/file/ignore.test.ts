import { test, expect, describe } from "bun:test"
import { FileIgnore } from "../../src/file/ignore"

describe("FileIgnore.match (G10 — ignores/générés couverts)", () => {
  test("build artifacts and VCS folders are ignored at any depth", () => {
    // Folders in the FOLDERS set should match at any depth
    // because parcel's `ignore` patterns are rooted at the
    // watch directory. The match() function checks every path
    // segment against FOLDERS, so `src/node_modules/x` is also
    // caught even when nested.
    for (const folder of ["node_modules", "dist", "build", ".git", ".next", ".turbo", "__pycache__"]) {
      expect(FileIgnore.match(`${folder}/x`)).toBe(true)
      expect(FileIgnore.match(`src/${folder}/x`)).toBe(true)
      expect(FileIgnore.match(`a/b/c/${folder}/x`)).toBe(true)
    }
  })

  test("glob folder patterns (results-*) match at any depth", () => {
    expect(FileIgnore.match("results-2024/x.json")).toBe(true)
    expect(FileIgnore.match("ci/results-42/x.json")).toBe(true)
    // `results-` (hyphen only) is a glob match because `*`
    // matches the empty string — a quirk of the wildcard
    // syntax we accept to keep the patterns readable.
    expect(FileIgnore.match("src/results-")).toBe(true)
  })

  test("binary files and media are ignored", () => {
    for (const path of [
      "logo.png", "photo.jpg", "icon.webp", "font.woff2", "video.mp4",
      "lib/libfoo.so", "lib/libfoo.dylib", "lib/libfoo.dll",
      "package.tar.gz", "data.zip", "weights.gguf", "wasm/module.wasm",
    ]) {
      expect(FileIgnore.match(path)).toBe(true)
    }
  })

  test("lock files are ignored", () => {
    for (const path of [
      "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
      "bun.lockb", "bun.lock", "crates/Cargo.lock",
    ]) {
      expect(FileIgnore.match(path)).toBe(true)
    }
  })

  test("source maps and editor temp files are ignored", () => {
    expect(FileIgnore.match("dist/bundle.js.map")).toBe(true)
    expect(FileIgnore.match("a/.b.swp")).toBe(true)
    expect(FileIgnore.match(".DS_Store")).toBe(true)
    expect(FileIgnore.match("Thumbs.db")).toBe(true)
  })

  test("source files are NOT ignored", () => {
    for (const path of [
      "src/app.ts", "src/app.tsx", "src/component.tsx",
      "index.html", "package.json", "tsconfig.json",
      "Cargo.toml", "go.mod", "pyproject.toml", "Makefile",
    ]) {
      expect(FileIgnore.match(path)).toBe(false)
    }
  })

  test("whitelist takes precedence over the default ignore rules", () => {
    // A user who actually wants to watch a node_modules file
    // (e.g. to debug a transitive dependency) can opt in via
    // `whitelist` — the whitelist is checked first and a match
    // returns `false` (NOT ignored).
    expect(FileIgnore.match("node_modules/foo/index.js", { whitelist: ["node_modules/foo/**"] })).toBe(false)
  })

  test("extra patterns supplement the defaults", () => {
    // The defaults ignore dist/, but a project with a custom
    // build dir can add it via `extra`. The function is
    // additive, not a replacement.
    expect(FileIgnore.match("custom-build/x")).toBe(false)  // not ignored by default
    expect(FileIgnore.match("custom-build/x", { extra: ["custom-build/**"] })).toBe(true)
  })

  test("PATTERNS exposes the full set used by the watcher (sanity check, G10)", () => {
    // The watcher passes `FileIgnore.PATTERNS` to parcel. The
    // test pins the size so a silent edit to the FOLDERS or
    // FILES list is caught — a regression that removed
    // `node_modules` here would balloon the watched tree to
    // thousands of files.
    expect(FileIgnore.PATTERNS.length).toBeGreaterThan(50)
    expect(FileIgnore.PATTERNS).toContain("**/*.log")
    expect(FileIgnore.PATTERNS).toContain("node_modules")  // folder name (no `**/` prefix)
  })
})
