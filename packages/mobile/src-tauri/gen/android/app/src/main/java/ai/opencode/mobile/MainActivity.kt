package ai.opencode.mobile

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.Settings
import android.view.WindowManager
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import java.io.File

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // Diagnostic-only: expose the WebView to `chrome://inspect` on the host
    // PC so we can live-inspect DOM / console / WebSocket frames. Required to
    // investigate the portrait first-prompt bug (see plan doc). Remove before
    // shipping to end users — this is not a debug-only build guard because
    // release builds are where the bug reproduces.
    WebView.setWebContentsDebuggingEnabled(true)

    // Start LlamaService (Foreground Service) FIRST so it's alive before any
    // llama-server spawn. LlamaService keeps the whole process tree at adj=0
    // (foreground), exempt from Android PhantomProcessKiller and MIUI
    // SmartPower kill. Without this, llama-server child processes die ~5-20s
    // after spawn regardless of llama.cpp flags or kernel settings.
    try {
      val serviceIntent = Intent(this, LlamaService::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        startForegroundService(serviceIntent)
      } else {
        startService(serviceIntent)
      }
      android.util.Log.i("OpenCode", "LlamaService start requested")
    } catch (e: Exception) {
      android.util.Log.w("OpenCode", "LlamaService start failed: ${e.message}")
    }

    // Request notification permission (Android 13+) for the FGS notification.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
          != PackageManager.PERMISSION_GRANTED) {
        ActivityCompat.requestPermissions(
          this,
          arrayOf(Manifest.permission.POST_NOTIFICATIONS),
          101
        )
      }
    }

    // Request storage permissions
    requestStoragePermission()

    // Draw behind the display cutout (notch) on all edges
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      window.attributes.layoutInDisplayCutoutMode =
        WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
    }

    val baseDir = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.N) {
      dataDir
    } else {
      File(applicationInfo.dataDir)
    }
    val runtimeDir = File(baseDir, "runtime")

    // Write nativeLibraryDir path so Rust can find JNI-packaged executables
    val nativeLibDir = applicationInfo.nativeLibraryDir
    android.util.Log.i("OpenCode", "nativeLibraryDir: $nativeLibDir")
    val nlFile = File(runtimeDir, ".native_lib_dir")
    runtimeDir.mkdirs()
    nlFile.writeText(nativeLibDir)

    // Load llama.cpp libraries and start command loop
    try {
      LlamaEngine.nativeLibDir = nativeLibDir
      LlamaEngine.init()
      android.util.Log.i("OpenCode", "LlamaEngine initialized")
      val llmDir = File(baseDir, "runtime/llm_ipc")
      llmDir.mkdirs()
      LlamaEngine.startCommandLoop(
        File(llmDir, "request"),
        File(llmDir, "result")
      )
    } catch (e: Exception) {
      android.util.Log.w("OpenCode", "LlamaEngine init failed: ${e.message}")
    }

    // Start PTY server (must be spawned from Java context = Seccomp: 0)
    // bun/musl has Seccomp: 2 which blocks fork()/clone() from forkpty children.
    // pty_server runs as a standalone binary and manages PTY sessions over TCP.
    Thread {
      try {
        val svc = LlamaService.waitForInstance(5000)
        if (svc != null) {
          svc.spawnPtyServer(nativeLibDir, runtimeDir.absolutePath)
          android.util.Log.i("OpenCode", "PTY server spawn requested")
        } else {
          android.util.Log.w("OpenCode", "LlamaService not ready, PTY server not started")
        }
      } catch (e: Exception) {
        android.util.Log.w("OpenCode", "PTY server spawn failed: ${e.message}")
      }
    }.start()

    // Auto-load last used local model if available
    Thread {
      try {
        val modelsDir = File(runtimeDir, "models")
        if (modelsDir.exists()) {
          val ggufFiles = modelsDir.listFiles()?.filter { it.name.endsWith(".gguf") } ?: emptyList()
          if (ggufFiles.isNotEmpty()) {
            // Load the first (or most recently modified) model
            val model = ggufFiles.maxByOrNull { it.lastModified() }
            if (model != null) {
              android.util.Log.i("OpenCode", "Auto-loading model (JNI/GPU): ${model.name}")
              val ok = LlamaEngine.load(model.absolutePath)
              android.util.Log.i("OpenCode", "Model loaded: $ok")
            }
          }
        }
      } catch (e: Exception) {
        android.util.Log.w("OpenCode", "Auto-load model failed: ${e.message}")
      }
    }.start()

    // Extract non-executable assets on first launch or after APK update.
    // Compare lastUpdateTime to detect APK upgrades and re-extract the CLI bundle.
    val versionFile = File(runtimeDir, ".apk_version")
    val currentVersion = try {
      packageManager.getPackageInfo(packageName, 0).lastUpdateTime.toString()
    } catch (_: Exception) { "unknown" }
    val installedVersion = if (versionFile.exists()) versionFile.readText().trim() else ""
    val needsExtract = !File(runtimeDir, "opencode-cli.js").exists() || installedVersion != currentVersion
    if (needsExtract) {
      Thread {
        android.util.Log.i("OpenCode", "Extracting runtime assets to ${runtimeDir.absolutePath}")
        val result = RuntimeExtractor.extractAll(this, runtimeDir.absolutePath)
        if (result.isEmpty()) {
          versionFile.writeText(currentVersion)
          android.util.Log.i("OpenCode", "Runtime extraction complete (version=$currentVersion)")
        } else {
          android.util.Log.e("OpenCode", "Runtime extraction failed: $result")
        }
      }.start()
    }
  }

  private fun requestStoragePermission() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      // Android 11+: request MANAGE_EXTERNAL_STORAGE
      if (!Environment.isExternalStorageManager()) {
        try {
          val intent = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION)
          intent.data = Uri.parse("package:$packageName")
          startActivity(intent)
        } catch (e: Exception) {
          val intent = Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)
          startActivity(intent)
        }
      }
    } else {
      // Android 10 and below: request legacy permissions
      if (ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_EXTERNAL_STORAGE)
          != PackageManager.PERMISSION_GRANTED) {
        ActivityCompat.requestPermissions(
          this,
          arrayOf(
            Manifest.permission.READ_EXTERNAL_STORAGE,
            Manifest.permission.WRITE_EXTERNAL_STORAGE
          ),
          100
        )
      }
    }
  }
}
