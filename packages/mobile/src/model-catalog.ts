export interface CatalogModel {
  id: string
  name: string
  description: string
  size: string
  sizeBytes: number
  url: string
  filename: string
  recommended?: boolean
}

export const MODEL_CATALOG: CatalogModel[] = [
  {
    id: "gemma-3-4b",
    name: "Gemma 3 4B",
    description: "Google's previous-gen small model — multilingual, great quality",
    size: "2.5 GB",
    sizeBytes: 2_500_000_000,
    url: "https://huggingface.co/bartowski/gemma-3-4b-it-GGUF/resolve/main/gemma-3-4b-it-Q4_K_M.gguf",
    filename: "gemma-3-4b-it-Q4_K_M.gguf",
  },
  {
    id: "qwen2.5-coder-7b",
    name: "Qwen 2.5 Coder 7B",
    description: "Best coding model at this size",
    size: "4.5 GB",
    sizeBytes: 4_500_000_000,
    url: "https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/qwen2.5-coder-7b-instruct-q4_k_m.gguf",
    filename: "qwen2.5-coder-7b-instruct-q4_k_m.gguf",
  },
  {
    id: "phi-4-mini",
    name: "Phi-4 Mini 3.8B",
    description: "Microsoft — strong reasoning and STEM",
    size: "2.3 GB",
    sizeBytes: 2_300_000_000,
    url: "https://huggingface.co/bartowski/phi-4-mini-instruct-GGUF/resolve/main/phi-4-mini-instruct-Q4_K_M.gguf",
    filename: "phi-4-mini-instruct-Q4_K_M.gguf",
  },
  {
    id: "llama-3.2-3b",
    name: "Llama 3.2 3B",
    description: "Meta's on-device optimized model",
    size: "1.8 GB",
    sizeBytes: 1_800_000_000,
    url: "https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf",
    filename: "Llama-3.2-3B-Instruct-Q4_K_M.gguf",
  },
  {
    id: "gemma-3-1b",
    name: "Gemma 3 1B",
    description: "Ultra-light for quick responses",
    size: "0.7 GB",
    sizeBytes: 700_000_000,
    url: "https://huggingface.co/bartowski/gemma-3-1b-it-GGUF/resolve/main/gemma-3-1b-it-Q4_K_M.gguf",
    filename: "gemma-3-1b-it-Q4_K_M.gguf",
  },
  {
    id: "gemma-4-e4b",
    name: "Gemma 4 E4B",
    description: "Google's latest multimodal model — 131K context, 140+ languages",
    size: "5.0 GB",
    sizeBytes: 5_351_931_084,
    url: "https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-Q4_K_M.gguf",
    filename: "gemma-4-E4B-it-Q4_K_M.gguf",
    recommended: true,
  },
  {
    id: "qwen3.5-4b",
    name: "Qwen 3.5 4B",
    description: "Qwen's latest small model — strong reasoning and multilingual",
    size: "2.7 GB",
    sizeBytes: 2_740_000_000,
    url: "https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf",
    filename: "Qwen3.5-4B-Q4_K_M.gguf",
  },
  {
    id: "qwen3.5-2b",
    name: "Qwen 3.5 2B",
    description: "Lightweight Qwen — good quality at minimal size",
    size: "1.3 GB",
    sizeBytes: 1_375_731_712,
    url: "https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_K_M.gguf",
    filename: "Qwen3.5-2B-Q4_K_M.gguf",
  },
  {
    id: "qwen3.5-0.8b",
    name: "Qwen 3.5 0.8B",
    description: "Ultra-light Qwen for fast on-device inference",
    size: "0.5 GB",
    sizeBytes: 533_000_000,
    url: "https://huggingface.co/unsloth/Qwen3.5-0.8B-GGUF/resolve/main/Qwen3.5-0.8B-Q4_K_M.gguf",
    filename: "Qwen3.5-0.8B-Q4_K_M.gguf",
  },
]

/** Build a direct HuggingFace download URL for a GGUF file. */
export function huggingFaceUrl(repo: string, file: string): string {
  return `https://huggingface.co/${repo}/resolve/main/${file}`
}
