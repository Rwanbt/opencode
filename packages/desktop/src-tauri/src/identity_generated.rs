// Generated from config/identity.json by scripts/identity/generate.mjs.
// Do not edit: run `bun run identity:generate` after changing the manifest.

#![allow(dead_code)]

pub const PRODUCT_NAME: &str = "Unifia";
pub const VENDOR: &str = "Rwanbt";
pub const DATA_DIR_NAME: &str = "unifia";
pub const CONFIG_DIR_NAME: &str = ".unifia";
pub const DATABASE_FILE: &str = "unifia.db";

pub const CLI_COMMAND: &str = "unifia";
pub const CLI_WINDOWS_BINARY: &str = "unifia.exe";

/// The only scheme Unifia registers with the OS.
pub const OWNED_PROTOCOLS: [&str; 1] = ["unifia"];
/// Accepted by the import flow only — never registered, never claimed.
pub const PARSE_ONLY_PROTOCOLS: [&str; 1] = ["opencode"];

pub const TAURI_DESKTOP_DEV_APP_ID: &str = "ai.unifia.workbench.dev";
pub const TAURI_DESKTOP_DEV_DISPLAY_NAME: &str = "Unifia Dev";
pub const TAURI_DESKTOP_BETA_APP_ID: &str = "ai.unifia.workbench.beta";
pub const TAURI_DESKTOP_BETA_DISPLAY_NAME: &str = "Unifia Beta";
pub const TAURI_DESKTOP_PROD_APP_ID: &str = "ai.unifia.desktop";
pub const TAURI_DESKTOP_PROD_DISPLAY_NAME: &str = "Unifia";
pub const TAURI_MOBILE_APP_ID: &str = "ai.unifia.mobile";
pub const TAURI_MOBILE_DISPLAY_NAME: &str = "Unifia Mobile";
pub const ELECTRON_PREVIEW_DEV_APP_ID: &str = "ai.unifia.desktop.preview.dev";
pub const ELECTRON_PREVIEW_DEV_DISPLAY_NAME: &str = "Unifia Preview Dev";
pub const ELECTRON_PREVIEW_BETA_APP_ID: &str = "ai.unifia.desktop.preview.beta";
pub const ELECTRON_PREVIEW_BETA_DISPLAY_NAME: &str = "Unifia Preview Beta";
pub const ELECTRON_PREVIEW_APP_ID: &str = "ai.unifia.desktop.preview";
pub const ELECTRON_PREVIEW_DISPLAY_NAME: &str = "Unifia Preview";
