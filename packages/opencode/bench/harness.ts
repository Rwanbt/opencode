#!/usr/bin/env bun
/**
 * Benchmark harness for the local llama-server.
 *
 * Measures four metrics per model/configuration:
 *   - FTL   (first token latency, ms)
 *   - TPS   (sustained tokens/sec over N predicted tokens)
 *   - RSS   (peak resident memory MB, sampled every 100ms)
 *   - Wall  (total elapsed seconds)
 *
 * Runs are reproducible: the prompt is constant, n_predict is pinned, and the
 * llama-server is freshly spawned per run so warm/cold caches are explicit.
 *
 * Output: JSON Lines on stdout, one object per run. Pipe to
 * `packages/opencode/bench/results/<date>-<sha>.jsonl` to archive.
 *
 * Usage:
 *   bun run bench:llm                       # default suite
 *   bun run bench:llm --model qwen3.5-4b    # single model
 *   bun run bench:llm --runs 5              # more iterations
 *
 * Not in CI by default — needs llama-server + GGUF weights on disk. Reference
 * thresholds documented in the audit plan §7.3.
 */
import { spawn, spawnSync } from "node:child_process"
import { performance } from "node:perf_hooks"
import { existsSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import os from "node:os"

interface Model {
  id: string
  path: string
}

interface RunResult {
  timestamp: string
  model: string
  modelSizeMb: number
  ftlMs: number | null
  tps: number | null
  peakRssMb: number
  wallSeconds: number
  nPredict: number
  prompt: string
  stderr?: string
  error?: string
}

const PROMPT =
  "Write a small fibonacci function in Rust that returns the nth term as a u64.\nAnnotate the signature, add one doc comment line, and include a single inline test.\n"
const DEFAULT_N_PREDICT = 256
const PORT = 18765

function parseArgs(): { models?: string[]; runs: number; nPredict: number; modelDir?: string } {
  const argv = process.argv.slice(2)
  const out: { models?: string[]; runs: number; nPredict: number; modelDir?: string } = {
    runs: 1,
    nPredict: DEFAULT_N_PREDICT,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--model" && argv[i + 1]) out.models = [argv[++i]]
    else if (a === "--runs" && argv[i + 1]) out.runs = parseInt(argv[++i], 10) || 1
    else if (a === "--n-predict" && argv[i + 1]) out.nPredict = parseInt(argv[++i], 10) || DEFAULT_N_PREDICT
    else if (a === "--model-dir" && argv[i + 1]) out.modelDir = argv[++i]
  }
  return out
}

function findLlamaServer(): string {
  const env = process.env.LLAMA_SERVER
  if (env && existsSync(env)) return env
  // Common locations: project-local, PATH
  const candidates = [
    path.join(os.homedir(), ".opencode", "bin", process.platform === "win32" ? "llama-server.exe" : "llama-server"),
    "llama-server",
  ]
  for (const c of candidates) {
    if (c.includes(path.sep) && existsSync(c)) return c
  }
  return "llama-server"
}

function discoverModels(modelDir?: string): Model[] {
  const dir = modelDir ?? path.join(os.homedir(), ".opencode", "models")
  if (!existsSync(dir)) return []
  const out: Model[] = []
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".gguf")) continue
    out.push({ id: f.replace(/\.gguf$/, ""), path: path.join(dir, f) })
  }
  return out
}

async function waitReady(port: number, timeoutMs = 60_000): Promise<boolean> {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) })
      if (r.ok) return true
    } catch {}
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}

function peakRssSampler(pid: number): { stop: () => number } {
  let peak = 0
  const interval = setInterval(() => {
    // `ps` is cross-platform enough for Linux/macOS. Windows would need a
    // different probe — out of scope here since bench is developer-run.
    const r = spawnSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" })
    const rssKb = parseInt((r.stdout ?? "").trim(), 10)
    if (!Number.isNaN(rssKb)) peak = Math.max(peak, rssKb)
  }, 100)
  return {
    stop: () => {
      clearInterval(interval)
      return Math.round(peak / 1024)
    },
  }
}

async function runOne(model: Model, nPredict: number): Promise<RunResult> {
  const timestamp = new Date().toISOString()
  const modelSizeMb = Math.round(statSync(model.path).size / (1024 * 1024))
  const llamaServer = findLlamaServer()

  const child = spawn(
    llamaServer,
    [
      "--model",
      model.path,
      "--port",
      String(PORT),
      "--host",
      "127.0.0.1",
      "--n-gpu-layers",
      process.env.BENCH_N_GPU_LAYERS ?? "99",
      "-np",
      "1",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  )
  let stderrTail = ""
  child.stderr.on("data", (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-4096)
  })

  const sampler = peakRssSampler(child.pid!)

  try {
    const ready = await waitReady(PORT)
    if (!ready) {
      return {
        timestamp,
        model: model.id,
        modelSizeMb,
        ftlMs: null,
        tps: null,
        peakRssMb: sampler.stop(),
        wallSeconds: 0,
        nPredict,
        prompt: PROMPT,
        stderr: stderrTail,
        error: "server did not become ready",
      }
    }

    const t0 = performance.now()
    const resp = await fetch(`http://127.0.0.1:${PORT}/completion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: PROMPT, n_predict: nPredict, stream: true }),
    })
    if (!resp.ok || !resp.body) {
      return {
        timestamp,
        model: model.id,
        modelSizeMb,
        ftlMs: null,
        tps: null,
        peakRssMb: sampler.stop(),
        wallSeconds: (performance.now() - t0) / 1000,
        nPredict,
        prompt: PROMPT,
        stderr: stderrTail,
        error: `HTTP ${resp.status}`,
      }
    }

    let firstTokenAt: number | null = null
    let tokenCount = 0
    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const text = decoder.decode(value, { stream: true })
      // llama-server SSE emits `data: {"content":"...", ...}` lines.
      for (const line of text.split("\n")) {
        const m = line.match(/^data:\s*(.+)$/)
        if (!m) continue
        try {
          const obj = JSON.parse(m[1]) as { content?: string; stop?: boolean }
          if (obj.content && obj.content.length > 0) {
            if (firstTokenAt === null) firstTokenAt = performance.now() - t0
            tokenCount += 1
          }
          if (obj.stop) break
        } catch {}
      }
    }

    const wallSeconds = (performance.now() - t0) / 1000
    const ftlMs = firstTokenAt === null ? null : Math.round(firstTokenAt)
    const tps = tokenCount > 0 && wallSeconds > 0 ? +(tokenCount / wallSeconds).toFixed(2) : null

    return {
      timestamp,
      model: model.id,
      modelSizeMb,
      ftlMs,
      tps,
      peakRssMb: sampler.stop(),
      wallSeconds: +wallSeconds.toFixed(3),
      nPredict,
      prompt: PROMPT,
    }
  } finally {
    child.kill("SIGTERM")
    // Give it a moment to flush stderr before exit.
    await new Promise((r) => setTimeout(r, 500))
  }
}

async function main() {
  const { models: requested, runs, nPredict, modelDir } = parseArgs()
  const discovered = discoverModels(modelDir)
  const models = requested
    ? requested.map((id) => discovered.find((m) => m.id === id)).filter((m): m is Model => !!m)
    : discovered

  if (models.length === 0) {
    console.error(
      "[bench] No models found. Place .gguf files under ~/.opencode/models or pass --model-dir.",
    )
    process.exit(1)
  }

  for (const model of models) {
    for (let i = 0; i < runs; i++) {
      const result = await runOne(model, nPredict)
      process.stdout.write(JSON.stringify(result) + "\n")
    }
  }
}

main().catch((e) => {
  console.error("[bench] fatal:", e)
  process.exit(1)
})
