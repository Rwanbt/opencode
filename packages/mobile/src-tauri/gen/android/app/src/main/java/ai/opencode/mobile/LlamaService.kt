package ai.opencode.mobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log

/**
 * Foreground Service that owns all llama-server child processes.
 *
 * Why this exists: on Android 12+ (API 31+), child processes spawned by a regular
 * Activity are classified as "phantom processes" and aggressively killed by the
 * system — typically ~20 seconds after spawn. MIUI adds its own SmartPower killer
 * on top. Even with `max_phantom_processes=MAX_INT`, the parent Activity is
 * frequently demoted to background (`fg TPSL`) and the whole process tree dies.
 *
 * A Foreground Service with a persistent notification keeps its process tree
 * pinned at `adj=0` (foreground), exempting it from PhantomProcessKiller, Doze,
 * and MIUI background kill. Children spawned via ProcessBuilder from inside this
 * service inherit that exemption.
 *
 * Lifecycle:
 *  - Started by MainActivity.onCreate() via startForegroundService()
 *  - Calls startForeground(NOTIF_ID, notification) in onCreate — MUST happen
 *    within 5 seconds of startForegroundService() or Android throws
 *    ForegroundServiceDidNotStartInTimeException.
 *  - Exposes spawnServer() / stopServer() / getProcess() via a static singleton
 *    so LlamaEngine can call them without bindService plumbing.
 *  - Lives for the app's lifetime; notification is updated when a model
 *    loads/unloads.
 */
class LlamaService : Service() {
    companion object {
        private const val TAG = "LlamaService"
        private const val CHANNEL_ID = "llama_inference"
        private const val CHANNEL_NAME = "Local LLM Inference"
        private const val NOTIF_ID = 4097

        @Volatile
        private var instance: LlamaService? = null

        /** Get the running service instance (or null if not yet started). */
        fun get(): LlamaService? = instance

        /** Blocking wait for the service to be ready. Returns null on timeout. */
        fun waitForInstance(timeoutMs: Long = 5000): LlamaService? {
            val deadline = System.currentTimeMillis() + timeoutMs
            while (System.currentTimeMillis() < deadline) {
                val svc = instance
                if (svc != null) return svc
                try { Thread.sleep(50) } catch (_: InterruptedException) {}
            }
            return instance
        }
    }

    @Volatile
    private var child: Process? = null

    @Volatile
    private var ptyServerProcess: Process? = null

    @Volatile
    private var isForeground: Boolean = false

    @Volatile
    private var watchdogThread: Thread? = null

    @Volatile
    private var ptyWatchdogThread: Thread? = null

    // Bounds automatic pty_server respawns so a fundamentally broken binary
    // (or a device that keeps phantom-process-killing it) can't crash-loop
    // forever. See PtyServerRespawnPolicy.
    private val ptyRespawnPolicy = PtyServerRespawnPolicy()

    // Params of the last spawnPtyServer() call, kept so the watchdog can
    // respawn with the same args after an unexpected death.
    private var lastPtyNativeLibDir: String? = null
    private var lastPtyRuntimeDir: String? = null
    private var lastPtyPort: Int = 14098

    // Held for the lifetime of an active llama-server child process.
    // PARTIAL_WAKE_LOCK prevents CPU deep sleep between token generation steps
    // when the screen is off — without it the SoC can stall for ~200ms per step.
    private var inferenceWakeLock: PowerManager.WakeLock? = null

    /** Called on the watchdog thread when llama-server exits unexpectedly. */
    @Volatile
    var onServerCrash: ((exitCode: Int) -> Unit)? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        createNotificationChannel()
        startInForeground("OpenCode", "Local AI service ready")
        Log.i(TAG, "LlamaService started in foreground")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // STICKY so the service survives if the system briefly kills it.
        return START_STICKY
    }

    override fun onDestroy() {
        Log.i(TAG, "LlamaService onDestroy — killing child llama-server if any")
        stopChildProcess()  // also calls releaseInferenceWakeLock()
        releaseInferenceWakeLock()  // safety net if child was already null
        instance = null
        super.onDestroy()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Runs on-device LLM inference"
                setShowBadge(false)
            }
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(title: String, text: String): Notification {
        val pendingIntent: PendingIntent? = try {
            val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
            launchIntent?.let {
                PendingIntent.getActivity(
                    this,
                    0,
                    it,
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
                )
            }
        } catch (_: Exception) { null }

        val builder = Notification.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setOngoing(true)
            .setContentIntent(pendingIntent)
        return builder.build()
    }

    private fun startInForeground(title: String, text: String) {
        val notification = buildNotification(title, text)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            // API 34+: MUST specify foregroundServiceType
            startForeground(
                NOTIF_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            )
        } else {
            startForeground(NOTIF_ID, notification)
        }
        isForeground = true
    }

    /** Update the persistent notification text (e.g. "Loading Gemma-4..."). */
    fun updateNotification(title: String, text: String) {
        try {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.notify(NOTIF_ID, buildNotification(title, text))
        } catch (e: Exception) {
            Log.w(TAG, "updateNotification failed: ${e.message}")
        }
    }

    /** True if the llama-server child process is alive (model loaded and running). */
    fun isModelActive(): Boolean = child?.let { isProcessAlive(it) } ?: false

    private fun isProcessAlive(proc: Process): Boolean = try {
        proc.exitValue()
        false  // exitValue() throws if still running; if it returns, process is dead
    } catch (_: IllegalThreadStateException) { true }

    /**
     * Demote from foreground when the app backgrounds with no active inference.
     * Removes the persistent notification without killing the service or pty_server.
     * Safe to call multiple times; no-op if already not in foreground.
     */
    fun tryDemoteFromForeground() {
        if (!isForeground) return
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE)
            } else {
                @Suppress("DEPRECATION")
                stopForeground(true)
            }
            isForeground = false
            Log.i(TAG, "Demoted from foreground (no active inference)")
        } catch (e: Exception) {
            Log.w(TAG, "tryDemoteFromForeground failed: ${e.message}")
        }
    }

    /**
     * Promote back to foreground. Must be called before any llama-server spawn,
     * or within 5s of startForegroundService() on a fresh start.
     */
    fun promoteToForeground(title: String = "OpenCode", text: String = "Local AI service ready") {
        if (isForeground) return
        startInForeground(title, text)
        Log.i(TAG, "Promoted back to foreground")
    }

    /**
     * Spawn a llama-server child process. The child inherits this service's
     * foreground priority, so it's exempt from PhantomProcessKiller.
     * Returns the spawned Process, or null on failure.
     */
    fun spawnServer(
        args: List<String>,
        envOverrides: Map<String, String> = emptyMap()
    ): Process? {
        stopChildProcess()  // kill any previous instance
        return try {
            val pb = ProcessBuilder(args)
            envOverrides.forEach { (k, v) -> pb.environment()[k] = v }
            pb.redirectErrorStream(true)
            val proc = pb.start()
            child = proc
            acquireInferenceWakeLock()
            // Drain stdout into logcat so the OS pipe (64 KB on bionic) never fills.
            // Without this, llama-server blocks progressively on verbose ggml logs
            // and decode throughput collapses on the 2nd+ inference (observed -56 %).
            // Mirrors spawnPtyServer pattern below.
            Thread {
                try {
                    proc.inputStream.bufferedReader().forEachLine { line ->
                        Log.d("llama-server", line)
                    }
                } catch (_: Exception) {}
                Log.i(TAG, "llama-server stdout stream ended")
            }.apply { isDaemon = true }.start()
            Log.i(TAG, "Spawned child process, argv[0]=${args.firstOrNull()}")
            startWatchdog(proc)
            proc
        } catch (e: Exception) {
            Log.e(TAG, "Failed to spawn child process: ${e.message}")
            null
        }
    }

    /**
     * Monitor the child process and fire onServerCrash if it exits unexpectedly.
     * Interrupted when stopChildProcess() is called (intentional stop).
     */
    private fun startWatchdog(proc: Process) {
        watchdogThread?.interrupt()
        val watchdog = Thread {
            try {
                val exitCode = proc.waitFor()
                // Only fire crash callback if this is still the active child
                // (i.e., we didn't call stopChildProcess() ourselves).
                if (child === proc) {
                    child = null
                    Log.w(TAG, "llama-server exited unexpectedly (code=$exitCode)")
                    updateNotification("OpenCode", "Model stopped (exit $exitCode) — tap to restart")
                    onServerCrash?.invoke(exitCode)
                }
            } catch (_: InterruptedException) {
                // Intentional stop via stopChildProcess() — no action needed
            }
        }
        watchdog.isDaemon = true
        watchdog.name = "llama-watchdog"
        watchdog.start()
        watchdogThread = watchdog
    }

    /**
     * Query the device thermal status from Android's PowerManager.
     * Returns "nominal", "fair", "serious", or "critical".
     * Available on API 29+; returns "nominal" on older devices.
     */
    fun getThermalState(): String {
        return try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return "nominal"
            val pm = getSystemService(POWER_SERVICE) as android.os.PowerManager
            when (pm.currentThermalStatus) {
                android.os.PowerManager.THERMAL_STATUS_NONE,
                android.os.PowerManager.THERMAL_STATUS_LIGHT -> "nominal"
                android.os.PowerManager.THERMAL_STATUS_MODERATE -> "fair"
                android.os.PowerManager.THERMAL_STATUS_SEVERE -> "serious"
                else -> "critical"
            }
        } catch (e: Exception) {
            Log.w(TAG, "getThermalState failed: ${e.message}")
            "nominal"
        }
    }

    /** Current child process, or null if none running. */
    fun getChildProcess(): Process? = child

    /** Kill and clear the current child process. */
    fun stopChildProcess() {
        // Interrupt watchdog first so it doesn't fire onServerCrash
        // after we intentionally destroy the process.
        watchdogThread?.interrupt()
        watchdogThread = null
        val proc = child ?: return
        child = null  // clear before destroyForcibly so watchdog sees child===null
        try {
            proc.destroyForcibly()
            proc.waitFor(3, java.util.concurrent.TimeUnit.SECONDS)
            Log.i(TAG, "Child process stopped")
        } catch (e: Exception) {
            Log.w(TAG, "Error stopping child process: ${e.message}")
        }
        releaseInferenceWakeLock()
    }

    private fun acquireInferenceWakeLock() {
        try {
            if (inferenceWakeLock?.isHeld == true) return
            val pm = getSystemService(POWER_SERVICE) as PowerManager
            inferenceWakeLock = pm.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "opencode:inference"
            ).also { it.acquire(30 * 60 * 1000L /* 30 min max */) }
            Log.i(TAG, "Inference wake lock acquired")
        } catch (e: Exception) {
            Log.w(TAG, "Failed to acquire wake lock: ${e.message}")
        }
    }

    private fun releaseInferenceWakeLock() {
        try {
            inferenceWakeLock?.let { if (it.isHeld) it.release() }
            inferenceWakeLock = null
            Log.i(TAG, "Inference wake lock released")
        } catch (e: Exception) {
            Log.w(TAG, "Failed to release wake lock: ${e.message}")
        }
    }

    // ── PTY Server ─────────────────────────────────────────────────
    //
    // pty_server is a native binary (compiled with NDK/bionic) that
    // manages PTY sessions over TCP.  Because it's spawned from this
    // Foreground Service (Java context, Seccomp: 0), its children
    // (bash via forkpty) can freely fork+exec external commands.
    //
    // bun connects to it via TCP instead of using the FFI-based
    // bun-pty library (which runs under musl's Seccomp: 2).

    /**
     * Spawn the PTY server binary.
     * @param nativeLibDir  Path to nativeLibraryDir (contains libpty_server.so)
     * @param runtimeDir    Path to the runtime directory (for port file)
     * @param port          TCP port for the PTY server
     */
    fun spawnPtyServer(nativeLibDir: String, runtimeDir: String, port: Int = 14098) {
        // stopPtyServer() interrupts any watchdog from a previous instance
        // first, so it never mistakes this intentional restart for an
        // unexpected death.
        stopPtyServer()
        lastPtyNativeLibDir = nativeLibDir
        lastPtyRuntimeDir = runtimeDir
        lastPtyPort = port

        val binary = "$nativeLibDir/libpty_server.so"
        val portFile = "$runtimeDir/.pty_server_port"

        val file = java.io.File(binary)
        if (!file.exists()) {
            Log.w(TAG, "PTY server binary not found: $binary")
            return
        }

        try {
            val pb = ProcessBuilder(listOf(binary, port.toString(), portFile))
            pb.redirectErrorStream(true)
            val proc = pb.start()
            ptyServerProcess = proc
            Log.i(TAG, "PTY server spawned on port $port (binary=$binary)")
            ptyRespawnPolicy.onHealthy()

            // Stream PTY server logs to logcat in background
            Thread {
                try {
                    proc.inputStream.bufferedReader().forEachLine { line ->
                        Log.d("PTY-Server", line)
                    }
                } catch (_: Exception) {}
                Log.i(TAG, "PTY server process ended")
            }.start()

            startPtyWatchdog(proc)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to spawn PTY server: ${e.message}")
        }
    }

    /**
     * Monitor the PTY server process and respawn it if it exits
     * unexpectedly (e.g. Android's phantom process killer reaping it —
     * see PtyServerRespawnPolicy for the crash-loop bound). Interrupted
     * when stopPtyServer()/a fresh spawnPtyServer() call supersedes it.
     */
    private fun startPtyWatchdog(proc: Process) {
        val watchdog = Thread {
            try {
                val exitCode = proc.waitFor()
                // Only react if this is still the active process (i.e. we
                // didn't call stopPtyServer() ourselves, which clears the
                // reference before destroying it).
                if (ptyServerProcess === proc) {
                    ptyServerProcess = null
                    Log.w(TAG, "PTY server exited unexpectedly (code=$exitCode)")
                    val nativeLibDir = lastPtyNativeLibDir
                    val runtimeDir = lastPtyRuntimeDir
                    if (nativeLibDir != null && runtimeDir != null &&
                        ptyRespawnPolicy.shouldRespawn(expected = false)
                    ) {
                        Log.i(
                            TAG,
                            "Respawning PTY server (attempt ${ptyRespawnPolicy.attemptCount()})"
                        )
                        spawnPtyServer(nativeLibDir, runtimeDir, lastPtyPort)
                    } else {
                        Log.e(TAG, "PTY server respawn budget exhausted, giving up")
                    }
                }
            } catch (_: InterruptedException) {
                // Intentional stop/restart — no action needed
            }
        }
        watchdog.isDaemon = true
        watchdog.name = "pty-watchdog"
        watchdog.start()
        ptyWatchdogThread = watchdog
    }

    /** Stop the PTY server process. */
    fun stopPtyServer() {
        // Interrupt the watchdog first so it doesn't treat this intentional
        // stop as an unexpected death and try to respawn.
        ptyWatchdogThread?.interrupt()
        ptyWatchdogThread = null
        ptyRespawnPolicy.shouldRespawn(expected = true)
        val proc = ptyServerProcess ?: return
        ptyServerProcess = null  // clear before destroying so the watchdog sees null
        try {
            proc.destroyForcibly()
            proc.waitFor(3, java.util.concurrent.TimeUnit.SECONDS)
            Log.i(TAG, "PTY server stopped")
        } catch (e: Exception) {
            Log.w(TAG, "Error stopping PTY server: ${e.message}")
        }
    }
}
