// @refresh reload

import { render } from "solid-js/web"
import { AppProviders } from "@/app"
import { type Platform, PlatformProvider } from "@/context/platform"
import { dict as en } from "@/i18n/en"
import { dict as zh } from "@/i18n/zh"
import { handleNotificationClick } from "@/utils/notification-click"
import pkg from "../package.json"
import { ServerConnection } from "./context/server"

const DEFAULT_SERVER_URL_KEY = "unifia.settings.dat:defaultServerUrl"

const getLocale = () => {
  if (typeof navigator !== "object") return "en" as const
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const language of languages) {
    if (!language) continue
    if (language.toLowerCase().startsWith("zh")) return "zh" as const
  }
  return "en" as const
}

const getRootNotFoundError = () => {
  const key = "error.dev.rootNotFound" as const
  const locale = getLocale()
  return locale === "zh" ? (zh[key] ?? en[key]) : en[key]
}

const getStorage = (key: string) => {
  if (typeof localStorage === "undefined") return null
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const setStorage = (key: string, value: string | null) => {
  if (typeof localStorage === "undefined") return
  try {
    if (value !== null) {
      localStorage.setItem(key, value)
      return
    }
    localStorage.removeItem(key)
  } catch {
    return
  }
}

const readDefaultServerUrl = () => getStorage(DEFAULT_SERVER_URL_KEY)
const writeDefaultServerUrl = (url: string | null) => setStorage(DEFAULT_SERVER_URL_KEY, url)

const notify: Platform["notify"] = async (title, description, href) => {
  if (!("Notification" in window)) return

  const permission =
    Notification.permission === "default"
      ? await Notification.requestPermission().catch(() => "denied")
      : Notification.permission

  if (permission !== "granted") return

  const inView = document.visibilityState === "visible" && document.hasFocus()
  if (inView) return

  const notification = new Notification(title, {
    body: description ?? "",
    icon: "https://opencode.ai/favicon-96x96-v3.png",
  })

  notification.onclick = () => {
    handleNotificationClick(href)
    notification.close()
  }
}

const openLink: Platform["openLink"] = (url) => {
  window.open(url, "_blank")
}

const back: Platform["back"] = () => {
  window.history.back()
}

const forward: Platform["forward"] = () => {
  window.history.forward()
}

const restart: Platform["restart"] = async () => {
  window.location.reload()
}

const root = document.getElementById("root")
if (!(root instanceof HTMLElement) && import.meta.env.DEV) {
  throw new Error(getRootNotFoundError())
}

const getCurrentUrl = () => {
  // WHY no marketing-host branch: upstream special-cased its own site host to
  // fall back to a local server. This fork controls no domain and publishes no
  // site (see PROD_READINESS.md G9), so that branch was unreachable here.
  if (import.meta.env.DEV)
    return `http://${import.meta.env.VITE_OPENCODE_SERVER_HOST ?? "localhost"}:${import.meta.env.VITE_OPENCODE_SERVER_PORT ?? "4096"}`
  return location.origin
}

const getDefaultUrl = () => {
  const lsDefault = readDefaultServerUrl()
  if (lsDefault) return lsDefault
  return getCurrentUrl()
}

const platform: Platform = {
  platform: "web",
  version: pkg.version,
  openLink,
  back,
  forward,
  restart,
  notify,
  getDefaultServer: async () => {
    const stored = readDefaultServerUrl()
    return stored ? ServerConnection.Key.make(stored) : null
  },
  setDefaultServer: writeDefaultServerUrl,
}

// V14.5 — test hook: the e2e harness (e2e/modes/design-journey.spec.ts)
// can install a partial platform on `window.__UNIFIA_PLATFORM__` BEFORE
// `entry.tsx` runs (via Playwright `addInitScript`). Production
// runtimes never set the global, so the spread yields nothing and
// the default web platform stands. The hook is intentionally narrow:
// a Partial<Platform>, merged field-by-field, so a test only has
// to override the slice it actually exercises (the workbench
// bridge is the only one the harness ships today).
const testOverride = (
  typeof window !== "undefined" ? (window as { __UNIFIA_PLATFORM__?: Partial<Platform> }).__UNIFIA_PLATFORM__ : undefined
)
const merged: Platform = testOverride ? { ...platform, ...testOverride } : platform

if (root instanceof HTMLElement) {
  const server: ServerConnection.Http = { type: "http", http: { url: getCurrentUrl() } }
  render(
    () => (
      <PlatformProvider value={merged}>
        <AppProviders
          defaultServer={ServerConnection.Key.make(getDefaultUrl())}
          servers={[server]}
          disableHealthCheck
        />
      </PlatformProvider>
    ),
    root,
  )
}
