import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"

let mockInvoke: ReturnType<typeof mock>

let listModels: typeof import("./llm").listModels
let downloadModel: typeof import("./llm").downloadModel
let deleteModel: typeof import("./llm").deleteModel
let loadModel: typeof import("./llm").loadModel
let unloadModel: typeof import("./llm").unloadModel
let isModelLoaded: typeof import("./llm").isModelLoaded
let abortGeneration: typeof import("./llm").abortGeneration
let generateText: typeof import("./llm").generateText
let checkLlmHealth: typeof import("./llm").checkLlmHealth

beforeAll(async () => {
  mockInvoke = mock()

  mock.module("@tauri-apps/api/core", () => ({ invoke: mockInvoke }))

  const mod = await import("./llm")
  listModels = mod.listModels
  downloadModel = mod.downloadModel
  deleteModel = mod.deleteModel
  loadModel = mod.loadModel
  unloadModel = mod.unloadModel
  isModelLoaded = mod.isModelLoaded
  abortGeneration = mod.abortGeneration
  generateText = mod.generateText
  checkLlmHealth = mod.checkLlmHealth
})

beforeEach(() => {
  mockInvoke.mockReset()
})

// ---------------------------------------------------------------------------
// listModels
// ---------------------------------------------------------------------------

describe("listModels", () => {
  test("retourne le tableau renvoyé par invoke", async () => {
    const models = [
      { filename: "gemma-4.gguf", size: 4_000_000_000 },
      { filename: "llama-3.2.gguf", size: 2_000_000_000 },
    ]
    mockInvoke.mockResolvedValue(models)

    const result = await listModels()

    expect(result).toEqual(models)
  })

  test("appelle invoke avec la commande list_models", async () => {
    mockInvoke.mockResolvedValue([])

    await listModels()

    expect(mockInvoke).toHaveBeenCalledWith("list_models")
  })

  test("retourne [] quand invoke lève une erreur", async () => {
    mockInvoke.mockRejectedValue(new Error("permission denied"))

    const result = await listModels()

    expect(result).toEqual([])
  })

  test("retourne [] sur un tableau vide", async () => {
    mockInvoke.mockResolvedValue([])

    const result = await listModels()

    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// downloadModel
// ---------------------------------------------------------------------------

describe("downloadModel", () => {
  test("passe url et filename à invoke", async () => {
    mockInvoke.mockResolvedValue(undefined)

    await downloadModel("https://hf.co/model.gguf", "model.gguf")

    expect(mockInvoke).toHaveBeenCalledWith("download_model", {
      url: "https://hf.co/model.gguf",
      filename: "model.gguf",
    })
  })

  test("propage l'erreur invoke sans la masquer", async () => {
    mockInvoke.mockRejectedValue(new Error("network error"))

    await expect(downloadModel("https://hf.co/model.gguf", "model.gguf")).rejects.toThrow("network error")
  })
})

// ---------------------------------------------------------------------------
// deleteModel
// ---------------------------------------------------------------------------

describe("deleteModel", () => {
  test("passe filename à invoke", async () => {
    mockInvoke.mockResolvedValue(undefined)

    await deleteModel("old-model.gguf")

    expect(mockInvoke).toHaveBeenCalledWith("delete_model", { filename: "old-model.gguf" })
  })

  test("propage l'erreur invoke", async () => {
    mockInvoke.mockRejectedValue(new Error("file not found"))

    await expect(deleteModel("ghost.gguf")).rejects.toThrow("file not found")
  })
})

// ---------------------------------------------------------------------------
// loadModel
// ---------------------------------------------------------------------------

describe("loadModel", () => {
  test("passe filename, nCtx null, nThreads null et draftModel null par défaut", async () => {
    mockInvoke.mockResolvedValue(undefined)

    await loadModel("gemma-4.gguf")

    expect(mockInvoke).toHaveBeenCalledWith("load_llm_model", {
      filename: "gemma-4.gguf",
      nCtx: null,
      nThreads: null,
      draftModel: null,
    })
  })

  test("passe nCtx quand fourni", async () => {
    mockInvoke.mockResolvedValue(undefined)

    await loadModel("gemma-4.gguf", 4096)

    expect(mockInvoke).toHaveBeenCalledWith("load_llm_model", {
      filename: "gemma-4.gguf",
      nCtx: 4096,
      nThreads: null,
      draftModel: null,
    })
  })

  test("passe nCtx et nThreads quand les deux sont fournis", async () => {
    mockInvoke.mockResolvedValue(undefined)

    await loadModel("gemma-4.gguf", 8192, 4)

    expect(mockInvoke).toHaveBeenCalledWith("load_llm_model", {
      filename: "gemma-4.gguf",
      nCtx: 8192,
      nThreads: 4,
      draftModel: null,
    })
  })

  test("propage l'erreur invoke", async () => {
    mockInvoke.mockRejectedValue(new Error("model load failed"))

    await expect(loadModel("bad.gguf")).rejects.toThrow("model load failed")
  })
})

// ---------------------------------------------------------------------------
// unloadModel
// ---------------------------------------------------------------------------

describe("unloadModel", () => {
  test("appelle invoke avec unload_llm_model", async () => {
    mockInvoke.mockResolvedValue(undefined)

    await unloadModel()

    expect(mockInvoke).toHaveBeenCalledWith("unload_llm_model")
  })

  test("n'est appelé qu'une seule fois", async () => {
    mockInvoke.mockResolvedValue(undefined)

    await unloadModel()

    expect(mockInvoke).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// isModelLoaded
// ---------------------------------------------------------------------------

describe("isModelLoaded", () => {
  test("retourne true quand invoke retourne true", async () => {
    mockInvoke.mockResolvedValue(true)

    const result = await isModelLoaded()

    expect(result).toBe(true)
  })

  test("retourne false quand invoke retourne false", async () => {
    mockInvoke.mockResolvedValue(false)

    const result = await isModelLoaded()

    expect(result).toBe(false)
  })

  test("retourne false quand invoke lève une exception", async () => {
    mockInvoke.mockRejectedValue(new Error("IPC error"))

    const result = await isModelLoaded()

    expect(result).toBe(false)
  })

  test("appelle invoke avec is_llm_loaded", async () => {
    mockInvoke.mockResolvedValue(false)

    await isModelLoaded()

    expect(mockInvoke).toHaveBeenCalledWith("is_llm_loaded")
  })
})

// ---------------------------------------------------------------------------
// abortGeneration
// ---------------------------------------------------------------------------

describe("abortGeneration", () => {
  test("appelle invoke avec abort_llm", async () => {
    mockInvoke.mockResolvedValue(undefined)

    await abortGeneration()

    expect(mockInvoke).toHaveBeenCalledWith("abort_llm")
  })

  test("propage l'erreur invoke", async () => {
    mockInvoke.mockRejectedValue(new Error("abort failed"))

    await expect(abortGeneration()).rejects.toThrow("abort failed")
  })
})

// ---------------------------------------------------------------------------
// generateText
// ---------------------------------------------------------------------------

describe("generateText", () => {
  test("retourne la chaîne générée par invoke", async () => {
    mockInvoke.mockResolvedValue("Bonjour le monde")

    const result = await generateText("Dis bonjour")

    expect(result).toBe("Bonjour le monde")
  })

  test("passe prompt, maxTokens null et temperature null par défaut", async () => {
    mockInvoke.mockResolvedValue("")

    await generateText("Hello")

    expect(mockInvoke).toHaveBeenCalledWith("generate_llm", {
      prompt: "Hello",
      maxTokens: null,
      temperature: null,
    })
  })

  test("passe maxTokens quand fourni", async () => {
    mockInvoke.mockResolvedValue("")

    await generateText("Hello", 512)

    expect(mockInvoke).toHaveBeenCalledWith("generate_llm", {
      prompt: "Hello",
      maxTokens: 512,
      temperature: null,
    })
  })

  test("passe temperature quand fournie", async () => {
    mockInvoke.mockResolvedValue("")

    await generateText("Hello", undefined, 0.3)

    expect(mockInvoke).toHaveBeenCalledWith("generate_llm", {
      prompt: "Hello",
      maxTokens: null,
      temperature: 0.3,
    })
  })

  test("passe maxTokens et temperature ensemble", async () => {
    mockInvoke.mockResolvedValue("")

    await generateText("Hello", 256, 0.9)

    expect(mockInvoke).toHaveBeenCalledWith("generate_llm", {
      prompt: "Hello",
      maxTokens: 256,
      temperature: 0.9,
    })
  })

  test("propage l'erreur invoke", async () => {
    mockInvoke.mockRejectedValue(new Error("inference error"))

    await expect(generateText("fail")).rejects.toThrow("inference error")
  })
})

// ---------------------------------------------------------------------------
// checkLlmHealth
// ---------------------------------------------------------------------------

describe("checkLlmHealth", () => {
  test("retourne true quand le modèle est chargé", async () => {
    mockInvoke.mockResolvedValue(true)

    const result = await checkLlmHealth()

    expect(result).toBe(true)
  })

  test("retourne false quand le modèle n'est pas chargé", async () => {
    mockInvoke.mockResolvedValue(false)

    const result = await checkLlmHealth()

    expect(result).toBe(false)
  })

  test("délègue à isModelLoaded — appelle is_llm_loaded", async () => {
    mockInvoke.mockResolvedValue(true)

    await checkLlmHealth()

    expect(mockInvoke).toHaveBeenCalledWith("is_llm_loaded")
  })

  test("retourne false quand invoke lève une exception (via isModelLoaded)", async () => {
    mockInvoke.mockRejectedValue(new Error("IPC error"))

    const result = await checkLlmHealth()

    expect(result).toBe(false)
  })
})
