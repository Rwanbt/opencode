/**
 * LocalLLMServer — auto-start et lifecycle management de llama-server.
 *
 * Permet au sidecar CLI et à l'extension IDE de démarrer llama-server
 * sans contexte Tauri. Coordonne le cycle de vie avec le desktop Tauri via
 * des fichiers dans {tmpdir}/opencode-llm-14097/ :
 *
 *   refs/{pid}.ref — présence d'un consommateur actif
 *   owner.pid      — PID owner:PID child du process qui a spawné le serveur
 *   start.lock     — lock exclusif atomique (O_EXCL) pendant le spawn
 */
import path from "node:path"
import os from "node:os"
import fs from "node:fs"
import net from "node:net"
import { Log } from "@/util/log"
import { detectProfile, deriveConfig, readGgufMeta } from "./auto-config"

const log = Log.create({ service: "local-llm-server" })

const PORT = Number(process.env.OPENCODE_LLAMA_PORT ?? 14097)

// Resolve the tmp base dir in a way that works on Android, where `/` is
// read-only for sandboxed apps and `os.tmpdir()` returns the bionic default
// "/tmp" regardless of environment. We honor TMPDIR/TMP/TEMP first (the
// mobile runtime.rs sets these to an app-private cache), fall back to
// $HOME/.cache/tmp when only HOME is set, and only use os.tmpdir() on
// desktop where /tmp is writable.
function resolveTmpDir(): string {
  const envTmp = process.env.TMPDIR || process.env.TMP || process.env.TEMP
  if (envTmp && envTmp.trim()) return envTmp.trim()
  if (process.env.HOME) return path.join(process.env.HOME, ".cache", "tmp")
  return os.tmpdir()
}

// Paths are lazily initialized. On mobile, mobile-entry.ts loads .env_vars
// AFTER this module's top-level code has run; capturing resolveTmpDir()
// eagerly would bake in "/tmp" and crash at the first mkdirSync.
let BASE_DIR = ""
let REF_DIR = ""
let OWNER_FILE = ""
let LOCK_FILE = ""
let _pathsReady = false
function initPaths(): void {
  if (_pathsReady) return
  BASE_DIR = path.join(resolveTmpDir(), `opencode-llm-${PORT}`)
  REF_DIR = path.join(BASE_DIR, "refs")
  OWNER_FILE = path.join(BASE_DIR, "owner.pid")
  LOCK_FILE = path.join(BASE_DIR, "start.lock")
  _pathsReady = true
}

const STARTUP_TIMEOUT_MS = 120_000
const LOCK_ACQUIRE_TIMEOUT_MS = 150_000
const HEALTH_POLL_INTERVAL_MS = 500
const HEALTH_CHECK_TIMEOUT_MS = 3_000
const TCP_CHECK_TIMEOUT_MS = 500
const STDERR_BUFFER_SIZE = 16384

const ALLOWED_KV_CACHE_TYPES = new Set([
  "f32",
  "f16",
  "bf16",
  "q8_0",
  "q4_0",
  "q4_1",
  "iq4_nl",
  "q5_0",
  "q5_1",
  "turbo2", // TurboQuant 3.25 bpw — Hadamard + PolarQuant + QJL (Google ICLR 2026)
  "turbo3", // TurboQuant 3.75 bpw — meilleur compromis compression/qualité
  "turbo4", // TurboQuant 4.25 bpw — proche q4_0 en taille, supérieur en qualité
])

// ─── Module state ─────────────────────────────────────────────────────────────

// Circuit breaker for model-mismatch restart loops.
// If more than MAX_RESTARTS happen within RESTART_WINDOW_MS, we stop
// and throw — preferable to burning cycles forever.
const RESTART_WINDOW_MS = 120_000
const MAX_RESTARTS = 3
let _restartTimestamps: number[] = []

function recordRestart(): void {
  const now = Date.now()
  _restartTimestamps = _restartTimestamps.filter((t) => now - t < RESTART_WINDOW_MS)
  _restartTimestamps.push(now)
}

function hasExceededRestartBudget(): boolean {
  const now = Date.now()
  _restartTimestamps = _restartTimestamps.filter((t) => now - t < RESTART_WINDOW_MS)
  return _restartTimestamps.length >= MAX_RESTARTS
}

let _ownedChildPid: number | null = null
let _startPromise: Promise<void> | null = null
let _cleanupRegistered = false
let _refRegistered = false
let _currentModelID: string | null = null

// ─── Stderr ring buffer ───────────────────────────────────────────────────────

class RingBuffer {
  private chunks: string[] = []
  private size = 0
  constructor(private readonly max: number) {}

  append(data: string) {
    this.chunks.push(data)
    this.size += data.length
    while (this.size > this.max && this.chunks.length > 1) {
      this.size -= this.chunks.shift()!.length
    }
  }

  read(): string {
    const joined = this.chunks.join("")
    return joined.length > this.max ? joined.slice(-this.max) : joined
  }
}

// ─── Exported namespace ───────────────────────────────────────────────────────

export namespace LocalLLMServer {
  // ── Runtime discovery ────────────────────────────────────────────────────

  function exeName() {
    return process.platform === "win32" ? "llama-server.exe" : "llama-server"
  }

  function candidateDirs(): string[] {
    const home = os.homedir()
    // En dev, on préfère le répertoire .dev ; en prod, le répertoire stable.
    const isDev = process.env.NODE_ENV !== "production"
    const names = isDev
      ? ["ai.opencode.desktop.dev", "ai.opencode.desktop"]
      : ["ai.opencode.desktop", "ai.opencode.desktop.dev"]

    if (process.platform === "win32") {
      const appdata = process.env.APPDATA ?? path.join(home, "AppData", "Roaming")
      return names.map((n) => path.join(appdata, n))
    }
    if (process.platform === "darwin") {
      return names.map((n) => path.join(home, "Library", "Application Support", n))
    }
    return names.map((n) => path.join(home, ".local", "share", n))
  }

  async function findRuntimeDir(): Promise<string | null> {
    // 1. Env var injectée par Tauri (cli.rs) ou par l'utilisateur
    const envDir = process.env.OPENCODE_LLAMA_RUNTIME_DIR
    if (envDir && fs.existsSync(path.join(envDir, exeName()))) return envDir

    // 2. Scan des chemins connus par plateforme
    for (const candidate of candidateDirs()) {
      const runtime = path.join(candidate, "llama-runtime")
      if (fs.existsSync(path.join(runtime, exeName()))) return runtime
    }
    return null
  }

  async function findModelFile(
    modelID: string,
  ): Promise<{ serverExe: string; modelPath: string; modelFile: string } | null> {
    const runtimeDir = await findRuntimeDir()
    if (!runtimeDir) return null
    const serverExe = path.join(runtimeDir, exeName())

    const modelsDir =
      process.env.OPENCODE_LLAMA_MODELS_DIR ?? path.join(path.dirname(runtimeDir), "models")
    if (!fs.existsSync(modelsDir)) return null

    const files = fs.readdirSync(modelsDir).filter((f) => f.toLowerCase().endsWith(".gguf"))
    const modelIDLower = modelID.toLowerCase()

    // 1. Match exact (case-insensitive)
    let gguf = files.find(
      (f) => f.toLowerCase() === modelIDLower || f.toLowerCase() === modelIDLower + ".gguf",
    )

    // 2. Fuzzy : strip suffixes de quantization/précision courants.
    //
    // Two prior bugs combined to break this for `Q4_K_M`-class files:
    //   - the regex anchored on `\.gguf$` but was applied after `.gguf` had
    //     already been stripped → it never matched anything;
    //   - `(_[a-z0-9]+)?` only allowed one trailing `_X` segment, so common
    //     llama.cpp suffixes like `Q4_K_M`, `Q5_K_S`, `IQ2_XS` were rejected
    //     even when the regex did fire.
    // Now: drop the `.gguf` first, then run a regex that matches one or more
    // trailing `_X` segments. Resolves "Runtime or model not found" for files
    // like `gemma-4-E4B-it-Q4_K_M.gguf` keyed by `gemma-4-E4B-it`.
    if (!gguf) {
      const QUANT_SUFFIX = /[-_](q\d+(_[a-z0-9]+)*|iq\d+(_[a-z0-9]+)*|f16|fp16|bf16|f32|fp32)$/i
      gguf = files.find((f) => {
        const stripped = f.replace(/\.gguf$/i, "").replace(QUANT_SUFFIX, "").toLowerCase()
        return stripped === modelIDLower
      })
    }

    if (!gguf) return null
    return { serverExe, modelPath: path.join(modelsDir, gguf), modelFile: gguf }
  }

  // ── Health checks ─────────────────────────────────────────────────────────

  /** Vérifie que le port est ouvert (check TCP rapide, sans attendre de réponse applicative). */
  function isPortOpen(): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket()
      const done = (ok: boolean) => {
        socket.destroy()
        resolve(ok)
      }
      socket.setTimeout(TCP_CHECK_TIMEOUT_MS)
      socket.once("connect", () => done(true))
      socket.once("timeout", () => done(false))
      socket.once("error", () => done(false))
      socket.connect(PORT, "127.0.0.1")
    })
  }

  /** Vérifie que /health répond OK (tolère les timeouts si le serveur est occupé). */
  async function isHealthy(signal?: AbortSignal): Promise<boolean> {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/health`, {
        signal: signal
          ? AbortSignal.any([AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS), signal])
          : AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
      })
      return res.ok
    } catch {
      return false
    }
  }

  /** Récupère le fichier modèle chargé via /props. */
  async function getLoadedModel(signal?: AbortSignal): Promise<string | null> {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/props`, {
        signal: signal
          ? AbortSignal.any([AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS), signal])
          : AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
      })
      if (!res.ok) return null
      const data = (await res.json()) as {
        default_generation_settings?: { model?: string }
        model_path?: string
      }
      const raw = data.default_generation_settings?.model ?? data.model_path ?? null
      return raw ? path.basename(raw) : null
    } catch {
      return null
    }
  }

  export async function isRunning(): Promise<boolean> {
    if (!(await isPortOpen())) return false
    return isHealthy()
  }

  // ── Ref files & cleanup ───────────────────────────────────────────────────

  function ensureBaseDirs() {
    initPaths()
    fs.mkdirSync(REF_DIR, { recursive: true })
  }

  function refPath(pid = process.pid) {
    initPaths()
    return path.join(REF_DIR, `${pid}.ref`)
  }

  function registerRef() {
    if (_refRegistered) return
    ensureBaseDirs()
    fs.writeFileSync(refPath(), JSON.stringify({ pid: process.pid, since: Date.now() }))
    _refRegistered = true
    registerCleanup()
  }

  function isPidAlive(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) return false
    try {
      process.kill(pid, 0)
      return true
    } catch (e: any) {
      // EPERM = process existe mais droits insuffisants → considéré vivant
      return e?.code === "EPERM"
    }
  }

  /** Supprime les ref files dont le PID est mort. Retourne les refs encore vivantes. */
  function pruneStaleRefs(): string[] {
    ensureBaseDirs()
    const alive: string[] = []
    let entries: string[] = []
    try {
      entries = fs.readdirSync(REF_DIR)
    } catch {
      return alive
    }
    for (const entry of entries) {
      if (!entry.endsWith(".ref")) continue
      const pid = parseInt(entry.replace(/\.ref$/, ""), 10)
      if (!Number.isInteger(pid) || pid <= 0) {
        try {
          fs.unlinkSync(path.join(REF_DIR, entry))
        } catch {}
        continue
      }
      if (isPidAlive(pid)) {
        alive.push(entry)
      } else {
        try {
          fs.unlinkSync(path.join(REF_DIR, entry))
        } catch {}
      }
    }
    return alive
  }

  function readOwner(): { ownerPid: number; childPid: number } | null {
    initPaths()
    try {
      const raw = fs.readFileSync(OWNER_FILE, "utf8").trim()
      const [ownerStr, childStr] = raw.split(":")
      const ownerPid = parseInt(ownerStr, 10)
      const childPid = parseInt(childStr, 10)
      if (!Number.isInteger(ownerPid) || ownerPid <= 0) return null
      if (!Number.isInteger(childPid) || childPid <= 0) return null
      return { ownerPid, childPid }
    } catch {
      return null
    }
  }

  function writeOwner(ownerPid: number, childPid: number) {
    ensureBaseDirs()
    const tmp = OWNER_FILE + ".tmp"
    fs.writeFileSync(tmp, `${ownerPid}:${childPid}`)
    fs.renameSync(tmp, OWNER_FILE)
  }

  function registerCleanup() {
    if (_cleanupRegistered) return
    _cleanupRegistered = true
    process.on("exit", syncCleanup)
    process.on("SIGTERM", () => {
      syncCleanup()
      process.exit(143)
    })
    process.on("SIGINT", () => {
      syncCleanup()
      process.exit(130)
    })
  }

  /**
   * Cleanup synchrone appelé sur exit.
   * - Supprime notre ref file
   * - Si plus aucune ref vivante :
   *   - On est owner → tuer llama-server (process.kill synchrone)
   *   - Owner mort, on est le dernier → orphan recovery, tuer le serveur
   *   - Owner vivant → ne rien faire (il gère son cycle de vie, ex: Tauri idle-unload)
   */
  function syncCleanup() {
    if (!_pathsReady) return
    try {
      fs.unlinkSync(refPath())
    } catch {}
    _refRegistered = false

    const aliveRefs = pruneStaleRefs()
    if (aliveRefs.length > 0) return // d'autres consommateurs actifs

    const owner = readOwner()
    if (!owner) return // pas d'owner enregistré (serveur externe non suivi)

    const weAreOwner = owner.ownerPid === process.pid
    const ownerAlive = !weAreOwner && isPidAlive(owner.ownerPid)

    if (weAreOwner) {
      // Notre serveur → kill déterministe via owner.childPid (fiable même si _ownedChildPid est stale)
      try {
        process.kill(owner.childPid, "SIGKILL")
      } catch {}
      try {
        fs.unlinkSync(OWNER_FILE)
      } catch {}
      return
    }

    if (!ownerAlive) {
      // Orphan recovery — dernier consommateur vivant, owner mort (SIGKILL sans cleanup).
      // On utilise owner.childPid depuis le fichier (pas _ownedChildPid qui est null
      // pour les non-owners). Scénario : A spawne, crash → B exit proprement →
      // pruneStaleRefs vide la ref morte de A → plus aucune ref → B tue le serveur.
      try {
        process.kill(owner.childPid, "SIGKILL")
      } catch {}
      try {
        fs.unlinkSync(OWNER_FILE)
      } catch {}
    }
    // Owner vivant → ne rien faire (ex: Tauri idle-unload gère son cycle de vie)
  }

  // ── Lock inter-process ────────────────────────────────────────────────────

  /**
   * Acquisition atomique via O_EXCL. Retourne un release, ou throw si timeout.
   * Détecte et nettoie les locks stale (PID mort).
   */
  async function acquireStartLock(signal?: AbortSignal): Promise<() => void> {
    ensureBaseDirs()
    const start = Date.now()

    while (Date.now() - start < LOCK_ACQUIRE_TIMEOUT_MS) {
      if (signal?.aborted) throw new Error("[LocalLLMServer] Cancelled while acquiring start lock")

      try {
        const fd = fs.openSync(LOCK_FILE, "wx")
        fs.writeSync(fd, String(process.pid))
        fs.closeSync(fd)
        return () => {
          try {
            fs.unlinkSync(LOCK_FILE)
          } catch {}
        }
      } catch (e: any) {
        if (e.code !== "EEXIST") throw e

        // Lock existe — vérifier s'il est stale
        try {
          const holderPid = parseInt(fs.readFileSync(LOCK_FILE, "utf8").trim(), 10)
          if (Number.isInteger(holderPid) && holderPid > 0 && !isPidAlive(holderPid)) {
            log.warn("Removing stale start.lock", { holderPid })
            try {
              fs.unlinkSync(LOCK_FILE)
            } catch {}
            continue
          }
        } catch {}

        // Pendant l'attente, le détenteur du lock a peut-être fini
        if (await isRunning()) return () => {}
        await new Promise((r) => setTimeout(r, 200))
      }
    }
    throw new Error("[LocalLLMServer] Timeout acquiring start lock")
  }

  // ── Spawn helpers ─────────────────────────────────────────────────────────

  function buildArgs(modelPath: string, nGpuLayersOverride?: number): { args: string[]; nGpuLayers: number } {
    initPaths()
    // deriveConfig picks GPU layers / threads / batch / KV quant based on
    // the running device (see auto-config.ts). Env overrides remain available
    // for advanced users who want to pin a specific value.
    const profile = detectProfile()
    const modelSizeMb = (() => {
      try {
        return Math.max(1, Math.floor(fs.statSync(modelPath).size / (1024 * 1024)))
      } catch {
        return 0
      }
    })()
    const blockCount = readGgufMeta(modelPath)?.blockCount ?? 32
    const cfg = deriveConfig(profile, modelSizeMb, blockCount)

    // KV cache quant: env override first, else adaptive.
    const kvCacheRaw = process.env.OPENCODE_KV_CACHE_TYPE ?? cfg.kvCacheType
    const kvCache = ALLOWED_KV_CACHE_TYPES.has(kvCacheRaw) ? kvCacheRaw : cfg.kvCacheType
    if (kvCacheRaw !== kvCache)
      log.warn("Invalid OPENCODE_KV_CACHE_TYPE, fallback to adaptive", { kvCacheRaw, chosen: kvCache })

    // n_gpu_layers: explicit override (OOM retry) > env override > adaptive.
    // "99" remains the historic "offload everything" sentinel; users who want
    // that opt in via env.
    const ngl =
      nGpuLayersOverride !== undefined
        ? String(Math.max(0, nGpuLayersOverride))
        : (process.env.OPENCODE_N_GPU_LAYERS ?? String(cfg.nGpuLayers))

    // --ctx-size: env override > adaptive (deriveConfig, RAM-tiered).
    //
    // Without this, llama-server starts from the GGUF's native n_ctx_train
    // (e.g. 262144 for Ornith-1.0-9B) and relies entirely on its own
    // experimental --fit auto-reduction to shrink it to fit VRAM. Verified
    // on an RTX 4070 8GB laptop GPU: --fit alone reduced Ornith's context to
    // 169984 — still far more than needed for coding tasks — leaving too
    // little VRAM margin and triggering either a CUDA OOM (full GPU offload)
    // or a llama.cpp scheduler assertion crash specific to this model's
    // hybrid Gated Delta Net architecture under partial CPU/GPU offload
    // (`GGML_ASSERT(ctx->mem_buffer != NULL)` in sched_reserve). With an
    // explicit --ctx-size 16384 cap, the same model loads fully on GPU
    // (ngl=99) using 6285/8187 MiB and runs at 37 tok/s decode, vs 2.9 tok/s
    // when forced to CPU-only as a workaround. Capping context — not
    // reducing GPU layers — is the actual fix for this failure class.
    const ctxSize = process.env.OPENCODE_LLAMA_CTX_SIZE
      ? Number(process.env.OPENCODE_LLAMA_CTX_SIZE)
      : cfg.contextSize

    // NOTE: --fit / -fitt / -fitc sont spécifiques au fork llama.cpp intégré.
    // Opt-in via OPENCODE_LLAMA_ENABLE_FIT=1 pour éviter de crasher sur llama.cpp upstream.
    const useFit = process.env.OPENCODE_LLAMA_ENABLE_FIT === "1"

    log.info("llama adaptive config", {
      profile: { gpu: profile.gpuBackend, vramMb: profile.vramMb, totalRamMb: profile.totalRamMb, bigCores: profile.cpuCores.big },
      chosen: { nGpuLayers: ngl, nThreads: cfg.nThreads, batchSize: cfg.batchSize, kvCache, ctxSize },
      modelSizeMb,
    })

    // Publish the adaptive config so other spawners (the Tauri desktop path
    // in particular) can honor the same values instead of hard-coding
    // --n-gpu-layers 99 etc. Best-effort: a failure here is not fatal.
    try {
      fs.mkdirSync(BASE_DIR, { recursive: true })
      const shared = {
        n_gpu_layers: Number(ngl) || cfg.nGpuLayers,
        n_threads: cfg.nThreads,
        batch_size: cfg.batchSize,
        ubatch_size: cfg.uBatchSize,
        kv_cache_type: kvCache,
        context_size: ctxSize,
      }
      fs.writeFileSync(path.join(BASE_DIR, "llm_config.json"), JSON.stringify(shared))
    } catch (e) {
      log.warn("Failed to write shared llm_config.json", { err: String(e) })
    }

    const args = [
      "--model",
      modelPath,
      "--port",
      String(PORT),
      "--host",
      "127.0.0.1",
      "--n-gpu-layers",
      ngl,
      "--ctx-size",
      String(ctxSize),
      "--flash-attn",
      "on",
      "--cache-type-k",
      kvCache,
      "--cache-type-v",
      kvCache,
      "-np",
      "1",
      "--threads",
      String(cfg.nThreads),
      "--batch-size",
      String(cfg.batchSize),
      "--ubatch-size",
      String(cfg.uBatchSize),
      // W4: explicit mmap (on by default in llama.cpp but made visible so
      // operators can see it, and so `--no-mmap` can be passed via env if
      // needed on a quirky storage backend).
      "--mmap",
      // W4: enable the server's slot management + persistent KV cache slots.
      // `--slots` exposes slot introspection; `--slot-save-path` lets the
      // server write KV cache snapshots that can be restored across sessions.
      "--slots",
      "--slot-save-path",
      path.join(BASE_DIR, "kv-slots"),
      // W4: reuse cached prefix tokens across prompts (prompt-cache-like
      // behaviour for the server mode). 256 is a conservative window.
      "--cache-reuse",
      "256",
      // Required for Gemma-4 (and any SWA / hybrid-recurrent arch) to actually
      // hit the cache reuse path. Without this, llama-server logs
      //   "forcing full prompt re-processing due to lack of cache data
      //    (likely due to SWA or hybrid/recurrent memory)"
      // and erases every checkpoint, defeating --cache-reuse entirely. See
      // llama.cpp PR #21749/#22288 (merged 2026-04-23). Older binaries (pre
      // b8731) silently ignore the flag.
      "--swa-full",
    ]
    if (useFit) args.push("--fit", "on", "-fitt", "512", "-fitc", "16384")

    // Ensure the slot save directory exists (best-effort).
    try {
      fs.mkdirSync(path.join(BASE_DIR, "kv-slots"), { recursive: true })
    } catch (e) {
      log.warn("Failed to create kv-slots dir", { err: String(e) })
    }

    // W4: speculative decoding via a draft model. Enabled if the user sets
    // OPENCODE_DRAFT_MODEL=<absolute path> OR if a sibling drafter file is
    // detected next to the main model (pattern: *-0.5B-*.gguf or *-draft*.gguf).
    //
    // VRAM guard: speculative decoding loads a second model into VRAM. As a
    // safety net we require at least ~4 GiB headroom beyond the main model
    // size; otherwise we skip draft and log. This is a coarse heuristic, not
    // a precise accounting (real cost depends on draft model layers, kv quant,
    // ctx size). Users on constrained devices can force-enable via env.
    const draftPath = (() => {
      const env = process.env.OPENCODE_DRAFT_MODEL
      if (env && fs.existsSync(env)) return env
      try {
        const dir = path.dirname(modelPath)
        const candidates = fs
          .readdirSync(dir)
          .filter((f) => f.toLowerCase().endsWith(".gguf"))
          .filter((f) => /(-0\.?5b-|-draft)/i.test(f))
        if (candidates.length > 0) return path.join(dir, candidates[0])
      } catch {}
      return null
    })()

    if (draftPath) {
      const vramHeadroomMb = Math.max(0, (profile.vramMb ?? 0) - modelSizeMb)
      const force = process.env.OPENCODE_DRAFT_FORCE === "1"
      if (vramHeadroomMb >= 4096 || force) {
        args.push("--model-draft", draftPath, "--draft-max", "16", "--draft-min", "5")
        log.info("speculative decoding enabled", {
          draft: path.basename(draftPath),
          vramHeadroomMb,
          forced: force,
        })
      } else {
        log.warn("skipping speculative decoding: insufficient VRAM headroom", {
          draft: path.basename(draftPath),
          modelSizeMb,
          vramMb: profile.vramMb,
          vramHeadroomMb,
          hint: "Set OPENCODE_DRAFT_FORCE=1 to override.",
        })
      }
    }

    return { args, nGpuLayers: Number(ngl) }
  }

  async function waitUntilReady(
    child: ReturnType<typeof Bun.spawn>,
    stderrBuf: RingBuffer,
    signal?: AbortSignal,
  ): Promise<void> {
    const t0 = Date.now()
    while (Date.now() - t0 < STARTUP_TIMEOUT_MS) {
      if (signal?.aborted) throw new Error("[LocalLLMServer] Startup cancelled")
      if (child.exitCode !== null) {
        throw new Error(
          `[LocalLLMServer] llama-server exited at startup (code=${child.exitCode}). stderr:\n${stderrBuf.read() || "<empty>"}`,
        )
      }
      if ((await isPortOpen()) && (await isHealthy(signal))) {
        log.info("llama-server ready", { elapsed: Date.now() - t0 })
        return
      }
      await new Promise((r) => setTimeout(r, HEALTH_POLL_INTERVAL_MS))
    }
    throw new Error(
      `[LocalLLMServer] Server did not start within ${STARTUP_TIMEOUT_MS}ms. stderr:\n${stderrBuf.read() || "<empty>"}`,
    )
  }

  // Matches the CUDA/ggml allocator failure modes seen when a model (or its
  // compute graph buffer — notably oversized on hybrid SSM/attention archs
  // whose recurrent-state buffer doesn't shrink with --fit's context
  // reduction) doesn't fit in available VRAM.
  const OOM_PATTERN = /cudaMalloc failed: out of memory|unable to allocate|failed to allocate.*buffer/i

  async function waitForPortFree(timeoutMs = 5000): Promise<void> {
    const t0 = Date.now()
    while (Date.now() - t0 < timeoutMs) {
      if (!(await isPortOpen())) return
      await new Promise((r) => setTimeout(r, 200))
    }
  }

  async function spawnOnce(
    modelID: string,
    serverExe: string,
    modelPath: string,
    modelFile: string,
    signal: AbortSignal | undefined,
    nGpuLayersOverride: number | undefined,
  ): Promise<void> {
    const stderrBuf = new RingBuffer(STDERR_BUFFER_SIZE)
    const { args, nGpuLayers } = buildArgs(modelPath, nGpuLayersOverride)
    log.info("Spawning llama-server", { exe: serverExe, model: modelFile, port: PORT, nGpuLayers })

    const child = Bun.spawn([serverExe, ...args], {
      stdout: "ignore",
      stderr: "pipe",
    })

    // Pipe stderr vers le ring buffer (non bloquant).
    //
    // The reader must be cancel()-able: if the child crashes mid-write the
    // pipe normally gets EOF and `read()` returns `{done:true}`, but in
    // degenerate cases (dangling fd, host kernel panic replay in CI) the
    // reader could sit forever. We cancel it explicitly once child.exited
    // resolves so the handle is always released.
    const stderrReader = (child.stderr as ReadableStream<Uint8Array>).getReader()
    ;(async () => {
      try {
        const decoder = new TextDecoder()
        while (true) {
          const { done, value } = await stderrReader.read()
          if (done) break
          stderrBuf.append(decoder.decode(value))
        }
      } catch {}
    })()
    void child.exited.then(() => {
      stderrReader.cancel().catch(() => undefined)
      // A.12: reset owned-pid cache on natural exit so isHealthy()/kill paths
      // don't keep holding a stale pid that now belongs to someone else.
      // Only clear if *this* child is still the registered one — avoids a race
      // where ensureCorrectModel already spawned a replacement and bumped the pid.
      if (_ownedChildPid === child.pid) {
        _ownedChildPid = null
      }
    })

    _ownedChildPid = child.pid
    _currentModelID = modelID
    writeOwner(process.pid, child.pid)
    registerRef()

    try {
      await waitUntilReady(child, stderrBuf, signal)
    } catch (e) {
      // Nettoyer en cas d'échec de démarrage
      try {
        process.kill(child.pid, "SIGKILL")
      } catch {}
      try {
        fs.unlinkSync(OWNER_FILE)
      } catch {}
      _ownedChildPid = null
      _currentModelID = null
      throw e
    }
  }

  async function spawnAndWait(modelID: string, signal?: AbortSignal): Promise<void> {
    const found = await findModelFile(modelID)
    if (!found)
      throw new Error(`[LocalLLMServer] Runtime or model not found for "${modelID}"`)

    const { serverExe, modelPath, modelFile } = found

    try {
      await spawnOnce(modelID, serverExe, modelPath, modelFile, signal, undefined)
      return
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (!OOM_PATTERN.test(message)) throw e

      // First attempt OOM'd in the CUDA allocator. Retry once with GPU
      // layers reduced (partial CPU offload) — this only engages on a
      // failure the existing flow already couldn't recover from, so it
      // cannot regress configs that load successfully today.
      const profile = detectProfile()
      const modelSizeMb = (() => {
        try {
          return Math.max(1, Math.floor(fs.statSync(modelPath).size / (1024 * 1024)))
        } catch {
          return 0
        }
      })()
      const blockCount = readGgufMeta(modelPath)?.blockCount ?? 32
      const baselineNgl = process.env.OPENCODE_N_GPU_LAYERS
        ? Number(process.env.OPENCODE_N_GPU_LAYERS)
        : deriveConfig(profile, modelSizeMb, blockCount).nGpuLayers
      const reducedNgl = Math.max(0, Math.floor(baselineNgl * 0.7))

      log.warn("llama-server OOM at startup — retrying with reduced GPU layers", {
        model: modelFile,
        baselineNgl,
        reducedNgl,
      })
      await waitForPortFree()

      try {
        await spawnOnce(modelID, serverExe, modelPath, modelFile, signal, reducedNgl)
        log.info("llama-server recovered with reduced GPU layers", { nGpuLayers: reducedNgl })
        return
      } catch (e2) {
        const message2 = e2 instanceof Error ? e2.message : String(e2)
        if (!OOM_PATTERN.test(message2)) throw e2
        throw new Error(
          `[LocalLLMServer] Modèle "${modelFile}" trop volumineux pour la VRAM disponible, ` +
            `même avec un offload GPU réduit (${reducedNgl} couches). ` +
            `Essayez une quantization plus légère (Q3/Q2) ou un modèle plus petit.`,
        )
      }
    }
  }

  // ── Model mismatch check ─────────────────────────────────────────────────

  /**
   * Vérifie que le modèle chargé correspond à modelID.
   * Si mismatch : restart du serveur.
   * Retourne false si un restart a été déclenché (appelant doit re-vérifier l'état).
   */
  async function ensureCorrectModel(
    modelID: string,
    signal?: AbortSignal,
  ): Promise<boolean> {
    if (!(await isHealthy(signal))) return false

    const loaded = await getLoadedModel(signal)
    if (!loaded) return true // /props n'a pas retourné de modèle, on fait confiance

    const expected = await findModelFile(modelID)
    if (!expected) return true // modèle introuvable localement, pas de restart

    if (loaded.toLowerCase() === expected.modelFile.toLowerCase()) return true

    if (hasExceededRestartBudget()) {
      throw new Error(
        `llama-server restart loop detected (${MAX_RESTARTS} restarts in ${RESTART_WINDOW_MS}ms). ` +
        `Loaded="${loaded}" Expected="${expected.modelFile}". ` +
        `Check model file integrity or path resolution.`,
      )
    }
    recordRestart()
    log.warn("Loaded model mismatch — restarting", {
      loaded,
      expected: expected.modelFile,
      restartsInWindow: _restartTimestamps.length,
    })

    const release = await acquireStartLock(signal)
    try {
      const owner = readOwner()
      if (owner) {
        // Invalider l'état local AVANT le kill.
        // Si crash entre le kill et le spawnAndWait, owner.pid est absent
        // → l'orphan recovery du prochain ensureRunning gère proprement.
        _ownedChildPid = null
        _currentModelID = null
        try {
          fs.unlinkSync(OWNER_FILE)
        } catch {}
        try {
          process.kill(owner.childPid, "SIGKILL")
        } catch {}
      }

      // Attendre que le port se libère
      const t0 = Date.now()
      while (Date.now() - t0 < 10_000) {
        if (!(await isPortOpen())) break
        await new Promise((r) => setTimeout(r, 200))
      }

      await spawnAndWait(modelID, signal)
    } finally {
      release()
    }

    return false
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Point d'entrée unique. Idempotent, safe pour appels concurrents (intra ET inter-process).
   *
   * - Nettoie les refs fantômes de PIDs morts
   * - Single-flight intra-process via _startPromise
   * - Lock inter-process via start.lock (O_EXCL)
   * - Vérifie que le bon modèle est chargé, restart si mismatch
   * - Orphan recovery si l'owner précédent est mort
   */
  export async function ensureRunning(
    modelID: string,
    signal?: AbortSignal,
  ): Promise<void> {
    // On Android, LlamaService (Kotlin/JNI) owns the llama-server lifecycle:
    // it spawns libllama_server.so, loads the model, and serves HTTP on 14097.
    // The bun sidecar must not try to spawn its own llama-server — the desktop
    // runtime dir (~/.local/share/ai.opencode.desktop/llama-runtime/) doesn't
    // exist on-device, so findRuntimeDir()/findModelFile() would fail with
    // "Runtime or model not found", even though the JNI server is healthy.
    // But we still need to block here until the model has finished loading,
    // otherwise the caller hits /v1/chat/completions too early and gets 503
    // `{"status":"loading"}` which the AI SDK gives up on after 3 retries.
    if (process.env.OPENCODE_CLIENT === "mobile-embedded") {
      log.info("mobile-embedded: waiting for JNI llama-server to report ready")
      const t0 = Date.now()
      while (Date.now() - t0 < STARTUP_TIMEOUT_MS) {
        if (signal?.aborted) throw new Error("[LocalLLMServer] Cancelled waiting for mobile JNI")
        try {
          const res = await fetch(`http://127.0.0.1:${PORT}/health`, {
            signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
          })
          if (res.ok) {
            // LlamaHttpServer returns {"status":"ok"} when ready, {"status":"loading"} while the model streams in
            const data = (await res.json().catch(() => ({}))) as { status?: string }
            if (data.status === "ok") {
              log.info("mobile JNI ready", { elapsed: Date.now() - t0 })
              return
            }
          }
        } catch {
          // connection refused / timeout → retry
        }
        await new Promise((r) => setTimeout(r, HEALTH_POLL_INTERVAL_MS))
      }
      throw new Error(
        `[LocalLLMServer] Mobile JNI llama-server did not become ready within ${STARTUP_TIMEOUT_MS}ms`,
      )
    }
    initPaths()
    pruneStaleRefs()

    // Single-flight : si un démarrage est en cours dans ce process, attendre
    if (_startPromise) {
      await _startPromise
      registerRef()
      return
    }

    _startPromise = (async () => {
      // Fast path : serveur déjà en cours
      if (await isRunning()) {
        registerRef() // enregistrer AVANT ensureCorrectModel qui peut restart
        await ensureCorrectModel(modelID, signal)
        // Si ensureCorrectModel a redémarré, spawnAndWait a réécrit owner.pid
        // et appelé registerRef → notre ref est toujours valide
        return
      }

      // Slow path : acquisition du lock inter-process
      const release = await acquireStartLock(signal)
      try {
        // Re-check post-lock : un autre process a pu démarrer entre temps
        if (await isRunning()) {
          registerRef()
          await ensureCorrectModel(modelID, signal)
          return
        }

        // Orphan recovery : owner.pid existe mais owner est mort
        const owner = readOwner()
        if (owner && !isPidAlive(owner.ownerPid)) {
          log.warn("Orphaned llama-server detected — cleaning up", {
            ownerPid: owner.ownerPid,
            childPid: owner.childPid,
          })
          try {
            process.kill(owner.childPid, "SIGKILL")
          } catch {}
          try {
            fs.unlinkSync(OWNER_FILE)
          } catch {}
        }

        await spawnAndWait(modelID, signal)
      } finally {
        release()
      }
    })()

    try {
      await _startPromise
    } finally {
      _startPromise = null
    }
  }
}
