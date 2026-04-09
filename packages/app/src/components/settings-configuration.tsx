import { Component, createSignal, JSX, Show } from "solid-js"
import { Switch } from "@opencode-ai/ui/switch"
import { Select } from "@opencode-ai/ui/select"
import { createStore } from "solid-js/store"

export type ModelConfiguration = {
  outputTokensMode: "auto" | "manual"
  outputTokensManual: number
  temperature: number
  topP: number
  contextMode: "auto" | "manual"
  contextManual: number
  kvCacheType: "auto" | "q8_0" | "q4_0" | "f16"
}

const DEFAULT_CONFIG: ModelConfiguration = {
  outputTokensMode: "auto",
  outputTokensManual: 8192,
  temperature: 0.7,
  topP: 0.95,
  contextMode: "auto",
  contextManual: 32768,
  kvCacheType: "auto",
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
            Q8_0 saves 47% VRAM vs FP16 with minimal quality loss. Q4_0 saves 72% but may reduce accuracy.
          </div>
        </div>
      </div>
    </div>
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
