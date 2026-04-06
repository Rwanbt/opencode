package ai.opencode.mobile

import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import java.io.File

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

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
