// FORK: Stretch — disk space quota warning for settings panel.
// Uses GET /disk (backend fs.statfs). On Windows the endpoint returns -1 (no statfs);
// in that case the component renders nothing. On Android/Linux it shows available / total
// and a red warning when available < 500 MB.
import { createResource, Show } from "solid-js"
import { useSDK } from "@/context/sdk"
import { SettingsRow } from "./settings-row"
import { useLanguage } from "@/context/language"

const WARN_BYTES = 500 * 1024 * 1024 // 500 MB

function fmtBytes(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} Go`
  return `${(n / 1e6).toFixed(0)} Mo`
}

export function SettingsDiskQuota() {
  const language = useLanguage()
  const sdk = useSDK()
  const [disk] = createResource<{ available: number; total: number } | null>(async () => {
    try {
      const res = await fetch(`${sdk.url}/disk?directory=${encodeURIComponent(sdk.directory)}`)
      if (!res.ok) return null
      const d = (await res.json()) as { available: number; total: number }
      // Sentinel -1 returned on platforms where statfs is unavailable (Windows)
      if (d.available < 0) return null
      return d
    } catch {
      return null
    }
  })

  return (
    <Show when={disk()}>
      {(d) => (
        <SettingsRow
          title={language.t("settings.fork.observability.diskTitle")}
          description={language.t("settings.fork.observability.diskDescription")}
        >
          <Show
            when={d().available < WARN_BYTES}
            fallback={
              <span class="text-12-regular text-text-weak">
                {fmtBytes(d().available)} / {fmtBytes(d().total)}
              </span>
            }
          >
            <span class="text-12-medium text-[#ef4444]">
              ⚠ {fmtBytes(d().available)} libres — espace faible
            </span>
          </Show>
        </SettingsRow>
      )}
    </Show>
  )
}
