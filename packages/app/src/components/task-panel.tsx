// FORK: ADR-0005 Phase 4 — Task runner panel (Build/Test/Debug).
// Detects available commands from package.json, Cargo.toml, and Makefile in the
// project directory. Each "Run" button creates a new PTY pre-wired to the
// selected command (via terminal.newWithCommand) and opens the terminal panel.
// FORK: Phase 4 stretch — problem matchers: Analyse button polls /pty/:id/tail.
import { createResource, createSignal, For, Show } from "solid-js"
import { useSDK } from "@/context/sdk"

type TaskKind = "npm" | "cargo" | "make"
export type DetectedTask = { name: string; command: string; kind: TaskKind }

function kindLabel(kind: TaskKind) {
  if (kind === "npm") return "npm"
  if (kind === "cargo") return "cargo"
  return "make"
}

function kindClass(kind: TaskKind) {
  if (kind === "npm") return "text-[#cb3837] dark:text-[#f5655b]"
  if (kind === "cargo") return "text-[#dea584] dark:text-[#e8a87c]"
  return "text-text-weak"
}

async function parseNpmTasks(content: string): Promise<DetectedTask[]> {
  try {
    const pkg = JSON.parse(content) as Record<string, unknown>
    const scripts = pkg.scripts
    if (typeof scripts !== "object" || !scripts) return []
    return Object.entries(scripts as Record<string, string>)
      .filter(([, v]) => typeof v === "string")
      .map(([name]) => ({ name, command: `npm run ${name}`, kind: "npm" as const }))
  } catch {
    return []
  }
}

function cargoTasks(): DetectedTask[] {
  return [
    { name: "build", command: "cargo build", kind: "cargo" },
    { name: "test", command: "cargo test", kind: "cargo" },
    { name: "clippy", command: "cargo clippy --all-targets -- -D warnings", kind: "cargo" },
    { name: "run", command: "cargo run", kind: "cargo" },
  ]
}

function parseMakeTasks(content: string): DetectedTask[] {
  return content
    .split("\n")
    .filter((line) => /^[a-zA-Z0-9_][a-zA-Z0-9_-]*\s*:(?!=)/.test(line))
    .map((line) => line.split(":")[0]!.trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((name) => ({ name, command: `make ${name}`, kind: "make" as const }))
}

// ─── Problem matcher ─────────────────────────────────────────────────────────

export type Problem = {
  severity: "error" | "warning"
  file: string
  line: number
  col: number
  message: string
}

// Rust: "  --> src/main.rs:10:5"
const RUST_RE = /^\s*-->\s*(.+?):(\d+):(\d+)/gm
// TypeScript / tsc: "foo.ts(10,5): error TS2345: ..."
const TS_RE = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+TS\d+:\s+(.+)/gm
// GCC/Clang: "file.c:10:5: error: ..."
const GCC_RE = /^(.+?):(\d+):(\d+):\s+(error|warning):\s+(.+)/gm

function parseProblems(text: string): Problem[] {
  const problems: Problem[] = []
  const seen = new Set<string>()

  const add = (severity: "error" | "warning", file: string, line: number, col: number, message: string) => {
    const key = `${file}:${line}:${col}:${message.slice(0, 40)}`
    if (seen.has(key)) return
    seen.add(key)
    problems.push({ severity, file, line, col, message: message.trim() })
  }

  let m: RegExpExecArray | null
  // Rust: previous line holds the "error[E0xxx]: message"
  const lines = text.split("\n")
  const linesBefore = new Map<number, string>()
  for (let i = 0; i < lines.length; i++) linesBefore.set(i, lines[i] ?? "")
  RUST_RE.lastIndex = 0
  while ((m = RUST_RE.exec(text)) !== null) {
    const lineIdx = text.slice(0, m.index).split("\n").length - 1
    const msgLine = linesBefore.get(lineIdx - 1) ?? ""
    const sev = /^error/.test(msgLine.trim()) ? "error" : "warning"
    const msg = msgLine.replace(/^(error|warning)(\[E\d+\])?:\s*/, "").trim() || msgLine.trim()
    add(sev, m[1]!, parseInt(m[2]!, 10), parseInt(m[3]!, 10), msg)
  }

  TS_RE.lastIndex = 0
  while ((m = TS_RE.exec(text)) !== null) {
    add(m[4] as "error" | "warning", m[1]!, parseInt(m[2]!, 10), parseInt(m[3]!, 10), m[5]!)
  }

  GCC_RE.lastIndex = 0
  while ((m = GCC_RE.exec(text)) !== null) {
    if (!m[1]!.includes("-->")) {
      add(m[4] as "error" | "warning", m[1]!, parseInt(m[2]!, 10), parseInt(m[3]!, 10), m[5]!)
    }
  }

  return problems.slice(0, 200)
}

function basename(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() ?? path
}

// ─── Test explorer ────────────────────────────────────────────────────────────

export type TestResult = { name: string; status: "pass" | "fail" | "ignore" }
export type TestSummary = { total: number; passed: number; failed: number; ignored: number }

// cargo test: "test module::name ... ok|FAILED|ignored"
const CARGO_TEST_RE = /^test\s+(.+?)\s+\.\.\.\s+(ok|FAILED|ignored)\s*$/gm
// cargo summary: "test result: ok. 5 passed; 1 failed; 0 ignored"
const CARGO_SUMMARY_RE = /^test result:\s+(?:ok|FAILED)\.\s+(\d+) passed;\s+(\d+) failed;\s+(\d+) ignored/m
// Jest/Vitest summary: "Tests: 1 failed, 4 passed, 5 total" or "Tests  3 passed | 1 failed (4)"
const JEST_SUMMARY_RE = /^Tests?(?:\s*:|\s{2,})(.+)/m
// Jest PASS/FAIL file line: "PASS src/foo.test.ts" / "FAIL src/bar.test.ts"
const JEST_FILE_RE = /^(PASS|FAIL)\s+(.+\.(?:test|spec)\.[jt]sx?)/gm
// Vitest ✓/× individual: "  ✓ test name" / "  × failing"
const VITEST_TEST_RE = /^\s+([✓×✗])\s+(.+)/gm
// Bun test: "(pass) name" / "(fail) name"
const BUN_TEST_RE = /^\((pass|fail)\)\s+(.+)/gm

function parseTests(text: string): { results: TestResult[]; summary: TestSummary | null } {
  const results: TestResult[] = []

  // cargo test — most explicit format
  let m: RegExpExecArray | null
  CARGO_TEST_RE.lastIndex = 0
  while ((m = CARGO_TEST_RE.exec(text)) !== null) {
    const status = m[2] === "ok" ? "pass" : m[2] === "ignored" ? "ignore" : "fail"
    results.push({ name: m[1]!, status })
  }

  // Vitest / Jest individual lines
  if (results.length === 0) {
    VITEST_TEST_RE.lastIndex = 0
    while ((m = VITEST_TEST_RE.exec(text)) !== null) {
      const status = m[1] === "✓" ? "pass" : "fail"
      results.push({ name: m[2]!.trim(), status })
    }
  }

  // Bun
  if (results.length === 0) {
    BUN_TEST_RE.lastIndex = 0
    while ((m = BUN_TEST_RE.exec(text)) !== null) {
      results.push({ name: m[2]!.trim(), status: m[1] === "pass" ? "pass" : "fail" })
    }
  }

  // Jest PASS/FAIL file-level fallback
  if (results.length === 0) {
    JEST_FILE_RE.lastIndex = 0
    while ((m = JEST_FILE_RE.exec(text)) !== null) {
      results.push({ name: basename(m[2]!), status: m[1] === "PASS" ? "pass" : "fail" })
    }
  }

  // Build summary
  let summary: TestSummary | null = null

  const cargoM = CARGO_SUMMARY_RE.exec(text)
  if (cargoM) {
    const passed = parseInt(cargoM[1]!, 10)
    const failed = parseInt(cargoM[2]!, 10)
    const ignored = parseInt(cargoM[3]!, 10)
    summary = { total: passed + failed + ignored, passed, failed, ignored }
  } else {
    const jestM = JEST_SUMMARY_RE.exec(text)
    if (jestM) {
      const line = jestM[1]!
      const passed = parseInt(line.match(/(\d+)\s+passed/)?.[1] ?? "0", 10)
      const failed = parseInt(line.match(/(\d+)\s+failed/)?.[1] ?? "0", 10)
      const skipped = parseInt(line.match(/(\d+)\s+(?:skipped|pending)/)?.[1] ?? "0", 10)
      if (passed + failed > 0) summary = { total: passed + failed + skipped, passed, failed, ignored: skipped }
    }
  }

  return { results: results.slice(0, 500), summary }
}

// ─── Main component ──────────────────────────────────────────────────────────

export function TaskPanel(props: {
  directory: string
  onRunTask: (command: string, title: string) => string
}) {
  const sdk = useSDK()
  const [lastPtyId, setLastPtyId] = createSignal<string | null>(null)
  const [problems, setProblems] = createSignal<Problem[]>([])
  const [testResults, setTestResults] = createSignal<TestResult[]>([])
  const [testSummary, setTestSummary] = createSignal<TestSummary | null>(null)
  const [analysing, setAnalysing] = createSignal(false)
  const [showAllTests, setShowAllTests] = createSignal(false)

  async function analyseProblems() {
    const id = lastPtyId()
    if (!id) return
    setAnalysing(true)
    try {
      const res = await fetch(`${sdk.url}/pty/${encodeURIComponent(id)}/tail`)
      if (res.ok) {
        const body = (await res.json()) as { text: string }
        setProblems(parseProblems(body.text))
        const { results, summary } = parseTests(body.text)
        setTestResults(results)
        setTestSummary(summary)
      }
    } catch {
      // network error — silently ignore
    } finally {
      setAnalysing(false)
    }
  }

  const [tasks] = createResource(
    () => props.directory,
    async (dir) => {
      const sep = dir.includes("\\") ? "\\" : "/"
      const join = (name: string) => dir.replace(/[/\\]+$/, "") + sep + name

      const readContent = async (filename: string): Promise<string | undefined> => {
        try {
          const result = await sdk.client.file.read({ path: join(filename) })
          return result.data?.content
        } catch {
          return undefined
        }
      }

      const [pkgJson, cargoToml, makefile] = await Promise.all([
        readContent("package.json"),
        readContent("Cargo.toml"),
        readContent("Makefile"),
      ])

      const all: DetectedTask[] = []
      if (pkgJson) all.push(...(await parseNpmTasks(pkgJson)))
      if (cargoToml) all.push(...cargoTasks())
      if (makefile) all.push(...parseMakeTasks(makefile))
      return all
    },
  )

  const errCount = () => problems().filter((p) => p.severity === "error").length
  const warnCount = () => problems().filter((p) => p.severity === "warning").length

  return (
    <div class="flex flex-col h-full overflow-y-auto">
      <Show when={tasks.loading}>
        <div class="text-text-weak text-12-regular px-3 py-2">Détection…</div>
      </Show>

      <Show when={!tasks.loading && (tasks()?.length ?? 0) === 0 && !tasks.error}>
        <div class="text-text-weak text-12-regular px-4 py-6 text-center leading-relaxed">
          Aucune tâche détectée.
          <br />
          <span class="text-11-regular opacity-70">
            Ajoute un package.json, Cargo.toml ou Makefile.
          </span>
        </div>
      </Show>

      <For each={tasks()}>
        {(task) => (
          <div class="flex items-center gap-2 px-3 py-1.5 hover:bg-surface-base group cursor-default">
            <span
              class={`text-10-regular font-medium uppercase tracking-wide shrink-0 w-10 ${kindClass(task.kind)}`}
            >
              {kindLabel(task.kind)}
            </span>
            <span class="text-12-regular text-text-base flex-1 truncate">{task.name}</span>
            <button
              type="button"
              onClick={() => {
                const id = props.onRunTask(task.command, `${kindLabel(task.kind)}: ${task.name}`)
                setLastPtyId(id)
                setProblems([])
              }}
              class="text-10-regular text-text-weak hover:text-text-base opacity-0 group-hover:opacity-100 transition-opacity px-1.5 py-0.5 rounded border border-transparent hover:border-border-weak-base shrink-0"
              title={task.command}
            >
              ▶
            </button>
          </div>
        )}
      </For>

      {/* Analyse toolbar + results */}
      <Show when={lastPtyId()}>
        <div class="border-t border-border-weak-base mt-1 pt-1">

          {/* Toolbar row */}
          <div class="flex items-center gap-2 px-3 py-1.5 flex-wrap">
            <button
              type="button"
              disabled={analysing()}
              onClick={analyseProblems}
              class="text-10-regular text-text-weak hover:text-text-base px-1.5 py-0.5 rounded border border-border-weak-base hover:border-border-base transition-colors disabled:opacity-40 shrink-0"
            >
              {analysing() ? "…" : "Analyser"}
            </button>

            {/* Problem badges */}
            <Show when={problems().length > 0}>
              <span class="text-11-regular text-[#ef4444]">{errCount()} erreur{errCount() !== 1 ? "s" : ""}</span>
              <Show when={warnCount() > 0}>
                <span class="text-11-regular text-[#f59e0b]">{warnCount()} avert.</span>
              </Show>
            </Show>

            {/* Test summary badge */}
            <Show when={testSummary()}>
              <span class="text-11-regular text-text-weaker">·</span>
              <Show
                when={(testSummary()?.failed ?? 0) === 0}
                fallback={
                  <span class="text-11-regular text-[#ef4444]">
                    {testSummary()!.failed} échec{testSummary()!.failed !== 1 ? "s" : ""} / {testSummary()!.total}
                  </span>
                }
              >
                <span class="text-11-regular text-[#22c55e]">
                  {testSummary()!.passed}/{testSummary()!.total} tests ok
                </span>
              </Show>
            </Show>

            <Show when={!analysing() && problems().length === 0 && testResults().length === 0 && lastPtyId()}>
              <span class="text-11-regular text-text-weaker">Aucun résultat</span>
            </Show>
          </div>

          {/* Problems list */}
          <Show when={problems().length > 0}>
            <div class="flex flex-col pb-1">
              <For each={problems()}>
                {(p) => (
                  <div class="flex items-start gap-2 px-3 py-1 hover:bg-surface-base">
                    <span
                      class={`text-10-regular font-mono shrink-0 mt-0.5 ${p.severity === "error" ? "text-[#ef4444]" : "text-[#f59e0b]"}`}
                    >
                      {p.severity === "error" ? "E" : "W"}
                    </span>
                    <div class="flex flex-col min-w-0">
                      <span class="text-11-regular text-text-base leading-snug truncate">{p.message}</span>
                      <span class="text-10-regular text-text-weaker font-mono">
                        {basename(p.file)}:{p.line}:{p.col}
                      </span>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>

          {/* Tests list */}
          <Show when={testResults().length > 0}>
            <div class="flex flex-col pb-2">
              {/* Show failed first, then optionally all */}
              <For each={showAllTests() ? testResults() : testResults().filter((t) => t.status === "fail")}>
                {(t) => (
                  <div class="flex items-center gap-2 px-3 py-0.5 hover:bg-surface-base">
                    <span
                      class={`text-10-regular font-mono shrink-0 ${
                        t.status === "pass"
                          ? "text-[#22c55e]"
                          : t.status === "ignore"
                            ? "text-text-weaker"
                            : "text-[#ef4444]"
                      }`}
                    >
                      {t.status === "pass" ? "✓" : t.status === "ignore" ? "–" : "✗"}
                    </span>
                    <span class="text-11-regular text-text-base truncate font-mono">{t.name}</span>
                  </div>
                )}
              </For>

              <Show when={testResults().filter((t) => t.status !== "fail").length > 0}>
                <button
                  type="button"
                  onClick={() => setShowAllTests((v) => !v)}
                  class="text-10-regular text-text-weaker hover:text-text-base px-3 py-0.5 text-left"
                >
                  {showAllTests()
                    ? "Masquer les succès"
                    : `Voir tous (${testResults().length})`}
                </button>
              </Show>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  )
}
