package ai.opencode.mobile

import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.*
import java.net.ServerSocket
import java.net.Socket
import java.util.UUID
import java.util.concurrent.Executors

/**
 * Minimal OpenAI-compatible HTTP server that delegates inference to LlamaEngine JNI (GPU).
 * Runs in-process so it has full GPU access via OpenCL/Vulkan.
 *
 * Endpoints:
 *   GET  /health                    → 200 OK
 *   GET  /v1/models                 → model list
 *   POST /v1/chat/completions       → chat completion (streaming or non-streaming)
 */
object LlamaHttpServer {
    private const val TAG = "LlamaHttpServer"
    @Volatile private var serverSocket: ServerSocket? = null
    private val executor = Executors.newSingleThreadExecutor()
    private var modelName = "local-model"

    fun start(port: Int = 14097, model: String = "local-model"): Boolean {
        modelName = model
        val existing = serverSocket
        if (existing != null && !existing.isClosed) {
            Log.w(TAG, "Server already running on port ${existing.localPort}")
            return true
        }

        return try {
            val ss = ServerSocket(port)
            serverSocket = ss
            Log.i(TAG, "HTTP server listening on port $port (in-process GPU)")

            Thread {
                val ss = serverSocket ?: return@Thread
                while (!ss.isClosed) {
                    try {
                        val client = ss.accept()
                        executor.submit { handleClient(client) }
                    } catch (e: Exception) {
                        if (!ss.isClosed) {
                            Log.e(TAG, "Accept error: ${e.message}")
                        }
                    }
                }
            }.apply { isDaemon = true; name = "llama-http" }.start()
            true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start server on port $port: ${e.message}")
            false
        }
    }

    fun stop() {
        try {
            serverSocket?.close()
        } catch (_: Exception) {}
        serverSocket = null
    }

    private fun handleClient(socket: Socket) {
        try {
            socket.soTimeout = 120_000
            val input = BufferedReader(InputStreamReader(socket.getInputStream()))
            val output = BufferedOutputStream(socket.getOutputStream())

            val requestLine = input.readLine() ?: return
            val parts = requestLine.split(" ", limit = 3)
            if (parts.size < 2) return
            val method = parts[0]
            val path = parts[1]

            // Read headers
            val headers = mutableMapOf<String, String>()
            while (true) {
                val headerLine = input.readLine() ?: break
                if (headerLine.isEmpty()) break
                val colonIdx = headerLine.indexOf(':')
                if (colonIdx > 0) {
                    headers[headerLine.substring(0, colonIdx).trim().lowercase()] =
                        headerLine.substring(colonIdx + 1).trim()
                }
            }

            // Read body
            val contentLength = headers["content-length"]?.toIntOrNull() ?: 0
            val body = if (contentLength > 0) {
                val buf = CharArray(contentLength)
                var read = 0
                while (read < contentLength) {
                    val n = input.read(buf, read, contentLength - read)
                    if (n <= 0) break
                    read += n
                }
                String(buf, 0, read)
            } else ""

            // Route
            when {
                path == "/health" || path == "/global/health" -> {
                    val loaded = LlamaEngine.loaded()
                    sendJson(output, 200, """{"status":"${if (loaded) "ok" else "loading"}"}""")
                }
                path == "/v1/models" -> {
                    sendJson(output, 200,
                        """{"object":"list","data":[{"id":"$modelName","object":"model","owned_by":"local"}]}""")
                }
                method == "POST" && path == "/v1/chat/completions" -> {
                    handleChatCompletion(output, body)
                }
                else -> {
                    sendJson(output, 404, """{"error":{"message":"Not found","code":404}}""")
                }
            }

            output.flush()
            socket.close()
        } catch (e: Exception) {
            Log.e(TAG, "Client error: ${e.message}")
            try { socket.close() } catch (_: Exception) {}
        }
    }

    private fun handleChatCompletion(output: BufferedOutputStream, body: String) {
        try {
            val json = JSONObject(body)
            val messages = json.getJSONArray("messages")
            val stream = json.optBoolean("stream", false)
            val maxTokens = json.optInt("max_tokens", 2048)
            val temperature = json.optDouble("temperature", 0.7).toFloat()

            val prompt = formatChatML(messages)

            if (!LlamaEngine.loaded()) {
                sendJson(output, 503, """{"error":{"message":"Model not loaded","code":503}}""")
                return
            }

            if (stream) {
                handleStream(output, prompt, maxTokens, temperature)
            } else {
                handleNonStream(output, prompt, maxTokens, temperature)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Chat completion error: ${e.message}")
            val msg = (e.message ?: "unknown error").replace("\"", "\\\"")
            sendJson(output, 500, """{"error":{"message":"$msg","code":500}}""")
        }
    }

    private fun handleNonStream(output: BufferedOutputStream, prompt: String, maxTokens: Int, temperature: Float) {
        val id = "chatcmpl-${UUID.randomUUID().toString().take(12)}"
        val rawResult = LlamaEngine.chat(prompt, maxTokens, temperature)
        val result = stripThinkingTags(rawResult)

        val response = JSONObject().apply {
            put("id", id)
            put("object", "chat.completion")
            put("model", modelName)
            put("created", System.currentTimeMillis() / 1000)
            put("choices", JSONArray().apply {
                put(JSONObject().apply {
                    put("index", 0)
                    put("message", JSONObject().apply {
                        put("role", "assistant")
                        put("content", result)
                    })
                    put("finish_reason", "stop")
                })
            })
        }

        sendJson(output, 200, response.toString())
    }

    private fun handleStream(output: BufferedOutputStream, prompt: String, maxTokens: Int, temperature: Float) {
        val id = "chatcmpl-${UUID.randomUUID().toString().take(12)}"

        val header = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: keep-alive\r\nAccess-Control-Allow-Origin: *\r\n\r\n"
        output.write(header.toByteArray())
        output.flush()

        // Accumulate tokens to strip <think>...</think> in real-time
        val buffer = StringBuilder()
        var insideThink = false
        var thinkTagChecked = false

        try {
            LlamaEngine.chat(prompt, maxTokens, temperature) { token ->
                buffer.append(token)

                // Detect and skip <think>...</think> blocks
                if (!thinkTagChecked && buffer.length >= 7) {
                    insideThink = buffer.toString().trimStart().startsWith("<think>")
                    thinkTagChecked = true
                }

                if (insideThink) {
                    val content = buffer.toString()
                    val endIdx = content.indexOf("</think>")
                    if (endIdx >= 0) {
                        // Think block ended, emit everything after </think>
                        insideThink = false
                        val afterThink = content.substring(endIdx + 8).trimStart()
                        buffer.clear()
                        if (afterThink.isNotEmpty()) {
                            sendSSEChunk(output, id, afterThink)
                        }
                    }
                    // Still inside think block, don't emit
                    return@chat
                }

                // Outside think block — emit token directly
                sendSSEChunk(output, id, token)
                buffer.clear()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Stream error: ${e.message}")
            LlamaEngine.stop()
        }

        // Send done
        try {
            output.write("data: [DONE]\n\n".toByteArray())
            output.flush()
        } catch (_: Exception) {}
    }

    private fun sendSSEChunk(output: BufferedOutputStream, id: String, content: String) {
        val chunk = JSONObject().apply {
            put("id", id)
            put("object", "chat.completion.chunk")
            put("model", modelName)
            put("created", System.currentTimeMillis() / 1000)
            put("choices", JSONArray().apply {
                put(JSONObject().apply {
                    put("index", 0)
                    put("delta", JSONObject().apply {
                        put("content", content)
                    })
                    put("finish_reason", JSONObject.NULL)
                })
            })
        }
        output.write("data: $chunk\n\n".toByteArray())
        output.flush()
    }

    /** Strip <think>...</think> tags from model output */
    private fun stripThinkingTags(text: String): String {
        val stripped = text.replace(Regex("<think>[\\s\\S]*?</think>"), "").trim()
        return stripped.ifEmpty { text.trim() }
    }

    private fun formatChatML(messages: JSONArray): String {
        val sb = StringBuilder()
        for (i in 0 until messages.length()) {
            val msg = messages.getJSONObject(i)
            val role = msg.getString("role")

            // Skip tool/function roles not supported by local models
            if (role == "tool" || role == "function") continue

            val content = extractContent(msg)
            sb.append("<|im_start|>$role\n$content<|im_end|>\n")
        }
        sb.append("<|im_start|>assistant\n")
        return sb.toString()
    }

    private fun extractContent(msg: JSONObject): String {
        if (!msg.has("content") || msg.isNull("content")) return ""
        return when (val c = msg.get("content")) {
            is String -> c
            is JSONArray -> {
                val parts = mutableListOf<String>()
                for (j in 0 until c.length()) {
                    val part = c.optJSONObject(j) ?: continue
                    if (part.optString("type") == "text") {
                        parts.add(part.optString("text", ""))
                    }
                }
                parts.joinToString("\n")
            }
            else -> c.toString()
        }
    }

    private fun sendJson(output: BufferedOutputStream, status: Int, body: String) {
        val statusText = when (status) {
            200 -> "OK"; 404 -> "Not Found"; 500 -> "Internal Server Error"
            503 -> "Service Unavailable"; else -> "Error"
        }
        val bytes = body.toByteArray(Charsets.UTF_8)
        val response = "HTTP/1.1 $status $statusText\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\nAccess-Control-Allow-Origin: *\r\n\r\n"
        output.write(response.toByteArray())
        output.write(bytes)
    }
}
