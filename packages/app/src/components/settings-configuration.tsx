import { type Component, createSignal, createResource, type JSX, Show, onCleanup, For } from "solid-js"
import { Slider } from "@kobalte/core/slider"
import { Switch } from "@opencode-ai/ui/switch"
import { Select } from "@opencode-ai/ui/select"
import { TextField } from "@opencode-ai/ui/text-field"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"

function invokeTauri(cmd: string, args?: Record<string, unknown>): Promise<any> {
  const tauri = (globalThis as any).__TAURI__
  if (!tauri?.core?.invoke) return Promise.reject("Tauri not available")
  return tauri.core.invoke(cmd, args)
}

export type AcceleratorMode = "auto" | "cpu" | "gpu" | "npu"

export type ModelConfiguration = {
  preset: "custom" | "fast" | "quality" | "eco" | "long-context"
  outputTokensMode: "auto" | "manual"
  outputTokensManual: number
  temperature: number
  topP: number
  topK: number
  contextMode: "auto" | "manual"
  contextManual: number
  kvCacheType: "auto" | "q8_0" | "q4_0" | "f16"
  offloadMode: "auto" | "gpu-max" | "balanced"
  mmapMode: "auto" | "on" | "off"
  draftModel: string
  accelerator: AcceleratorMode
  systemPrompt: string
  // Advanced
  threads: number // 0 = auto-detect big-cores
  flashAttn: boolean
  cacheReuse: boolean
  nBatch: number
}

const PRESETS: Record<string, Omit<ModelConfiguration, "preset" | "accelerator" | "systemPrompt">> = {
  fast: {
    outputTokensMode: "auto", outputTokensManual: 4096,
    temperature: 0.5, topP: 0.9, topK: 40,
    contextMode: "manual", contextManual: 8192,
    kvCacheType: "q4_0", offloadMode: "gpu-max", mmapMode: "auto",
    draftModel: "",
    threads: 0, flashAttn: true, cacheReuse: true, nBatch: 512,
  },
  quality: {
    outputTokensMode: "auto", outputTokensManual: 8192,
    temperature: 0.7, topP: 0.95, topK: 64,
    contextMode: "auto", contextManual: 131072,
    kvCacheType: "q8_0", offloadMode: "auto", mmapMode: "auto",
    draftModel: "",
    threads: 0, flashAttn: true, cacheReuse: true, nBatch: 512,
  },
  eco: {
    outputTokensMode: "manual", outputTokensManual: 4096,
    temperature: 0.5, topP: 0.9, topK: 40,
    contextMode: "manual", contextManual: 16384,
    kvCacheType: "q4_0", offloadMode: "balanced", mmapMode: "on",
    draftModel: "",
    threads: 4, flashAttn: true, cacheReuse: true, nBatch: 256,
  },
  "long-context": {
    outputTokensMode: "auto", outputTokensManual: 8192,
    temperature: 0.7, topP: 0.95, topK: 64,
    contextMode: "auto", contextManual: 131072,
    kvCacheType: "q4_0", offloadMode: "auto", mmapMode: "auto",
    draftModel: "",
    threads: 0, flashAttn: true, cacheReuse: false, nBatch: 1024,
  },
}

const DEFAULT_CONFIG: ModelConfiguration = {
  preset: "quality",
  outputTokensMode: "auto",
  outputTokensManual: 8192,
  temperature: 0.7,
  topP: 0.95,
  topK: 64,
  contextMode: "auto",
  contextManual: 32768,
  kvCacheType: "auto",
  offloadMode: "auto",
  mmapMode: "auto",
  draftModel: "",
  accelerator: "auto",
  systemPrompt: "",
  threads: 0,
  flashAttn: true,
  cacheReuse: true,
  nBatch: 512,
}

const STORAGE_KEY = "opencode-model-config"

export function loadModelConfig(): ModelConfiguration {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) }
  } catch {}
  return { ...DEFAULT_CONFIG }
}

function saveConfig(c: ModelConfiguration) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(c))
}

export const SettingsConfiguration: Component = () => {
  const language = useLanguage()
  const [config, setConfig] = createStore<ModelConfiguration>(loadModelConfig())
  const [advancedOpen, setAdvancedOpen] = createSignal(false)

  const update = <K extends keyof ModelConfiguration>(key: K, value: ModelConfiguration[K]) => {
    setConfig(key, value as any)
    saveConfig({ ...config })
  }

  const formatTokens = (n: number) => (n >= 1000 ? `${(n / 1024).toFixed(n % 1024 === 0 ? 0 : 1)}K` : String(n))

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.localConfig.title")}</h2>
          <span class="text-12-regular text-text-weak">{language.t("settings.localConfig.description")}</span>
        </div>
      </div>

      <div class="flex flex-col gap-8 w-full">
        {/* Hardware Status */}
        <VramWidget />
        <ThermalWidget />

        {/* Accelerator (NEW) */}
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.localConfig.accelerator")}</h3>
          <SettingsList>
            <SettingsRow
              title={language.t("settings.localConfig.backend")}
              description={language.t("settings.localConfig.backendDescription")}
            >
              <SegmentedButton<AcceleratorMode>
                options={[
                  { value: "auto", label: "Auto" },
                  { value: "cpu", label: "CPU" },
                  { value: "gpu", label: "GPU" },
                  { value: "npu", label: "NPU" },
                ]}
                value={config.accelerator}
                onChange={(v) => update("accelerator", v)}
              />
            </SettingsRow>
          </SettingsList>
          <div class="text-11-regular text-text-weak mt-1 px-1">
            Auto detects: Hexagon NPU on Snapdragon 8 Gen 1+, Vulkan on MediaTek 9000+/Exynos 2200+, OpenCL on other Adreno, CPU otherwise. Manual overrides device tier routing.
          </div>
        </div>

        {/* System Prompt (NEW) */}
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.localConfig.systemPrompt")}</h3>
          <SettingsList>
            <SettingsRow
              title={language.t("settings.localConfig.customPrompt")}
              description={language.t("settings.localConfig.customPromptDescription")}
            >
              <div class="w-full sm:w-96">
                <TextField
                  multiline
                  value={config.systemPrompt}
                  onChange={(v) => update("systemPrompt", v ?? "")}
                  placeholder={language.t("settings.localConfig.promptPlaceholder")}
                  hideLabel
                  label={language.t("settings.localConfig.systemPrompt")}
                />
              </div>
            </SettingsRow>
          </SettingsList>
        </div>

        {/* Presets */}
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.localConfig.preset")}</h3>
          <SettingsList>
            <SettingsRow title={language.t("settings.localConfig.profile")} description={language.t("settings.localConfig.profileDescription")}>
              <Select
                size="normal"
                options={["custom", "fast", "quality", "eco", "long-context"]}
                current={config.preset}
                triggerStyle={{ "max-width": "220px" }}
                valueClass="truncate"
                label={(x) => {
                  const m: Record<string, string> = {
                    custom: "Custom",
                    fast: "Fast (low VRAM, quick responses)",
                    quality: "Quality (balanced, recommended)",
                    eco: "Eco (minimal VRAM usage)",
                    "long-context": "Long Context (128K+, q4_0 KV)",
                  }
                  return m[x] ?? x
                }}
                onSelect={(v) => {
                  if (!v) return
                  update("preset", v as any)
                  if (v !== "custom" && PRESETS[v]) {
                    const p = PRESETS[v]
                    Object.entries(p).forEach(([k, val]) => update(k as any, val as any))
                  }
                }}
              />
            </SettingsRow>
          </SettingsList>
        </div>

        {/* Output Tokens */}
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.localConfig.outputTokens")}</h3>
          <SettingsList>
            <SettingsRow
              title={language.t("settings.localConfig.mode")}
              description={language.t("settings.localConfig.outputModeDescription")}
            >
              <Select
                size="normal"
                options={["auto", "manual"]}
                current={config.outputTokensMode}
                label={(x) => x === "auto" ? "Auto (recommended)" : "Manual"}
                onSelect={(v) => { if (v) update("outputTokensMode", v as any) }}
              />
            </SettingsRow>
            <Show when={config.outputTokensMode === "manual"}>
              <SettingsRow
                title={language.t("settings.localConfig.maxOutputTokens")}
                description={language.t("settings.localConfig.maxOutputDescription")}
              >
                <SettingsSlider
                  value={config.outputTokensManual}
                  min={1024} max={32768} step={512}
                  format={formatTokens}
                  onChange={(v) => update("outputTokensManual", v)}
                />
              </SettingsRow>
            </Show>
          </SettingsList>
          <div class="text-11-regular text-text-weak mt-1 px-1">
            Auto mode: uses min(model_limit, available_context / 3) for optimal balance between response length and conversation history.
          </div>
        </div>

        {/* Context Window */}
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.localConfig.contextWindow")}</h3>
          <SettingsList>
            <SettingsRow
              title={language.t("settings.localConfig.mode")}
              description={language.t("settings.localConfig.contextModeDescription")}
            >
              <Select
                size="normal"
                options={["auto", "manual"]}
                current={config.contextMode}
                label={(x) => x === "auto" ? "Auto (recommended)" : "Manual"}
                onSelect={(v) => { if (v) update("contextMode", v as any) }}
              />
            </SettingsRow>
            <Show when={config.contextMode === "manual"}>
              <SettingsRow
                title={language.t("settings.localConfig.contextSize")}
                description={language.t("settings.localConfig.contextSizeDescription")}
              >
                <SettingsSlider
                  value={config.contextManual}
                  min={4096} max={131072} step={4096}
                  format={formatTokens}
                  onChange={(v) => update("contextManual", v)}
                />
              </SettingsRow>
            </Show>
          </SettingsList>
        </div>

        {/* Sampling */}
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.localConfig.sampling")}</h3>
          <SettingsList>
            <SettingsRow
              title={language.t("settings.localConfig.temperature")}
              description={language.t("settings.localConfig.temperatureDescription")}
            >
              <SettingsSlider
                value={config.temperature}
                min={0} max={2} step={0.05}
                format={(v) => v.toFixed(2)}
                onChange={(v) => update("temperature", Math.round(v * 100) / 100)}
              />
            </SettingsRow>
            <SettingsRow
              title={language.t("settings.localConfig.topP")}
              description={language.t("settings.localConfig.topPDescription")}
            >
              <SettingsSlider
                value={config.topP}
                min={0} max={1} step={0.01}
                format={(v) => v.toFixed(2)}
                onChange={(v) => update("topP", Math.round(v * 100) / 100)}
              />
            </SettingsRow>
            <SettingsRow
              title={language.t("settings.localConfig.topK")}
              description={language.t("settings.localConfig.topKDescription")}
            >
              <SettingsSlider
                value={config.topK}
                min={1} max={100} step={1}
                format={(v) => String(v)}
                onChange={(v) => update("topK", Math.round(v))}
              />
            </SettingsRow>
          </SettingsList>
        </div>

        {/* KV Cache (Local models only) */}
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.localConfig.kvCache")}</h3>
          <SettingsList>
            <SettingsRow
              title={language.t("settings.localConfig.quantization")}
              description={language.t("settings.localConfig.quantizationDescription")}
            >
              <Select
                size="normal"
                options={["auto", "q8_0", "q4_0", "f16"]}
                current={config.kvCacheType}
                label={(x) => {
                  const m: Record<string, string> = {
                    auto: "Auto (q8_0)",
                    q8_0: "Q8_0 (balanced)",
                    q4_0: "Q4_0 (compact)",
                    f16: "FP16 (quality)",
                  }
                  return m[x] ?? x
                }}
                onSelect={(v) => { if (v) update("kvCacheType", v as any) }}
              />
            </SettingsRow>
          </SettingsList>
          <div class="text-11-regular text-text-weak mt-1 px-1">
            With llama.cpp b8731+, Hadamard rotation is auto-applied to Q4_0/Q8_0 for near-lossless compression (TurboQuant PR #21038).
          </div>
        </div>

        {/* GPU/CPU Offloading */}
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.localConfig.offloading")}</h3>
          <SettingsList>
            <SettingsRow
              title={language.t("settings.localConfig.mode")}
              description={language.t("settings.localConfig.offloadDescription")}
            >
              <Select
                size="normal"
                options={["auto", "gpu-max", "balanced"]}
                current={config.offloadMode}
                triggerStyle={{ "max-width": "220px" }}
                valueClass="truncate"
                label={(x) => {
                  const m: Record<string, string> = {
                    auto: "Auto (--fit, recommended)",
                    "gpu-max": "GPU priority (max layers on GPU)",
                    balanced: "Balanced (stable throughput)",
                  }
                  return m[x] ?? x
                }}
                onSelect={(v) => { if (v) update("offloadMode", v as any) }}
              />
            </SettingsRow>
          </SettingsList>
          <div class="text-11-regular text-text-weak mt-1 px-1">
            Auto uses llama.cpp --fit to detect VRAM and place layers optimally. For MoE models (Gemma 26B), overflow experts go to CPU automatically.
          </div>
        </div>

        {/* Memory Management */}
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.localConfig.memory")}</h3>
          <SettingsList>
            <SettingsRow
              title={language.t("settings.localConfig.mmap")}
              description={language.t("settings.localConfig.mmapDescription")}
            >
              <Select
                size="normal"
                options={["auto", "on", "off"]}
                current={config.mmapMode}
                triggerStyle={{ "max-width": "220px" }}
                valueClass="truncate"
                label={(x) => {
                  const m: Record<string, string> = {
                    auto: "Auto (recommended)",
                    on: "Force on (SSD streaming)",
                    off: "Force off (all in RAM)",
                  }
                  return m[x] ?? x
                }}
                onSelect={(v) => { if (v) update("mmapMode", v as any) }}
              />
            </SettingsRow>
          </SettingsList>
          <div class="text-11-regular text-text-weak mt-1 px-1">
            mmap lets the OS page model weights from SSD on demand. Useful for large models that exceed RAM. Disable for maximum speed if the model fits in RAM.
          </div>
        </div>

        {/* Speculative Decoding */}
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.localConfig.speculative")}</h3>
          <SettingsList>
            <SettingsRow
              title={language.t("settings.localConfig.draftModel")}
              description={language.t("settings.localConfig.draftModelDescription")}
            >
              <DraftModelSelect
                current={config.draftModel}
                onSelect={(v) => update("draftModel", v)}
              />
            </SettingsRow>
          </SettingsList>
          <div class="text-11-regular text-text-weak mt-1 px-1">
            Uses a small model to draft tokens, verified by the main model. Requires extra VRAM. Active after next server restart.
          </div>
        </div>

        {/* Advanced (collapsible, NEW) */}
        <div class="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => setAdvancedOpen(!advancedOpen())}
            class="flex items-center justify-between text-14-medium text-text-strong pb-2 cursor-pointer hover:text-text-strong"
          >
            <span>{language.t("settings.localConfig.advanced")}</span>
            <span class="text-12-regular text-text-weak">{advancedOpen() ? "▾" : "▸"}</span>
          </button>
          <Show when={advancedOpen()}>
            <SettingsList>
              <SettingsRow
                title={language.t("settings.localConfig.cpuThreads")}
                description={language.t("settings.localConfig.cpuThreadsDescription")}
              >
                <SettingsSlider
                  value={config.threads}
                  min={0} max={16} step={1}
                  format={(v) => v === 0 ? "auto" : String(v)}
                  onChange={(v) => update("threads", Math.round(v))}
                />
              </SettingsRow>
              <SettingsRow
                title={language.t("settings.localConfig.flashAttention")}
                description={language.t("settings.localConfig.flashAttentionDescription")}
              >
                <Switch
                  checked={config.flashAttn}
                  onChange={(v) => update("flashAttn", v)}
                />
              </SettingsRow>
              <SettingsRow
                title={language.t("settings.localConfig.cacheReuse")}
                description={language.t("settings.localConfig.cacheReuseDescription")}
              >
                <Switch
                  checked={config.cacheReuse}
                  onChange={(v) => update("cacheReuse", v)}
                />
              </SettingsRow>
              <SettingsRow
                title={language.t("settings.localConfig.batchSize")}
                description={language.t("settings.localConfig.batchSizeDescription")}
              >
                <SettingsSlider
                  value={config.nBatch}
                  min={64} max={2048} step={64}
                  format={(v) => String(v)}
                  onChange={(v) => update("nBatch", Math.round(v))}
                />
              </SettingsRow>
            </SettingsList>
            <div class="text-11-regular text-text-weak mt-1 px-1">
              These options take effect after the next model load. Disable cache reuse if you see "cache reuse is not supported - ignoring n_cache_reuse" warnings (Gemma 4 SWA architecture).
            </div>
          </Show>
        </div>
      </div>
    </div>
  )
}

// ─── Helper components ─────────────────────────────────────────────────

function SettingsSlider(props: {
  value: number
  min: number
  max: number
  step: number
  format?: (v: number) => string
  onChange: (v: number) => void
}) {
  const fmt = props.format ?? ((v: number) => String(v))
  return (
    <div class="flex items-center gap-3 w-56">
      <Slider
        class="relative flex flex-1 items-center select-none touch-none h-5"
        value={[props.value]}
        minValue={props.min}
        maxValue={props.max}
        step={props.step}
        onChange={(vals) => props.onChange(vals[0])}
      >
        <Slider.Track class="bg-surface-inset relative grow rounded-full h-1.5">
          <Slider.Fill class="bg-text-strong absolute rounded-full h-full" />
        </Slider.Track>
        <Slider.Thumb class="block w-4 h-4 bg-text-strong rounded-full shadow-sm -translate-y-1/2 top-1/2 absolute focus:outline-none focus:ring-2 focus:ring-text-strong">
          <Slider.Input />
        </Slider.Thumb>
      </Slider>
      <span class="text-12-regular text-text-strong w-14 text-right tabular-nums">{fmt(props.value)}</span>
    </div>
  )
}

function SegmentedButton<T extends string>(props: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div class="flex bg-surface-inset rounded-lg p-0.5 gap-0.5">
      <For each={props.options}>
        {(opt) => (
          <button
            type="button"
            onClick={() => props.onChange(opt.value)}
            class="px-3 py-1.5 text-12-medium rounded-md transition-colors"
            classList={{
              "bg-surface-base text-text-strong shadow-sm": props.value === opt.value,
              "text-text-weak hover:text-text-strong": props.value !== opt.value,
            }}
          >
            {opt.label}
          </button>
        )}
      </For>
    </div>
  )
}

function DraftModelSelect(props: { current: string; onSelect: (v: string) => void }) {
  const [tick, setTick] = createSignal(0)
  const [models] = createResource(tick, async () => {
    try {
      const all: { filename: string; size: number }[] = await invokeTauri("list_models")
      // Only show small models suitable as drafts (< 4 GB)
      return all.filter((m) => m.size < 4_000_000_000)
    } catch {
      return []
    }
  })
  // Re-scan models directory when window regains focus
  // (covers: new file added while settings open, alt-tabbed back)
  const onVisible = () => {
    if (document.visibilityState === "visible") setTick((t) => t + 1)
  }
  document.addEventListener("visibilitychange", onVisible)
  onCleanup(() => document.removeEventListener("visibilitychange", onVisible))

  const formatSize = (bytes: number) => `${Math.round(bytes / 1_000_000)} MB`

  return (
    <Select
      size="normal"
      options={["", ...(models() ?? []).map((m) => m.filename)]}
      current={props.current}
      label={(x) => {
        if (x === "") return "None (disabled)"
        const m = models()?.find((m) => m.filename === x)
        const name = x.replace(/\.gguf$/i, "")
        return m ? `${name} (${formatSize(m.size)})` : name
      }}
      onSelect={(v) => {
        if (v !== undefined) props.onSelect(v)
      }}
    />
  )
}

function VramWidget() {
  const [vram, setVram] = createSignal<{ total_mib: number; used_mib: number; free_mib: number; gpu_name: string } | null>(null)

  ;(async () => {
    try {
      // Try desktop GPU VRAM first (nvidia-smi)
      const info = await invokeTauri("get_vram_info")
      setVram(info)
    } catch {
      // Fallback to mobile RAM info (/proc/meminfo)
      try {
        const mem: { total_mb: number; available_mb: number; used_mb: number } = await invokeTauri("get_memory_info")
        setVram({
          total_mib: mem.total_mb,
          used_mib: mem.used_mb,
          free_mib: mem.available_mb,
          gpu_name: "Device RAM",
        })
      } catch { /* no memory info available */ }
    }
  })()

  return (
    <Show when={vram()}>
      {(info) => {
        const pct = () => Math.round((info().used_mib / info().total_mib) * 100)
        return (
          <div class="bg-surface-base rounded-lg px-4 py-3">
            <div class="flex items-center justify-between mb-2">
              <span class="text-13-medium text-text-strong">{info().gpu_name}</span>
              <span class="text-12-regular text-text-weak">
                {info().used_mib} / {info().total_mib} MiB ({pct()}%)
              </span>
            </div>
            <div class="w-full h-2 bg-surface-inset rounded-full overflow-hidden">
              <div
                class="h-full rounded-full transition-all"
                classList={{
                  "bg-icon-success-base": pct() < 70,
                  "bg-yellow-500": pct() >= 70 && pct() < 90,
                  "bg-icon-critical-base": pct() >= 90,
                }}
                style={{ width: `${pct()}%` }}
              />
            </div>
            <div class="flex justify-between mt-1">
              <span class="text-11-regular text-text-weak">{info().free_mib} MiB free</span>
              <span class="text-11-regular text-text-weak">{info().gpu_name === "Device RAM" ? "RAM" : "VRAM"}</span>
            </div>
          </div>
        )
      }}
    </Show>
  )
}

const THERMAL_MSG: Record<string, string> = {
  fair: "Device is warm — inference may be slightly slower.",
  serious: "Device is hot — GPU layers reduced to protect hardware.",
  critical: "Device is critically hot — local inference disabled until it cools.",
}

function ThermalWidget() {
  const [thermal, setThermal] = createSignal<"nominal" | "fair" | "serious" | "critical">("nominal")

  const poll = async () => {
    try {
      const state = await invokeTauri("get_thermal_state")
      setThermal(state as "nominal" | "fair" | "serious" | "critical")
    } catch { /* unavailable on Windows */ }
  }

  poll()
  const id = setInterval(poll, 10_000)
  onCleanup(() => clearInterval(id))

  return (
    <Show when={thermal() !== "nominal"}>
      <div
        class="flex items-center gap-3 rounded-lg px-4 py-3 text-13-regular border"
        classList={{
          "bg-yellow-500/10 text-yellow-400 border-yellow-500/20": thermal() === "fair",
          "bg-orange-500/10 text-orange-400 border-orange-500/20": thermal() === "serious",
          "bg-red-500/10 text-red-400 border-red-500/20": thermal() === "critical",
        }}
      >
        <div
          class="size-2 rounded-full shrink-0 animate-pulse"
          classList={{
            "bg-yellow-400": thermal() === "fair",
            "bg-orange-400": thermal() === "serious",
            "bg-red-400": thermal() === "critical",
          }}
        />
        <span>{THERMAL_MSG[thermal()] ?? ""}</span>
      </div>
    </Show>
  )
}

function SettingsList(props: { children: JSX.Element }) {
  return <div class="bg-surface-base px-4 rounded-lg">{props.children}</div>
}

interface SettingsRowProps {
  title: string
  description: string
  children: JSX.Element
}

const SettingsRow: Component<SettingsRowProps> = (props) => {
  return (
    <div class="flex flex-wrap items-center gap-4 py-3 border-b border-border-weak-base last:border-none sm:flex-nowrap">
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="text-14-medium text-text-strong">{props.title}</span>
        <span class="text-12-regular text-text-weak">{props.description}</span>
      </div>
      <div class="flex w-full justify-end sm:w-auto sm:shrink-0">{props.children}</div>
    </div>
  )
}
