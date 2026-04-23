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
        stopChildProcess()
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
            proc
        } catch (e: Exception) {
            Log.e(TAG, "Failed to spawn child process: ${e.message}")
            null
        }
    }

    /** Current child process, or null if none running. */
    fun getChildProcess(): Process? = child

    /** Kill and clear the current child process. */
    fun stopChildProcess() {
        val proc = child ?: return
        try {
            proc.destroyForcibly()
            proc.waitFor(3, java.util.concurrent.TimeUnit.SECONDS)
            Log.i(TAG, "Child process stopped")
        } catch (e: Exception) {
            Log.w(TAG, "Error stopping child process: ${e.message}")
        }
        child = null
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
        stopPtyServer()
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

            // Stream PTY server logs to logcat in background
            Thread {
                try {
                    proc.inputStream.bufferedReader().forEachLine { line ->
                        Log.d("PTY-Server", line)
                    }
                } catch (_: Exception) {}
                Log.i(TAG, "PTY server process ended")
            }.start()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to spawn PTY server: ${e.message}")
        }
    }

    /** Stop the PTY server process. */
    fun stopPtyServer() {
        val proc = ptyServerProcess ?: return
        try {
            proc.destroyForcibly()
            proc.waitFor(3, java.util.concurrent.TimeUnit.SECONDS)
            Log.i(TAG, "PTY server stopped")
        } catch (e: Exception) {
            Log.w(TAG, "Error stopping PTY server: ${e.message}")
        }
        ptyServerProcess = null
    }
}
