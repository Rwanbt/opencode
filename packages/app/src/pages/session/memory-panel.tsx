/* SPDX-License-Identifier: MIT */

import { For, Show, createEffect, createMemo, createSignal, type JSX } from "solid-js"
import { createQuery } from "@tanstack/solid-query"
import { useWorkspaceWorkbench } from "@/context/workbench/provider"
import { workbenchQueryKey } from "@/context/workbench/query-keys"
import { decodeFile } from "@/pages/workbench/automate-decode"
import { isMemoryMarkdown, linkedMemoryNotes, memoryTitle, parseMemoryNote } from "./memory-panel-model"

const MEMORY_ROOT = ".unifia/memory"

export function MemoryPanel(): JSX.Element {
  const workbench = useWorkspaceWorkbench()
  const connection = workbench.connection
  const [selectedPath, setSelectedPath] = createSignal<string>()
  const [query, setQuery] = createSignal("")
  const [view, setView] = createSignal<"preview" | "source">("preview")

  createEffect(() => { void workbench.ensureConnected().catch(() => undefined) })
  const filesQueryOptions = createMemo(() => {
    const current = connection()
    return {
      queryKey: workbenchQueryKey(current, "files", { prefix: MEMORY_ROOT }),
      enabled: !!current,
      queryFn: () => current!.client.listFiles(current!.workspaceId, MEMORY_ROOT),
    }
  })
  const files = createQuery(filesQueryOptions)
  const notes = createMemo(() => (files.data?.entries ?? []).filter((entry) => entry.kind === "file" && isMemoryMarkdown(entry.path)).map((entry) => ({ path: entry.path, title: memoryTitle(entry.path) })))
  const visibleNotes = createMemo(() => {
    const term = query().trim().toLocaleLowerCase()
    return term ? notes().filter((note) => note.title.toLocaleLowerCase().includes(term) || note.path.toLocaleLowerCase().includes(term)) : notes()
  })
  createEffect(() => {
    if (!selectedPath() && notes()[0]) setSelectedPath(notes()[0].path)
  })
  const noteQueryOptions = createMemo(() => {
    const current = connection()
    const path = selectedPath()
    return {
      queryKey: workbenchQueryKey(current, "file", { path: path ?? "" }),
      enabled: !!current && !!path,
      queryFn: () => current!.client.readFiles(current!.workspaceId, [path!]),
    }
  })
  const noteFile = createQuery(noteQueryOptions)
  const note = createMemo(() => {
    const path = selectedPath()
    const file = noteFile.data?.results[0]
    return path && file ? parseMemoryNote(path, decodeFile(file)) : undefined
  })
  const linked = createMemo(() => note() ? linkedMemoryNotes(note()!.links, notes()) : [])

  return (
    <section class="size-full min-w-0 bg-background-base p-3" data-v110="memory-panel">
      <div class="grid size-full min-h-0 grid-cols-[minmax(180px,0.8fr)_minmax(0,1.7fr)_minmax(180px,0.8fr)] gap-3 max-[900px]:grid-cols-[minmax(160px,0.75fr)_minmax(0,1.25fr)] max-[900px]:[&>[data-memory-links]]:hidden max-[620px]:grid-cols-1 max-[620px]:[&>[data-memory-vault]]:hidden">
        <aside class="min-h-0 overflow-hidden rounded-lg border border-border-base bg-background-stronger" data-memory-vault>
          <div class="border-b border-border-base p-3"><h2 class="text-14-medium">Vault</h2><input class="mt-2 w-full rounded border border-border-base bg-background-base px-2 py-1 text-12-regular" value={query()} onInput={(event) => setQuery(event.currentTarget.value)} aria-label="Search memory notes" placeholder="Search notes" /></div>
          <div class="h-[calc(100%-76px)] overflow-y-auto p-2">
            <Show when={files.error}><p class="text-12-regular text-text-danger">Unable to load the workspace vault.</p></Show>
            <For each={visibleNotes()}>{(item) => <button type="button" class="mb-1 block w-full rounded px-2 py-2 text-left text-12-regular hover:bg-background-base" classList={{ "bg-background-base text-text-strong": selectedPath() === item.path }} data-memory-note={item.path} onClick={() => setSelectedPath(item.path)}>{item.title}</button>}</For>
            <Show when={!files.isLoading && !files.error && notes().length === 0}><p class="p-2 text-12-regular text-text-weak">No Markdown note in {MEMORY_ROOT}.</p></Show>
          </div>
        </aside>
        <article class="min-h-0 overflow-hidden rounded-lg border border-border-base bg-background-stronger" data-memory-note-pane>
          <header class="flex items-center gap-2 border-b border-border-base px-3 py-2"><span class="text-12-medium">Memory</span><span class="ml-auto text-11-regular text-text-weak">Read-only workspace view</span><button type="button" class="rounded px-2 py-1 text-11-medium" classList={{ "bg-background-base": view() === "preview" }} onClick={() => setView("preview")}>Preview</button><button type="button" class="rounded px-2 py-1 text-11-medium" classList={{ "bg-background-base": view() === "source" }} onClick={() => setView("source")}>Source</button></header>
          <div class="h-[calc(100%-43px)] overflow-y-auto p-5">
            <Show when={noteFile.isLoading}><p class="text-12-regular text-text-weak">Loading note…</p></Show>
            <Show when={noteFile.error}><p class="text-12-regular text-text-danger">Unable to read this note.</p></Show>
            <Show when={note()}>{(current) => <><p class="text-11-regular text-text-weak">{current().path}</p><h1 class="mt-2 text-20-medium">{current().title}</h1><Show when={current().tags.length > 0}><div class="mt-3 flex flex-wrap gap-1"><For each={current().tags}>{(tag) => <span class="rounded bg-background-base px-2 py-1 text-11-regular">#{tag}</span>}</For></div></Show><pre class="mt-5 whitespace-pre-wrap break-words font-sans text-13-regular leading-6 text-text-base" classList={{ "font-mono text-12-regular": view() === "source" }}>{view() === "source" ? current().body : current().body}</pre></>}</Show>
            <Show when={!note() && !noteFile.isLoading && !noteFile.error}><p class="text-12-regular text-text-weak">Choose a note from the vault.</p></Show>
          </div>
        </article>
        <aside class="min-h-0 overflow-hidden rounded-lg border border-border-base bg-background-stronger" data-memory-links>
          <header class="border-b border-border-base p-3"><h2 class="text-14-medium">Links &amp; context</h2></header>
          <div class="overflow-y-auto p-3"><Show when={note() && linked().length > 0} fallback={<p class="text-12-regular text-text-weak">No resolved links for this note.</p>}><For each={linked()}>{(item) => <button type="button" class="mb-2 block w-full rounded border border-border-base p-2 text-left text-12-regular hover:bg-background-base" onClick={() => setSelectedPath(item.path)}>{item.title}</button>}</For></Show></div>
        </aside>
      </div>
    </section>
  )
}
