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
    description: "Google's best small model — multilingual, great quality",
    size: "2.5 GB",
    sizeBytes: 2_500_000_000,
    url: "https://huggingface.co/bartowski/gemma-3-4b-it-GGUF/resolve/main/gemma-3-4b-it-Q4_K_M.gguf",
    filename: "gemma-3-4b-it-Q4_K_M.gguf",
    recommended: true,
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
]

/** Build a direct HuggingFace download URL for a GGUF file. */
export function huggingFaceUrl(repo: string, file: string): string {
  return `https://huggingface.co/${repo}/resolve/main/${file}`
}
