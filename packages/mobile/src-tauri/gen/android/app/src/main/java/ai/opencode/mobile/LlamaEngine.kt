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

    /** Load a GGUF model — uses external server on old SoCs (fast), JNI on modern (GPU). */
    fun load(modelPath: String, contextSize: Int = 4096, threads: Int = 4): Boolean {
        init()
        stopServer()

        val useGpu = detectVulkanCapable()

        if (!useGpu) {
            // Old SoC: use external server process (statically-linked NEON/dotprod = fast)
            Log.i(TAG, "Old SoC → using external llama-server (CPU-optimized)")
            startServer(modelPath, contextSize)
            return true
        }

        // Modern SoC: use JNI with Vulkan GPU (in-process for full GPU access)
        val gpuIdx = 0 // Vulkan
        Log.i(TAG, "Modern SoC → using JNI with Vulkan GPU (mainGpu=$gpuIdx)")
        val handle = loadModel(modelPath, contextSize, threads, gpuIdx)
        val success = handle != 0L
        Log.i(TAG, "loadModel($modelPath) JNI GPU = $success")

        if (success) {
            val name = java.io.File(modelPath).nameWithoutExtension
                .replace(Regex("[-_]Q\\d.*$", RegexOption.IGNORE_CASE), "")
            LlamaHttpServer.start(port = 14097, model = name)
        }
        return success
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

    private fun startServer(modelPath: String, ctxSize: Int) {
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

            val serverBin = java.io.File(nativeLibDir, "libllama_server.so")
            if (!serverBin.exists()) {
                Log.w(TAG, "llama-server not found at ${serverBin.absolutePath}")
                return
            }

            val homeDir = java.io.File(modelPath).parentFile?.parentFile?.let { java.io.File(it, "home") }
            homeDir?.mkdirs()

            val pb = ProcessBuilder(
                serverBin.absolutePath,
                "-m", modelPath,
                "--host", "127.0.0.1",
                "--port", "14097",
                "-ngl", "0",              // CPU-only (GPU needs in-app process)
                "--ctx-size", ctxSize.toString(),
                "--threads", "4",         // SD865: 4x Cortex-A77 big cores
                "--threads-batch", "4",   // Parallel prompt processing
                "--batch-size", "512",    // Larger batch = faster prompt eval
                "--jinja"
            )
            pb.environment()["HOME"] = homeDir?.absolutePath ?: "/tmp"
            pb.environment()["TMPDIR"] = homeDir?.absolutePath ?: "/tmp"
            pb.environment()["LD_LIBRARY_PATH"] = "$nativeLibDir:/vendor/lib64:/system/vendor/lib64"
            pb.redirectErrorStream(true)

            serverProcess = pb.start()
            Log.i(TAG, "llama-server started on port 14097")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start llama-server: ${e.message}")
        }
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
