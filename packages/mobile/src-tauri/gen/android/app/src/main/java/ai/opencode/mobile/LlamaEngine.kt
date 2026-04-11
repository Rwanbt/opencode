package ai.opencode.mobile

import android.util.Log

/**
 * JNI bridge to llama.cpp for local LLM inference.
 * Loads GGUF models and generates text with streaming token callbacks.
 */
object LlamaEngine {
    private const val TAG = "LlamaEngine"
    private var initialized = false

    /** Store the app ClassLoader so Rust JNI threads can find our classes */
    @JvmField
    var appClassLoader: ClassLoader? = null

    /** Callback interface for streaming tokens during generation */
    interface TokenCallback {
        fun onToken(token: String)
    }

    init {
        try {
            // Load llama.cpp shared libraries in dependency order
            System.loadLibrary("ggml")
            System.loadLibrary("ggml-base")
            System.loadLibrary("ggml-cpu")

            // Smart GPU backend selection based on device capabilities
            // Vulkan 1.3+ (Adreno 730+/SD 8 Gen 1+) → Vulkan (fastest, most mature)
            // Vulkan 1.1 (Adreno 6xx) → OpenCL only (Vulkan too slow on old drivers)
            // No GPU → CPU fallback
            val useVulkan = detectVulkanCapable()
            if (useVulkan) {
                try { System.loadLibrary("ggml-vulkan"); Log.i(TAG, "Vulkan backend loaded (preferred for this device)") } catch (_: UnsatisfiedLinkError) {
                    Log.w(TAG, "Vulkan load failed, trying OpenCL")
                    try { System.loadLibrary("ggml-opencl"); Log.i(TAG, "OpenCL backend loaded (fallback)") } catch (_: UnsatisfiedLinkError) {
                        Log.w(TAG, "No GPU backend available, CPU only")
                    }
                }
            } else {
                try { System.loadLibrary("ggml-opencl"); Log.i(TAG, "OpenCL backend loaded (preferred for this device)") } catch (_: UnsatisfiedLinkError) {
                    Log.w(TAG, "OpenCL not available, trying Vulkan")
                    try { System.loadLibrary("ggml-vulkan"); Log.i(TAG, "Vulkan backend loaded (fallback)") } catch (_: UnsatisfiedLinkError) {
                        Log.w(TAG, "No GPU backend available, CPU only")
                    }
                }
            }

            System.loadLibrary("llama")
            System.loadLibrary("llama_jni")
            Log.i(TAG, "Native libraries loaded successfully")
            appClassLoader = LlamaEngine::class.java.classLoader
        } catch (e: UnsatisfiedLinkError) {
            Log.e(TAG, "Failed to load native libraries: ${e.message}")
        }
    }

    /** Detect big/prime CPU cores by reading max frequencies from sysfs.
     *  Returns a bitmask where each bit represents a core (1=big, 0=LITTLE).
     *  E.g., SD8Gen3: cores 2-7 are big → 0xFC, SD865: cores 4-7 → 0xF0 */
    private fun detectBigCoreMask(): Int {
        try {
            val nCores = Runtime.getRuntime().availableProcessors()
            val freqs = mutableListOf<Pair<Int, Long>>()  // (core_index, max_freq_khz)

            for (i in 0 until nCores) {
                val freq = try {
                    java.io.File("/sys/devices/system/cpu/cpu$i/cpufreq/cpuinfo_max_freq")
                        .readText().trim().toLong()
                } catch (_: Exception) { 0L }
                freqs.add(i to freq)
            }

            if (freqs.isEmpty() || freqs.all { it.second == 0L }) {
                // Fallback: assume top half of cores are big
                val mask = ((1 shl nCores) - 1) and (((1 shl nCores) - 1) xor ((1 shl (nCores / 2)) - 1))
                Log.w(TAG, "CPU freq detection failed, using fallback mask: 0x${Integer.toHexString(mask)}")
                return mask
            }

            // Find the threshold: big cores have significantly higher max freq than LITTLE cores
            val maxFreq = freqs.maxOf { it.second }
            val threshold = maxFreq * 70 / 100  // Cores with >70% of max freq are "big"

            var mask = 0
            for ((core, freq) in freqs) {
                if (freq >= threshold) {
                    mask = mask or (1 shl core)
                }
            }

            Log.i(TAG, "CPU freqs: ${freqs.map { "${it.first}:${it.second/1000}MHz" }}")
            Log.i(TAG, "Big core mask: 0x${Integer.toHexString(mask)} (threshold=${threshold/1000}MHz)")
            return if (mask != 0) mask else ((1 shl nCores) - 1)  // Fallback to all cores
        } catch (e: Exception) {
            Log.w(TAG, "CPU topology detection failed: ${e.message}")
            return 0xFF  // Default: all 8 cores
        }
    }

    /** Detect if Vulkan is the preferred GPU backend for this device.
     *  Vulkan 1.3+ devices (Adreno 730+) work well with Vulkan.
     *  Older devices (Adreno 6xx, Vulkan 1.1) should use OpenCL. */
    private fun detectVulkanCapable(): Boolean {
        // Check Vulkan version from ActivityManager GPU info
        try {
            val vulkanVersion = android.app.ActivityManager.RunningAppProcessInfo().let {
                // Use system property as a simpler approach
                val prop = Runtime.getRuntime().exec("getprop ro.hardware.vulkan").inputStream.bufferedReader().readLine()?.trim() ?: ""
                Log.i(TAG, "Vulkan hardware: $prop")
                prop
            }
            // Adreno 730+ (SD 8 Gen 1+) → Vulkan capable
            // Check via Android API level + hardware
            val sdkVersion = android.os.Build.VERSION.SDK_INT
            val board = android.os.Build.BOARD.lowercase()
            val hardware = android.os.Build.HARDWARE.lowercase()
            val soc = if (android.os.Build.VERSION.SDK_INT >= 31) android.os.Build.SOC_MODEL.lowercase() else ""
            Log.i(TAG, "Device: board=$board, hardware=$hardware, soc=$soc, sdk=$sdkVersion")

            // Snapdragon 8 Gen 1+ (SM8450+) have Adreno 730+ with good Vulkan
            // SM8450=SD8Gen1, SM8475=SD8+Gen1, SM8550=SD8Gen2, SM8650=SD8Gen3
            val modernSnapdragon = soc.contains("sm8") && !soc.contains("sm8150") && !soc.contains("sm8250") && !soc.contains("sm8350")
            if (modernSnapdragon) {
                Log.i(TAG, "Modern Snapdragon detected ($soc) — using Vulkan")
                return true
            }

            // Dimensity 9000+ (MT6983+), Exynos 2200+ also have good Vulkan
            if (soc.contains("mt698") || soc.contains("mt699") || soc.contains("s5e9") || soc.contains("s5e8")) {
                Log.i(TAG, "Modern SoC detected ($soc) — using Vulkan")
                return true
            }

            Log.i(TAG, "Older SoC ($soc) — using OpenCL")
            return false
        } catch (e: Exception) {
            Log.w(TAG, "GPU detection failed: ${e.message}, defaulting to OpenCL")
            return false
        }
    }

    /** Store the native library directory so backends can be loaded from it */
    @JvmField
    var nativeLibDir: String? = null

    /** Initialize the llama backend (call once at startup).
     *  Disables the unwanted GPU backend via env var before loading. */
    fun init() {
        if (!initialized) {
            val preferVulkan = detectVulkanCapable()
            if (preferVulkan) {
                // Modern SoC (Adreno 730+): use Vulkan GPU, disable OpenCL
                setenv("GGML_DISABLE_OPENCL", "1")
                Log.i(TAG, "Disabling OpenCL backend (Vulkan preferred)")
            } else {
                // Older SoC (Adreno 6xx): GPU too slow for LLM, disable BOTH backends → pure CPU
                setenv("GGML_DISABLE_VULKAN", "1")
                setenv("GGML_DISABLE_OPENCL", "1")
                Log.i(TAG, "Disabling all GPU backends (CPU-only mode, faster on old SoCs)")
            }
            initBackend()
            initialized = true
            Log.i(TAG, "Backend initialized (${if (preferVulkan) "Vulkan" else "CPU-only"})")
        }
    }

    /**
     * Start a background thread that polls for model load/unload requests.
     * Rust writes commands to requestFile, Kotlin reads and executes them.
     */
    fun startCommandLoop(requestFile: java.io.File, resultFile: java.io.File) {
        Thread {
            Log.i(TAG, "Command loop started, watching: ${requestFile.absolutePath}")
            while (true) {
                try {
                    if (requestFile.exists()) {
                        val cmd = requestFile.readText().trim()
                        requestFile.delete()

                        Log.i(TAG, "Received command: $cmd")
                        val parts = cmd.split("|", limit = 2)
                        val action = parts[0]
                        val arg = parts.getOrElse(1) { "" }

                        val result = when (action) {
                            "load" -> {
                                if (arg.isEmpty()) "error:No model path provided"
                                else {
                                    val success = load(arg, 4096, 4)
                                    if (success) "ok" else "error:Failed to load model"
                                }
                            }
                            "unload" -> { unload(); "ok" }
                            "loaded" -> if (loaded()) "true" else "false"
                            "stop" -> { stop(); "ok" }
                            "generate" -> {
                                val genParts = arg.split("|", limit = 3)
                                val prompt = genParts.getOrElse(0) { "" }
                                if (prompt.isEmpty()) "error:Empty prompt"
                                else {
                                    val maxTokens = genParts.getOrElse(1) { "512" }.toIntOrNull() ?: 512
                                    val temp = genParts.getOrElse(2) { "0.7" }.toFloatOrNull() ?: 0.7f
                                    chat(prompt, maxTokens, temp)
                                }
                            }
                            else -> "error:Unknown command: $action"
                        }

                        resultFile.writeText(result)
                        Log.i(TAG, "Command result: ${result.take(100)}")
                    }
                    Thread.sleep(100)
                } catch (e: Exception) {
                    Log.e(TAG, "Command loop error: ${e.message}")
                    try { resultFile.writeText("error:${e.message}") } catch (_: Exception) {}
                    Thread.sleep(500)
                }
            }
        }.apply { isDaemon = true }.start()
    }

    private var serverProcess: Process? = null

    /** GPU backend selection result.
     *  OpenCL intentionally omitted: the _opencl.so variant is an unvalidated
     *  orphan artifact (no build script, no test). Older SoCs fall back to CPU. */
    private enum class Backend { CPU, VULKAN }

    /** Load a GGUF model via external llama-server process.
     *  Backend selection (empirically validated on mobile):
     *  - Small models (<1.5GB quantized, ~<2B params): CPU NEON/dotprod
     *    is faster than GPU due to transfer overhead and kernel launch cost.
     *  - Large models (≥1.5GB) on modern SoCs (Vulkan 1.3+ / Adreno 730+):
     *    Vulkan via libllama_server.so (built with -DGGML_VULKAN=ON).
     *  - Large models on older SoCs: CPU NEON/dotprod (slower but functional). */
    fun load(modelPath: String, contextSize: Int = 4096, threads: Int = 4): Boolean {
        init()
        stopServer()

        val modelFile = java.io.File(modelPath)
        val modelSizeMB = modelFile.length() / (1024 * 1024)
        val isLargeModel = modelSizeMB > 1500  // >1.5GB ~ >2B params quantized
        val vulkanCapable = detectVulkanCapable()

        val backend = when {
            !isLargeModel -> Backend.CPU
            vulkanCapable -> Backend.VULKAN
            else -> Backend.CPU  // older SoC: CPU fallback (no OpenCL)
        }
        Log.i(TAG, "Model: ${modelFile.name} (${modelSizeMB}MB), vulkanCapable=$vulkanCapable, backend=$backend")

        // Read config from IPC file (written by Rust backend)
        val config = readLlmConfig(modelPath)
        return startServer(modelPath, contextSize, backend, config)
    }

    /** Configuration for llama-server, read from IPC config file */
    data class LlmConfig(
        val kvCacheType: String = "q4_0",
        val flashAttn: Boolean = true,
        val offloadMode: String = "auto",
        val mmapMode: String = "auto",
        val draftModelPath: String? = null,
        val nGpuLayers: Int = 0,
    )

    /** Read LLM config from IPC file written by Rust backend */
    private fun readLlmConfig(modelPath: String): LlmConfig {
        try {
            val configFile = java.io.File(modelPath).parentFile?.parentFile?.let {
                java.io.File(it, "llm_ipc/llm_config")
            }
            if (configFile != null && configFile.exists()) {
                val lines = configFile.readLines()
                var kvCache = "q4_0"
                var flashAttn = true
                var offload = "auto"
                var mmap = "auto"
                var draftModel: String? = null
                var ngl = 0
                for (line in lines) {
                    val parts = line.split("=", limit = 2)
                    if (parts.size != 2) continue
                    when (parts[0].trim()) {
                        "kv_cache_type" -> kvCache = parts[1].trim()
                        "flash_attn" -> flashAttn = parts[1].trim() == "true"
                        "offload_mode" -> offload = parts[1].trim()
                        "mmap_mode" -> mmap = parts[1].trim()
                        "draft_model" -> draftModel = parts[1].trim().ifEmpty { null }
                        "n_gpu_layers" -> ngl = parts[1].trim().toIntOrNull() ?: 0
                    }
                }
                Log.i(TAG, "Config: kv=$kvCache, flash=$flashAttn, offload=$offload, mmap=$mmap, draft=$draftModel, ngl=$ngl")
                return LlmConfig(kvCache, flashAttn, offload, mmap, draftModel, ngl)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to read LLM config: ${e.message}")
        }
        return LlmConfig()
    }

    /** Start only the llama-server HTTP process (Vulkan GPU). Skip JNI model loading. */
    fun startServerOnly(modelPath: String, contextSize: Int = 4096) {
        init()
        stopServer()
        startServer(modelPath, contextSize)
    }

    /** Unload the current model and free memory */
    fun unload() {
        LlamaHttpServer.stop()
        stopServer()
        unloadModel()
        Log.i(TAG, "Model unloaded")
    }

    private fun startServer(modelPath: String, ctxSize: Int, backend: Backend = Backend.CPU, config: LlmConfig = LlmConfig()): Boolean {
        try {
            // Use nativeLibDir field set by MainActivity, fallback to file
            var libDir = nativeLibDir
            if (libDir == null) {
                val possiblePaths = listOf(
                    "/data/data/ai.opencode.mobile/runtime/.native_lib_dir",
                    "/data/user/0/ai.opencode.mobile/runtime/.native_lib_dir"
                )
                for (p in possiblePaths) {
                    val f = java.io.File(p)
                    if (f.exists()) {
                        libDir = f.readText().trim()
                        break
                    }
                }
            }

            if (libDir == null) {
                Log.w(TAG, "Cannot find nativeLibraryDir, skipping HTTP server")
                return false
            }
            val nativeLibDir = libDir

            // Only libllama_server.so is produced by the build scripts
            // (packages/mobile/scripts/build-llama-server.sh with -DGGML_VULKAN=ON).
            // The _vulkan / _opencl / _modern variants are unvalidated orphan artifacts.
            val serverBin = java.io.File(nativeLibDir, "libllama_server.so")
            if (!serverBin.exists()) {
                Log.w(TAG, "No llama-server binary found at ${serverBin.absolutePath}")
                return false
            }
            Log.i(TAG, "Selected server binary: ${serverBin.name} (backend=$backend)")

            val homeDir = java.io.File(modelPath).parentFile?.parentFile?.let { java.io.File(it, "home") }
            homeDir?.mkdirs()

            // GPU layer offload — only when using a GPU backend.
            // CPU backend must use ngl=0 (no GPU transfer overhead).
            val useGpu = backend != Backend.CPU
            val ngl = if (useGpu) "99" else "0"

            // Offload mode → -fitt value (MiB free headroom, GPU only)
            val fittHeadroom = when (config.offloadMode) {
                "gpu-max" -> "256"
                "balanced" -> "1024"
                else -> "512"  // auto
            }

            // Thread count: follow PocketPal AI heuristic (proven on Android for
            // Gemma/Qwen inference). Use floor(cores * 0.8) for devices >4 cores,
            // else use all cores. llama.cpp's internal threadpool handles scheduling.
            // We deliberately do NOT pin threads to big cores via --cpu-mask: Android
            // sandbox (cgroup v2, SELinux) can silently reject sched_setaffinity calls,
            // and PocketPal — which works — does no pinning at all.
            val nCores = Runtime.getRuntime().availableProcessors()
            val nThreads = if (nCores <= 4) nCores else (nCores * 8 / 10).coerceAtLeast(2)
            Log.i(TAG, "CPU topology: nCores=$nCores, nThreads=$nThreads (PocketPal heuristic)")

            val args = mutableListOf(
                serverBin.absolutePath,
                "-m", modelPath,
                "--host", "127.0.0.1",
                "--port", "14097",
                "--n-gpu-layers", ngl,
                "--threads", nThreads.toString(),
                "--threads-batch", nThreads.toString(),
                "--batch-size", "512",
                "--jinja",
                // Single slot to minimize memory usage
                "-np", "1"
            )

            // Context size strategy:
            // - GPU backend: --fit on -fitc 16384 auto-scales to VRAM (floor 16K)
            // - CPU backend: fixed 4096. Prompt eval on mobile CPU NEON for a 7B
            //   model is ~50-100 tok/s, so 4K ctx = ~40-80s worst case prefill.
            //   Larger ctx would blow prompt eval latency past acceptable.
            //   Manual test proved 2048 ctx generates at ~1.5 tok/s on SM8250
            //   (see session logs); 4096 is the compromise sweet spot.
            if (useGpu) {
                args.addAll(listOf(
                    "--fit", "on",
                    "-fitt", fittHeadroom,
                    "-fitc", "16384"
                ))
            } else {
                args.addAll(listOf("--ctx-size", "4096"))
            }

            // KV cache quantization — q4_0 saves ~72% KV memory but llama.cpp
            // HARD REQUIRES flash_attn=on when V cache is quantized. If we disable
            // FA with quantized V, llama_init_from_model returns NULL and the next
            // llama_n_ctx() call segfaults with a null pointer deref.
            // → Rule: quantized KV ⇒ flash-attn on (regardless of CPU/GPU).
            val kvType = config.kvCacheType
            val kvQuantized = kvType != "f16"
            if (kvQuantized) {
                args.addAll(listOf("--cache-type-k", kvType, "--cache-type-v", kvType))
                Log.i(TAG, "KV cache quantization: $kvType (forces --flash-attn on)")
            }

            // Flash Attention:
            // - Forced ON if KV is quantized (llama.cpp hard requirement)
            // - Otherwise: on in GPU, off in CPU (batch=1 decode overhead)
            val flashAttnOn = kvQuantized || (useGpu && config.flashAttn)
            if (flashAttnOn) {
                args.addAll(listOf("--flash-attn", "on"))
                Log.i(TAG, "Flash Attention enabled (kvQuantized=$kvQuantized, useGpu=$useGpu)")
            } else {
                args.addAll(listOf("--flash-attn", "off"))
                Log.i(TAG, "Flash Attention disabled")
            }

            // Memory mapping: the device (8 GB RAM on SM8250 with ~3 GB system
            // overhead) cannot fit a 4.9 GB model + 1.25 GB KV cache as anonymous
            // pages — it triggers OOM cascade that kills launcher, keyboard,
            // Google Play Services, and our app in the process.
            //
            // With mmap=ON, the model weights are clean file-backed pages that
            // the kernel can page out when memory pressure rises, then re-read
            // on demand from storage. On UFS 3.0 (SM8250) this is ~1-2 GB/s
            // read bandwidth — slower per-token than pure RAM, but physically
            // possible unlike --no-mmap which OOMs the entire system.
            //
            // PocketPal AI recommends mmap=OFF, but their default model is
            // Gemma-2-2B (2 GB) which fits anonymous-page-style. For 7B+ models
            // on 8 GB devices, mmap=ON is the only viable path.
            when (config.mmapMode) {
                "off" -> { args.add("--no-mmap"); Log.i(TAG, "mmap disabled (user override)") }
                "on" -> Log.i(TAG, "mmap enabled (default)")
                else -> Log.i(TAG, "mmap auto (llama.cpp default = ON)")
            }

            // Speculative decoding with draft model — GPU-only feature.
            // On CPU, running two models concurrently on the same cores is
            // net-negative: the draft model steals compute that the main model
            // needs, and the validation batch is bound by the same CPU anyway.
            // Only enable speculative decoding when we're actually offloading to GPU.
            if (useGpu && config.draftModelPath != null) {
                val draftFile = java.io.File(config.draftModelPath)
                if (draftFile.exists()) {
                    val freeRamMB = getAvailableRamMB()
                    if (freeRamMB > 1000) {
                        args.addAll(listOf(
                            "--model-draft", config.draftModelPath,
                            "--draft", "16",
                            "--draft-p-min", "0.75"
                        ))
                        Log.i(TAG, "Speculative decoding enabled: ${draftFile.name} (free RAM: ${freeRamMB}MB)")
                    } else {
                        Log.i(TAG, "Speculative decoding skipped (free RAM: ${freeRamMB}MB < 1000MB)")
                    }
                } else {
                    Log.w(TAG, "Draft model not found: ${config.draftModelPath}")
                }
            } else if (config.draftModelPath != null) {
                Log.i(TAG, "Speculative decoding skipped (CPU backend — GPU only feature)")
            }

            Log.i(TAG, "Starting server: ${serverBin.name} backend=$backend ngl=$ngl kv=${config.kvCacheType} flash=${config.flashAttn}")

            // Delegate spawn to LlamaService (Foreground Service).
            // The child process inherits foreground priority and is exempt from
            // Android PhantomProcessKiller + MIUI SmartPower + Doze kill.
            val service = LlamaService.waitForInstance(5_000)
            if (service == null) {
                Log.e(TAG, "LlamaService not available — cannot spawn llama-server safely")
                return false
            }
            service.updateNotification("OpenCode", "Loading ${java.io.File(modelPath).name}…")
            val envOverrides = mapOf(
                "HOME" to (homeDir?.absolutePath ?: "/tmp"),
                "TMPDIR" to (homeDir?.absolutePath ?: "/tmp"),
                "LD_LIBRARY_PATH" to "$nativeLibDir:/vendor/lib64:/system/vendor/lib64"
            )
            val spawned = service.spawnServer(args, envOverrides)
            if (spawned == null) {
                Log.e(TAG, "LlamaService.spawnServer returned null")
                return false
            }
            serverProcess = spawned
            Log.i(TAG, "llama-server spawned via LlamaService on port 14097 (backend=$backend), waiting for readiness...")

            // Readiness loop: poll /v1/models until 200 OK, up to 180s.
            // /health returns 200 as soon as the HTTP listener binds (even while the
            // model is still loading in b8683). /v1/models only returns 200 once the
            // model is actually loaded and ready to serve inference — the signal we need.
            val startTime = System.currentTimeMillis()
            val timeoutMs = 180_000L
            var ready = false
            while (System.currentTimeMillis() - startTime < timeoutMs) {
                // Bail out early if the child process died
                val proc = serverProcess
                if (proc != null && !proc.isAlive) {
                    Log.e(TAG, "llama-server died during startup (exit=${proc.exitValue()})")
                    return false
                }
                try {
                    val conn = java.net.URL("http://127.0.0.1:14097/v1/models").openConnection() as java.net.HttpURLConnection
                    conn.connectTimeout = 500
                    conn.readTimeout = 500
                    val code = conn.responseCode
                    conn.disconnect()
                    if (code == 200) {
                        ready = true
                        break
                    }
                } catch (_: Exception) {
                    // Not ready yet, keep polling
                }
                Thread.sleep(500)
            }
            val elapsed = System.currentTimeMillis() - startTime
            if (!ready) {
                Log.e(TAG, "llama-server readiness timeout after ${elapsed}ms")
                return false
            }
            Log.i(TAG, "llama-server ready after ${elapsed}ms (backend=$backend)")
            return true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start llama-server: ${e.message}")
            return false
        }
    }

    /** Get available RAM in MB using /proc/meminfo (more reliable than ActivityManager) */
    private fun getAvailableRamMB(): Long {
        try {
            val meminfo = java.io.File("/proc/meminfo").readText()
            for (line in meminfo.lines()) {
                if (line.startsWith("MemAvailable:")) {
                    val kb = line.replace(Regex("[^0-9]"), "").toLongOrNull() ?: 0
                    return kb / 1024
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to read /proc/meminfo: ${e.message}")
        }
        return 2000  // Optimistic fallback
    }

    private fun stopServer() {
        // Delegate kill to LlamaService so its internal reference is cleared too.
        LlamaService.get()?.stopChildProcess()
        serverProcess = null
        LlamaService.get()?.updateNotification("OpenCode", "Local AI idle")
    }

    /** Check if a model is currently loaded */
    fun loaded(): Boolean = isLoaded()

    /** Stop the current generation */
    fun stop() = abort()

    /**
     * Generate text from a prompt with optional streaming.
     * @param prompt The input text
     * @param maxTokens Maximum tokens to generate
     * @param temperature Sampling temperature (0.0-2.0)
     * @param onToken Optional callback called for each generated token
     * @return The full generated text
     */
    fun chat(
        prompt: String,
        maxTokens: Int = 512,
        temperature: Float = 0.7f,
        onToken: ((String) -> Unit)? = null
    ): String {
        if (!loaded()) {
            Log.e(TAG, "Cannot generate: no model loaded")
            return "[ERROR] No model loaded"
        }

        val callback = if (onToken != null) {
            object : TokenCallback {
                override fun onToken(token: String) {
                    onToken(token)
                }
            }
        } else null

        return generate(prompt, maxTokens, temperature, callback)
    }

    // Native methods
    private external fun initBackend()
    private external fun setenv(name: String, value: String)
    private external fun loadModel(path: String, nCtx: Int, nThreads: Int, mainGpu: Int): Long
    private external fun unloadModel()
    private external fun isLoaded(): Boolean
    private external fun abort()
    private external fun generate(prompt: String, maxTokens: Int, temperature: Float, callback: TokenCallback?): String
}
