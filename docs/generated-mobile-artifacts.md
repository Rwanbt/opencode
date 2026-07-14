# Generated mobile artifacts

packages/mobile/src-tauri/assets/runtime/opencode-cli.js is the authoritative
generated bundle. The Android generated-assets copy is derived from it by
scripts/bundle-mobile.mjs; it must not be edited independently.

Run node scripts/verify-mobile-bundle.mjs after generation. The check verifies
that every migration directory is represented, production metadata exists, the
observability runtime is present, and the Android copy is byte-identical.

The bundle is versioned because the offline Android runtime requires it at
install time. Source changes that affect the bundle must regenerate both copies
in one change and review the generated diff separately from source changes.