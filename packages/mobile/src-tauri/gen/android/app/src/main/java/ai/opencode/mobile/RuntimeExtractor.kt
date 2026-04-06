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
     * Executables (bun, bash, rg, musl libs) are now packaged as JNI libs
     * and installed by Android to nativeLibraryDir with execute permission.
     * We only need to extract: opencode-cli.js, node_modules shims.
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

            return "" // success
        } catch (e: Exception) {
            return "Extraction failed: ${e.message}"
        }
    }
}
