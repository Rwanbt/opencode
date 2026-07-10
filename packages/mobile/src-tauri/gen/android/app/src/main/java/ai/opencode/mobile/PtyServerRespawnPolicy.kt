package ai.opencode.mobile

/**
 * Decides whether an unexpectedly-dead PTY server process should be
 * respawned, bounded by a max attempt count so a fundamentally broken
 * binary (or a device stuck killing it, e.g. Android's phantom process
 * killer) can't crash-loop forever.
 */
class PtyServerRespawnPolicy(private val maxAttempts: Int = 5) {
    private var attempts = 0

    /**
     * Call when the process exits. [expected] is true when the exit was
     * triggered by our own stopPtyServer() call — never respawn in that case.
     * Returns true if a respawn attempt should be made now.
     */
    fun shouldRespawn(expected: Boolean): Boolean {
        if (expected) {
            attempts = 0
            return false
        }
        if (attempts >= maxAttempts) return false
        attempts++
        return true
    }

    /** Call once the respawned process is confirmed alive/healthy again. */
    fun onHealthy() {
        attempts = 0
    }

    /** Attempts consumed so far since the last onHealthy()/expected stop. */
    fun attemptCount(): Int = attempts
}
