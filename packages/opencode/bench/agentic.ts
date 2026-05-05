#!/usr/bin/env bun
/**
 * Agentic coding benchmark — OpenCode local models.
 *
 * Runs 5 real coding tasks per model and collects:
 *   success    — task verified correct (output/file checked)
 *   toolCalls  — total tool calls completed or errored
 *   toolErrors — failed tool calls
 *   loops      — doom loop text parts detected
 *   tokensIn / tokensOut / tokensReasoning
 *   wallSec    — wall clock seconds
 *   steps      — number of LLM turns (step-finish events)
 *
 * Usage:
 *   bun run bench/agentic.ts
 *   bun run bench/agentic.ts --model Qwen3.5-4B-Q4_K_M
 *   bun run bench/agentic.ts --model Qwen3.5-9B-Q4_K_M --runs 2
 *   bun run bench/agentic.ts --task create-function
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { mkdtempSync, writeFileSync, existsSync, readFileSync, mkdirSync, readdirSync, rmSync } from "node:fs"
import { tmpdir, homedir, platform } from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"

// ── Paths ──────────────────────────────────────────────────────────────────────

// Port 18770 — port dédié benchmark, évite tout conflit avec OpenCode desktop (14097).
// Le providerID "local-llm" est ce qui déclenche PROMPT_LOCAL (~545 tok), pas le port.
// Le baseURL dans le workspace config pointe vers ce port → CLI se connecte correctement.
// ✅ OpenCode desktop peut rester ouvert pendant les benchmarks.
const BENCH_PORT = 18770

const MODEL_DIR =
  process.env.OPENCODE_LLAMA_MODELS_DIR ??
  (() => {
    const appdata = process.env.APPDATA ?? path.join(homedir(), "AppData", "Roaming")
    for (const n of ["ai.opencode.desktop.dev", "ai.opencode.desktop"]) {
      const d = path.join(appdata, n, "models")
      if (existsSync(d)) return d
    }
    return path.join(homedir(), ".opencode", "models")
  })()

const RUNTIME_DIR =
  process.env.OPENCODE_LLAMA_RUNTIME_DIR ??
  (() => {
    const appdata = process.env.APPDATA ?? path.join(homedir(), "AppData", "Roaming")
    for (const n of ["ai.opencode.desktop.dev", "ai.opencode.desktop"]) {
      const d = path.join(appdata, n, "llama-runtime")
      const exe = path.join(d, platform() === "win32" ? "llama-server.exe" : "llama-server")
      if (existsSync(exe)) return d
    }
    return ""
  })()

const LLAMA_SERVER = path.join(RUNTIME_DIR, platform() === "win32" ? "llama-server.exe" : "llama-server")

const CLI = (() => {
  const candidates = [
    path.join(import.meta.dir, "..", "dist", "opencode-windows-x64", "bin", "opencode.exe"),
    path.join(import.meta.dir, "..", "dist", "opencode-windows-x64", "bin", "opencode"),
    path.join(import.meta.dir, "..", "..", "desktop", "src-tauri", "sidecars", "opencode-cli-x86_64-pc-windows-msvc.exe"),
  ]
  for (const c of candidates) if (existsSync(c)) return c
  return "opencode"
})()

// Workspace opencode.json injecté dans chaque tmpdir de benchmark.
//
// On enregistre le modèle sous providerID "local-llm" (pas un ID custom) pour
// déclencher toute la logique d'adaptation locale d'OpenCode :
//   - system.ts:34  → PROMPT_LOCAL (~545 tok) au lieu de PROMPT_DEFAULT (14 700 tok)
//   - system.ts:40  → environment bloc court (1 ligne)
//   - system.ts:73  → skills skippées (~800 tok économisés)
//   - registry.ts   → LOCAL_TOOLS subset (tool definitions allégées)
//   - llm.ts:342    → adaptive limits depuis /props llama-server
//
// "permission": "allow" : obligatoire en mode non-TTY pour que Write/Edit/Bash
// ne soient pas auto-rejectés.
const WORKSPACE_CONFIG = (modelID: string) => {
  // Fix 1a désactive la suppression du thinking pour Qwen (capabilities.reasoning=undefined).
  // En bench, on force reasoning:false pour éviter les chaînes de thinking infinies (~5000 tok)
  // qui empêchent tout appel d'outil dans les 300s imparties.
  const suppressReasoning = /qwen/i.test(modelID)
  return JSON.stringify({
    provider: {
      "local-llm": {
        options: { baseURL: `http://127.0.0.1:${BENCH_PORT}/v1`, apiKey: "none" },
        models: {
          [modelID]: {
            limit: { context: 32768, output: 8192 },
            ...(suppressReasoning ? { capabilities: { reasoning: false } } : {}),
          },
        },
      },
    },
    permission: "allow",
  }, null, 2)
}

// ── Task definitions ──────────────────────────────────────────────────────────

interface Task {
  id: string
  description: string
  setup?: (dir: string) => void
  prompt: string
  verify: (dir: string) => boolean
}

const TASKS: Task[] = [
  {
    id: "create-function",
    description: "Create a TS file with two exported functions",
    prompt: 'Use the Write tool to create the file "./math.ts" (relative path, in the current working directory) with two exported functions: add(a: number, b: number): number and multiply(a: number, b: number): number.',
    verify: (dir) => {
      const f = path.join(dir, "math.ts")
      if (!existsSync(f)) return false
      const c = readFileSync(f, "utf8")
      return c.includes("add") && c.includes("multiply") && c.includes("export")
    },
  },
  {
    id: "read-and-modify",
    description: "Read an existing file and add a function",
    setup: (dir) => {
      writeFileSync(path.join(dir, "utils.ts"), `export function greet(name: string): string {\n  return \`Hello, \${name}!\`\n}\n`)
    },
    prompt: 'Read the file "./utils.ts" with the Read tool. Then use the Edit tool to add a new exported function farewell(name: string): string that returns "Goodbye, {name}!". Keep the existing greet function intact.',
    verify: (dir) => {
      const f = path.join(dir, "utils.ts")
      if (!existsSync(f)) return false
      const c = readFileSync(f, "utf8")
      return c.includes("greet") && c.includes("farewell") && c.includes("Goodbye")
    },
  },
  {
    id: "bash-run",
    description: "Write and run a script, verify output",
    prompt: 'Write a file "./fib.ts" (in current directory) that computes fibonacci(10) with an iterative loop and console.log the result (answer = 55). Then run it with bash: "bun run ./fib.ts". Confirm the output contains 55.',
    verify: (dir) => {
      const f = path.join(dir, "fib.ts")
      if (!existsSync(f)) return false
      const { out, ok } = runBun(["run", f], dir)
      return ok && out.includes("55")
    },
  },
  {
    id: "fix-bug",
    description: "Read broken code and fix an edge-case bug",
    setup: (dir) => {
      writeFileSync(path.join(dir, "broken.ts"), `// factorial — buggy: infinite recursion on negative input
export function factorial(n: number): number {
  if (n === 0) return 1
  return n * factorial(n - 1)
}
console.log(factorial(5))
`)
    },
    prompt: 'Read "./broken.ts". The factorial function crashes on negative inputs (infinite recursion). Fix it: add a guard that returns 0 when n < 0. Then run "bun run ./broken.ts" and confirm it prints 120.',
    verify: (dir) => {
      const f = path.join(dir, "broken.ts")
      if (!existsSync(f)) return false
      const content = readFileSync(f, "utf8")
      // File must contain a negative-input guard (the original file has none)
      if (!content.includes("n < 0") && !content.includes("< 0")) return false
      // Run the file directly — factorial(5) must print 120, exit 0
      const { out, ok } = runBun(["run", f], dir, 8000)
      return ok && out.includes("120")
    },
  },
  {
    id: "multi-file",
    description: "Create a coherent two-file project",
    prompt: 'Create two files in the current directory:\n1. "./geometry.ts" — exports interface Point { x: number; y: number } and function distance(a: Point, b: Point): number (Euclidean distance).\n2. "./main.ts" — imports from "./geometry.ts", computes distance({x:0,y:0}, {x:3,y:4}), logs the result (answer: 5).\nThen run "bun run ./main.ts" and confirm output contains 5.',
    verify: (dir) => {
      const geoFile  = path.join(dir, "geometry.ts")
      const mainFile = path.join(dir, "main.ts")
      if (!existsSync(geoFile) || !existsSync(mainFile)) return false
      // Content sanity: geometry must export distance, main must import it
      const geoContent  = readFileSync(geoFile, "utf8")
      const mainContent = readFileSync(mainFile, "utf8")
      if (!geoContent.includes("distance") || !mainContent.includes("distance")) return false
      // Run main.ts — must output "5"
      const { out, ok } = runBun(["run", mainFile], dir, 15000)
      return ok && /\b5\b/.test(out)
    },
  },
]

// ── Verify helpers ────────────────────────────────────────────────────────────

// Retry spawnSync up to 3 times (1s gap) to absorb sporadic Windows file-system
// latency (file watcher, antivirus scan) that causes transient empty output.
function runBun(args: string[], cwd: string, timeout = 12000): { out: string; ok: boolean } {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) Bun.sleepSync(1000)
    try {
      const r = spawnSync("bun", args, { cwd, encoding: "utf8", timeout })
      const out = String(r.stdout ?? "") + String(r.stderr ?? "")
      if (r.status === 0 && out.trim().length > 0) return { out, ok: true }
    } catch {}
  }
  return { out: "", ok: false }
}

// ── Metrics types ─────────────────────────────────────────────────────────────

interface TaskResult {
  taskID: string
  model: string
  success: boolean
  toolCalls: number
  toolErrors: number
  loops: number
  tokensIn: number
  tokensOut: number
  tokensReasoning: number
  wallSec: number
  steps: number
  error?: string
}

// ── llama-server lifecycle ────────────────────────────────────────────────────

// Budget de thinking adaptatif par famille de modèle.
// Gemma-4 : 512 tokens suffit (thinking concis) — au-delà il génère du texte au lieu d'outils.
// Qwen3.5 : 0 = ferme <think> immédiatement → le modèle passe directement au tool call.
//   Pourquoi 0 et non 2048 : avec 2048, le modèle pense 85s puis génère du texte ~215s (>300s).
//   Pourquoi 0 et non --reasoning off : off supprime le template thinking → génère du texte.
//   Avec budget=0, <think></think> est vide → le modèle passe directement aux outils (comportement pré-Fix1a).
function reasoningBudget(modelID: string): number {
  if (/gemma/i.test(modelID)) return 512
  if (/qwen/i.test(modelID)) return 0
  return 256  // default conservateur
}

async function startLlamaServer(modelPath: string, modelID: string): Promise<ChildProcess> {
  const child = spawn(LLAMA_SERVER, [
    "--model", modelPath,
    "--port", String(BENCH_PORT),
    "--host", "127.0.0.1",
    "--n-gpu-layers", "99",
    "--ctx-size", "32768",
    "--flash-attn", "on",       // accélère l'attention, requis pour Gemma-4-E2B
    "--cache-type-k", "q8_0",  // 8-bit KV : safe universellement (head_dim quelconque), 2× moins VRAM que f16
    "--cache-type-v", "q8_0",  // q4_0 corrompt thinking Qwen3.5 ; turbo3 incompatible head_dim>128 (Gemma-4-E2B)
    // Qwen : budget 0 = ferme <think> immédiatement → force tool call direct
    //         (--reasoning off supprime le template thinking → génère du texte au lieu d'outils)
    // Gemma : budget 512 (au-delà il génère du texte au lieu d'outils)
    "--reasoning-budget", String(reasoningBudget(modelID)),
    "-np", "1",
    "--temp", "0",            // greedy decoding — déterministe, reproductible
    "--log-disable",
  ], { stdio: ["ignore", "pipe", "pipe"] })

  child.stderr?.on("data", () => {})
  child.stdout?.on("data", () => {})

  const t0 = Date.now()
  while (Date.now() - t0 < 90_000) {
    try {
      const r = await fetch(`http://127.0.0.1:${BENCH_PORT}/health`, { signal: AbortSignal.timeout(500) })
      if (r.ok) return child
    } catch {}
    await new Promise(r => setTimeout(r, 400))
  }
  child.kill()
  throw new Error(`llama-server did not start within 90s for ${modelPath}`)
}

async function stopLlamaServer(child: ChildProcess) {
  child.kill("SIGTERM")
  await new Promise(r => setTimeout(r, 1000))
  if (!child.killed) child.kill("SIGKILL")
}

async function isServerAlive(): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${BENCH_PORT}/health`, { signal: AbortSignal.timeout(2000) })
    return r.ok
  } catch { return false }
}

// ── Task runner ───────────────────────────────────────────────────────────────

async function runTask(task: Task, modelID: string, workDir: string): Promise<TaskResult> {
  task.setup?.(workDir)

  writeFileSync(path.join(workDir, "opencode.json"), WORKSPACE_CONFIG(modelID))

  const t0 = performance.now()
  const metrics: TaskResult = {
    taskID: task.id, model: modelID, success: false,
    toolCalls: 0, toolErrors: 0, loops: 0,
    tokensIn: 0, tokensOut: 0, tokensReasoning: 0,
    wallSec: 0, steps: 0,
  }

  try {
    // stdin: "ignore" is critical — forces non-TTY mode so CLI doesn't wait for input
    // OPENCODE_LLAMA_PORT: redirige toute la logique local-llm (ensureRunning, /props, etc.)
    // vers le port du benchmark — évite tout conflit avec l'app desktop sur 14097.
    const child = spawn(CLI, [
      "run", "--dir", workDir, "--model", `local-llm/${modelID}`,
      "--format", "json",
      task.prompt,
    ], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, OPENCODE_LLAMA_PORT: String(BENCH_PORT) },
    })

    let stdout = ""
    const rawLog: string[] = []

    child.stdout?.on("data", (chunk: Buffer) => {
      const s = chunk.toString()
      stdout += s
      rawLog.push(s)
    })
    child.stderr?.on("data", () => {})

    await new Promise<void>((resolve) => {
      const forceKill = () => {
        // child.kill() sur Windows envoie SIGTERM qui est souvent ignoré.
        // taskkill /F /T tue le process ET ses enfants de façon fiable.
        if (process.platform === "win32" && child.pid) {
          spawnSync("taskkill", ["/F", "/T", "/PID", String(child.pid)])
        } else {
          child.kill("SIGKILL")
        }
        resolve()
      }
      const timeout = setTimeout(forceKill, 300_000)
      child.on("exit", () => { clearTimeout(timeout); resolve() })
      child.on("error", () => { clearTimeout(timeout); resolve() })
    })

    // Parse JSON events
    // Event types from opencode run --format json:
    //   tool_use  — tool completed or errored  (part.state.status: completed|error)
    //   step_start / step_finish — LLM turn boundaries
    //   text      — final text part
    //   error     — session error
    for (const line of stdout.split("\n")) {
      const t = line.trim()
      if (!t.startsWith("{")) continue
      try {
        const ev = JSON.parse(t) as {
          type: string
          error?: { name?: string; data?: { message?: string } }
          part?: {
            type?: string
            tool?: string
            text?: string
            state?: { status?: string; error?: string }
            tokens?: { input?: number; output?: number; reasoning?: number }
          }
        }

        if (ev.type === "error") {
          const msg = ev.error?.data?.message ?? ev.error?.name ?? "unknown error"
          metrics.error = msg
        }

        if (ev.type === "tool_use" && ev.part) {
          metrics.toolCalls++
          if (ev.part.state?.status === "error") metrics.toolErrors++
        }

        if (ev.type === "text" && ev.part?.text?.includes("Loop detected")) {
          metrics.loops++
        }

        if (ev.type === "step_finish" && ev.part?.tokens) {
          metrics.tokensIn += ev.part.tokens.input ?? 0
          metrics.tokensOut += ev.part.tokens.output ?? 0
          metrics.tokensReasoning += ev.part.tokens.reasoning ?? 0
          metrics.steps++
        }
      } catch {}
    }

    // Debug: save raw log per task
    const debugDir = path.join(import.meta.dir, "results", "debug")
    mkdirSync(debugDir, { recursive: true })
    const debugFile = path.join(debugDir, `${new Date().toISOString().slice(0, 10)}-${modelID}-${task.id}.jsonl`)
    writeFileSync(debugFile, rawLog.join(""))

  } catch (e: any) {
    metrics.error = e.message
  }

  metrics.wallSec = +((performance.now() - t0) / 1000).toFixed(2)
  metrics.success = task.verify(workDir)
  return metrics
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function findModelFile(modelID: string): string | null {
  if (!existsSync(MODEL_DIR)) return null
  const files = readdirSync(MODEL_DIR).filter(f => f.toLowerCase().endsWith(".gguf") && !f.includes("mmproj"))
  const lower = modelID.toLowerCase()
  let found = files.find(f => f.toLowerCase() === lower || f.toLowerCase() === lower + ".gguf")
  if (!found) {
    const QUANT = /[-_](q\d+(_[a-z0-9]+)*|iq\d+(_[a-z0-9]+)*|f16|fp16|bf16|f32)$/i
    found = files.find(f => f.replace(/\.gguf$/i, "").replace(QUANT, "").toLowerCase() === lower)
  }
  return found ? path.join(MODEL_DIR, found) : null
}

function discoverModels(): string[] {
  if (!existsSync(MODEL_DIR)) return []
  return readdirSync(MODEL_DIR)
    .filter(f => f.toLowerCase().endsWith(".gguf") && !f.includes("mmproj"))
    .map(f => f.replace(/\.gguf$/i, ""))
}

function parseArgs() {
  const argv = process.argv.slice(2)
  const out: { models?: string[]; tasks?: string[]; runs: number } = { runs: 1 }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--model" && argv[i + 1]) { out.models = [argv[++i]]; continue }
    if (argv[i] === "--task"  && argv[i + 1]) { out.tasks  = [argv[++i]]; continue }
    if (argv[i] === "--runs"  && argv[i + 1]) { out.runs   = parseInt(argv[++i], 10) || 1; continue }
  }
  return out
}

// ── Results display ───────────────────────────────────────────────────────────

function printTable(results: TaskResult[]) {
  const models = [...new Set(results.map(r => r.model))]
  const tasks  = [...new Set(results.map(r => r.taskID))]

  console.log("\n╔══════════════════════════════════════════════════════════════════╗")
  console.log("║  AGENTIC BENCHMARK RESULTS                                       ║")
  console.log("╠══════════════════════════════════════════════════════════════════╣")

  for (const model of models) {
    const mR    = results.filter(r => r.model === model)
    const pass  = mR.filter(r => r.success).length
    const total = mR.length
    const avgTok  = Math.round(mR.reduce((s, r) => s + r.tokensIn + r.tokensOut, 0) / total)
    const avgWall = (mR.reduce((s, r) => s + r.wallSec, 0) / total).toFixed(1)
    const loops   = mR.reduce((s, r) => s + r.loops, 0)
    const tc      = mR.reduce((s, r) => s + r.toolCalls, 0)
    const te      = mR.reduce((s, r) => s + r.toolErrors, 0)
    const acc     = tc > 0 ? Math.round((1 - te / tc) * 100) : 100

    console.log(`║  ${model.slice(0, 42).padEnd(42)}`)
    console.log(`║    Score: ${pass}/${total}  tool-acc: ${acc}%  loops: ${loops}  avg-tok: ${avgTok}  avg: ${avgWall}s`)

    for (const taskID of tasks) {
      const r = mR.find(x => x.taskID === taskID)
      if (!r) continue
      const icon    = r.success ? "✓" : "✗"
      const loopStr = r.loops > 0 ? ` loops:${r.loops}` : ""
      const errStr  = r.error  ? ` [${r.error.slice(0, 45)}]` : ""
      console.log(`║    ${icon} ${taskID.padEnd(22)}  tools:${r.toolCalls}/${r.toolErrors}err  steps:${r.steps}  ${r.wallSec}s${loopStr}${errStr}`)
    }
    console.log("║")
  }
  console.log("╚══════════════════════════════════════════════════════════════════╝")
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const { models: reqModels, tasks: reqTasks, runs } = parseArgs()

  const allModels = reqModels ?? discoverModels()
  const allTasks  = reqTasks ? TASKS.filter(t => reqTasks.includes(t.id)) : TASKS

  if (allModels.length === 0) { console.error(`[bench] No models in ${MODEL_DIR}`); process.exit(1) }
  if (!existsSync(LLAMA_SERVER)) { console.error(`[bench] llama-server not found: ${LLAMA_SERVER}`); process.exit(1) }
  if (!existsSync(CLI))          { console.error(`[bench] CLI not found: ${CLI}`); process.exit(1) }

  // Vérifier que le port bench est libre (conflit desktop ou run précédent)
  try {
    const health = await fetch(`http://127.0.0.1:${BENCH_PORT}/health`, { signal: AbortSignal.timeout(500) })
    if (health.ok) {
      console.error(`[bench] ⚠ Port ${BENCH_PORT} already in use — kill the existing server first.`)
      console.error(`[bench]   Run: taskkill /F /IM llama-server.exe`)
      process.exit(1)
    }
  } catch {} // port libre → OK

  console.log(`[bench] CLI:        ${CLI}`)
  console.log(`[bench] Runtime:    ${RUNTIME_DIR}`)
  console.log(`[bench] Models dir: ${MODEL_DIR}`)
  console.log(`[bench] Models:     ${allModels.join(", ")}`)
  console.log(`[bench] Tasks:      ${allTasks.map(t => t.id).join(", ")}`)
  console.log(`[bench] Runs:       ${runs}`)

  const allResults: TaskResult[] = []
  const ts          = new Date().toISOString().slice(0, 10)
  const resultsFile = path.join(import.meta.dir, "results", `${ts}-agentic.jsonl`)
  mkdirSync(path.dirname(resultsFile), { recursive: true })

  for (const modelID of allModels) {
    const modelPath = findModelFile(modelID)
    if (!modelPath) { console.error(`[bench] Model file not found for ${modelID}, skipping`); continue }

    console.log(`\n[bench] === ${modelID} ===`)
    console.log(`[bench] Starting llama-server on port ${BENCH_PORT}...`)

    let server: ChildProcess | null = null
    try {
      server = await startLlamaServer(modelPath, modelID)
      console.log(`[bench] Server ready`)

      for (let run = 0; run < runs; run++) {
        if (runs > 1) console.log(`[bench] Run ${run + 1}/${runs}`)
        for (const task of allTasks) {
          // Health check — restart if server died between tasks
          if (!await isServerAlive()) {
            console.log(`\n[bench] Server down, restarting...`)
            try { await stopLlamaServer(server!) } catch {}
            server = await startLlamaServer(modelPath, modelID)
            console.log(`[bench] Server restarted`)
          }

          const workDir = mkdtempSync(path.join(tmpdir(), "opencode-bench-"))
          try {
            process.stdout.write(`[bench] ${task.id}... `)
            const result = await runTask(task, modelID, workDir)
            allResults.push(result)

            const icon    = result.success ? "✓" : "✗"
            const loopStr = result.loops > 0 ? ` [${result.loops} loops]` : ""
            const errStr  = result.error ? ` [${result.error.slice(0, 50)}]` : ""
            console.log(`${icon}  tools:${result.toolCalls}/${result.toolErrors}err  steps:${result.steps}  ${result.wallSec}s${loopStr}${errStr}`)

            writeFileSync(resultsFile, JSON.stringify(result) + "\n", { flag: "a" })
          } finally {
            // On Windows the OpenCode file-watcher can keep handles open;
            // swallow EBUSY and let the OS clean up on next boot.
            try { rmSync(workDir, { recursive: true, force: true }) } catch {}
          }
        }
      }
    } catch (e: any) {
      console.error(`[bench] Error with ${modelID}: ${e.message}`)
    } finally {
      if (server) await stopLlamaServer(server)
    }
  }

  printTable(allResults)
  console.log(`\n[bench] Full results: ${resultsFile}`)
}

main().catch(e => { console.error("[bench] fatal:", e); process.exit(1) })
