// Global search palette (PLAN-EDITEUR-IDE-DEFINITIF Phase 5.3).
//
// Modal Quick Open variant that runs project-wide ripgrep via
// `sdk.client.find.text({pattern})`. Results are flattened to one entry per
// match line with file path, line number, and the matched content. Selecting
// a result opens the file (no-op when already active) and sets
// `selectedLines` to the match line so pierre auto-scrolls the viewer.
//
// WHY a new modal (not reusing DialogSelectFile): the file dialog is
// project-wide fuzzy **name** search backed by `find.files`; global search
// is project-wide regex **content** search backed by `find.text`. The result
// shape (one row per match, not per file) and the auto-jump-to-line UX are
// different enough that a dedicated modal is clearer than another mode flag.

import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { List } from "@opencode-ai/ui/list"
import { getDirectory, getFilename } from "@opencode-ai/util/path"
import { type JSXElement } from "solid-js"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useSessionLayout } from "@/pages/session/session-layout"

// Match payload — the SDK type declares this directly, but the server
// route returns the full ripgrep stream (Begin | Match | End | Summary).
// We narrow defensively so the UI survives the route bug or future fixes
// without code changes.
type MatchData = {
  path: { text: string }
  lines: { text: string }
  line_number: number
  absolute_offset: number
  submatches: Array<{ match: { text: string }; start: number; end: number }>
}

type MatchEntry = {
  id: string
  path: string
  line: number
  preview: string
  matchText?: string
}

const asMatch = (item: unknown): MatchData | undefined => {
  if (!item || typeof item !== "object") return undefined
  const obj = item as Record<string, unknown>
  // Stream shape: { type: "match", data: MatchData }.
  if (obj.type === "match" && obj.data) return obj.data as MatchData
  // Flat shape: MatchData directly.
  if (obj.path && obj.lines && typeof obj.line_number === "number") return obj as MatchData
  return undefined
}

export function DialogSelectSearch() {
  const sdk = useSDK()
  const file = useFile()
  const language = useLanguage()
  const dialog = useDialog()
  const { tabs, view } = useSessionLayout()

  // Token to discard stale responses when the user types faster than ripgrep
  // returns. Each `search()` invocation captures the token at start; only the
  // latest in-flight request's result wins.
  let pending = 0

  const search = async (query: string) => {
    const pattern = query.trim()
    if (!pattern) return [] as MatchEntry[]
    const my = ++pending
    const result = await sdk.client.find.text({ pattern })
    if (my !== pending) return [] as MatchEntry[]

    const matches = ((result.data ?? []) as unknown[])
      .map(asMatch)
      .filter((m): m is MatchData => !!m)
    return matches.map((m, i) => ({
      id: `${m.path.text}:${m.line_number}:${i}`,
      path: m.path.text,
      line: m.line_number,
      preview: m.lines.text.trimEnd(),
      matchText: m.submatches[0]?.match.text,
    }))
  }

  const handleSelect = (item: MatchEntry | undefined) => {
    if (!item) return
    dialog.close()

    const tab = file.tab(item.path)
    tabs().open(tab)
    file.load(item.path)
    tabs().setActive(tab)
    if (!view().reviewPanel.opened()) view().reviewPanel.open()

    // pierre auto-scrolls to the selected line via the file-find bridge
    // when `selectedLines` changes (see pierre/file-find.ts).
    const line = item.line + 1
    file.setSelectedLines(item.path, { start: line, end: line })
  }

  return (
    <Dialog class="pt-3 pb-0 !max-h-[480px]" transition>
      <List
        search={{
          placeholder: language.t("palette.search.global.placeholder"),
          autofocus: true,
          hideIcon: true,
        }}
        emptyMessage={language.t("palette.search.global.empty")}
        loadingMessage={language.t("common.loading")}
        items={search}
        key={(item: MatchEntry) => item.id}
        filterKeys={["path", "preview", "matchText"]}
        onSelect={handleSelect}
      >
        {(item: MatchEntry): JSXElement => (
          <div class="w-full flex items-center gap-3 pl-1 min-w-0">
            <FileIcon node={{ path: item.path, type: "file" }} class="shrink-0 size-4" />
            <div class="flex items-center gap-2 min-w-0 grow">
              <span class="text-12-regular text-text-weak shrink-0 max-w-[40%] truncate">
                {getDirectory(item.path) + "/"}
                <span class="text-text-strong">{getFilename(item.path)}</span>
              </span>
              <span class="text-12-regular text-text-weak shrink-0">L{item.line + 1}</span>
              <span class="text-14-regular text-text-strong whitespace-nowrap overflow-hidden overflow-ellipsis truncate">
                {item.preview}
              </span>
            </div>
          </div>
        )}
      </List>
    </Dialog>
  )
}