/* SPDX-License-Identifier: MIT */

import { For, Show, createEffect, createMemo, createSignal, type JSX } from "solid-js"
import { createQuery } from "@tanstack/solid-query"
import { showToast } from "@unifia/ui/toast"
import { Markdown } from "@unifia/ui/markdown"
import { useSDK } from "@/context/sdk"
import { useWorkspaceWorkbench } from "@/context/workbench/provider"
import { workbenchQueryKey } from "@/context/workbench/query-keys"
import { isMemoryMarkdown, linkedMemoryNotes, localMemoryGraph, memoryBacklinks, memoryTitle, parseMemoryNote, type MemoryNoteDocument } from "./memory-panel-model"

const MEMORY_ROOT = ".unifia/memory"

function MemoryPreview(props: { note: MemoryNoteDocument }): JSX.Element {
  return <><h1 class="mt-2 text-20-medium">{props.note.title}</h1><Show when={props.note.tags.length > 0}><div class="mt-3 flex flex-wrap gap-1"><For each={props.note.tags}>{(tag) => <span class="rounded bg-background-base px-2 py-1 text-11-regular">#{tag}</span>}</For></div></Show><Markdown text={props.note.body} class="mt-5 text-13-regular leading-6 text-text-base" /></>
}

function MemoryEditor(props: { value: string; onInput: (value: string) => void }): JSX.Element {
  return <textarea class="h-full min-h-72 w-full resize-none rounded border border-border-base bg-background-base p-3 font-mono text-12-regular leading-5" value={props.value} onInput={(event) => props.onInput(event.currentTarget.value)} aria-label="Edit memory note" />
}

export function MemoryPanel(): JSX.Element {
  const workbench = useWorkspaceWorkbench()
  const sdk = useSDK()
  const connection = workbench.connection
  const [selectedPath, setSelectedPath] = createSignal<string>()
  const [query, setQuery] = createSignal("")
  const [view, setView] = createSignal<"preview" | "source" | "split">("preview")
  const [contextView, setContextView] = createSignal<"links" | "graph">("links")
  const [draft, setDraft] = createSignal("")
  const [saving, setSaving] = createSignal(false)

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
    const path = selectedPath()
    return {
      queryKey: ["memory-note", sdk.directory, path] as const,
      enabled: !!path,
      queryFn: async () => {
        const result = await sdk.client.file.readRaw({ path: path! })
        if (!result.data) throw new Error("Memory note was not found")
        return result.data
      },
    }
  })
  const noteFile = createQuery(noteQueryOptions)
  const note = createMemo(() => {
    const path = selectedPath()
    const file = noteFile.data
    return path && file ? parseMemoryNote(path, file.content) : undefined
  })
  const linked = createMemo(() => note() ? linkedMemoryNotes(note()!.links, notes()) : [])
  const backlinksQueryOptions = createMemo(() => {
    const selected = selectedPath()
    const candidates = notes()
    return {
      queryKey: ["memory-backlinks", sdk.directory, selected ?? "", candidates.map((candidate) => candidate.path).join("|")] as const,
      enabled: !!selected && candidates.length > 0,
      queryFn: async () => {
        const documents = await Promise.all(candidates.map(async (candidate) => {
          const result = await sdk.client.file.readRaw({ path: candidate.path })
          return result.data ? parseMemoryNote(candidate.path, result.data.content) : undefined
        }))
        return memoryBacklinks({ path: selected!, title: memoryTitle(selected!) }, documents.filter((document): document is MemoryNoteDocument => !!document))
      },
    }
  })
  const backlinks = createQuery(backlinksQueryOptions)
  const relatedNotes = createMemo(() => [...new Map([...linked(), ...(backlinks.data ?? [])].map((related) => [related.path, related])).values()])
  const graph = createMemo(() => note() ? localMemoryGraph(note()!, relatedNotes()) : [])
  createEffect(() => {
    const content = noteFile.data?.content
    if (content !== undefined) setDraft(content)
  })

  async function saveNote(): Promise<void> {
    const path = selectedPath()
    const current = noteFile.data
    if (!path || !current || saving()) return
    setSaving(true)
    try {
      const result = await sdk.client.file.write({ path, content: draft(), expectedHash: current.stamp.hash })
      if (result.response?.status === 409) {
        showToast({ variant: "error", title: "Memory note changed on disk", description: "Reload the note before saving your edits." })
        return
      }
      if (!result.data) throw new Error("Memory note was not saved")
      await noteFile.refetch()
      showToast({ variant: "success", title: "Memory note saved" })
    } catch (error) {
      showToast({ variant: "error", title: "Unable to save memory note", description: error instanceof Error ? error.message : String(error) })
    } finally {
      setSaving(false)
    }
  }

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
          <header class="flex items-center gap-2 border-b border-border-base px-3 py-2"><span class="text-12-medium">Memory</span><select class="hidden min-w-0 max-w-32 rounded border border-border-base bg-background-base px-1 py-1 text-11-regular max-[620px]:block" value={selectedPath() ?? ""} onChange={(event) => setSelectedPath(event.currentTarget.value)} aria-label="Choose memory note"><For each={notes()}>{(item) => <option value={item.path}>{item.title}</option>}</For></select><span class="ml-auto text-11-regular text-text-weak">CAS-protected</span><button type="button" class="rounded px-2 py-1 text-11-medium" classList={{ "bg-background-base": view() === "preview" }} onClick={() => setView("preview")}>Preview</button><button type="button" class="rounded px-2 py-1 text-11-medium" classList={{ "bg-background-base": view() === "source" }} onClick={() => setView("source")}>Edit</button><button type="button" class="rounded px-2 py-1 text-11-medium max-[620px]:hidden" classList={{ "bg-background-base": view() === "split" }} onClick={() => setView("split")}>Split</button><button type="button" class="rounded bg-accent-base px-2 py-1 text-11-medium text-text-on-accent disabled:opacity-50" disabled={saving() || draft() === noteFile.data?.content} onClick={() => void saveNote()}>{saving() ? "Saving…" : "Save"}</button></header>
          <div class="h-[calc(100%-43px)] overflow-y-auto p-5">
            <Show when={noteFile.isLoading}><p class="text-12-regular text-text-weak">Loading note…</p></Show>
            <Show when={noteFile.error}><p class="text-12-regular text-text-danger">Unable to read this note.</p></Show>
            <Show when={note()}>{(current) => <><p class="text-11-regular text-text-weak">{current().path}</p><Show when={view() === "source"} fallback={<Show when={view() === "split"} fallback={<MemoryPreview note={current()} />}><div class="mt-3 grid min-h-[calc(100%-28px)] grid-cols-2 gap-3"><MemoryEditor value={draft()} onInput={setDraft} /><div class="min-w-0 overflow-y-auto rounded border border-border-base bg-background-base p-3"><MemoryPreview note={parseMemoryNote(current().path, draft())} /></div></div></Show>}><div class="mt-3 h-[calc(100%-28px)]"><MemoryEditor value={draft()} onInput={setDraft} /></div></Show></>}</Show>
            <Show when={!note() && !noteFile.isLoading && !noteFile.error}><p class="text-12-regular text-text-weak">Choose a note from the vault.</p></Show>
          </div>
        </article>
        <aside class="min-h-0 overflow-hidden rounded-lg border border-border-base bg-background-stronger" data-memory-links>
          <header class="border-b border-border-base p-3"><h2 class="text-14-medium">Links &amp; context</h2><div class="mt-2 flex gap-1"><button type="button" class="rounded px-2 py-1 text-11-medium" classList={{ "bg-background-base": contextView() === "links" }} onClick={() => setContextView("links")}>Links</button><button type="button" class="rounded px-2 py-1 text-11-medium" classList={{ "bg-background-base": contextView() === "graph" }} onClick={() => setContextView("graph")}>Local graph</button></div></header>
          <div class="overflow-y-auto p-3"><Show when={contextView() === "links"} fallback={<Show when={graph().length > 0} fallback={<p class="text-12-regular text-text-weak">Choose a note to inspect its graph.</p>}><svg class="h-56 w-full" viewBox="0 0 100 100" role="img" aria-label="Local memory graph"> <For each={graph().slice(1)}>{(node) => <line x1="50" y1="50" x2={node.x} y2={node.y} stroke="currentColor" opacity="0.35" />}</For><For each={graph()}>{(node, index) => <g class="cursor-pointer" role="button" tabindex="0" onClick={() => setSelectedPath(node.path)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedPath(node.path) }}><circle cx={node.x} cy={node.y} r={index() === 0 ? 8 : 6} class={index() === 0 ? "fill-accent-base" : "fill-background-strong"} stroke="currentColor" /><text x={node.x} y={node.y + 13} text-anchor="middle" class="fill-text-base text-[5px]">{node.title.slice(0, 16)}</text></g>}</For></svg></Show>}><Show when={note() && linked().length > 0} fallback={<p class="text-12-regular text-text-weak">No resolved links for this note.</p>}><For each={linked()}>{(item) => <button type="button" class="mb-2 block w-full rounded border border-border-base p-2 text-left text-12-regular hover:bg-background-base" onClick={() => setSelectedPath(item.path)}>{item.title}</button>}</For></Show><Show when={backlinks.data?.length}><h3 class="mt-4 text-12-medium">Backlinks</h3><For each={backlinks.data}>{(item) => <button type="button" class="mt-2 block w-full rounded border border-border-base p-2 text-left text-12-regular hover:bg-background-base" onClick={() => setSelectedPath(item.path)}>{item.title}</button>}</For></Show></Show></div>
        </aside>
      </div>
    </section>
  )
}
