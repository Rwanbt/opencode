import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"

let mockInvoke: ReturnType<typeof mock>
let mockListen: ReturnType<typeof mock>

let ensureLocalLLMLoaded: typeof import("./use-auto-start-llm").ensureLocalLLMLoaded
let getDeviceMemoryInfo: typeof import("./use-auto-start-llm").getDeviceMemoryInfo
let markLocalLLMUnloaded: typeof import("./use-auto-start-llm").markLocalLLMUnloaded

beforeAll(async () => {
  mockInvoke = mock()
  // listen() doit retourner une fonction unlisten
  mockListen = mock(() => Promise.resolve(() => {}))

  mock.module("@tauri-apps/api/core", () => ({ invoke: mockInvoke }))
  mock.module("@tauri-apps/api/event", () => ({ listen: mockListen }))

  const mod = await import("./use-auto-start-llm")
  ensureLocalLLMLoaded = mod.ensureLocalLLMLoaded
  getDeviceMemoryInfo = mod.getDeviceMemoryInfo
  markLocalLLMUnloaded = mod.markLocalLLMUnloaded
})

beforeEach(() => {
  mockInvoke.mockReset()
  mockListen.mockReset()
  // Toujours reset unlisten par défaut
  mockListen.mockImplementation(() => Promise.resolve(() => {}))
  // Réinitialiser l'état du module entre les tests
  markLocalLLMUnloaded()
  // Vider localStorage
  localStorage.clear()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Configure invoke pour retourner des modèles pour list_models, et undefined pour le reste. */
function setupInvokeWithModels(models: Array<{ filename: string; size: number }>) {
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === "list_models") return Promise.resolve(models)
    return Promise.resolve(undefined)
  })
}

/** Collecte les CustomEvent dispatché sur window pendant l'exécution d'une fn async. */
async function collectWindowEvents(eventNames: string[], fn: () => Promise<void>): Promise<CustomEvent[]> {
  const collected: CustomEvent[] = []
  const handler = (e: Event) => collected.push(e as CustomEvent)
  for (const name of eventNames) window.addEventListener(name, handler)
  await fn()
  for (const name of eventNames) window.removeEventListener(name, handler)
  return collected
}

// ---------------------------------------------------------------------------
// ensureLocalLLMLoaded — guards d'entrée
// ---------------------------------------------------------------------------

describe("ensureLocalLLMLoaded — guards", () => {
  test("ne fait rien quand providerID n'est pas local-llm", async () => {
    await ensureLocalLLMLoaded("openai", "gpt-4o")

    expect(mockInvoke).not.toHaveBeenCalled()
  })

  test("ne fait rien quand providerID est undefined", async () => {
    await ensureLocalLLMLoaded(undefined, "gemma-4.gguf")

    expect(mockInvoke).not.toHaveBeenCalled()
  })

  test("ne fait rien quand modelID est undefined", async () => {
    await ensureLocalLLMLoaded("local-llm", undefined)

    expect(mockInvoke).not.toHaveBeenCalled()
  })

  test("ne fait rien quand modelID est une chaîne vide", async () => {
    await ensureLocalLLMLoaded("local-llm", "")

    expect(mockInvoke).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// ensureLocalLLMLoaded — aucun modèle trouvé
// ---------------------------------------------------------------------------

describe("ensureLocalLLMLoaded — no-model-found", () => {
  test("dispatche no-model-found quand list_models retourne []", async () => {
    setupInvokeWithModels([])

    const events = await collectWindowEvents(
      ["no-model-found", "llm-loading-progress"],
      () => ensureLocalLLMLoaded("local-llm", "gemma-4"),
    )

    const noModelEvent = events.find(e => e.type === "no-model-found")
    expect(noModelEvent).toBeDefined()
    expect((noModelEvent as CustomEvent).detail.modelID).toBe("gemma-4")
  })

  test("ne dispatche pas llm-loading-progress quand aucun modèle trouvé", async () => {
    setupInvokeWithModels([])

    const events = await collectWindowEvents(
      ["no-model-found", "llm-loading-progress"],
      () => ensureLocalLLMLoaded("local-llm", "gemma-4"),
    )

    const loadingEvents = events.filter(e => e.type === "llm-loading-progress")
    expect(loadingEvents).toHaveLength(0)
  })

  test("dispatche no-model-found quand aucun fichier ne correspond au modelID", async () => {
    setupInvokeWithModels([{ filename: "llama-3.2.gguf", size: 2_000_000_000 }])

    const events = await collectWindowEvents(
      ["no-model-found"],
      () => ensureLocalLLMLoaded("local-llm", "gemma-4"),
    )

    expect(events).toHaveLength(1)
    expect(events[0].detail.modelID).toBe("gemma-4")
  })

  test("n'appelle pas set_llm_config ni load_llm_model quand aucun modèle trouvé", async () => {
    setupInvokeWithModels([])

    await ensureLocalLLMLoaded("local-llm", "gemma-4")

    const calls = mockInvoke.mock.calls.map((c: unknown[]) => c[0])
    expect(calls).not.toContain("set_llm_config")
    expect(calls).not.toContain("load_llm_model")
  })
})

// ---------------------------------------------------------------------------
// ensureLocalLLMLoaded — modèle déjà chargé (skip)
// ---------------------------------------------------------------------------

describe("ensureLocalLLMLoaded — déjà chargé", () => {
  test("ne recharge pas si currentlyLoaded === filename", async () => {
    setupInvokeWithModels([{ filename: "gemma-4.gguf", size: 4_000_000_000 }])

    // Premier chargement
    await ensureLocalLLMLoaded("local-llm", "gemma-4")
    const firstCallCount = mockInvoke.mock.calls.length

    mockInvoke.mockReset()
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_models") return Promise.resolve([{ filename: "gemma-4.gguf", size: 4_000_000_000 }])
      return Promise.resolve(undefined)
    })
    mockListen.mockImplementation(() => Promise.resolve(() => {}))

    // Deuxième appel avec le même fichier
    await ensureLocalLLMLoaded("local-llm", "gemma-4")

    // Après le deuxième appel, seul list_models devrait être appelé (pour findGGUFFile)
    // set_llm_config et load_llm_model ne doivent PAS être rappelés
    const secondCalls = mockInvoke.mock.calls.map((c: unknown[]) => c[0])
    expect(secondCalls).not.toContain("set_llm_config")
    expect(secondCalls).not.toContain("load_llm_model")
    expect(firstCallCount).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// ensureLocalLLMLoaded — chargement réussi
// ---------------------------------------------------------------------------

describe("ensureLocalLLMLoaded — chargement réussi", () => {
  test("dispatche llm-loading-progress {loading: true} au début", async () => {
    setupInvokeWithModels([{ filename: "gemma-4.gguf", size: 4_000_000_000 }])

    const events = await collectWindowEvents(
      ["llm-loading-progress"],
      () => ensureLocalLLMLoaded("local-llm", "gemma-4"),
    )

    const startEvent = events.find(e => e.detail.loading === true && e.detail.filename)
    expect(startEvent).toBeDefined()
    expect(startEvent!.detail.filename).toBe("gemma-4.gguf")
    expect(startEvent!.detail.elapsed_secs).toBe(0)
    expect(startEvent!.detail.max_secs).toBe(240)
  })

  test("dispatche llm-loading-progress {loading: false} en finally après succès", async () => {
    setupInvokeWithModels([{ filename: "gemma-4.gguf", size: 4_000_000_000 }])

    const events = await collectWindowEvents(
      ["llm-loading-progress"],
      () => ensureLocalLLMLoaded("local-llm", "gemma-4"),
    )

    const endEvent = events.find(e => e.detail.loading === false)
    expect(endEvent).toBeDefined()
  })

  test("appelle set_llm_config avant load_llm_model", async () => {
    setupInvokeWithModels([{ filename: "gemma-4.gguf", size: 4_000_000_000 }])

    await ensureLocalLLMLoaded("local-llm", "gemma-4")

    const commands = mockInvoke.mock.calls.map((c: unknown[]) => c[0])
    const setIdx = commands.indexOf("set_llm_config")
    const loadIdx = commands.indexOf("load_llm_model")
    expect(setIdx).toBeGreaterThanOrEqual(0)
    expect(loadIdx).toBeGreaterThanOrEqual(0)
    expect(setIdx).toBeLessThan(loadIdx)
  })

  test("appelle load_llm_model avec le bon filename", async () => {
    setupInvokeWithModels([{ filename: "gemma-4.gguf", size: 4_000_000_000 }])

    await ensureLocalLLMLoaded("local-llm", "gemma-4")

    const loadCall = mockInvoke.mock.calls.find((c: unknown[]) => c[0] === "load_llm_model")
    expect(loadCall).toBeDefined()
    expect((loadCall as unknown[])[1]).toMatchObject({ filename: "gemma-4.gguf" })
  })

  test("appelle listen pour s'abonner aux événements de progression Rust", async () => {
    setupInvokeWithModels([{ filename: "gemma-4.gguf", size: 4_000_000_000 }])

    await ensureLocalLLMLoaded("local-llm", "gemma-4")

    expect(mockListen).toHaveBeenCalledWith("llm-model-loading", expect.any(Function))
  })

  test("appelle unlisten après le chargement", async () => {
    const unlistenFn = mock()
    mockListen.mockImplementation(() => Promise.resolve(unlistenFn))
    setupInvokeWithModels([{ filename: "gemma-4.gguf", size: 4_000_000_000 }])

    await ensureLocalLLMLoaded("local-llm", "gemma-4")

    expect(unlistenFn).toHaveBeenCalled()
  })

  test("trouve le modèle par correspondance exacte avec extension .gguf", async () => {
    setupInvokeWithModels([{ filename: "gemma-4.gguf", size: 4_000_000_000 }])

    await ensureLocalLLMLoaded("local-llm", "gemma-4.gguf")

    const loadCall = mockInvoke.mock.calls.find((c: unknown[]) => c[0] === "load_llm_model")
    expect(loadCall).toBeDefined()
    expect((loadCall as unknown[])[1]).toMatchObject({ filename: "gemma-4.gguf" })
  })

  test("trouve le modèle par correspondance partielle (strip quality markers)", async () => {
    setupInvokeWithModels([{ filename: "gemma-4-Q4_0.gguf", size: 4_000_000_000 }])

    await ensureLocalLLMLoaded("local-llm", "gemma-4")

    const loadCall = mockInvoke.mock.calls.find((c: unknown[]) => c[0] === "load_llm_model")
    expect(loadCall).toBeDefined()
    expect((loadCall as unknown[])[1]).toMatchObject({ filename: "gemma-4-Q4_0.gguf" })
  })
})

// ---------------------------------------------------------------------------
// ensureLocalLLMLoaded — chargement en erreur
// ---------------------------------------------------------------------------

describe("ensureLocalLLMLoaded — erreur de chargement", () => {
  test("dispatche llm-loading-progress {loading: false} en finally même après erreur", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_models") return Promise.resolve([{ filename: "gemma-4.gguf", size: 4_000_000_000 }])
      if (cmd === "load_llm_model") return Promise.reject(new Error("load failed"))
      return Promise.resolve(undefined)
    })

    const events = await collectWindowEvents(
      ["llm-loading-progress"],
      () => ensureLocalLLMLoaded("local-llm", "gemma-4"),
    )

    const endEvent = events.find(e => e.detail.loading === false)
    expect(endEvent).toBeDefined()
  })

  test("appelle unlisten même quand load_llm_model échoue", async () => {
    const unlistenFn = mock()
    mockListen.mockImplementation(() => Promise.resolve(unlistenFn))
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_models") return Promise.resolve([{ filename: "gemma-4.gguf", size: 4_000_000_000 }])
      if (cmd === "load_llm_model") return Promise.reject(new Error("load failed"))
      return Promise.resolve(undefined)
    })

    await ensureLocalLLMLoaded("local-llm", "gemma-4")

    expect(unlistenFn).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// ensureLocalLLMLoaded — config localStorage
// ---------------------------------------------------------------------------

describe("ensureLocalLLMLoaded — config localStorage", () => {
  test("utilise les valeurs de DEFAULT_CONFIG quand localStorage est vide", async () => {
    setupInvokeWithModels([{ filename: "gemma-4.gguf", size: 4_000_000_000 }])
    localStorage.clear()

    await ensureLocalLLMLoaded("local-llm", "gemma-4")

    const configCall = mockInvoke.mock.calls.find((c: unknown[]) => c[0] === "set_llm_config")
    expect(configCall).toBeDefined()
    const args = (configCall as unknown[])[1] as Record<string, unknown>
    expect(args.kvCacheType).toBe("q4_0")
    expect(args.flashAttn).toBe(true)
    expect(args.offloadMode).toBe("auto")
  })

  test("utilise les valeurs de localStorage quand disponibles", async () => {
    setupInvokeWithModels([{ filename: "gemma-4.gguf", size: 4_000_000_000 }])
    localStorage.setItem("opencode-model-config", JSON.stringify({ kvCacheType: "f16", threads: 8, temperature: 0.5 }))

    await ensureLocalLLMLoaded("local-llm", "gemma-4")

    const configCall = mockInvoke.mock.calls.find((c: unknown[]) => c[0] === "set_llm_config")
    expect(configCall).toBeDefined()
    const args = (configCall as unknown[])[1] as Record<string, unknown>
    expect(args.kvCacheType).toBe("f16")
    expect(args.threads).toBe(8)
    expect(args.temperature).toBe(0.5)
  })
})

// ---------------------------------------------------------------------------
// ensureLocalLLMLoaded — circuit breaker crash-loop (OOM whole-process kill)
// ---------------------------------------------------------------------------

describe("ensureLocalLLMLoaded — circuit breaker crash-loop", () => {
  // The actual crash-loop detection (durable marker + fail count) lives in
  // Rust now (llm.rs::load_llm_model) — a WebView localStorage marker isn't
  // reliable here since the whole app process gets OOM-killed and
  // localStorage writes aren't guaranteed to be flushed by then (confirmed
  // on-device). JS only needs to react to the "blocked:" error Rust returns.

  test("load_llm_model n'est appelé qu'avec filename et draftModel (pas de tier calculé côté JS)", async () => {
    setupInvokeWithModels([{ filename: "gemma-4.gguf", size: 4_000_000_000 }])

    await ensureLocalLLMLoaded("local-llm", "gemma-4")

    const loadCall = mockInvoke.mock.calls.find((c: unknown[]) => c[0] === "load_llm_model")
    expect(loadCall).toBeDefined()
    expect((loadCall as unknown[])[1]).toEqual({ filename: "gemma-4.gguf", draftModel: null })
  })

  test("une erreur 'blocked: ...' dispatche llm-load-blocked au lieu d'un console.error", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_models") return Promise.resolve([{ filename: "gemma-4.gguf", size: 4_000_000_000 }])
      if (cmd === "load_llm_model") return Promise.reject(new Error("blocked: gemma-4.gguf crashed the app repeatedly while loading"))
      return Promise.resolve(undefined)
    })

    const events = await collectWindowEvents(
      ["llm-load-blocked"],
      () => ensureLocalLLMLoaded("local-llm", "gemma-4"),
    )

    const blockedEvent = events.find(e => e.type === "llm-load-blocked")
    expect(blockedEvent).toBeDefined()
    expect((blockedEvent as CustomEvent).detail.filename).toBe("gemma-4.gguf")
  })

  test("une erreur ordinaire ne dispatche pas llm-load-blocked", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_models") return Promise.resolve([{ filename: "gemma-4.gguf", size: 4_000_000_000 }])
      if (cmd === "load_llm_model") return Promise.reject(new Error("Model not found: gemma-4.gguf"))
      return Promise.resolve(undefined)
    })

    const events = await collectWindowEvents(
      ["llm-load-blocked"],
      () => ensureLocalLLMLoaded("local-llm", "gemma-4"),
    )

    expect(events.find(e => e.type === "llm-load-blocked")).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// markLocalLLMUnloaded
// ---------------------------------------------------------------------------

describe("markLocalLLMUnloaded", () => {
  test("remet currentlyLoaded à null — permet un rechargement du même modèle", async () => {
    setupInvokeWithModels([{ filename: "gemma-4.gguf", size: 4_000_000_000 }])

    // Première charge — currentlyLoaded devient "gemma-4.gguf"
    await ensureLocalLLMLoaded("local-llm", "gemma-4")

    // Réinitialise l'état
    markLocalLLMUnloaded()
    mockInvoke.mockReset()
    mockListen.mockReset()
    mockListen.mockImplementation(() => Promise.resolve(() => {}))
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_models") return Promise.resolve([{ filename: "gemma-4.gguf", size: 4_000_000_000 }])
      return Promise.resolve(undefined)
    })

    // Deuxième appel — doit recharger car currentlyLoaded === null
    await ensureLocalLLMLoaded("local-llm", "gemma-4")

    const loadCall = mockInvoke.mock.calls.find((c: unknown[]) => c[0] === "load_llm_model")
    expect(loadCall).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// getDeviceMemoryInfo
// ---------------------------------------------------------------------------

describe("getDeviceMemoryInfo", () => {
  test("retourne les infos mémoire converties depuis le format Rust", async () => {
    mockInvoke.mockResolvedValue({ total_mb: 12_288, available_mb: 8_192, used_mb: 4_096 })

    const result = await getDeviceMemoryInfo()

    expect(result).toEqual({ totalMb: 12_288, availableMb: 8_192, usedMb: 4_096 })
  })

  test("retourne null quand invoke lève une exception", async () => {
    mockInvoke.mockRejectedValue(new Error("memory read error"))

    const result = await getDeviceMemoryInfo()

    expect(result).toBeNull()
  })

  test("appelle invoke avec get_memory_info", async () => {
    mockInvoke.mockResolvedValue({ total_mb: 8_192, available_mb: 4_096, used_mb: 4_096 })

    await getDeviceMemoryInfo()

    expect(mockInvoke).toHaveBeenCalledWith("get_memory_info")
  })
})
