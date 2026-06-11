package ai.opencode.mobile

/**
 * In-memory circuit breaker for llama-server GPU backend failures.
 *
 * When a backend (Vulkan/OpenCL) fails to boot, we record the failure and
 * skip that backend for RESET_AFTER_MS before retrying. This avoids the
 * 180 s readiness timeout on every model load when a GPU driver is broken.
 *
 * State is process-lifetime only; killing/restarting the app resets it,
 * which is the intended UX for "user fixes driver issue, restarts app".
 */
object BackendCircuitBreaker {
    private const val RESET_AFTER_MS = 5 * 60_000L  // 5 minutes

    private val failures = mutableMapOf<LlamaEngine.Backend, Long>()

    @Synchronized
    fun recordFailure(backend: LlamaEngine.Backend) {
        failures[backend] = System.currentTimeMillis()
    }

    @Synchronized
    fun isDisabled(backend: LlamaEngine.Backend): Boolean {
        val t = failures[backend] ?: return false
        if (System.currentTimeMillis() - t > RESET_AFTER_MS) {
            failures.remove(backend)
            return false
        }
        return true
    }

    @Synchronized
    fun reset() {
        failures.clear()
    }
}
