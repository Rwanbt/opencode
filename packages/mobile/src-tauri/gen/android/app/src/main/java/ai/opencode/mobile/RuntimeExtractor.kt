package ai.opencode.mobile

import android.content.Context
import android.content.res.AssetManager
import java.io.File
import java.io.FileOutputStream

/**
 * Extracts runtime binaries from APK assets to the app's private data directory.
 * Called from Rust via JNI.
 */
object RuntimeExtractor {

    /**
     * Extract a single asset file to the target path.
     * Returns true if successful.
     */
    @JvmStatic
    fun extractAsset(context: Context, assetPath: String, targetPath: String): Boolean {
        return try {
            val targetFile = File(targetPath)
            targetFile.parentFile?.mkdirs()

            context.assets.open(assetPath).use { input ->
                FileOutputStream(targetFile).use { output ->
                    input.copyTo(output, bufferSize = 65536)
                }
            }

            // Make executable
            targetFile.setExecutable(true, false)
            targetFile.setReadable(true, false)
            true
        } catch (e: Exception) {
            android.util.Log.e("RuntimeExtractor", "Failed to extract $assetPath: ${e.message}")
            false
        }
    }

    /**
     * List files in an asset directory.
     * Returns comma-separated list of file names.
     */
    @JvmStatic
    fun listAssets(context: Context, path: String): String {
        return try {
            context.assets.list(path)?.joinToString(",") ?: ""
        } catch (e: Exception) {
            ""
        }
    }

    /**
     * Check if an asset exists.
     */
    @JvmStatic
    fun assetExists(context: Context, path: String): Boolean {
        return try {
            context.assets.open(path).use { true }
        } catch (e: Exception) {
            false
        }
    }

    /**
     * Extract non-executable runtime files from APK assets.
     * Executables (bun, bash, rg, musl libs) are packaged as JNI libs
     * and installed by Android to nativeLibraryDir with execute permission.
     * We extract: opencode-cli.js, node_modules shims, wasm files, rootfs.tar.gz.
     * Returns empty string on success, error message on failure.
     */
    @JvmStatic
    fun extractAll(context: Context, targetDir: String): String {
        try {
            val homeDir = File(targetDir, "home/.opencode")
            val nmDir = File(targetDir, "node_modules/@parcel/watcher")

            homeDir.mkdirs()
            nmDir.mkdirs()

            // Extract CLI JS bundle
            val cliTarget = File(targetDir, "opencode-cli.js").absolutePath
            if (!extractAsset(context, "runtime/opencode-cli.js", cliTarget)) {
                return "Failed to extract opencode-cli.js"
            }

            // Extract node_modules shims
            val shimFiles = listOf("wrapper.js", "package.json")
            for (name in shimFiles) {
                val assetPath = "runtime/node_modules/@parcel/watcher/$name"
                val targetPath = File(nmDir, name).absolutePath
                extractAsset(context, assetPath, targetPath)
            }

            // Extract tree-sitter wasm files (if present in assets)
            try {
                val wasmFiles = context.assets.list("runtime")?.filter { it.endsWith(".wasm") } ?: emptyList()
                for (name in wasmFiles) {
                    val assetPath = "runtime/$name"
                    val targetPath = File(targetDir, name).absolutePath
                    extractAsset(context, assetPath, targetPath)
                }
            } catch (_: Exception) {}

            // Extract pre-built Alpine rootfs.tar.gz (version-guarded).
            // The tar.gz (~80 MB) is only copied when the asset version changes,
            // avoiding an expensive re-copy on every app start.
            // Actual decompression into rootfs/ is done by install_extended_env (Rust)
            // which checks health sentinels and skips if the rootfs is already complete.
            extractRootfs(context, targetDir)

            return "" // success
        } catch (e: Exception) {
            return "Extraction failed: ${e.message}"
        }
    }

    /**
     * Copy rootfs.tgz from assets to targetDir as rootfs.tar.gz, guarded by a version file.
     * The asset is named .tgz to avoid AAPT2 gunzipping .gz files during packaging.
     * Version is read from assets/runtime/rootfs_version.txt (single line integer).
     * Skips the copy if targetDir/.rootfs_version already matches.
     */
    @JvmStatic
    private fun extractRootfs(context: Context, targetDir: String) {
        val assetVersion = try {
            context.assets.open("runtime/rootfs_version.txt").bufferedReader().readLine()?.trim() ?: "0"
        } catch (_: Exception) {
            android.util.Log.w("RuntimeExtractor", "rootfs_version.txt not found in assets, skipping rootfs extract")
            return
        }

        val versionFile = File(targetDir, ".rootfs_version")
        val installedVersion = if (versionFile.exists()) versionFile.readText().trim() else ""

        if (installedVersion == assetVersion) {
            android.util.Log.i("RuntimeExtractor", "rootfs.tgz up-to-date (v$assetVersion), skipping copy")
            return
        }

        android.util.Log.i("RuntimeExtractor", "Copying rootfs.tgz (asset v$assetVersion, installed '$installedVersion')...")
        val tarTarget = File(targetDir, "rootfs.tar.gz")
        try {
            context.assets.open("runtime/rootfs.tgz").use { input ->
                tarTarget.outputStream().use { output ->
                    input.copyTo(output, bufferSize = 1024 * 256) // 256 KB chunks
                }
            }
            // Write version stamp AFTER successful copy so partial copies are re-tried.
            versionFile.writeText(assetVersion)
            android.util.Log.i("RuntimeExtractor", "rootfs.tgz copied (${tarTarget.length() / 1_048_576} MB)")
        } catch (e: Exception) {
            android.util.Log.e("RuntimeExtractor", "Failed to copy rootfs.tgz: ${e.message}")
            // Non-fatal: install_extended_env will surface the error to the user.
        }
    }
}
