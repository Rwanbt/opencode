/* SPDX-License-Identifier: MIT */

import { describeGithubConnection } from "../src/design-github.js"
import { test } from "bun:test"

test('design-github.test', async () => {

let cases = 0
const check = (label: string, actual: unknown, expected: unknown) => {
  cases += 1
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label}: got ${JSON.stringify(actual)}`)
}

check("loading while the query is in flight", describeGithubConnection({ loading: true }), { kind: "loading" })
check("loading while no status has arrived", describeGithubConnection({}), { kind: "loading" })
check("error wins over a stale status", describeGithubConnection({ error: new Error("boom"), status: { connected: true, configured: true } }), { kind: "error" })
check("a null error is not an error", describeGithubConnection({ error: null, status: { connected: false, configured: true } }), { kind: "disconnected" })
check("unconfigured beats disconnected", describeGithubConnection({ status: { connected: false, configured: false } }), { kind: "unconfigured" })
check("disconnected when configured but not linked", describeGithubConnection({ status: { connected: false, configured: true } }), { kind: "disconnected" })
check("connected reports the login and profile", describeGithubConnection({ status: { connected: true, configured: true, identity: { login: "octocat", profileUrl: "https://github.com/octocat" } } }), { kind: "connected", login: "octocat", profileUrl: "https://github.com/octocat" })
check("connected without an identity stays connected", describeGithubConnection({ status: { connected: true, configured: true } }), { kind: "connected", login: "" })
check("connected without a profile url omits it", describeGithubConnection({ status: { connected: true, configured: true, identity: { login: "octocat", profileUrl: "" } } }), { kind: "connected", login: "octocat" })

console.log(`DesignGithub: ${cases}/${cases} passed`)
})
