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
            System.loadLibrary("llama")
            System.loadLibrary("llama_jni")
            Log.i(TAG, "Native libraries loaded successfully")
            // Save the ClassLoader for use from Rust JNI threads
            appClassLoader = LlamaEngine::class.java.classLoader
        } catch (e: UnsatisfiedLinkError) {
            Log.e(TAG, "Failed to load native libraries: ${e.message}")
        }
    }

    /** Initialize the llama backend (call once at startup) */
    fun init() {
        if (!initialized) {
            initBackend()
            initialized = true
            Log.i(TAG, "Backend initialized")
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
                                val success = load(arg, 2048, 4)
                                if (success) "ok" else "error:Failed to load model"
                            }
                            "unload" -> { unload(); "ok" }
                            "loaded" -> if (loaded()) "true" else "false"
                            "stop" -> { stop(); "ok" }
                            "generate" -> {
                                // arg = prompt|maxTokens|temperature
                                val genParts = arg.split("|", limit = 3)
                                val prompt = genParts[0]
                                val maxTokens = genParts.getOrElse(1) { "512" }.toIntOrNull() ?: 512
                                val temp = genParts.getOrElse(2) { "0.7" }.toFloatOrNull() ?: 0.7f
                                chat(prompt, maxTokens, temp)
                            }
                            else -> "error:Unknown command: $action"
                        }

                        resultFile.writeText(result)
                        Log.i(TAG, "Command result: ${result.take(100)}")
                    }
                    Thread.sleep(100)
                } catch (e: Exception) {
                    Log.e(TAG, "Command loop error: ${e.message}")
                    resultFile.writeText("error:${e.message}")
                    Thread.sleep(500)
                }
            }
        }.apply { isDaemon = true }.start()
    }

    private var serverProcess: Process? = null

    /** Load a GGUF model file. Returns true if successful. Also starts HTTP server. */
    fun load(modelPath: String, contextSize: Int = 4096, threads: Int = 4): Boolean {
        init()
        // Kill any existing server process
        stopServer()

        val handle = loadModel(modelPath, contextSize, threads)
        val success = handle != 0L
        Log.i(TAG, "loadModel($modelPath) = $success")

        if (success) {
            // Also start llama-server for OpenAI-compatible HTTP API
            startServer(modelPath, contextSize)
        }
        return success
    }

    /** Unload the current model and free memory */
    fun unload() {
        stopServer()
        unloadModel()
        Log.i(TAG, "Model unloaded")
    }

    private fun startServer(modelPath: String, ctxSize: Int) {
        try {
            // Find libllama_server.so in nativeLibraryDir
            val nativeDir = appClassLoader?.let {
                // Get from the .native_lib_dir file written by MainActivity
                null
            }

            // Try to find the server binary
            val possiblePaths = listOf(
                "/data/data/ai.opencode.mobile/runtime/.native_lib_dir",
                "/data/user/0/ai.opencode.mobile/runtime/.native_lib_dir"
            )
            var nativeLibDir: String? = null
            for (p in possiblePaths) {
                val f = java.io.File(p)
                if (f.exists()) {
                    nativeLibDir = f.readText().trim()
                    break
                }
            }

            if (nativeLibDir == null) {
                Log.w(TAG, "Cannot find nativeLibraryDir, skipping HTTP server")
                return
            }

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
                "-ngl", "0",
                "--ctx-size", ctxSize.toString()
            )
            pb.environment()["HOME"] = homeDir?.absolutePath ?: "/tmp"
            pb.environment()["TMPDIR"] = homeDir?.absolutePath ?: "/tmp"
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
    private external fun loadModel(path: String, nCtx: Int, nThreads: Int): Long
    private external fun unloadModel()
    private external fun isLoaded(): Boolean
    private external fun abort()
    private external fun generate(prompt: String, maxTokens: Int, temperature: Float, callback: TokenCallback?): String
}
