import { createSignal, For, Show } from "solid-js"

export interface DiffFile {
  path: string
  diff: string
}

export interface MobileDiffProps {
  files: DiffFile[]
}

/**
 * Mobile-optimized unified diff viewer with swipe navigation between files.
 */
export function MobileDiff(props: MobileDiffProps) {
  const [currentIndex, setCurrentIndex] = createSignal(0)
  let touchStartX = 0

  const current = () => props.files[currentIndex()]
  const hasPrev = () => currentIndex() > 0
  const hasNext = () => currentIndex() < props.files.length - 1

  function onTouchStart(e: TouchEvent) {
    touchStartX = e.touches[0].clientX
  }

  function onTouchEnd(e: TouchEvent) {
    const dx = e.changedTouches[0].clientX - touchStartX
    const threshold = 80
    if (dx > threshold && hasPrev()) setCurrentIndex((i) => i - 1)
    else if (dx < -threshold && hasNext()) setCurrentIndex((i) => i + 1)
  }

  function renderLine(line: string, idx: number) {
    const type = line.startsWith("+") ? "added" : line.startsWith("-") ? "removed" : line.startsWith("@@") ? "hunk" : "context"
    const colors = {
      added: "bg-green-500/10 text-green-400",
      removed: "bg-red-500/10 text-red-400",
      hunk: "bg-blue-500/10 text-blue-400 font-semibold",
      context: "text-secondary",
    }
    return (
      <div class={`px-2 py-px text-xs font-mono whitespace-pre-wrap break-all ${colors[type]}`}>
        {line}
      </div>
    )
  }

  return (
    <div class="flex flex-col h-full" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {/* File navigation header */}
      <div class="flex items-center justify-between px-3 py-2 border-b bg-surface">
        <button
          class="px-2 py-1 text-xs rounded disabled:opacity-30"
          disabled={!hasPrev()}
          onClick={() => setCurrentIndex((i) => i - 1)}
        >
          ← Prev
        </button>
        <span class="text-xs font-medium truncate mx-2">
          {current()?.path ?? "No files"}
          <span class="text-secondary ml-1">
            ({currentIndex() + 1}/{props.files.length})
          </span>
        </span>
        <button
          class="px-2 py-1 text-xs rounded disabled:opacity-30"
          disabled={!hasNext()}
          onClick={() => setCurrentIndex((i) => i + 1)}
        >
          Next →
        </button>
      </div>

      {/* Diff content */}
      <div class="flex-1 overflow-auto">
        <Show when={current()} fallback={<div class="p-4 text-center text-secondary">No diffs to show</div>}>
          <For each={current()!.diff.split("\n")}>
            {(line, idx) => renderLine(line, idx())}
          </For>
        </Show>
      </div>

      {/* Swipe hint */}
      <Show when={props.files.length > 1}>
        <div class="text-center text-xs text-secondary py-1 border-t">
          Swipe left/right to navigate files
        </div>
      </Show>
    </div>
  )
}
