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

    // Extract non-executable assets (opencode-cli.js, node_modules) on first launch
    val marker = File(runtimeDir, "opencode-cli.js")
    if (!marker.exists()) {
      Thread {
        android.util.Log.i("OpenCode", "Extracting runtime assets to ${runtimeDir.absolutePath}")
        val result = RuntimeExtractor.extractAll(this, runtimeDir.absolutePath)
        if (result.isEmpty()) {
          android.util.Log.i("OpenCode", "Runtime extraction complete")
        } else {
          android.util.Log.e("OpenCode", "Runtime extraction failed: $result")
        }
      }.start()
    }
  }
}
