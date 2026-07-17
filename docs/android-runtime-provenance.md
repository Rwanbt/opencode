# Android runtime provenance

The Android runtime is an assembled release input, not an opaque cache. Every
release build must generate `artifacts/android-runtime-provenance.json` with
`scripts/android-runtime-provenance.ps1` and publish it beside the APK/AAB.

The report records the commit, OpenCode version, target ABI, tool versions,
file sizes, and SHA-256 hashes for native libraries, embedded runtime files,
and Android packages. A release must be rejected when a required artifact is
missing, has the wrong ABI, or its hash is not present in the report.

Required native inputs include ONNX Runtime and the llama/ggml libraries. They
must be built or downloaded by the release workflow from explicitly pinned
versions; copying files from another worktree is not a valid provenance.