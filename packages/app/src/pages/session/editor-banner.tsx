// FORK: Inline editor status banners (ADR-0005 ⑥).
// Shown above the CodeMirror editor when the file has a conflict, stale state,
// or has been deleted on disk. Actions are passed in as callbacks so the parent
// (`FileTabContent`) owns the async coordination with the CM handle.
import { Show, type JSX } from "solid-js"
import type { EditorEntry } from "@/context/editor/store"
import { useLanguage } from "@/context/language"

function BannerButton(props: {
  label: string
  variant: "secondary" | "primary"
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      class={[
        "shrink-0 rounded px-2 py-0.5 text-xs font-medium transition-opacity hover:opacity-80 active:opacity-60",
        props.variant === "primary"
          ? "bg-surface-raised-base text-text-base border border-border-base"
          : "bg-surface-inset text-text-weak border border-border-weak-base",
      ].join(" ")}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  )
}

export function EditorBanner(props: {
  entry: EditorEntry
  onReload: () => void
  onOverwrite: () => void
  onDiscard: () => void
  onRecreate: () => void
}): JSX.Element {
  const language = useLanguage()

  const t = (key: string, fallback: string) => language.t(key) ?? fallback

  return (
    <>
      {/* Stale: external disk change while buffer was dirty. */}
      <Show when={props.entry.stale && !props.entry.conflict && !props.entry.missing}>
        <div class="flex items-center gap-2 border-b border-border-base bg-surface-warning-strong/10 px-3 py-1.5 text-xs text-text-base">
          <span class="min-w-0 flex-1 truncate">
            {t("editor.stale.message", "File changed on disk while you were editing.")}
          </span>
          <BannerButton
            label={t("editor.stale.reload", "Reload")}
            variant="secondary"
            onClick={props.onReload}
          />
          <BannerButton
            label={t("editor.stale.overwrite", "Overwrite disk")}
            variant="primary"
            onClick={props.onOverwrite}
          />
        </div>
      </Show>

      {/* Conflict: save was blocked by a 409 (disk changed between open and save). */}
      <Show when={props.entry.conflict && !props.entry.missing}>
        <div class="flex items-center gap-2 border-b border-border-base bg-surface-warning-strong/10 px-3 py-1.5 text-xs text-text-base">
          <span class="min-w-0 flex-1 truncate">
            {t("editor.conflict.banner", "Save blocked: file changed on disk since you opened it.")}
          </span>
          <BannerButton
            label={t("editor.conflict.reload", "Reload")}
            variant="secondary"
            onClick={props.onReload}
          />
          <BannerButton
            label={t("editor.conflict.overwrite", "Overwrite disk")}
            variant="primary"
            onClick={props.onOverwrite}
          />
        </div>
      </Show>

      {/* Missing: file was deleted or renamed externally while buffer was open. */}
      <Show when={props.entry.missing}>
        <div class="flex items-center gap-2 border-b border-border-base bg-surface-critical-base/10 px-3 py-1.5 text-xs text-text-critical-base">
          <span class="min-w-0 flex-1 truncate">
            {t("editor.missing.banner", "This file was deleted on disk.")}
          </span>
          <BannerButton
            label={t("editor.missing.discard", "Discard")}
            variant="secondary"
            onClick={props.onDiscard}
          />
          <BannerButton
            label={t("editor.missing.recreate", "Recreate")}
            variant="primary"
            onClick={props.onRecreate}
          />
        </div>
      </Show>
    </>
  )
}
