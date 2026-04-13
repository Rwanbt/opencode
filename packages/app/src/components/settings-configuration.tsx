import { Component, createSignal, createResource, JSX, Show } from "solid-js"
import { Switch } from "@opencode-ai/ui/switch"
import { Select } from "@opencode-ai/ui/select"
import { Button } from "@opencode-ai/ui/button"
import { createStore } from "solid-js/store"

function invokeTauri(cmd: string, args?: Record<string, unknown>): Promise<any> {
  const tauri = (globalThis as any).__TAURI__
  if (!tauri?.core?.invoke) return Promise.reject("Tauri not available")
  return tauri.core.invoke(cmd, args)
}

export type ModelConfiguration = {
  preset: "custom" | "fast" | "quality" | "eco" | "long-context"
  outputTokensMode: "auto" | "manual"
  outputTokensManual: number
  temperature: number
  topP: number
  contextMode: "auto" | "manual"
  contextManual: number
  kvCacheType: "auto" | "q8_0" | "q4_0" | "f16"
  offloadMode: "auto" | "gpu-max" | "balanced"
  mmapMode: "auto" | "on" | "off"
  draftModel: string
}

const PRESETS: Record<string, Omit<ModelConfiguration, "preset">> = {
  fast: { outputTokensMode: "auto", outputTokensManual: 4096, temperature: 0.5, topP: 0.9, contextMode: "manual", contextManual: 8192, kvCacheType: "q4_0", offloadMode: "gpu-max", mmapMode: "auto", draftModel: "" },
  quality: { outputTokensMode: "auto", outputTokensManual: 8192, temperature: 0.7, topP: 0.95, contextMode: "auto", contextManual: 131072, kvCacheType: "q8_0", offloadMode: "auto", mmapMode: "auto", draftModel: "" },
  eco: { outputTokensMode: "manual", outputTokensManual: 4096, temperature: 0.5, topP: 0.9, contextMode: "manual", contextManual: 16384, kvCacheType: "q4_0", offloadMode: "balanced", mmapMode: "on", draftModel: "" },
  "long-context": { outputTokensMode: "auto", outputTokensManual: 8192, temperature: 0.7, topP: 0.95, contextMode: "auto", contextManual: 131072, kvCacheType: "q4_0", offloadMode: "auto", mmapMode: "auto", draftModel: "" },
}

const DEFAULT_CONFIG: ModelConfiguration = {
  preset: "quality",
  outputTokensMode: "auto",
  outputTokensManual: 8192,
  temperature: 0.7,
  topP: 0.95,
  contextMode: "auto",
  contextManual: 32768,
  kvCacheType: "auto",
  offloadMode: "auto",
  mmapMode: "auto",
  draftModel: "",
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
  const [config, setConfig] = createStore<ModelConfiguration>(loadModelConfig())

  const update = <K extends keyof ModelConfiguration>(key: K, value: ModelConfiguration[K]) => {
    setConfig(key, value as any)
    saveConfig({ ...config })
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8">
          <h2 class="text-16-medium text-text-strong">Configuration</h2>
          <span class="text-12-regular text-text-weak">Advanced model parameters</span>
        </div>
      </div>

      <div class="flex flex-col gap-8 w-full">
        {/* GPU Info */}
        <VramWidget />

        {/* Presets */}
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">Preset</h3>
          <SettingsList>
            <SettingsRow title="Configuration profile" description="Pre-configured settings for common use cases">
              <Select
                size="normal"
                options={["custom", "fast", "quality", "eco", "long-context"]}
                current={config.preset}
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
          <h3 class="text-14-medium text-text-strong pb-2">Output Tokens</h3>
          <SettingsList>
            <SettingsRow
              title="Mode"
              description="Auto adjusts based on model and available context. Manual lets you set a fixed limit."
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
                title="Max output tokens"
                description="Maximum number of tokens the model can generate per response"
              >
                <Select
                  size="normal"
                  options={["1024", "2048", "4096", "8192", "16384", "32000"]}
                  current={String(config.outputTokensManual)}
                  label={(x) => {
                    const n = parseInt(x)
                    return n >= 1000 ? `${(n/1000).toFixed(n % 1000 === 0 ? 0 : 1)}K` : x
                  }}
                  onSelect={(v) => { if (v) update("outputTokensManual", parseInt(v)) }}
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
          <h3 class="text-14-medium text-text-strong pb-2">Context Window</h3>
          <SettingsList>
            <SettingsRow
              title="Mode"
              description="Auto uses the model's native context length. Manual lets you constrain it."
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
                title="Context size"
                description="Maximum context window for the conversation"
              >
                <Select
                  size="normal"
                  options={["4096", "8192", "16384", "32768", "65536", "131072"]}
                  current={String(config.contextManual)}
                  label={(x) => {
                    const n = parseInt(x)
                    return `${(n/1024).toFixed(0)}K`
                  }}
                  onSelect={(v) => { if (v) update("contextManual", parseInt(v)) }}
                />
              </SettingsRow>
            </Show>
          </SettingsList>
        </div>

        {/* Sampling */}
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">Sampling</h3>
          <SettingsList>
            <SettingsRow
              title="Temperature"
              description="Higher = more creative, lower = more focused (0.0 - 2.0)"
            >
              <Select
                size="normal"
                options={["0.0", "0.2", "0.5", "0.7", "1.0", "1.5", "2.0"]}
                current={String(config.temperature)}
                label={(x) => x}
                onSelect={(v) => { if (v) update("temperature", parseFloat(v)) }}
              />
            </SettingsRow>
            <SettingsRow
              title="Top P"
              description="Nucleus sampling threshold (0.0 - 1.0)"
            >
              <Select
                size="normal"
                options={["0.5", "0.7", "0.8", "0.9", "0.95", "1.0"]}
                current={String(config.topP)}
                label={(x) => x}
                onSelect={(v) => { if (v) update("topP", parseFloat(v)) }}
              />
            </SettingsRow>
          </SettingsList>
        </div>

        {/* KV Cache (Local models only) */}
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">KV Cache (Local AI)</h3>
          <SettingsList>
            <SettingsRow
              title="Quantization"
              description="KV cache type for local LLM server (affects VRAM usage)"
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
          <h3 class="text-14-medium text-text-strong pb-2">GPU/CPU Offloading</h3>
          <SettingsList>
            <SettingsRow
              title="Mode"
              description="How to split model layers between GPU and CPU"
            >
              <Select
                size="normal"
                options={["auto", "gpu-max", "balanced"]}
                current={config.offloadMode}
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
          <h3 class="text-14-medium text-text-strong pb-2">Memory</h3>
          <SettingsList>
            <SettingsRow
              title="Memory mapping (mmap)"
              description="Use OS memory mapping for model weights"
            >
              <Select
                size="normal"
                options={["auto", "on", "off"]}
                current={config.mmapMode}
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
          <h3 class="text-14-medium text-text-strong pb-2">Speculative Decoding (Local AI)</h3>
          <SettingsList>
            <SettingsRow
              title="Draft model"
              description="Small model for speculative decoding (2-3x speedup)"
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
      </div>
    </div>
  )
}

function DraftModelSelect(props: { current: string; onSelect: (v: string) => void }) {
  const [models] = createResource(async () => {
    try {
      const all: { filename: string; size: number }[] = await invokeTauri("list_models")
      // Only show small models suitable as drafts (< 2 GB)
      return all.filter((m) => m.size < 2_000_000_000)
    } catch {
      return []
    }
  })

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
