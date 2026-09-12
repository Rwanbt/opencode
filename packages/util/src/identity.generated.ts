// Generated from config/identity.json by scripts/identity/generate.mjs.
// Do not edit: run `bun run identity:generate` after changing the manifest.

export const IDENTITY = {
  product: {
    name: "Unifia",
    vendor: "Rwanbt",
    dataDirName: "unifia",
    configDirName: ".unifia",
    databaseFile: "unifia.db",
  },
  protocols: {
    /** The only scheme Unifia registers with the OS. */
    owned: ["unifia"] as const,
    /** Accepted by the import flow only — never registered, never claimed. */
    parseOnly: ["opencode"] as const,
  },
  cli: {
    command: "unifia",
    windowsBinary: "unifia.exe",
    npmPackage: "unifia",
    scope: "@unifia",
  },
  surfaces: {
  "tauri-desktop-dev": { displayName: "Unifia Dev", appId: "ai.unifia.workbench.dev" },
  "tauri-desktop-beta": { displayName: "Unifia Beta", appId: "ai.unifia.workbench.beta" },
  "tauri-desktop-prod": { displayName: "Unifia", appId: "ai.unifia.desktop" },
  "tauri-mobile": { displayName: "Unifia Mobile", appId: "ai.unifia.mobile" },
  "electron-preview-dev": { displayName: "Unifia Preview Dev", appId: "ai.unifia.desktop.preview.dev" },
  "electron-preview-beta": { displayName: "Unifia Preview Beta", appId: "ai.unifia.desktop.preview.beta" },
  "electron-preview": { displayName: "Unifia Preview", appId: "ai.unifia.desktop.preview" },
  },
  env: {
    prefix: "UNIFIA_",
    legacyPrefix: "OPENCODE_",
    /** Must never fall back to the legacy prefix: ports, storage, credentials. */
    isolated: ["UNIFIA_KEYCHAIN_URL", "UNIFIA_KEYCHAIN_TOKEN", "UNIFIA_AUTH_STORAGE", "UNIFIA_AUTH_ENCRYPTION_KEY", "UNIFIA_CONFIG_DIR", "UNIFIA_PTY_PORT", "UNIFIA_SERVER_USERNAME", "UNIFIA_SERVER_PASSWORD", "UNIFIA_CLIENT"] as const,
    /** May read the legacy name as a fallback — preferences, not identity. */
    safeDualRead: ["UNIFIA_AUTO_SHARE", "UNIFIA_DISABLE_AUTOUPDATE", "UNIFIA_DISABLE_PRUNE", "UNIFIA_DISABLE_TERMINAL_TITLE", "UNIFIA_DISABLE_AUTOCOMPACT", "UNIFIA_DISABLE_MODELS_FETCH", "UNIFIA_DISABLE_LSP_DOWNLOAD", "UNIFIA_EXPERIMENTAL", "UNIFIA_MODELS_URL", "UNIFIA_MODELS_PATH", "UNIFIA_PERMISSION", "UNIFIA_CONFIG", "UNIFIA_CONFIG_CONTENT"] as const,
    /** Read only by the explicit legacy import. */
    migrationOnly: [] as const,
  },
} as const

export type IdentitySurface = keyof typeof IDENTITY.surfaces
