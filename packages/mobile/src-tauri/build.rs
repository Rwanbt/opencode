fn main() {
    // Auto-set ORT_LIB_LOCATION for Android builds if not already set
    if std::env::var("ORT_LIB_LOCATION").is_err() {
        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
        let candidates = [
            format!("{}/ort-android/extracted/jni/arm64-v8a", manifest_dir),
            format!("{}/gen/android/app/src/main/jniLibs/arm64-v8a", manifest_dir),
        ];
        for candidate in &candidates {
            if std::path::Path::new(candidate).join("libonnxruntime.so").exists() {
                println!("cargo:rustc-env=ORT_LIB_LOCATION={}", candidate);
                std::env::set_var("ORT_LIB_LOCATION", candidate);
                println!(
                    "cargo:warning=Auto-detected ORT_LIB_LOCATION={}",
                    candidate
                );
                break;
            }
        }
    }
    tauri_build::build()
}
