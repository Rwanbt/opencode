package ai.opencode.mobile

import android.Manifest
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.Settings
import android.system.Os
import android.view.WindowManager
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import java.io.File

class MainActivity : TauriActivity() {
  private var hadAllFilesAccessAtCreate: Boolean = false

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // WebView contents debugging is gated on ApplicationInfo.FLAG_DEBUGGABLE so
    // release builds (isDebuggable=false in build.gradle.kts) do NOT expose
    // the WebView to chrome://inspect. An attacker with USB access to an
    // installed release build cannot attach the web inspector to the IPC surface.
    val isDebuggable = (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
    WebView.setWebContentsDebuggingEnabled(isDebuggable)

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

    // Snapshot the All-Files-Access state BEFORE requesting it, so onResume can
    // detect the user flipping the switch and force a restart to refresh the
    // FUSE mount namespace (subprocess /sdcard access depends on it).
    hadAllFilesAccessAtCreate = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R &&
      Environment.isExternalStorageManager()

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

    // Create Termux-style symlinks pointing at external storage. Done here in
    // Java so the process-wide FUSE mount view is correctly resolved before
    // any bun/bash subprocess inherits the namespace. The shell's $HOME is
    // runtime/home (see runtime.rs), so that's where ~/storage must live.
    setupStorageSymlinks(File(runtimeDir, "home"))

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
      // Android 11+: MANAGE_EXTERNAL_STORAGE (full FS) + scoped READ_MEDIA_*
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
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        val media = arrayOf(
          Manifest.permission.READ_MEDIA_IMAGES,
          Manifest.permission.READ_MEDIA_VIDEO,
          Manifest.permission.READ_MEDIA_AUDIO
        )
        val missing = media.filter {
          ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isNotEmpty()) {
          ActivityCompat.requestPermissions(this, missing.toTypedArray(), 102)
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

  override fun onResume() {
    super.onResume()
    // If the user just granted "All files access" in Settings while the app was
    // suspended, StorageManagerService remounted /sdcard in THIS process'
    // namespace — but not in the pty_server child (forked earlier in onCreate).
    // Every bash spawned by pty_server still inherits the stale, FUSE-gated
    // view and gets EACCES on /sdcard writes.
    //
    // Targeted fix: kill + respawn pty_server. The new fork() inherits the
    // refreshed namespace of the Java process. No splash flash, WebView state
    // preserved. Falls back to full restart only if isExternalStorageManager()
    // still reports false after respawn (HyperOS sync bug).
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val nowGranted = Environment.isExternalStorageManager()
      // Track the last-seen state so every OFF→ON transition re-triggers the
      // respawn (not just the first one). Without this, a user who toggles the
      // permission off and back on in the same session would stay stuck with
      // a stale mount namespace.
      if (!nowGranted) hadAllFilesAccessAtCreate = false
      if (nowGranted && !hadAllFilesAccessAtCreate) {
        android.util.Log.i("OpenCode", "All-files-access just granted — respawning pty_server to refresh FUSE mount")
        hadAllFilesAccessAtCreate = true
        val svc = LlamaService.get()
        val nlib = applicationInfo.nativeLibraryDir
        val baseDir = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) dataDir else File(applicationInfo.dataDir)
        val runtimeDir = File(baseDir, "runtime").absolutePath
        if (svc != null) {
          try {
            svc.stopPtyServer()
            svc.spawnPtyServer(nlib, runtimeDir)
            android.util.Log.i("OpenCode", "pty_server respawned with refreshed mount namespace")
          } catch (e: Exception) {
            android.util.Log.w("OpenCode", "pty_server respawn failed, falling back to full restart: ${e.message}")
            forceFullRestart()
          }
        } else {
          android.util.Log.w("OpenCode", "LlamaService not available, falling back to full restart")
          forceFullRestart()
        }
      }
    }
  }

  private fun forceFullRestart() {
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    launch?.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NEW_TASK)
    if (launch != null) startActivity(launch)
    finishAffinity()
    Runtime.getRuntime().exit(0)
  }

  private fun setupStorageSymlinks(homeDir: File) {
    try {
      homeDir.mkdirs()
      val storage = File(homeDir, "storage")
      // Earlier versions of runtime.rs created ~/storage as a symlink directly
      // to /sdcard. Replace it with a real directory so we can populate it
      // with per-target symlinks.
      if (java.nio.file.Files.isSymbolicLink(storage.toPath())) {
        try { storage.delete() } catch (_: Exception) {}
      } else if (storage.exists() && !storage.isDirectory) {
        try { storage.delete() } catch (_: Exception) {}
      }
      storage.mkdirs()

      // Primary: Environment.getExternalStorageDirectory() returns the canonical
      // /storage/emulated/0 path (not the /sdcard legacy symlink), which is what
      // the per-process FUSE mount actually exposes when MANAGE_EXTERNAL_STORAGE
      // is granted.
      val external = Environment.getExternalStorageDirectory()
      val links = mutableListOf<Pair<String, String>>()
      if (external != null) {
        links += "shared" to external.absolutePath
        // Standard public subdirs — each resolved through the Android API so
        // localized/OEM overrides (Xiaomi) are honored.
        val publicDirs = listOf(
          "downloads" to Environment.DIRECTORY_DOWNLOADS,
          "documents" to Environment.DIRECTORY_DOCUMENTS,
          "pictures" to Environment.DIRECTORY_PICTURES,
          "music" to Environment.DIRECTORY_MUSIC,
          "movies" to Environment.DIRECTORY_MOVIES,
          "dcim" to Environment.DIRECTORY_DCIM,
        )
        for ((linkName, envDir) in publicDirs) {
          val target = Environment.getExternalStoragePublicDirectory(envDir)
          if (target != null) links += linkName to target.absolutePath
        }
      }
      // App-specific external dir — accessible WITHOUT MANAGE_EXTERNAL_STORAGE,
      // survives even if the user never grants All-Files-Access. Exposed under
      // two names:
      //   ~/storage/external-0  (legacy, kept for compat)
      //   ~/workspace           (discoverable default CWD — always writable on
      //                          any Android/OEM, since it's app-private and
      //                          bypasses FUSE scoped-storage gating)
      val appExt = getExternalFilesDir(null)?.absolutePath
      if (appExt != null) {
        links += "external-0" to appExt
        // Also symlink ~/workspace directly (not under ~/storage/)
        val workspaceLink = File(homeDir, "workspace")
        try {
          if (workspaceLink.exists() || java.nio.file.Files.isSymbolicLink(workspaceLink.toPath())) {
            workspaceLink.delete()
          }
        } catch (_: Exception) {}
        try {
          Os.symlink(appExt, workspaceLink.absolutePath)
          android.util.Log.i("OpenCode", "symlink ~/workspace -> $appExt")
        } catch (e: Exception) {
          android.util.Log.w("OpenCode", "symlink ~/workspace failed: ${e.message}")
        }
      }

      for ((name, target) in links) {
        val linkPath = File(storage, name)
        // Idempotent: remove stale entry (file / old symlink) then recreate
        try { if (linkPath.exists() || java.nio.file.Files.isSymbolicLink(linkPath.toPath())) linkPath.delete() } catch (_: Exception) {}
        try {
          Os.symlink(target, linkPath.absolutePath)
          android.util.Log.i("OpenCode", "symlink ~/storage/$name -> $target")
        } catch (e: Exception) {
          android.util.Log.w("OpenCode", "symlink ~/storage/$name failed: ${e.message}")
        }
      }
    } catch (e: Exception) {
      android.util.Log.w("OpenCode", "setupStorageSymlinks failed: ${e.message}")
    }
  }
}
