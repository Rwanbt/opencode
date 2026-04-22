package ai.opencode.mobile

import android.app.Application

/**
 * Pre-load libonnxruntime.so BEFORE the class loader reaches
 * WryActivity.<clinit> — which calls System.loadLibrary("opencode_mobile_lib")
 * and fails with UnsatisfiedLinkError (OrtGetApiBase) if ORT isn't resolvable.
 *
 * Android doesn't chase NEEDED entries the way glibc does on Linux: when Rust
 * ort is built with ORT_PREFER_DYNAMIC_LINK=1 (see build-android.sh), the
 * resulting libopencode_mobile_lib.so has an undefined reference to
 * OrtGetApiBase that can only be satisfied if libonnxruntime.so is *already*
 * in the process' namespace. System.loadLibrary pushes it there explicitly.
 *
 * Registered via android:name=".OpenCodeApp" in AndroidManifest.xml. The
 * Application class is loaded before any Activity, so this runs first.
 */
class OpenCodeApp : Application() {
    companion object {
        init {
            try {
                System.loadLibrary("onnxruntime")
                android.util.Log.i("OpenCode", "libonnxruntime.so preloaded")
            } catch (e: UnsatisfiedLinkError) {
                android.util.Log.w("OpenCode", "libonnxruntime.so preload failed: ${e.message}")
            }
        }
    }
}
