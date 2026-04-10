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

    /** Load a GGUF model — always uses external server process for best performance.
     *  Vulkan GPU is only beneficial for large models (>2B params).
     *  For small models, CPU with NEON/dotprod is faster due to GPU transfer overhead. */
    fun load(modelPath: String, contextSize: Int = 4096, threads: Int = 4): Boolean {
        init()
        stopServer()

        // Check model size to decide GPU vs CPU
        val modelFile = java.io.File(modelPath)
        val modelSizeMB = modelFile.length() / (1024 * 1024)
        val isLargeModel = modelSizeMB > 1500  // >1.5GB ~ >2B params quantized
        val vulkanCapable = detectVulkanCapable()
        val useVulkan = vulkanCapable && isLargeModel

        Log.i(TAG, "Model: ${modelFile.name} (${modelSizeMB}MB), vulkan=$vulkanCapable, useGPU=$useVulkan")

        // Read config from IPC file (written by Rust backend)
        val config = readLlmConfig(modelPath)
        startServer(modelPath, contextSize, useVulkan, config)
        return true
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

    private fun startServer(modelPath: String, ctxSize: Int, useVulkan: Boolean = false, config: LlmConfig = LlmConfig()) {
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
                return
            }
            val nativeLibDir = libDir

            val serverName = "libllama_server.so"
            val serverBin = java.io.File(nativeLibDir, serverName)
            if (!serverBin.exists()) {
                Log.w(TAG, "No llama-server binary found")
                return
            }

            val homeDir = java.io.File(modelPath).parentFile?.parentFile?.let { java.io.File(it, "home") }
            homeDir?.mkdirs()

            // GPU layers: use config or auto-detect
            val ngl = if (useVulkan) config.nGpuLayers.coerceAtLeast(99).toString() else "0"

            // Detect big-core topology for CPU affinity pinning
            val cpuMask = detectBigCoreMask()
            val nBigCores = Integer.bitCount(cpuMask)
            val nThreads = nBigCores.coerceIn(2, 4)
            Log.i(TAG, "CPU topology: mask=0x${Integer.toHexString(cpuMask).uppercase()}, bigCores=$nBigCores, threads=$nThreads")

            val args = mutableListOf(
                serverBin.absolutePath,
                "-m", modelPath,
                "--host", "127.0.0.1",
                "--port", "14097",
                "-ngl", ngl,
                "--ctx-size", ctxSize.toString(),
                "--threads", nThreads.toString(),
                "--threads-batch", nThreads.toString(),
                "--batch-size", "512",
                "--jinja",
                // Single slot to minimize memory usage
                "-np", "1"
            )

            // Flash Attention — significant memory savings on mobile
            if (config.flashAttn) {
                args.addAll(listOf("--flash-attn", "on"))
                Log.i(TAG, "Flash Attention enabled")
            }

            // KV cache quantization — q4_0 with Hadamard rotation saves ~72% KV memory
            val kvType = config.kvCacheType
            if (kvType != "f16") {
                args.addAll(listOf("--cache-type-k", kvType, "--cache-type-v", kvType))
                Log.i(TAG, "KV cache quantization: $kvType")
            }

            // Memory mapping control
            when (config.mmapMode) {
                "off" -> { args.add("--no-mmap"); Log.i(TAG, "mmap disabled") }
                "on" -> Log.i(TAG, "mmap enabled (default)")
                else -> Log.i(TAG, "mmap auto")
            }

            // Speculative decoding with draft model
            if (config.draftModelPath != null) {
                val draftFile = java.io.File(config.draftModelPath)
                if (draftFile.exists()) {
                    // RAM guard: check available memory before enabling draft model
                    val freeRamMB = getAvailableRamMB()
                    if (freeRamMB > 1000) {  // Need at least 1GB free for draft model
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
            }

            Log.i(TAG, "Starting server: ${serverBin.name} ngl=$ngl kv=${config.kvCacheType} flash=${config.flashAttn}")

            val pb = ProcessBuilder(args)
            pb.environment()["HOME"] = homeDir?.absolutePath ?: "/tmp"
            pb.environment()["TMPDIR"] = homeDir?.absolutePath ?: "/tmp"
            pb.environment()["LD_LIBRARY_PATH"] = "$nativeLibDir:/vendor/lib64:/system/vendor/lib64"
            pb.redirectErrorStream(true)

            serverProcess = pb.start()
            Log.i(TAG, "llama-server started on port 14097 (${if (useVulkan) "Vulkan GPU" else "CPU-only"}, args=${args.size})")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start llama-server: ${e.message}")
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
        serverProcess?.let {
            try {
                it.destroyForcibly()
                it.waitFor(5, java.util.concurrent.TimeUnit.SECONDS)
                Log.i(TAG, "llama-server stopped")
            } catch (e: Exception) {
                Log.w(TAG, "Error stopping server: ${e.message}")
            }
        }
        serverProcess = null
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
