package ai.opencode.mobile

import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.enableEdgeToEdge
import java.io.File

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

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
}
