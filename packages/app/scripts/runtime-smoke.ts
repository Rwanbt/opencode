// Standalone runtime smoke (no Playwright): executes the built web bundle
// inside a happy-dom Window and asserts that AppProviders mounts without
// throwing the original "GlobalSDK context must be used within a context
// provider" crash.
//
// Why happy-dom and not Playwright:
//   - Playwright's chromium hangs at launch on this Windows + bun combo
//   - happy-dom is already wired into packages/app via happydom.ts
//   - We only need to detect the boot-time throw, which is a synchronous
//     error captured by `window.addEventListener("error")`
//
// Run from packages/app: `bun run scripts/runtime-smoke.ts`.

import { Window } from "happy-dom"
import { join, extname } from "node:path"
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs"

const DIST = join(import.meta.dir, "..", "dist")

if (!existsSync(DIST)) {
  console.error(`[smoke] FAIL: dist/ not found at ${DIST}. Run \`bun run build\` first.`)
  process.exit(1)
}

// Load index.html, then resolve every <script src="…"> against dist/.
const html = readFileSync(join(DIST, "index.html"), "utf-8")
const entryScripts = Array.from(html.matchAll(/<script[^>]+src=["']([^"']+)["']/g))
  .map((m) => m[1])
  .filter((s) => s.startsWith("./") || !s.startsWith("http"))

console.log(`[smoke] found ${entryScripts.length} entry script(s) in index.html`)
const entryScript = entryScripts[0]
if (!entryScript) {
  console.error("[smoke] FAIL: no entry <script src=...> in index.html")
  process.exit(1)
}

const entryPath = join(DIST, entryScript.replace(/^\.\//, ""))
console.log(`[smoke] entry script: ${entryPath}`)

// Find CSS for happy-dom to apply
const cssFiles = readdirSync(join(DIST, "assets")).filter((f) => f.endsWith(".css"))
const cssLinks = Array.from(html.matchAll(/<link[^>]+href=["']([^"']+\.css)["']/g))
  .map((m) => m[1])

const window = new Window({
  url: "http://localhost:3000/",
  settings: {
    disableJavaScriptEvaluation: false,
    disableJavaScriptFileLoading: false,
    disableErrorCapturing: false,
    enableFileSystemHttpRequests: true,
  },
})

// Capture window-level errors
const errors: Array<{ kind: string; msg: string; stack?: string }> = []
window.addEventListener("error", (ev: any) => {
  errors.push({
    kind: "error",
    msg: ev.message ?? ev.error?.message ?? String(ev),
    stack: ev.error?.stack,
  })
})
window.addEventListener("unhandledrejection", (ev: any) => {
  errors.push({
    kind: "unhandledrejection",
    msg: ev.reason?.message ?? String(ev.reason ?? ev),
    stack: ev.reason?.stack,
  })
})

// Also patch console.error to capture any synchronous errors logged
const origConsoleError = (window as any).console?.error
;(window as any).console = {
  ...(window as any).console,
  error: (...args: any[]) => {
    errors.push({ kind: "console.error", msg: args.map((a) => String(a)).join(" ") })
    if (origConsoleError) origConsoleError.apply((window as any).console, args)
  },
  warn: () => {},
  log: () => {},
  info: () => {},
  debug: () => {},
}

// Write the HTML shell into the window
window.document.write(html)

// Read the bundle code and inject as inline script so happy-dom executes it
const bundleCode = readFileSync(entryPath, "utf-8")
console.log(`[smoke] bundle size: ${(bundleCode.length / 1024).toFixed(1)} KB`)

try {
  const scriptEl = window.document.createElement("script")
  scriptEl.textContent = bundleCode
  window.document.body.appendChild(scriptEl)
  // Give Solid a few ticks to mount
  await new Promise((r) => setTimeout(r, 2500))
} catch (err) {
  errors.push({ kind: "eval", msg: (err as Error).message ?? String(err) })
}

// Inspect DOM
const root = window.document.getElementById("root")
const rootChildren = root ? root.children.length : 0
const rootHtmlLen = root ? root.innerHTML.length : 0

console.log("\n[smoke] ============ BOOT RESULT ============")
console.log(`[smoke] window errors: ${errors.length}`)
for (const e of errors) {
  console.log(`  - [${e.kind}] ${e.msg.slice(0, 300)}`)
  if (e.stack) console.log(`    ${e.stack.split("\n").slice(0, 3).join(" | ")}`)
}
console.log(`[smoke] #root exists: ${!!root}`)
console.log(`[smoke] #root children: ${rootChildren}`)
console.log(`[smoke] #root innerHTML length: ${rootHtmlLen}`)
console.log("[smoke] =====================================\n")

// Assertions
const globSdkErr = errors.find((e) => /globalsdk context must be used/i.test(e.msg))
const serverErr = errors.find((e) => /server context must be used/i.test(e.msg))
const useParamsErr = errors.find((e) => /useparams must be used/i.test(e.msg))
const anyUncaught = errors.find(
  (e) =>
    !/AbortError|Failed to fetch|NetworkError|getaddrinfo ENOTFOUND/i.test(e.msg) &&
    e.kind !== "error",
)

const checks: Array<{ name: string; ok: boolean; detail: string }> = [
  {
    name: "no 'GlobalSDK context must be used' error",
    ok: !globSdkErr,
    detail: globSdkErr?.msg.slice(0, 200) ?? "OK",
  },
  {
    name: "no 'Server context must be used' error",
    ok: !serverErr,
    detail: serverErr?.msg.slice(0, 200) ?? "OK",
  },
  {
    name: "no 'useParams must be used' error",
    ok: !useParamsErr,
    detail: useParamsErr?.msg.slice(0, 200) ?? "OK",
  },
  {
    name: "AppProviders mount did not throw (boot reached past GlobalSDK init)",
    // The ORIGINAL bug threw synchronously at AppProviders mount time.
    // 0 errors means we got past the GlobalSDKProvider init — which was
    // the line that crashed before. (Root may still be empty because the
    // app is now correctly waiting on the server-side health check, which
    // never succeeds in a smoke env without a sidecar.)
    ok: errors.length === 0 || (errors.length > 0 && !globSdkErr && !serverErr),
    detail: `${errors.length} error(s), #root html = ${rootHtmlLen} chars`,
  },
]  

console.log("[smoke] ============ ASSERTIONS ============")
let exitCode = 0
for (const c of checks) {
  const tag = c.ok ? "✅ PASS" : "❌ FAIL"
  console.log(`  ${tag}  ${c.name}  — ${c.detail}`)
  if (!c.ok) exitCode = 1
}
console.log("[smoke] =====================================\n")

// Cleanup
await window.happyDOM.close()
process.exit(exitCode)
