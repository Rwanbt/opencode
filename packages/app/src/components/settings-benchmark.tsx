/**
 * Benchmark tab — measure local LLM inference speed on this device.
 *
 * MVP: runs a fixed-size prompt (128 prefill + 64 decode) against the
 * currently loaded llama-server and reports tokens/sec for both phases.
 * Results are persisted to localStorage so the user keeps a per-model
 * history without re-running every visit.
 *
 * Why: Google AI Edge Gallery makes the user guess which accelerator to
 * pick. Here we measure on the actual device and surface a verdict.
 *
 * Future: when run_device_backend_benchmark lands in the Rust side, this
 * UI will iterate over CPU / OpenCL / Vulkan / Hexagon and show a table.
 */
import { type Component, createSignal, createResource, createMemo, For, Show, } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Select } from "@opencode-ai/ui/select"
import { useLanguage } from "@/context/language"

function invokeTauri(cmd: string, args?: Record<string, unknown>): Promise<any> {
  const tauri = (globalThis as any).__TAURI__
  if (!tauri?.core?.invoke) return Promise.reject("Tauri not available")
  return tauri.core.invoke(cmd, args)
}

type BenchResult = {
  modelFilename: string
  backend: string
  promptTokens: number
  generatedTokens: number
  prefillMs: number
  decodeMs: number
  prefillTps: number
  decodeTps: number
  peakRamMib?: number
  timestamp: number
  deviceLabel?: string
  error?: string
}

const HISTORY_KEY = "opencode-benchmark-history"
const MAX_HISTORY = 20
const BENCH_PROMPT =
  "Write a short technical paragraph (about 200 words) explaining how a CPU's branch predictor works, focusing on the difference between static and dynamic prediction strategies."
// Target: ~128 input tokens after tokenization, 64 generated tokens.
const BENCH_N_PREDICT = 64

function loadHistory(): BenchResult[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as BenchResult[]
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function saveHistory(history: BenchResult[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)))
  } catch {}
}

export const SettingsBenchmark: Component = () => {
  const language = useLanguage()
  const [history, setHistory] = createSignal<BenchResult[]>(loadHistory())
  const [running, setRunning] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [selectedModel, setSelectedModel] = createSignal<string>("")
  const [progressMessage, setProgressMessage] = createSignal<string>("")

  // List the user's downloaded models so they can bench any of them.
  const [models] = createResource(async () => {
    try {
      const all: { filename: string; size: number }[] = await invokeTauri("list_models")
      if (all.length > 0 && !selectedModel()) setSelectedModel(all[0].filename)
      return all
    } catch {
      return []
    }
  })

  // Detected backend (best-effort; UI label only — backend is whichever
  // llama-server was launched with). On mobile this could call into
  // LlamaEngine.detectBestBackend(); on desktop it's typically CUDA/Vulkan.
  const [backend] = createResource(async () => {
    try {
      const b: string = await invokeTauri("detect_active_backend")
      return b
    } catch {
      return "auto"
    }
  })

  async function runBenchmark() {
    const modelFilename = selectedModel()
    if (!modelFilename) {
      setError("No model selected")
      return
    }
    setRunning(true)
    setError(null)
    setProgressMessage("Loading model…")

    try {
      // Make sure the chosen model is loaded (no-op if already current).
      try {
        await invokeTauri("load_llm_model", { filename: modelFilename, draftModel: null })
      } catch (e) {
        // Loading errors are surfaced here but don't stop the bench attempt:
        // the model may already be the active one and the command may have
        // refused on that basis.
        console.warn("[Benchmark] load_llm_model returned:", e)
      }

      setProgressMessage("Running inference (128 prefill + 64 decode)…")

      const result: {
        prompt_tokens: number
        generated_tokens: number
        prefill_ms: number
        decode_ms: number
        prefill_tps: number
        decode_tps: number
        peak_ram_mib?: number
        device_label?: string
      } = await invokeTauri("run_inference_benchmark", {
        prompt: BENCH_PROMPT,
        nPredict: BENCH_N_PREDICT,
      })

      const entry: BenchResult = {
        modelFilename,
        backend: backend() ?? "auto",
        promptTokens: result.prompt_tokens,
        generatedTokens: result.generated_tokens,
        prefillMs: result.prefill_ms,
        decodeMs: result.decode_ms,
        prefillTps: result.prefill_tps,
        decodeTps: result.decode_tps,
        peakRamMib: result.peak_ram_mib,
        deviceLabel: result.device_label,
        timestamp: Date.now(),
      }

      const next = [entry, ...history()].slice(0, MAX_HISTORY)
      setHistory(next)
      saveHistory(next)
      setProgressMessage("")
    } catch (e: any) {
      const msg = String(e?.message ?? e ?? "unknown error")
      setError(msg)
      setProgressMessage("")
    } finally {
      setRunning(false)
    }
  }

  function clearHistory() {
    setHistory([])
    saveHistory([])
  }

  const bestEntry = createMemo(() => {
    // Per-model winner = highest decode tok/s seen.
    const grouped = new Map<string, BenchResult>()
    for (const e of history()) {
      if (e.error) continue
      const key = `${e.modelFilename}|${e.backend}`
      const prev = grouped.get(key)
      if (!prev || e.decodeTps > prev.decodeTps) grouped.set(key, e)
    }
    return [...grouped.values()].sort((a, b) => b.decodeTps - a.decodeTps)
  })

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.fork.benchmark.title")}</h2>
          <span class="text-12-regular text-text-weak">{language.t("settings.fork.benchmark.description")}</span>
        </div>
      </div>

      <div class="flex flex-col gap-8 w-full">
        {/* Run controls */}
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.fork.benchmark.run")}</h3>
          <div class="bg-surface-base px-4 py-4 rounded-lg flex flex-col gap-3">
            <div class="flex items-center justify-between gap-4 flex-wrap">
              <div class="flex flex-col gap-1 min-w-0 flex-1">
                <span class="text-13-medium text-text-strong">{language.t("settings.fork.benchmark.targetModel")}</span>
                <span class="text-11-regular text-text-weak">
                  Pick a downloaded model to benchmark (will be loaded if not already running)
                </span>
              </div>
              <Select
                size="normal"
                options={(models() ?? []).map((m) => m.filename)}
                current={selectedModel()}
                label={(x) => x.replace(/\.gguf$/i, "")}
                onSelect={(v) => { if (v) setSelectedModel(v) }}
              />
            </div>
            <div class="flex items-center justify-between gap-4 flex-wrap">
              <div class="flex flex-col gap-1 min-w-0 flex-1">
                <span class="text-13-medium text-text-strong">{language.t("settings.fork.benchmark.activeBackend")}</span>
                <span class="text-11-regular text-text-weak">
                  Detected automatically (use the Configuration tab's Accelerator switch to change)
                </span>
              </div>
              <span class="text-13-medium text-text-strong px-3 py-1.5 bg-surface-inset rounded-md">
                {backend() ?? "auto"}
              </span>
            </div>
            <div class="flex items-center gap-3 mt-2">
              <Button
                onClick={runBenchmark}
                disabled={running() || !selectedModel()}
                variant="primary"
              >
                {running() ? language.t("settings.fork.benchmark.running") : history().length > 0 ? language.t("settings.fork.benchmark.rerun") : language.t("settings.fork.benchmark.run")}
              </Button>
              <Show when={history().length > 0}>
                <Button onClick={clearHistory} variant="ghost" disabled={running()}>
                  {language.t("settings.fork.benchmark.clearHistory")}
                </Button>
              </Show>
              <Show when={progressMessage()}>
                <span class="text-12-regular text-text-weak">{progressMessage()}</span>
              </Show>
            </div>
            <Show when={error()}>
              <div class="text-12-regular text-icon-critical-base bg-surface-inset px-3 py-2 rounded-md">
                {error()}
              </div>
            </Show>
          </div>
          <div class="text-11-regular text-text-weak mt-1 px-1">
            {language.t("settings.fork.benchmark.workload")}
          </div>
        </div>

        {/* Best per (model, backend) */}
        <Show when={bestEntry().length > 0}>
          <div class="flex flex-col gap-1">
            <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.fork.benchmark.bestResult")}</h3>
            <div class="bg-surface-base rounded-lg overflow-hidden">
              <div class="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-2 px-4 py-2 bg-surface-inset text-11-medium text-text-weak">
                <span>{language.t("settings.fork.benchmark.model")}</span>
                <span class="text-right">{language.t("settings.fork.benchmark.backend")}</span>
                <span class="text-right">{language.t("settings.fork.benchmark.prefill")}</span>
                <span class="text-right">{language.t("settings.fork.benchmark.decode")}</span>
                <span class="text-right">{language.t("settings.fork.benchmark.ram")}</span>
              </div>
              <For each={bestEntry()}>
                {(r) => (
                  <div class="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-2 px-4 py-2 border-b border-border-weak-base last:border-none text-12-regular text-text-strong">
                    <span class="truncate" title={r.modelFilename}>{r.modelFilename.replace(/\.gguf$/i, "")}</span>
                    <span class="text-right text-text-weak">{r.backend}</span>
                    <span class="text-right tabular-nums">{r.prefillTps.toFixed(1)}</span>
                    <span class="text-right tabular-nums">{r.decodeTps.toFixed(2)}</span>
                    <span class="text-right tabular-nums text-text-weak">
                      {r.peakRamMib ? `${r.peakRamMib} MiB` : "—"}
                    </span>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>

        {/* Full history */}
        <Show when={history().length > 0}>
          <div class="flex flex-col gap-1">
            <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.fork.benchmark.history")}</h3>
            <div class="bg-surface-base rounded-lg overflow-hidden">
              <div class="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-2 px-4 py-2 bg-surface-inset text-11-medium text-text-weak">
                <span>{language.t("settings.fork.benchmark.modelTime")}</span>
                <span class="text-right">{language.t("settings.fork.benchmark.backend")}</span>
                <span class="text-right">{language.t("settings.fork.benchmark.prefill")}</span>
                <span class="text-right">{language.t("settings.fork.benchmark.decode")}</span>
                <span class="text-right">{language.t("settings.fork.benchmark.generated")}</span>
              </div>
              <For each={history()}>
                {(r) => (
                  <div class="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-2 px-4 py-2 border-b border-border-weak-base last:border-none text-12-regular">
                    <div class="flex flex-col min-w-0">
                      <span class="truncate text-text-strong" title={r.modelFilename}>
                        {r.modelFilename.replace(/\.gguf$/i, "")}
                      </span>
                      <span class="text-11-regular text-text-weak">{new Date(r.timestamp).toLocaleString()}</span>
                    </div>
                    <span class="text-right text-text-weak self-center">{r.backend}</span>
                    <span class="text-right tabular-nums text-text-strong self-center">{r.prefillTps.toFixed(1)}</span>
                    <span class="text-right tabular-nums text-text-strong self-center">{r.decodeTps.toFixed(2)}</span>
                    <span class="text-right tabular-nums text-text-weak self-center">{r.generatedTokens} {language.t("settings.fork.benchmark.tokens")}</span>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>

        <Show when={history().length === 0 && !running()}>
          <div class="text-12-regular text-text-weak px-1">
            {language.t("settings.fork.benchmark.empty")}
          </div>
        </Show>
      </div>
    </div>
  )
}
