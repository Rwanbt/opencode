/* SPDX-License-Identifier: MIT */
import { expect, test } from "bun:test"
import { resolveGithubAttachmentUrl } from "../../src/cli/cmd/github-run"

// The fetch this feeds carries the GitHub App token, and its input is a URL
// lifted out of an issue comment — i.e. attacker-supplied. The two guards that
// matter are the literal host and the prefix check on the *normalised* path.

test("accepts a real user-attachments URL and keeps its path and query", () => {
  const resolved = resolveGithubAttachmentUrl("https://github.com/user-attachments/files/21433810/api.json?x=1")
  expect(resolved?.href).toBe("https://github.com/user-attachments/files/21433810/api.json?x=1")
})

test("refuses a path that normalises out of /user-attachments/", () => {
  // The caller's regex accepts this: it is literally prefixed with
  // https://github.com/user-attachments/. `new URL` resolves it to /settings,
  // which would have sent the app token to an unrelated github.com endpoint.
  expect(resolveGithubAttachmentUrl("https://github.com/user-attachments/../../settings/tokens")).toBeNull()
  expect(resolveGithubAttachmentUrl("https://github.com/user-attachments/..%2f..%2fsettings")?.pathname).toBe(
    "/user-attachments/..%2f..%2fsettings",
  )
})

test("never lets the host come from the input", () => {
  for (const raw of [
    "https://github.com//evil.example/user-attachments/x",
    "https://github.com:443//evil.example/user-attachments/x",
  ]) {
    // A pathname of //evil.example/... is what makes `new URL(pathname, base)`
    // the wrong way to rebuild this; the resolver must either refuse it or
    // keep github.com as the host.
    const resolved = resolveGithubAttachmentUrl(raw)
    if (resolved) expect(resolved.host).toBe("github.com")
  }
})

test("refuses anything that is not https://github.com", () => {
  for (const raw of [
    "http://github.com/user-attachments/assets/x",
    "https://evil.example/user-attachments/assets/x",
    "https://github.com.evil.example/user-attachments/assets/x",
    "https://user:pass@evil.example/user-attachments/assets/x",
    "file:///etc/passwd",
    "not a url",
  ]) {
    expect({ raw, resolved: resolveGithubAttachmentUrl(raw) }).toEqual({ raw, resolved: null })
  }
})
