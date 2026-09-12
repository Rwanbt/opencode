declare global {
  const UNIFIA_VERSION: string
  const UNIFIA_CHANNEL: string
  const UNIFIA_PLUGIN_VERSION: string
}

export const VERSION = typeof UNIFIA_VERSION === "string" ? UNIFIA_VERSION : "local"
export const CHANNEL = typeof UNIFIA_CHANNEL === "string" ? UNIFIA_CHANNEL : "local"
export const PLUGIN_VERSION = typeof UNIFIA_PLUGIN_VERSION === "string" ? UNIFIA_PLUGIN_VERSION : "local"
