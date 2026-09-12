use tauri_plugin_window_state::StateFlags;

/// Deliberately still named after the old brand.
///
/// The store lives inside the bundle identifier's own directory, so it never
/// collided with anything — upstream's desktop is Electron and has no Tauri
/// store at all. Renaming the file would orphan the settings of everyone
/// already running this fork (default server URL, WSL toggle, remote config,
/// Linux display backend) for a cosmetic gain. It moves when the legacy import
/// bridge exists to carry the contents across, not before.
pub const SETTINGS_STORE: &str = "opencode.settings.dat";
pub const DEFAULT_SERVER_URL_KEY: &str = "defaultServerUrl";
pub const WSL_ENABLED_KEY: &str = "wslEnabled";
pub const REMOTE_CONFIG_KEY: &str = "remoteConfig";
pub const UPDATER_ENABLED: bool = option_env!("TAURI_SIGNING_PRIVATE_KEY").is_some();

pub fn window_state_flags() -> StateFlags {
    StateFlags::all() - StateFlags::DECORATIONS - StateFlags::VISIBLE
}
