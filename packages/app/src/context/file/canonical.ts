// canonical.ts — single source of truth for file path canonicalization.
//
// WHY: the IDE bug (R2 in PLAN-EDITEUR-IDE-DEFINITIF) was that two stores keyed
// file content by two different "normalized" forms:
//   - viewer read-mode keys  → "src/app.ts"          (from tab URLs, `/` separator)
//   - watcher event keys     → "src\\app.ts"         (from native path, `\` on win32)
//
// Reading the same file through the same store required a STABLE key regardless
// of input shape: file://, query/hash, git-quoted octal, native separators,
// Windows drive letters, mixed `\` and `/`, leading `./` and `\\`.
//
// `canonical(raw, root?)` is the ONE function allowed to produce that key.
// Every other path helper (path.ts, watcher.ts, file-tree, operations) must
// funnel through it. Direct path manipulation outside this file is a bug.

export function stripFileProtocol(input: string): string {
  if (!input.startsWith("file://")) return input
  return input.slice("file://".length)
}

export function stripQueryAndHash(input: string): string {
  const hashIndex = input.indexOf("#")
  const queryIndex = input.indexOf("?")

  if (hashIndex !== -1 && queryIndex !== -1) {
    return input.slice(0, Math.min(hashIndex, queryIndex))
  }

  if (hashIndex !== -1) return input.slice(0, hashIndex)
  if (queryIndex !== -1) return input.slice(0, queryIndex)
  return input
}

export function unquoteGitPath(input: string): string {
  if (!input.startsWith('"')) return input
  if (!input.endsWith('"')) return input
  const body = input.slice(1, -1)
  const bytes: number[] = []

  for (let i = 0; i < body.length; i++) {
    const char = body[i]!
    if (char !== "\\") {
      bytes.push(char.charCodeAt(0))
      continue
    }

    const next = body[i + 1]
    if (!next) {
      bytes.push("\\".charCodeAt(0))
      continue
    }

    if (next >= "0" && next <= "7") {
      const chunk = body.slice(i + 1, i + 4)
      const match = chunk.match(/^[0-7]{1,3}/)
      if (!match) {
        bytes.push(next.charCodeAt(0))
        i++
        continue
      }
      bytes.push(parseInt(match[0], 8))
      i += match[0].length
      continue
    }

    const escaped =
      next === "n"
        ? "\n"
        : next === "r"
          ? "\r"
          : next === "t"
            ? "\t"
            : next === "b"
              ? "\b"
              : next === "f"
                ? "\f"
                : next === "v"
                  ? "\v"
                  : next === "\\" || next === '"'
                    ? next
                    : undefined

    bytes.push((escaped ?? next).charCodeAt(0))
    i++
  }

  return new TextDecoder().decode(new Uint8Array(bytes))
}

export function decodeFilePath(input: string): string {
  try {
    return decodeURIComponent(input)
  } catch {
    return input
  }
}

// canonical(raw, root?) → forward-slash, decoded, no protocol/query/hash, no git quoting.
//
// If `root` is given, the function strips a case-insensitive prefix when the
// input is inside `root` (Windows-aware: `D:\repo` and `d:/REPO` match) and
// returns the relative path. Otherwise it returns the absolute path with
// forward slashes.
//
// Invariants (enforced by canonical.test.ts):
//   1. `canonical(x) === canonical(y)` for any two forms of the same file path
//      (file://, query/hash, git-quoted, native/forward, case on win32).
//   2. Output never contains `\` (the source of R2's stale-cache bug).
//   3. Output never starts with `/`, `\\`, `./`, or `.\\` (clean relative form).
export function canonical(raw: string, root?: string): string {
  let path = unquoteGitPath(decodeFilePath(stripQueryAndHash(stripFileProtocol(raw))))

  if (root) {
    // Separator-agnostic, case-insensitive prefix match (Windows-aware).
    const windows = /^[A-Za-z]:/.test(root) || root.startsWith("\\\\")
    const canonRoot = root.replace(/\\/g, "/")
    const canonPath = path.replace(/\\/g, "/")
    const cmpRoot = windows ? canonRoot.toLowerCase() : canonRoot
    const cmpPath = windows ? canonPath.toLowerCase() : canonPath

    if (
      cmpPath.startsWith(cmpRoot) &&
      (cmpRoot.endsWith("/") || cmpPath === cmpRoot || cmpPath[cmpRoot.length] === "/")
    ) {
      path = path.slice(root.length)
    }
  }

  if (path.startsWith("./") || path.startsWith(".\\")) {
    path = path.slice(2)
  }

  if (path.startsWith("/") || path.startsWith("\\")) {
    path = path.slice(1)
  }

  return path.replace(/\\/g, "/")
}
