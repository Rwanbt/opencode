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

            // Smart GPU backend preload (for in-process JNI path; llama-server child
            // process does its own linking via NEEDED deps).
            // Inline detection: detectBestBackend() depends on nativeLibDir which is
            // set by MainActivity AFTER this static init block runs.
            // Vulkan 1.3+ (Adreno 730+/SD 8 Gen 1+) → ggml-vulkan.so preferred
            // Vulkan 1.1 (Adreno 6xx) → ggml-opencl.so preferred
            val soc = if (android.os.Build.VERSION.SDK_INT >= 31) android.os.Build.SOC_MODEL.lowercase() else ""
            val useVulkan = soc.matches(Regex("sm(8[4-9]|9)\\d{2}.*")) ||
                            soc.startsWith("mt698") || soc.startsWith("mt699") ||
                            soc.startsWith("s5e9") || soc.startsWith("s5e84")
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

    /** Detect the best inference backend for this device.
     *  Three tiers, in order of preference:
     *  - VULKAN: Adreno 730+ (SD 8 Gen 1+), Dimensity 9000+, Exynos 2200+
     *  - OPENCL: Adreno 6xx (SD 8xx pre-Gen1, SD 7xxG) — Vulkan 1.1 too weak
     *  - CPU: unknown / validation failures
     *
     *  User override: env var OPENCODE_LLAMA_BACKEND=auto|vulkan|opencl|cpu */
    private fun detectBestBackend(): Backend {
        val override = System.getenv("OPENCODE_LLAMA_BACKEND")?.lowercase()
        when (override) {
            "cpu"     -> { Log.i(TAG, "Backend override: CPU"); return Backend.CPU }
            "vulkan"  -> { Log.i(TAG, "Backend override: VULKAN"); return Backend.VULKAN }
            "opencl"  -> { Log.i(TAG, "Backend override: OPENCL"); return Backend.OPENCL }
            "hexagon" -> { Log.i(TAG, "Backend override: HEXAGON"); return Backend.HEXAGON }
            "auto", null -> {}
            else -> Log.w(TAG, "Unknown OPENCODE_LLAMA_BACKEND='$override', ignoring")
        }

        val sdkVersion = android.os.Build.VERSION.SDK_INT
        val soc = if (sdkVersion >= 31) android.os.Build.SOC_MODEL.lowercase() else ""
        val board = android.os.Build.BOARD.lowercase()
        val hardware = android.os.Build.HARDWARE.lowercase()
        Log.i(TAG, "Device: board=$board, hardware=$hardware, soc=$soc, sdk=$sdkVersion")

        // Qualcomm Adreno: prefer Hexagon NPU (SM8450+ = SD 8 Gen 1+) when available,
        // else OpenCL fallback. Vulkan is broken in llama.cpp on Adreno (all versions):
        //  - 15x slower than CPU on SD8Gen3 (discussion #9464)
        //  - vk::DeviceLostError on batch>32 (issue #8743, unresolved)
        //  - Adreno shader compile failures (issue #6395)
        //  - 1 GB single-alloc cap
        // Hexagon NPU (HTP v75/v79/v81) is 5-10x faster than OpenCL for decode
        // (docs/backend/snapdragon: Llama-3.2-1B Q4_0 → 51 tok/s decode v79 vs
        // 7.81 tok/s OpenCL on Xiaomi 14 Ultra).
        val qualcommAdreno = soc.matches(Regex("sm(7[2-9]|8|9)\\d{2}.*"))
        if (qualcommAdreno) {
            // Hexagon capable = SM8450+ (SD 8 Gen 1 uses HTP v75).
            // Hexagon v68 (SM7150 SD730) supported but marginal gain on small models.
            val hexagonCapable = soc.matches(Regex("sm(8[4-9]|9)\\d{2}.*"))
            if (hexagonCapable && verifyHexagonLib()) {
                Log.i(TAG, "Qualcomm Adreno SoC ($soc) → HEXAGON backend (NPU, SM8450+ capable)")
                return Backend.HEXAGON
            }
            if (verifyOpenclLib()) {
                Log.i(TAG, "Qualcomm Adreno SoC ($soc) → OPENCL backend (Hexagon not available or pre-SM8450)")
                return Backend.OPENCL
            }
            Log.w(TAG, "Qualcomm Adreno SoC ($soc) but no GPU binary → CPU fallback")
        }

        // Non-Qualcomm: Dimensity 9000+ (MT698x/699x), Exynos 2200+ (S5E9/S5E84) can try Vulkan.
        val modernDimensity = soc.startsWith("mt698") || soc.startsWith("mt699")
        val modernExynos    = soc.startsWith("s5e9") || soc.startsWith("s5e84")
        if (modernDimensity || modernExynos) {
            Log.i(TAG, "Non-Qualcomm modern SoC ($soc) → VULKAN backend")
            return Backend.VULKAN
        }

        Log.i(TAG, "No validated GPU backend for SoC ($soc) → CPU backend")
        return Backend.CPU
    }

    /** Validate that libllama_server_hexagon.so exists, has an ELF header, AND
     *  that at least one libggml-htp-vNN.so skel matching the device's Hexagon
     *  version is present (required for FastRPC-loaded DSP kernels). */
    private fun verifyHexagonLib(): Boolean {
        val libDir = nativeLibDir ?: return false
        val lib = java.io.File(libDir, "libllama_server_hexagon.so")
        if (!lib.exists() || lib.length() < 1_000_000) {
            Log.w(TAG, "libllama_server_hexagon.so missing or too small (${if (lib.exists()) lib.length() else -1} bytes)")
            return false
        }
        // ELF magic check
        val elfOk = try {
            java.io.RandomAccessFile(lib, "r").use { raf ->
                val magic = ByteArray(4); raf.readFully(magic)
                magic[0] == 0x7F.toByte() && magic[1] == 'E'.code.toByte() &&
                magic[2] == 'L'.code.toByte() && magic[3] == 'F'.code.toByte()
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to read libllama_server_hexagon.so header: ${e.message}")
            false
        }
        if (!elfOk) return false
        // At least one HTP skel must exist
        val skels = listOf("v68", "v69", "v73", "v75", "v79", "v81")
            .map { java.io.File(libDir, "libggml-htp-$it.so") }
            .filter { it.exists() && it.length() > 10_000 }
        if (skels.isEmpty()) {
            Log.w(TAG, "No libggml-htp-vNN.so skels found in $libDir")
            return false
        }
        Log.i(TAG, "Hexagon skels present: ${skels.joinToString { it.name }}")
        return true
    }

    /** Validate that libllama_server_opencl.so exists and has an ELF header.
     *  Deep validation (symbol check, dlopen) happens at startServer time. */
    private fun verifyOpenclLib(): Boolean {
        val libDir = nativeLibDir ?: return false
        val lib = java.io.File(libDir, "libllama_server_opencl.so")
        if (!lib.exists() || lib.length() < 1_000_000) {
            Log.w(TAG, "libllama_server_opencl.so missing or too small (${if (lib.exists()) lib.length() else -1} bytes)")
            return false
        }
        return try {
            java.io.RandomAccessFile(lib, "r").use { raf ->
                val magic = ByteArray(4); raf.readFully(magic)
                val ok = magic[0] == 0x7F.toByte() && magic[1] == 'E'.code.toByte() &&
                        magic[2] == 'L'.code.toByte() && magic[3] == 'F'.code.toByte()
                if (!ok) Log.w(TAG, "libllama_server_opencl.so is not an ELF file")
                ok
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to read libllama_server_opencl.so header: ${e.message}")
            false
        }
    }

    /** Compute a safe --n-gpu-layers value.
     *  - CPU backend: 0 (no offload)
     *  - VULKAN: 99 (full offload; Vulkan 1.3 handles VRAM allocation itself)
     *  - OPENCL Adreno: shared RAM with CPU. Budget scales with total RAM:
     *    - ≤8 GB device (Mi 10 Pro): 35% (~20 layers Gemma-4-E4B) — thrashing at 50%
     *    - >10 GB device (Xiaomi 14 Ultra 12GB+): 45% (~29 layers)
     *    Also caps per-buffer ≤ 1 GB (Adreno llama.cpp issue #8743). */
    private fun adaptiveNgl(modelSizeMB: Long, backend: Backend): Int {
        if (backend == Backend.CPU) return 0
        if (backend == Backend.VULKAN) return 99
        if (backend == Backend.HEXAGON) return 99  // NPU manages its own 2GB pool (HTP0 REPACK)

        val totalRamMB = totalSystemRamMB()
        val budgetPct = if (totalRamMB > 10000) 45 else 35
        val budgetMB = totalRamMB * budgetPct / 100
        // Rough bytes-per-layer estimate: gemma-4-E4B (4.7 GB, 36 layers) ≈ 130 MB/layer Q4_K_M.
        // Use 36 as a safe default layer count — overestimates for bigger models (→ smaller ngl, safer).
        val bytesPerLayerMB = (modelSizeMB / 36L).coerceAtLeast(100L)
        val maxLayers = (budgetMB / bytesPerLayerMB).toInt().coerceIn(8, 99)
        Log.i(TAG, "Adaptive ngl: totalRam=${totalRamMB}MB, budgetPct=$budgetPct%, budget=${budgetMB}MB, bytesPerLayer=${bytesPerLayerMB}MB → ngl=$maxLayers")
        return maxLayers
    }

    /** Read total system RAM from /proc/meminfo (MemTotal). */
    private fun totalSystemRamMB(): Long {
        try {
            val meminfo = java.io.File("/proc/meminfo").readText()
            for (line in meminfo.lines()) {
                if (line.startsWith("MemTotal:")) {
                    val kb = line.replace(Regex("[^0-9]"), "").toLongOrNull() ?: 0
                    return kb / 1024
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to read MemTotal: ${e.message}")
        }
        return 4096L  // Conservative fallback
    }

    /** Store the native library directory so backends can be loaded from it */
    @JvmField
    var nativeLibDir: String? = null

    /** Initialize the llama backend (call once at startup).
     *  Picks the best backend (Vulkan/OpenCL/CPU) and gates ggml env vars accordingly. */
    fun init() {
        if (!initialized) {
            val backend = detectBestBackend()
            selectedBackend = backend
            when (backend) {
                Backend.VULKAN -> {
                    setenv("GGML_DISABLE_OPENCL", "1")
                    Log.i(TAG, "Backend init: VULKAN (OpenCL disabled)")
                }
                Backend.OPENCL -> {
                    setenv("GGML_DISABLE_VULKAN", "1")
                    setenv("GGML_OPENCL_PLATFORM", "QUALCOMM")
                    Log.i(TAG, "Backend init: OPENCL (Qualcomm platform pinned)")
                }
                Backend.HEXAGON -> {
                    setenv("GGML_DISABLE_VULKAN", "1")
                    setenv("GGML_DISABLE_OPENCL", "1")
                    // ADSP_LIBRARY_PATH: FastRPC host-side lookup for libggml-htp-vNN.so
                    // skels. Must point to app native lib dir so DSP channel can forward them.
                    nativeLibDir?.let { setenv("ADSP_LIBRARY_PATH", it) }
                    Log.i(TAG, "Backend init: HEXAGON (NPU; ADSP_LIBRARY_PATH=$nativeLibDir)")
                }
                Backend.CPU -> {
                    setenv("GGML_DISABLE_VULKAN", "1")
                    setenv("GGML_DISABLE_OPENCL", "1")
                    Log.i(TAG, "Backend init: CPU (all GPU backends disabled)")
                }
            }
            initBackend()
            initialized = true
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
                                // Protocol: "{max}|{temp}|{prompt}". Prompt is LAST so that
                                // any `|` in user text is preserved (split with limit=3 keeps
                                // the third slot as the uncut tail). Older layout put prompt
                                // first and got corrupted the moment the user typed a `|`.
                                val genParts = arg.split("|", limit = 3)
                                val maxTokens = genParts.getOrElse(0) { "512" }.toIntOrNull() ?: 512
                                val temp = genParts.getOrElse(1) { "0.7" }.toFloatOrNull() ?: 0.7f
                                val prompt = genParts.getOrElse(2) { "" }
                                if (prompt.isEmpty()) "error:Empty prompt"
                                else {
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
     *  Each backend has its own llama-server binary with explicit GPU NEEDED deps:
     *  - CPU     → libllama_server.so              (no GPU NEEDED)
     *  - VULKAN  → libllama_server_vulkan.so       (NEEDED libggml-vulkan.so)
     *  - OPENCL  → libllama_server_opencl.so       (NEEDED libggml-opencl.so, Adreno kernels)
     *  - HEXAGON → libllama_server_hexagon.so      (static, dlopens libggml-htp-vNN.so via FastRPC) */
    enum class Backend { CPU, VULKAN, OPENCL, HEXAGON }

    /** Persisted backend choice from init(), consumed by load()/startServer(). */
    @JvmField
    var selectedBackend: Backend = Backend.CPU

    /** Load a GGUF model via external llama-server process.
     *  Backend selection (empirically validated on mobile):
     *  - Small models (<1.5GB quantized, ~<2B params): CPU NEON/dotprod
     *    is faster than GPU due to transfer overhead and kernel launch cost.
     *  - Large models (≥1.5GB) on modern SoCs (Vulkan 1.3+ / Adreno 730+):
     *    Vulkan via libllama_server.so (built with -DGGML_VULKAN=ON).
     *  - Large models on older SoCs: CPU NEON/dotprod (slower but functional). */
    fun load(modelPath: String, contextSize: Int = 4096, threads: Int = 4): Boolean {
        init()  // sets selectedBackend
        stopServer()

        val modelFile = java.io.File(modelPath)
        val modelSizeMB = modelFile.length() / (1024 * 1024)
        val isSmallModel = modelSizeMB < 1500  // <1.5GB ~ <2B params quantized

        // OpenCL Adreno kernels support Q4_0 and Q8_0 but NOT K-quants (Q4_K_M,
        // Q5_K_M, etc.). With K-quants, llama.cpp master crashes at model load
        // with SET_ROWS unsupported (exit 134). Route CPU proactively.
        //
        // ALSO route CPU for Q4_0 on Adreno 6xx (OpenCL 2.0) — measured -68%
        // decode on Mi 10 Pro (5.12 vs 16.2 CPU Q4_K_M). Adreno 6xx has weak
        // OpenCL 2.0 kernel launch overhead for batch=1 decode. CPU REPACK
        // NEON is faster there. Only Adreno 750+ (OpenCL 3.0+, SM8650+) has
        // comparable OpenCL perf, and even then gain is marginal (~0%).
        val modelNameUpper = modelFile.name.uppercase()
        val modelIsOpenclFriendly = modelNameUpper.contains("Q4_0") ||
                                    modelNameUpper.contains("Q8_0")
        val soc = if (android.os.Build.VERSION.SDK_INT >= 31)
            android.os.Build.SOC_MODEL.lowercase() else ""
        // Adreno OpenCL 3.0+ tier = SM8450+ (SD8Gen1+), SM9xxx, SM7350+. Adreno
        // 6xx (SM8150/SM8250/SM8350/SM7250) = OCL 2.0, decode too weak.
        val adrenoOcl3Plus = soc.matches(Regex("sm(8[4-9]|9|73[5-9])\\d*.*")) ||
                             soc.matches(Regex("sm(7[4-9])\\d*.*"))
        val useOpenclForThisModel = modelIsOpenclFriendly && adrenoOcl3Plus
        // Hexagon NPU (HTP) kernels support Q4_0 / Q8_0 / MXFP4 natively (HTP-REPACK
        // pre-quantizes weights on-device). K-quants are NOT in the HTP kernel set.
        //
        // Arch filter — measured on Xiaomi 14 Ultra (SM8650, HTP v75) 2026-04-24:
        //  - Llama-3.2-1B Q4_0 : decode 17.1 tok/s (+119% vs OpenCL) ✅
        //  - Gemma-4-E4B Q4_0 : decode  4.56 tok/s (-40%  vs OpenCL) ❌
        // Gemma-4 SWA attention + gemma4 arch causes 105+ graph splits and 360 MiB
        // CPU_REPACK fallback → CPU↔HTP memory copy kills decode. Route such arches
        // to OPENCL/CPU path until upstream ggml-hexagon kernels cover them.
        val modelIsHexagonUnfriendlyArch = modelNameUpper.contains("GEMMA-4") ||
                                           modelNameUpper.contains("GEMMA4") ||
                                           modelNameUpper.contains("MOE") ||
                                           modelNameUpper.contains("QWEN3-") ||
                                           modelNameUpper.contains("PHI-4")
        val useHexagonForThisModel = modelIsOpenclFriendly && !modelIsHexagonUnfriendlyArch
        val backend = when {
            selectedBackend == Backend.HEXAGON && !useHexagonForThisModel -> {
                // Fall back to OPENCL if available on this SoC (SM8450+ = Adreno OCL 3.0+),
                // else CPU. Don't just drop to CPU — OPENCL is strictly better than CPU
                // on large Q4_0 models with Adreno 750+ (~33% faster than CPU REPACK).
                if (adrenoOcl3Plus && modelIsOpenclFriendly) Backend.OPENCL else Backend.CPU
            }
            selectedBackend == Backend.HEXAGON -> Backend.HEXAGON  // skip small-model CPU gate
            isSmallModel -> Backend.CPU
            selectedBackend == Backend.OPENCL && !useOpenclForThisModel -> Backend.CPU
            else -> selectedBackend
        }
        Log.i(TAG, "Model: ${modelFile.name} (${modelSizeMB}MB), selectedBackend=$selectedBackend, actual=$backend, openclFriendly=$modelIsOpenclFriendly, hexagonUnfriendly=$modelIsHexagonUnfriendlyArch, adrenoOcl3Plus=$adrenoOcl3Plus")

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

    /** Outer entry point: picks effective backend (via circuit breaker) and
     *  falls back to CPU if the GPU backend fails to boot. */
    private fun startServer(modelPath: String, ctxSize: Int, backend: Backend = Backend.CPU, config: LlmConfig = LlmConfig()): Boolean {
        val effective = if (BackendCircuitBreaker.isDisabled(backend)) {
            Log.w(TAG, "Backend $backend temporarily disabled (recent failures) → CPU")
            Backend.CPU
        } else backend

        if (tryStartServer(modelPath, ctxSize, effective, config)) return true

        // First attempt failed — record and fall back to CPU if we weren't already.
        BackendCircuitBreaker.recordFailure(effective)
        if (effective == Backend.CPU) {
            Log.e(TAG, "CPU backend failed to start — no fallback left")
            return false
        }
        Log.w(TAG, "Backend $effective failed → retrying with CPU fallback")
        return tryStartServer(modelPath, ctxSize, Backend.CPU, config)
    }

    private fun tryStartServer(modelPath: String, ctxSize: Int, backend: Backend, config: LlmConfig): Boolean {
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

            // Backend-specific binary. Each variant has explicit NEEDED GPU lib:
            //   libllama_server.so         → libggml-cpu  (CPU backend)
            //   libllama_server_vulkan.so  → libggml-vulkan
            //   libllama_server_opencl.so  → libggml-opencl (Adreno 6xx kernels)
            val binName = when (backend) {
                Backend.HEXAGON -> "libllama_server_hexagon.so"
                Backend.OPENCL  -> "libllama_server_opencl.so"
                Backend.VULKAN  -> "libllama_server_vulkan.so"
                Backend.CPU     -> "libllama_server.so"
            }
            val serverBin = java.io.File(nativeLibDir, binName)
            if (!serverBin.exists() || !serverBin.canExecute()) {
                Log.w(TAG, "Binary $binName missing or not executable at ${serverBin.absolutePath}")
                return false
            }
            Log.i(TAG, "Selected server binary: ${serverBin.name} (backend=$backend)")

            val homeDir = java.io.File(modelPath).parentFile?.parentFile?.let { java.io.File(it, "home") }
            homeDir?.mkdirs()

            // GPU layer offload — adaptive per backend.
            //  - CPU:    0 layers (no GPU transfer overhead)
            //  - VULKAN: 99 (Vulkan 1.3+ handles VRAM internally)
            //  - OPENCL: budget 35% of RAM (Adreno shares memory with CPU → OOM risk)
            val useGpu = backend != Backend.CPU
            val modelSizeMB = java.io.File(modelPath).length() / (1024 * 1024)
            val ngl = adaptiveNgl(modelSizeMB, backend).toString()

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
            // Auto-detect big-core bitmask via cpufreq (detectBigCoreMask).
            // SD865 = 0xF0 (cores 4-7), SD 8 Gen 3 = 0xFC (cores 2-7), SD 8 Gen 2 = 0xFE.
            val bigMask = detectBigCoreMask()
            val bigCount = Integer.bitCount(bigMask).coerceIn(1, nCores)
            // Hexagon: 4 threads max (Qualcomm bench default; higher oversubscribes
            // DSP callback dispatcher → measured decode regression 17.1→1.3 tok/s on SM8650).
            // CPU backend: threads == big-core count (avoids LITTLE A55 slowdown).
            //   SD865 6 threads includes 2 LITTLE → measured 18 pp / 3.4 decode on Gemma-4.
            //   SD865 4 threads big-only should avoid the weak-link bottleneck.
            // VULKAN/OPENCL: keep PocketPal AI heuristic (ne touche pas path GPU validé).
            // OPENCL: 4 threads optimal pour decode mesuré sur Adreno 750 Gemma-4 Q4_0
            // (2026-04-25 bench matrix : t=4 → 8.76 tok/s decode, t=8 → 7.15 tok/s, t=2 → 7.38 tok/s).
            // Au-delà de 4 threads, contention CPU↔OpenCL driver thread dégrade decode.
            val nThreads = when {
                backend == Backend.HEXAGON -> 4
                backend == Backend.OPENCL -> 4
                backend == Backend.CPU -> bigCount.coerceAtLeast(2).coerceAtMost(4)
                nCores <= 4 -> nCores
                else -> (nCores * 8 / 10).coerceAtLeast(2)
            }
            Log.i(TAG, "CPU topology: nCores=$nCores, bigMask=0x${Integer.toHexString(bigMask)}, bigCount=$bigCount, nThreads=$nThreads (backend=$backend)")

            // ubatch-size: pour OPENCL Adreno, 128 mesuré meilleur que 512 défaut sur decode
            // (bench 2026-04-25 X14U Gemma-4 Q4_0 : ub=128 → 7.57 vs default → 7.15 tok/s).
            // CPU/HEXAGON path : 512 reste cohérent.
            val ubatchSize = when (backend) {
                Backend.OPENCL -> "128"
                else -> "512"
            }

            val args = mutableListOf(
                serverBin.absolutePath,
                "-m", modelPath,
                "--host", "127.0.0.1",
                "--port", "14097",
                "--n-gpu-layers", ngl,
                "--threads", nThreads.toString(),
                "--threads-batch", nThreads.toString(),
                "--batch-size", "512",
                "--ubatch-size", ubatchSize,
                "--jinja",
                // Single slot to minimize memory usage
                "-np", "1",
                // Prefix KV cache reuse across prompts. Without this, every new
                // chat turn re-prefills the full conversation history from scratch
                // (system prompt + all prior turns), growing linearly with turn
                // count → user-perceived 20x slowdown on mobile. 256 is a
                // conservative window (matches desktop default). The desktop
                // TS sidecar (local-llm-server/index.ts) already passes this on
                // its own spawn path; mobile was missing it.
                "--cache-reuse", "256"
            )

            // OPENCL: --poll 0 (no busy-wait) mesuré meilleur que poll 50 default
            // sur Adreno 750 (bench 2026-04-25 : poll=0 → 7.69 vs poll=100 → 7.60 tok/s).
            if (backend == Backend.OPENCL) {
                args.addAll(listOf("--poll", "0"))
            }

            // Prompt Lookup Decoding / speculative self (PR #18471, Jan 2026).
            // Drafts tokens from n-grams, verified in batch on the main model →
            // 1.5-3x decode on code/agent workloads (tool calls, JSON, repetitive).
            //
            // Exceptions where ngram-simple is net negative (drafts rejected = overhead):
            //  - CPU backend: batch-1 decode saturates big cluster, draft batch validation
            //    adds overhead. Mesuré 2026-04-24 Mi 10 Pro Gemma-4-E4B Q4_0 : drafts=0/0
            //    sur 1358 tokens, -5/10% decode.
            //  - OPENCL + arch hexagon-unfriendly (Gemma-4 SWA, MoE) : statistique
            //    similaire #gen drafts = 0 / #acc drafts = 0. SWA + ngram-simple ne
            //    matchent pas → overhead init context spec à chaque token = decode
            //    7.06 in-app vs 8.76 bench isolé sans spec.
            //
            // Spec-type override (P1 audit 2026-04-25): set OPENCODE_LLAMA_SPEC_TYPE
            // to one of [ngram-cache | ngram-simple | ngram-map-k | ngram-map-k4v | ngram-mod]
            // to evaluate alternatives on Gemma-4 SWA. ngram-cache maintains its own
            // n-gram statistics independent of the target's KV cache, so it may match
            // on Gemma-4 SWA where ngram-simple fails. When the override is set, the
            // SWA-skip is RELAXED so the chosen spec-type can run on Gemma-4/MoE/Phi-4.
            // Default behavior (no override) is unchanged — ngram-simple, skip on SWA.
            //
            // Escape hatch: OPENCODE_LLAMA_NO_SPEC=1 disables it globally.
            // Avoid ngram-mod per issue #19232 (crash on Qwen3-Next).
            //
            // Recompute model flags here (this scope) — duplicate from load() to avoid
            // forward-reference hazard.
            val modelFileName = java.io.File(modelPath).name.uppercase()
            val modelIsOpenclFriendly = modelFileName.contains("Q4_0") ||
                                        modelFileName.contains("Q8_0")
            val modelIsHexagonUnfriendlyArch = modelFileName.contains("GEMMA-4") ||
                                               modelFileName.contains("GEMMA4") ||
                                               modelFileName.contains("MOE") ||
                                               modelFileName.contains("QWEN3-") ||
                                               modelFileName.contains("PHI-4")
            // Override resolution order:
            //   1. env var OPENCODE_LLAMA_SPEC_TYPE (for shell-launched debug builds)
            //   2. system property debug.opencode.spec_type (settable via `adb shell setprop`
            //      without APK rebuild — preferred for in-app perf experiments)
            val specTypeOverride: String? = System.getenv("OPENCODE_LLAMA_SPEC_TYPE")
                ?: try {
                    val cls = Class.forName("android.os.SystemProperties")
                    val get = cls.getMethod("get", String::class.java, String::class.java)
                    val v = get.invoke(null, "debug.opencode.spec_type", "") as? String
                    if (v.isNullOrEmpty()) null else v
                } catch (_: Throwable) { null }
            val specType = specTypeOverride ?: "ngram-simple"
            // Skip on CPU always; skip on SWA only when running default ngram-simple
            // (other types — notably ngram-cache — get a chance via override).
            val specSkipCondition = backend == Backend.CPU ||
                (backend == Backend.OPENCL && modelIsHexagonUnfriendlyArch && specTypeOverride == null)
            val specEnabled = System.getenv("OPENCODE_LLAMA_NO_SPEC") != "1" &&
                              !specSkipCondition
            if (specEnabled) {
                args.addAll(listOf(
                    "--spec-type", specType,
                    "--spec-ngram-size-n", "8",
                    "--spec-ngram-size-m", "4"
                ))
                Log.i(TAG, "Speculative decoding: --spec-type $specType (override=${specTypeOverride != null})")
            } else if (specSkipCondition) {
                Log.i(TAG, "Speculative decoding skipped (backend=$backend, hexagonUnfriendly=$modelIsHexagonUnfriendlyArch, type=$specType — net overhead, set OPENCODE_LLAMA_SPEC_TYPE=ngram-cache to override on SWA)")
            }

            // CPU affinity — pin threads to big cluster to avoid A55 LITTLE bottleneck.
            // Measured on SD865 (Mi 10 Pro, Gemma-4 Q4_0): -t 6 includes 2 A55 → 18 pp /
            // 3.4 decode (A55 is ~2.5x slower than A77, drags the batch). Pinning to big
            // cores only should reclaim ~20-40% throughput.
            // History (reference_mi10pro_cpu_mask): old static build blocked HTTP with
            // --cpu-mask. Re-test with current build; disable via OPENCODE_NO_CPU_MASK=1
            // if the same issue resurfaces.
            val cpuMaskEnabled = backend == Backend.CPU &&
                                 bigMask != 0 &&
                                 bigMask != ((1 shl nCores) - 1) &&  // skip if all cores are "big"
                                 System.getenv("OPENCODE_NO_CPU_MASK") != "1"
            if (cpuMaskEnabled) {
                val maskHex = "0x" + Integer.toHexString(bigMask).uppercase()
                args.addAll(listOf("--cpu-mask", maskHex, "--cpu-strict", "1"))
                Log.i(TAG, "CPU affinity: --cpu-mask $maskHex --cpu-strict 1 (big cluster pinning)")
            }

            // HEXAGON backend — pin to HTP0 + CPU affinity (big cores 2-7) + polling.
            // Measured on Xiaomi 14 Ultra (SM8650, HTP v75, Llama-3.2-1B Q4_0, 2026-04-24):
            //  - WITHOUT these args (just --device HTP0): 49 tok/s pp, 1.3-8.2 tok/s decode
            //  - WITH full Qualcomm args:                 81 tok/s pp, 17.1 tok/s decode (+122%/+119% vs OpenCL)
            // --poll 100 (max valid range 0-100) = polling agressif des DSP callbacks
            // (critique pour FastRPC IPC latency, sans poll decode chute à 1.3 tok/s).
            // Note : "--poll 1000" pré-2026-04-25 était silencieusement clampé à 100,
            // valeur explicitée pour clarté.
            // --cpu-mask 0xfc = cores 2-7 (big+prime cluster on SD 8 Gen 1/2/3).
            // --cpu-strict 1 prevents thread migration to LITTLE cores.
            if (backend == Backend.HEXAGON) {
                args.addAll(listOf(
                    "--device", "HTP0", "--no-mmap",
                    "--poll", "100",
                    "--cpu-mask", "0xfc", "--cpu-strict", "1"
                ))
                Log.i(TAG, "HEXAGON: HTP0 + --poll 100 + --cpu-mask 0xfc --cpu-strict 1")
            }

            // Phase C experiment — REVERTED: --mlock + --ubatch-size 128 did not
            // help (mlock failed OOM on 2.4 GB buffer even on 15 GB Xiaomi,
            // ubatch=128 gave -6% vs default 512). Left here as dormant comment
            // for docs; keep default behavior.

            // Detect model quantization from filename (used for OpenCL routing).
            // OpenCL Adreno supports Q4_0 / Q8_0 but NOT K-quants (Q4_K_M, Q5_K_M,
            // etc.). K-quants silently fall back to CPU mixed mode.
            //
            // Context size strategy — ADAPTIVE on total RAM (audit 2026-04-25 soir).
            // Previous hardcoded caps (8K OpenCL / 4K CPU) ignored that flagships
            // have 12-16 GB shared RAM, plenty for 32K-64K KV cache. The agent
            // OpenCode system prompt + tools defs eats 1.5-2K tokens, leaving only
            // 2K usable on a 4K cap = chronic conversation truncation.
            //
            // KV cache (Gemma-4 E4B, f16, 32 layers × 8 KV heads × 256 dim):
            //   ~32 KB / token → 4096=128MB, 16384=512MB, 32768=1GB, 65536=2GB.
            // Budget: model (~5GB) + system overhead (~2-3GB) + KV must fit RAM.
            //   - 16GB device → up to 65K KV (2GB) safe
            //   - 8GB device → 16K KV (512MB) safe with mmap, 32K possible
            //   - 6GB device → 8K KV (256MB) safe
            //   - <6GB → keep 4K conservative
            //
            // OpenCL+Q4_0 path: FA is off (Adreno OpenCL doesn't impl FA), so --fit
            // is ignored; we MUST pass an explicit --ctx-size. Adaptive cap below.
            // OpenCL+K-quants: FA stays on, --fit works (kept as legacy path).
            // CPU/Vulkan: explicit ctx for predictability + faster prefill cap.
            val totalRamMB = totalSystemRamMB()
            val totalRamGB = totalRamMB / 1024
            val adaptiveCtx = when {
                totalRamGB >= 14 -> 65536  // X14U 16GB → 64K
                totalRamGB >= 10 -> 32768  // 12GB tier → 32K
                totalRamGB >= 7  -> 16384  // Mi 10 Pro 8GB → 16K
                totalRamGB >= 5  -> 8192   // 6GB → 8K
                else             -> 4096   // <6GB → 4K conservative
            }
            Log.i(TAG, "Adaptive ctx-size: ${adaptiveCtx} tokens (totalRamGB=$totalRamGB, KV ~${(adaptiveCtx * 32) / 1024}MB)")
            when {
                backend == Backend.OPENCL && modelIsOpenclFriendly ->
                    args.addAll(listOf("--ctx-size", adaptiveCtx.toString()))
                useGpu ->
                    args.addAll(listOf("--fit", "on", "-fitt", fittHeadroom, "-fitc", adaptiveCtx.toString()))
                else ->
                    args.addAll(listOf("--ctx-size", adaptiveCtx.toString()))
            }

            // KV cache quantization — q4_0 saves ~72% KV memory but llama.cpp
            // HARD REQUIRES flash_attn=on when V cache is quantized. If we disable
            // FA with quantized V, llama_init_from_model returns NULL and the next
            // llama_n_ctx() call segfaults with a null pointer deref.
            // → Rule: quantized KV ⇒ flash-attn on (regardless of CPU/GPU).
            //
            // OpenCL Adreno exception: Flash Attention is NOT implemented in the
            // Qualcomm Adreno OpenCL backend (docs/backend/OPENCL.md + PR #10693).
            //  - Q4_0 / Q8_0 → real GPU path: force KV f16 + FA off.
            //  - Q4_K_M / K-quants → fall back to CPU mixed mode anyway, so
            //    keeping the old config (quantized KV + FA on) is faster than
            //    f16 KV + FA off (which degrades the hybrid path to ~1/2 speed
            //    measured 1.96 vs 4.85 tok/s on Mi 10 Pro — regression).
            val openclForceF16 = (backend == Backend.OPENCL) && modelIsOpenclFriendly
            val kvType = if (openclForceF16) "f16" else config.kvCacheType
            val kvQuantized = kvType != "f16"
            if (backend == Backend.OPENCL) {
                if (openclForceF16 && config.kvCacheType != "f16") {
                    Log.w(TAG, "OpenCL Adreno + Q4_0/Q8_0 model: forcing KV f16 + FA off for real GPU path")
                } else if (!modelIsOpenclFriendly) {
                    Log.i(TAG, "OpenCL Adreno + K-quant model ($modelFileName): keeping FA on + quantized KV (CPU mixed path baseline)")
                }
            }
            if (kvQuantized) {
                args.addAll(listOf("--cache-type-k", kvType, "--cache-type-v", kvType))
                Log.i(TAG, "KV cache quantization: $kvType (forces --flash-attn on)")
            }

            // Flash Attention:
            // - Forced ON if KV is quantized (llama.cpp hard requirement)
            // - Forced OFF only for OpenCL + Q4_0/Q8_0 (real GPU path uses no-FA)
            // - Otherwise: on in GPU, off in CPU (batch=1 decode overhead)
            val flashAttnOn = when {
                backend == Backend.OPENCL && modelIsOpenclFriendly -> false
                kvQuantized -> true
                useGpu && config.flashAttn -> true
                else -> false
            }
            if (flashAttnOn) {
                args.addAll(listOf("--flash-attn", "on"))
                Log.i(TAG, "Flash Attention enabled (kvQuantized=$kvQuantized, useGpu=$useGpu)")
            } else {
                args.addAll(listOf("--flash-attn", "off"))
                Log.i(TAG, "Flash Attention disabled (backend=$backend, kvQuantized=$kvQuantized)")
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
            val envOverrides = mutableMapOf(
                "HOME" to (homeDir?.absolutePath ?: "/tmp"),
                "TMPDIR" to (homeDir?.absolutePath ?: "/tmp"),
                "LD_LIBRARY_PATH" to "$nativeLibDir:/vendor/lib64:/system/vendor/lib64"
            )
            // OpenCL backend init hints (llama.cpp ggml-opencl reads these before
            // clCreateContext). Propagating via envOverrides guarantees the child
            // inherits them, independent of JVM setenv timing.
            if (backend == Backend.OPENCL) {
                envOverrides["GGML_OPENCL_PLATFORM"] = "QUALCOMM"
                envOverrides["GGML_OPENCL_DEVICE"] = "0"
                envOverrides["GGML_OPENCL_ADRENO_USE_LARGE_BUFFER"] = "1"
            }
            if (backend == Backend.HEXAGON) {
                // FastRPC DSP library path — où le côté host de FastRPC cherche
                // les libggml-htp-vNN.so pour les transmettre au cDSP context.
                envOverrides["ADSP_LIBRARY_PATH"] = nativeLibDir
                envOverrides["GGML_HEXAGON_NDEV"] = "1"
                // Phase D Hexagon NPU tuning (2026-04-25, à valider in-app sur Llama-3.2 X14U) :
                //  - HOSTBUF=1 : host-buffer mode requis pour REPACK (PR llama.cpp #12326),
                //    expected +50% prefill upstream
                //  - USE_HMX=1 : Hexagon Matrix Multiplier explicit on (matmul HW dédié)
                //  - NHVX="all" : utilise tous les HVX threads disponibles
                envOverrides["GGML_HEXAGON_HOSTBUF"] = "1"
                envOverrides["GGML_HEXAGON_USE_HMX"] = "1"
                envOverrides["GGML_HEXAGON_NHVX"] = "all"
                Log.i(TAG, "HEXAGON envOverrides: ADSP_LIBRARY_PATH=$nativeLibDir, NDEV=1, HOSTBUF=1, USE_HMX=1, NHVX=all")
            }
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
