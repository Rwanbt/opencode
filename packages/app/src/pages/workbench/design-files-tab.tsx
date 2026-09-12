/* SPDX-License-Identifier: MIT */

import { For, Show, createEffect, createMemo, createSignal, type JSX } from "solid-js"
import { createQuery } from "@tanstack/solid-query"
import { useWorkspaceWorkbench } from "@/context/workbench/provider"
import { workbenchQueryKey } from "@/context/workbench/query-keys"
import { FileIcon } from "@unifia/ui/file-icon"
import { ArtifactPreview } from "@/pages/workbench/artifact-preview"
import { DEFAULT_TOOLBAR_MODE, type DesignToolbarMode } from "@/pages/workbench/design-toolbar"
import { DEFAULT_VIEWPORT, DEFAULT_ZOOM } from "@unifia/artifact-render"
import {
  collectRelativeAssetTargets,
  decodeWorkspaceFile,
  encodeBase64,
  inlineRelativeAssets,
  isRenderable,
} from "@/pages/workbench/design-files-preview"
import { FileThumbnail, ThumbnailHost, createThumbnailController, type ThumbnailController } from "@/pages/workbench/design-files-thumbnail"
import {
  buildFileTree,
  createDesignFilesPanelState,
  deserializeTreeExpansion,
  designFilesTreeStorageKey,
  EMPTY_TREE_EXPANSION,
  nextSelectedPathAfterRemove,
  nextSelectedPathAfterRename,
  renderDesignFileRows,
  serializeTreeExpansion,
  toggleTreeDirectory,
  type DesignFileRow,
  type DesignFileTreeNode,
  type DesignFilesTreeExpansion,
  type WorkspaceFilePage,
} from "@unifia/workbench-shell"

/**
 * Phase 7 — "Fichiers" tab of the Design workshop.
 *
 * Before this, the tab was a placeholder proving only that a non-closable
 * tab survives `closeTab` (P3-3). The listing itself waited on
 * `listFiles(workspaceId, ".")`, already consumed by Automate and Work —
 * this reuses the exact same client call, no new server surface.
 *
 * The row/kind logic (`createDesignFilesPanelState`, `renderDesignFileRows`)
 * already existed in `@unifia/workbench-shell` with its own test suite —
 * it filters to files (no directories) and classifies each by extension
 * (asset / component / style / unknown). It had zero consumers before this
 * tab; wiring it here is the same "close the loop on tested, unconsumed
 * logic" pattern as the P4-2 artifact adapter.
 *
 * `listFiles` pages a flat listing at `prefix = "."`, so — unlike
 * `components/file-tree.tsx`, which lazily expands nested directories via
 * `useFile()` (route-scoped to the Code session, not available here) — this
 * fetches every page up front. `MAX_PAGES` bounds that walk so a workspace
 * with a runaway file count fails loudly (a visible error) instead of
 * looping forever.
 *
 * UI copy is plain French, not `t()` keys: phase 6 (P6-1) already decided
 * new Workbench-surface strings stay hardcoded until the ~31-key/16-locale
 * i18n pass is picked back up — the parity test only audits `t()` calls, so
 * this doesn't regress it. Matches `WorkbenchThread`'s existing strings.
 *
 * Follow-up — the first version of this tab only ever showed raw text, even
 * for `index.html`: real-world confirmation this was a gap, not a
 * hypothetical one. `ArtifactPreview` (the same iframe renderer the artifact
 * workshop tab already uses) already accepts an inline `source` string, so
 * no new rendering path was needed — an "Aperçu | Source" toggle now feeds
 * the fetched file content into it for renderable extensions.
 */

const MAX_PAGES = 50

async function collectFiles(
  list: (prefix: string, cursor?: string) => Promise<WorkspaceFilePage>,
): Promise<WorkspaceFilePage> {
  let page = await list(".")
  const entries = [...page.entries]
  let skipped = page.skipped
  let pages = 1
  while (page.nextCursor && pages < MAX_PAGES) {
    page = await list(".", page.nextCursor)
    entries.push(...page.entries)
    skipped += page.skipped
    pages += 1
  }
  return { entries, skipped, nextCursor: pages >= MAX_PAGES ? page.nextCursor : undefined }
}

function FileRow(props: { row: DesignFileRow; onSelect: (path: string) => void; thumbnails: ThumbnailController }): JSX.Element {
  return (
    <li>
      <button
        type="button"
        class="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-12-regular hover:bg-background-stronger"
        classList={{ "bg-background-stronger text-text-strong": props.row.selected }}
        data-design-files-row={props.row.path}
        aria-current={props.row.selected ? "true" : undefined}
        onClick={() => props.onSelect(props.row.path)}
        title={props.row.path}
      >
        <FileIcon node={{ path: props.row.path, type: "file" }} class="size-4 shrink-0" />
        <span class="min-w-0 flex-1 truncate">{props.row.label}</span>
      </button>
      <FileThumbnail path={props.row.path} controller={props.thumbnails} />
    </li>
  )
}

/**
 * A tree row's indentation grows with depth; 14px roughly matches one
 * `size-4` icon width plus its gap, so a child's icon lines up under its
 * parent's label rather than under its parent's icon.
 */
const TREE_INDENT_PX = 14
const TREE_BASE_PADDING_PX = 8

function TreeRow(props: {
  node: DesignFileTreeNode
  depth: number
  expanded: DesignFilesTreeExpansion
  selectedPath?: string
  onToggle: (path: string) => void
  onSelect: (path: string) => void
  thumbnails: ThumbnailController
}): JSX.Element {
  const paddingLeft = `${TREE_BASE_PADDING_PX + props.depth * TREE_INDENT_PX}px`

  return (
    <Show
      when={props.node.type === "directory" ? props.node : undefined}
      fallback={
        <li>
          <button
            type="button"
            class="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-12-regular hover:bg-background-stronger"
            classList={{ "bg-background-stronger text-text-strong": props.node.path === props.selectedPath }}
            style={{ "padding-left": paddingLeft }}
            data-design-files-row={props.node.path}
            aria-current={props.node.path === props.selectedPath ? "true" : undefined}
            onClick={() => props.onSelect(props.node.path)}
            title={props.node.path}
          >
            <FileIcon node={{ path: props.node.path, type: "file" }} class="size-4 shrink-0" />
            <span class="min-w-0 flex-1 truncate">{props.node.name}</span>
          </button>
          <FileThumbnail path={props.node.path} controller={props.thumbnails} />
        </li>
      }
    >
      {(directory) => (
        <li>
          <button
            type="button"
            class="flex w-full items-center gap-1 rounded px-2 py-1 text-left text-12-regular hover:bg-background-stronger"
            style={{ "padding-left": paddingLeft }}
            data-design-files-dir={directory().path}
            aria-expanded={props.expanded.has(directory().path)}
            onClick={() => props.onToggle(directory().path)}
            title={directory().path}
          >
            <span class="flex size-4 shrink-0 items-center justify-center text-text-weak" aria-hidden="true">
              {props.expanded.has(directory().path) ? "▾" : "▸"}
            </span>
            <span class="min-w-0 flex-1 truncate">{directory().name}</span>
          </button>
          <Show when={props.expanded.has(directory().path)}>
            <ul class="flex flex-col gap-0.5">
              <For each={directory().children}>
                {(child) => (
                  <TreeRow
                    node={child}
                    depth={props.depth + 1}
                    expanded={props.expanded}
                    selectedPath={props.selectedPath}
                    onToggle={props.onToggle}
                    onSelect={props.onSelect}
                    thumbnails={props.thumbnails}
                  />
                )}
              </For>
            </ul>
          </Show>
        </li>
      )}
    </Show>
  )
}

export function DesignFilesTab(): JSX.Element {
  const workbench = useWorkspaceWorkbench()
  const connection = workbench.connection
  const [selectedPath, setSelectedPath] = createSignal<string>()
  const [search, setSearch] = createSignal("")
  const [previewMode, setPreviewMode] = createSignal<DesignToolbarMode>(DEFAULT_TOOLBAR_MODE)
  const [expanded, setExpanded] = createSignal<DesignFilesTreeExpansion>(EMPTY_TREE_EXPANSION)
  const thumbnails = createThumbnailController()

  // Phase 7.3 — create / rename / delete / upload. All four share one
  // error slot and one in-flight flag: they're mutually exclusive user
  // actions (you can't rename while a delete is in flight), so a single
  // "busy" state is enough — no per-action tracking needed.
  const [mutating, setMutating] = createSignal(false)
  const [mutationError, setMutationError] = createSignal<string>()
  const [showCreateForm, setShowCreateForm] = createSignal(false)
  const [newFilePath, setNewFilePath] = createSignal("")
  const [renameDraft, setRenameDraft] = createSignal<string>()
  let uploadInput: HTMLInputElement | undefined

  async function withMutation(run: () => Promise<void>): Promise<void> {
    if (mutating()) return
    setMutating(true)
    setMutationError(undefined)
    try {
      await run()
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : String(error))
    } finally {
      setMutating(false)
    }
  }

  async function createFile(rawPath: string): Promise<void> {
    const current = connection()
    const targetPath = rawPath.trim()
    if (!current || !targetPath) return
    await withMutation(async () => {
      await current.client.createFiles(current.workspaceId, [{ path: targetPath, content: "" }])
      await files.refetch()
      setSelectedPath(targetPath)
      setShowCreateForm(false)
      setNewFilePath("")
    })
  }

  async function renameSelected(rawPath: string): Promise<void> {
    const current = connection()
    const from = selectedPath()
    const to = rawPath.trim()
    if (!current || !from || !to || to === from) return
    await withMutation(async () => {
      await current.client.renameFile(current.workspaceId, from, to)
      await files.refetch()
      setSelectedPath(nextSelectedPathAfterRename(from, from, to))
      setRenameDraft(undefined)
    })
  }

  async function deleteSelected(): Promise<void> {
    const current = connection()
    const target = selectedPath()
    if (!current || !target) return
    if (typeof window !== "undefined" && !window.confirm(`Supprimer « ${target} » ?`)) return
    await withMutation(async () => {
      await current.client.removeFiles(current.workspaceId, [target])
      await files.refetch()
      setSelectedPath(nextSelectedPathAfterRemove(target, [target]))
    })
  }

  async function uploadFile(file: File): Promise<void> {
    const current = connection()
    if (!current) return
    await withMutation(async () => {
      const bytes = new Uint8Array(await file.arrayBuffer())
      await current.client.createFiles(current.workspaceId, [{ path: file.name, content: encodeBase64(bytes), encoding: "base64" }])
      await files.refetch()
      setSelectedPath(file.name)
    })
  }

  // Expansion is scoped per workspace (two open workspaces must not share
  // which folders are open), so it reloads whenever the workspace changes —
  // not on every render, since `connection()` itself is stable across those.
  const workspaceId = createMemo(() => connection()?.workspaceId)
  createEffect(() => {
    const id = workspaceId()
    if (!id || typeof window === "undefined" || !window.localStorage) return
    try {
      const raw = window.localStorage.getItem(designFilesTreeStorageKey(id))
      const restored = raw ? deserializeTreeExpansion(raw) : null
      setExpanded(restored ?? EMPTY_TREE_EXPANSION)
    } catch {
      setExpanded(EMPTY_TREE_EXPANSION)
    }
  })

  function toggleDirectory(path: string) {
    const next = toggleTreeDirectory(expanded(), path)
    setExpanded(next)
    const id = workspaceId()
    if (!id || typeof window === "undefined" || !window.localStorage) return
    try {
      window.localStorage.setItem(designFilesTreeStorageKey(id), serializeTreeExpansion(next))
    } catch {
      // best-effort — an unavailable/full localStorage must not break the tab
    }
  }

  // A file selection that lands on a non-renderable extension (e.g. picking
  // a .ts file after viewing an .html one) must not stay stuck on "preview"
  // — there is nothing to render, and the toggle for it won't even show.
  createEffect(() => {
    const path = selectedPath()
    if (path && !isRenderable(path)) setPreviewMode("source")
  })

  const filesQueryOptions = createMemo(() => {
    const current = connection()
    return {
      queryKey: workbenchQueryKey(current, "design-files-tab"),
      enabled: !!current,
      queryFn: () => collectFiles((prefix, cursor) => current!.client.listFiles(current!.workspaceId, prefix, cursor)),
    }
  })
  const files = createQuery(filesQueryOptions)

  const panel = createMemo(() => createDesignFilesPanelState(files.data ?? { entries: [], skipped: 0 }, selectedPath()))
  const rows = createMemo(() => {
    const query = search().trim().toLowerCase()
    const all = renderDesignFileRows(panel())
    if (!query) return all
    return all.filter((row) => row.path.toLowerCase().includes(query))
  })
  // Search flattens on purpose — a match three folders deep must surface
  // without the user having to expand every ancestor first. The tree view
  // is only for the unfiltered browse case.
  const tree = createMemo(() => buildFileTree((files.data ?? { entries: [], skipped: 0 }).entries))

  const contentQueryOptions = createMemo(() => {
    const current = connection()
    const path = selectedPath()
    return {
      queryKey: workbenchQueryKey(current, "design-files-tab-content", { path: path ?? "" }),
      enabled: !!current && !!path,
      queryFn: () => current!.client.readFiles(current!.workspaceId, [path!]),
    }
  })
  const content = createQuery(contentQueryOptions)

  const decodedContent = createMemo(() => {
    const file = content.data?.results[0]
    return file ? decodeWorkspaceFile(file) : undefined
  })

  // A previewed HTML file's <link rel="stylesheet"> and <script src> tags
  // are almost always workspace-relative — `srcdoc` has no base URL to
  // resolve those against, so the iframe would otherwise render unstyled.
  // Fetch each referenced asset once and inline it before handing the
  // document to `ArtifactPreview`.
  const assetTargets = createMemo(() => {
    const html = decodedContent()
    const path = selectedPath()
    if (!html || !path || !isRenderable(path)) return []
    return collectRelativeAssetTargets(html, path)
  })
  const assetPaths = createMemo(() => [...new Set(assetTargets().map((target) => target.path))])

  const assetsQueryOptions = createMemo(() => {
    const current = connection()
    const paths = assetPaths()
    return {
      queryKey: workbenchQueryKey(current, "design-files-tab-assets", { paths: paths.join("|") }),
      enabled: !!current && paths.length > 0,
      queryFn: () => current!.client.readFiles(current!.workspaceId, paths),
    }
  })
  const assets = createQuery(assetsQueryOptions)

  const renderedSource = createMemo(() => {
    const html = decodedContent()
    const path = selectedPath()
    if (!html || !path) return undefined
    if (assetPaths().length === 0) return html
    if (assets.isLoading || !assets.data) return undefined
    const contentByPath = new Map(assets.data.results.map((file) => [file.path, decodeWorkspaceFile(file)]))
    return inlineRelativeAssets(html, path, contentByPath)
  })

  return (
    <div class="flex h-full min-h-0" data-design-files-tab data-design-files-count={rows().length}>
      <div class="flex w-64 shrink-0 flex-col border-r border-border-base">
        <div class="flex flex-col gap-2 border-b border-border-base p-2">
          <div class="flex items-center gap-1">
            <input
              type="search"
              class="w-full rounded border border-border-base bg-background-base px-2 py-1 text-12-regular text-text-base placeholder:text-text-weak focus:outline-none"
              placeholder="Rechercher un fichier…"
              value={search()}
              onInput={(event) => setSearch(event.currentTarget.value)}
              data-design-files-search
            />
            <button
              type="button"
              class="shrink-0 rounded border border-border-base px-2 py-1 text-12-medium disabled:opacity-50"
              disabled={mutating()}
              onClick={() => setShowCreateForm((value) => !value)}
              title="Nouveau fichier"
              data-design-files-new-button
            >
              +
            </button>
            <button
              type="button"
              class="shrink-0 rounded border border-border-base px-2 py-1 text-12-medium disabled:opacity-50"
              disabled={mutating()}
              onClick={() => uploadInput?.click()}
              title="Importer un fichier"
              data-design-files-upload-button
            >
              ↑
            </button>
            <input
              ref={uploadInput}
              type="file"
              class="hidden"
              data-design-files-upload-input
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                event.currentTarget.value = ""
                if (file) void uploadFile(file)
              }}
            />
          </div>
          <Show when={showCreateForm()}>
            <form
              class="flex items-center gap-1"
              data-design-files-create-form
              onSubmit={(event) => {
                event.preventDefault()
                void createFile(newFilePath())
              }}
            >
              <input
                type="text"
                class="w-full rounded border border-border-base bg-background-base px-2 py-1 text-12-regular text-text-base placeholder:text-text-weak focus:outline-none"
                placeholder="chemin/du/fichier.ext"
                value={newFilePath()}
                onInput={(event) => setNewFilePath(event.currentTarget.value)}
                data-design-files-new-path
                autofocus
              />
              <button type="submit" class="shrink-0 rounded border border-border-base px-2 py-1 text-12-medium disabled:opacity-50" disabled={mutating() || !newFilePath().trim()}>
                Créer
              </button>
            </form>
          </Show>
          <Show when={mutationError()}>
            <p class="text-12-regular text-text-danger" role="alert" data-design-files-mutation-error>
              {mutationError()}
            </p>
          </Show>
        </div>
        <div class="flex-1 min-h-0 overflow-y-auto p-1">
          <Show when={files.isLoading}>
            <p class="p-2 text-12-regular text-text-weak" data-design-files-loading>
              Chargement…
            </p>
          </Show>
          <Show when={files.error}>
            <p class="p-2 text-12-regular text-text-danger" data-design-files-error>
              {files.error instanceof Error ? files.error.message : String(files.error)}
            </p>
          </Show>
          <Show when={!files.isLoading && !files.error && rows().length === 0}>
            <p class="p-2 text-12-regular text-text-weak" data-design-files-empty>
              Aucun fichier trouvé.
            </p>
          </Show>
          <Show
            when={search().trim().length === 0}
            fallback={
              <ul class="flex flex-col gap-0.5">
                <For each={rows()}>{(row) => <FileRow row={row} onSelect={setSelectedPath} thumbnails={thumbnails} />}</For>
              </ul>
            }
          >
            <ul class="flex flex-col gap-0.5" data-design-files-tree>
              <For each={tree()}>
                {(node) => (
                  <TreeRow
                    node={node}
                    depth={0}
                    expanded={expanded()}
                    selectedPath={selectedPath()}
                    onToggle={toggleDirectory}
                    onSelect={setSelectedPath}
                    thumbnails={thumbnails}
                  />
                )}
              </For>
            </ul>
          </Show>
        </div>
      </div>
      <ThumbnailHost controller={thumbnails} />
      <div class="flex flex-1 min-h-0 flex-col" data-design-files-preview={selectedPath() ?? "none"}>
        <Show
          when={selectedPath()}
          fallback={
            <div class="flex h-full items-center justify-center p-6 text-center">
              <p class="text-12-regular text-text-weak">Sélectionne un fichier pour l'aperçu.</p>
            </div>
          }
        >
          {(path) => (
            <>
              <div class="flex items-center justify-between gap-2 border-b border-border-base px-3 py-2">
                <Show
                  when={renameDraft() !== undefined}
                  fallback={
                    <span class="truncate text-12-medium" data-design-files-preview-path>
                      {path()}
                    </span>
                  }
                >
                  <form
                    class="flex min-w-0 flex-1 items-center gap-1"
                    data-design-files-rename-form
                    onSubmit={(event) => {
                      event.preventDefault()
                      void renameSelected(renameDraft() ?? "")
                    }}
                  >
                    <input
                      type="text"
                      class="w-full min-w-0 rounded border border-border-base bg-background-base px-2 py-1 text-12-regular text-text-base focus:outline-none"
                      value={renameDraft() ?? ""}
                      onInput={(event) => setRenameDraft(event.currentTarget.value)}
                      data-design-files-rename-input
                      autofocus
                    />
                    <button type="submit" class="shrink-0 rounded border border-border-base px-2 py-1 text-12-medium disabled:opacity-50" disabled={mutating() || !(renameDraft() ?? "").trim()}>
                      Renommer
                    </button>
                    <button type="button" class="shrink-0 rounded border border-border-base px-2 py-1 text-12-medium" onClick={() => setRenameDraft(undefined)}>
                      Annuler
                    </button>
                  </form>
                </Show>
                <div class="flex shrink-0 items-center gap-1">
                  <Show when={renameDraft() === undefined}>
                    <button
                      type="button"
                      class="rounded border border-border-base px-2 py-1 text-12-medium disabled:opacity-50"
                      disabled={mutating()}
                      onClick={() => setRenameDraft(path())}
                      data-design-files-rename-button
                    >
                      Renommer
                    </button>
                    <button
                      type="button"
                      class="rounded border border-border-base px-2 py-1 text-12-medium text-text-danger disabled:opacity-50"
                      disabled={mutating()}
                      onClick={() => void deleteSelected()}
                      data-design-files-delete-button
                    >
                      Supprimer
                    </button>
                  </Show>
                </div>
                <Show when={isRenderable(path())}>
                  <div class="flex shrink-0 items-center gap-1 rounded border border-border-base p-0.5" role="group" aria-label="Aperçu ou source" data-design-files-mode-toggle>
                    <button
                      type="button"
                      class="rounded px-2 py-1 text-12-medium"
                      classList={{ "bg-background-stronger text-text-strong": previewMode() === "preview" }}
                      aria-pressed={previewMode() === "preview"}
                      onClick={() => setPreviewMode("preview")}
                    >
                      Aperçu
                    </button>
                    <button
                      type="button"
                      class="rounded px-2 py-1 text-12-medium"
                      classList={{ "bg-background-stronger text-text-strong": previewMode() === "source" }}
                      aria-pressed={previewMode() === "source"}
                      onClick={() => setPreviewMode("source")}
                    >
                      Source
                    </button>
                  </div>
                </Show>
              </div>
              <Show when={content.isLoading}>
                <p class="p-3 text-12-regular text-text-weak">Chargement…</p>
              </Show>
              <Show when={content.error}>
                <p class="p-3 text-12-regular text-text-danger">
                  {content.error instanceof Error ? content.error.message : String(content.error)}
                </p>
              </Show>
              <Show when={decodedContent() !== undefined}>
                <Show
                  when={isRenderable(path()) && previewMode() === "preview"}
                  fallback={
                    <div class="flex-1 min-h-0 overflow-auto p-3">
                      <pre class="whitespace-pre-wrap font-mono text-12-regular text-text-weak" data-design-files-preview-content>
                        {decodedContent()}
                      </pre>
                    </div>
                  }
                >
                  <Show when={assets.error}>
                    <p class="p-3 text-12-regular text-text-danger">
                      {assets.error instanceof Error ? assets.error.message : String(assets.error)}
                    </p>
                  </Show>
                  <Show
                    when={renderedSource() !== undefined}
                    fallback={<p class="p-3 text-12-regular text-text-weak">Chargement des styles…</p>}
                  >
                    <div class="flex-1 min-h-0 overflow-hidden" data-design-files-preview-render>
                      <ArtifactPreview
                        artifactId={path()}
                        workspaceId={connection()?.workspaceId ?? ""}
                        source={renderedSource()}
                        mode="preview"
                        viewport={DEFAULT_VIEWPORT}
                        zoom={DEFAULT_ZOOM}
                      />
                    </div>
                  </Show>
                </Show>
              </Show>
            </>
          )}
        </Show>
      </div>
    </div>
  )
}
