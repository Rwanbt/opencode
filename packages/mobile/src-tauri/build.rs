fn main() {
    sync_jnilibs_onnxruntime();
    tauri_build::build()
}

// ort-sys reads ORT_LIB_LOCATION from the process environment in its own build
// script, which Cargo runs before this crate's build.rs (dependencies build
// first). Setting the var here cannot influence what ort-sys already linked
// against. What this CAN do — and must do, every build — is copy the exact
// libonnxruntime.so that ort-sys is using into the jniLibs dir that Tauri
// packages into the APK, so the two can never drift apart again. A previous
// drift (committed jniLibs/libonnxruntime.so left stale while ORT_LIB_LOCATION
// pointed at a newer extraction) caused `dlopen failed: cannot locate symbol
// OrtGetApiBase` at launch — Android's Bionic linker enforces exact GNU
// symbol-version matches, so even a same-named .so with a different ORT
// version is a hard crash, not a compatible fallback.
fn sync_jnilibs_onnxruntime() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let jnilibs_dir = format!("{}/gen/android/app/src/main/jniLibs/arm64-v8a", manifest_dir);
    let jnilibs_so = format!("{}/libonnxruntime.so", jnilibs_dir);

    let location = std::env::var("ORT_LIB_LOCATION").unwrap_or_else(|_| {
        let candidates = [
            format!("{}/ort-android/extracted/jni/arm64-v8a", manifest_dir),
            jnilibs_dir.clone(),
        ];
        candidates
            .into_iter()
            .find(|candidate| std::path::Path::new(candidate).join("libonnxruntime.so").exists())
            .unwrap_or(jnilibs_dir.clone())
    });

    let source_so = format!("{}/libonnxruntime.so", location);
    if source_so == jnilibs_so || !std::path::Path::new(&source_so).exists() {
        return;
    }

    if let Err(e) = std::fs::create_dir_all(&jnilibs_dir) {
        println!("cargo:warning=Could not create jniLibs dir {}: {}", jnilibs_dir, e);
        return;
    }
    match std::fs::copy(&source_so, &jnilibs_so) {
        Ok(_) => println!(
            "cargo:warning=Synced libonnxruntime.so from ORT_LIB_LOCATION={} into jniLibs/ (keeps linked ABI in lockstep with the packaged .so)",
            location
        ),
        Err(e) => println!("cargo:warning=Failed to sync libonnxruntime.so from {}: {}", location, e),
    }
}
