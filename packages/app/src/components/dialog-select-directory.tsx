import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { List } from "@opencode-ai/ui/list"
import type { ListRef } from "@opencode-ai/ui/list"
import { Button } from "@opencode-ai/ui/button"
import { getDirectory, getFilename } from "@opencode-ai/util/path"
import fuzzysort from "fuzzysort"
import { createMemo, createResource, createSignal, Show } from "solid-js"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLayout } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"

interface DialogSelectDirectoryProps {
  title?: string
  multiple?: boolean
  onSelect: (result: string | string[] | null) => void
}

type Row = {
  absolute: string
  search: string
  group: "recent" | "storage" | "folders"
  label?: string
}

function cleanInput(value: string) {
  const first = (value ?? "").split(/\r?\n/)[0] ?? ""
  return first.replace(/[\u0000-\u001F\u007F]/g, "").trim()
}

function normalizePath(input: string) {
  const v = input.replaceAll("\\", "/")
  if (v.startsWith("//") && !v.startsWith("///")) return "//" + v.slice(2).replace(/\/+/g, "/")
  return v.replace(/\/+/g, "/")
}

function normalizeDriveRoot(input: string) {
  const v = normalizePath(input)
  if (/^[A-Za-z]:$/.test(v)) return v + "/"
  return v
}

function trimTrailing(input: string) {
  const v = normalizeDriveRoot(input)
  if (v === "/") return v
  if (v === "//") return v
  if (/^[A-Za-z]:\/$/.test(v)) return v
  return v.replace(/\/+$/, "")
}

function joinPath(base: string | undefined, rel: string) {
  const b = trimTrailing(base ?? "")
  const r = trimTrailing(rel).replace(/^\/+/, "")
  if (!b) return r
  if (!r) return b
  if (b.endsWith("/")) return b + r
  return b + "/" + r
}

function rootOf(input: string) {
  const v = normalizeDriveRoot(input)
  if (v.startsWith("//")) return "//"
  if (v.startsWith("/")) return "/"
  if (/^[A-Za-z]:\//.test(v)) return v.slice(0, 3)
  return ""
}

function parentOf(input: string) {
  const v = trimTrailing(input)
  if (v === "/") return v
  if (v === "//") return v
  if (/^[A-Za-z]:\/$/.test(v)) return v

  const i = v.lastIndexOf("/")
  if (i <= 0) return "/"
  if (i === 2 && /^[A-Za-z]:/.test(v)) return v.slice(0, 3)
  return v.slice(0, i)
}

function modeOf(input: string) {
  const raw = normalizeDriveRoot(input.trim())
  if (!raw) return "relative" as const
  if (raw.startsWith("~")) return "tilde" as const
  if (rootOf(raw)) return "absolute" as const
  return "relative" as const
}

function tildeOf(absolute: string, home: string) {
  const full = trimTrailing(absolute)
  if (!home) return ""

  const hn = trimTrailing(home)
  const lc = full.toLowerCase()
  const hc = hn.toLowerCase()
  if (lc === hc) return "~"
  if (lc.startsWith(hc + "/")) return "~" + full.slice(hn.length)
  return ""
}

function displayPath(path: string, input: string, home: string) {
  const full = trimTrailing(path)
  if (modeOf(input) === "absolute") return full
  return tildeOf(full, home) || full
}

function toRow(absolute: string, home: string, group: Row["group"]): Row {
  const full = trimTrailing(absolute)
  const tilde = tildeOf(full, home)
  const withSlash = (value: string) => {
    if (!value) return ""
    if (value.endsWith("/")) return value
    return value + "/"
  }

  const search = Array.from(
    new Set([full, withSlash(full), tilde, withSlash(tilde), getFilename(full)].filter(Boolean)),
  ).join("\n")
  return { absolute: full, search, group }
}

function uniqueRows(rows: Row[]) {
  const seen = new Set<string>()
  return rows.filter((row) => {
    if (seen.has(row.absolute)) return false
    seen.add(row.absolute)
    return true
  })
}

function useDirectorySearch(args: {
  sdk: ReturnType<typeof useGlobalSDK>
  start: () => string | undefined
  home: () => string
}) {
  const cache = new Map<string, Promise<Array<{ name: string; absolute: string }>>>()
  let current = 0

  const scoped = (value: string) => {
    const base = args.start()
    if (!base) return

    const raw = normalizeDriveRoot(value)
    if (!raw) return { directory: trimTrailing(base), path: "" }

    const h = args.home()
    if (raw === "~") return { directory: trimTrailing(h || base), path: "" }
    if (raw.startsWith("~/")) return { directory: trimTrailing(h || base), path: raw.slice(2) }

    const root = rootOf(raw)
    if (root) return { directory: trimTrailing(root), path: raw.slice(root.length) }
    return { directory: trimTrailing(base), path: raw }
  }

  const dirs = async (dir: string) => {
    const key = trimTrailing(dir)
    const existing = cache.get(key)
    if (existing) return existing

    const request = args.sdk.client.file
      .list({ directory: key, path: "" })
      .then((x) => x.data ?? [])
      .catch(() => [])
      .then((nodes) =>
        nodes
          .filter((n) => n.type === "directory")
          .map((n) => ({
            name: n.name,
            absolute: trimTrailing(normalizeDriveRoot(n.absolute)),
          })),
      )

    cache.set(key, request)
    return request
  }

  const match = async (dir: string, query: string, limit: number) => {
    const items = await dirs(dir)
    if (!query) return items.slice(0, limit).map((x) => x.absolute)
    return fuzzysort.go(query, items, { key: "name", limit }).map((x) => x.obj.absolute)
  }

  return async (filter: string) => {
    const token = ++current
    const active = () => token === current

    const value = cleanInput(filter)
    const scopedInput = scoped(value)
    if (!scopedInput) return [] as string[]

    const raw = normalizeDriveRoot(value)
    const isPath = raw.startsWith("~") || !!rootOf(raw) || raw.includes("/")
    const query = normalizeDriveRoot(scopedInput.path)

    const find = () =>
      args.sdk.client.find
        .files({ directory: scopedInput.directory, query, type: "directory", limit: 50 })
        .then((x) => x.data ?? [])
        .catch(() => [])

    if (!isPath) {
      const results = await find()
      if (!active()) return []
      return results.map((rel) => joinPath(scopedInput.directory, rel)).slice(0, 50)
    }

    const segments = query.replace(/^\/+/, "").split("/")
    const head = segments.slice(0, segments.length - 1).filter((x) => x && x !== ".")
    const tail = segments[segments.length - 1] ?? ""

    const cap = 12
    const branch = 4
    let paths = [scopedInput.directory]
    let consumed: string[] = []
    let headIdx = 0
    while (headIdx < head.length) {
      const part = head[headIdx]
      if (!active()) return []
      if (part === "..") {
        paths = paths.map(parentOf)
        consumed.pop()
        headIdx++
        continue
      }

      const next = (await Promise.all(paths.map((p) => match(p, part, branch)))).flat()
      if (!active()) return []
      paths = Array.from(new Set(next)).slice(0, cap)
      if (paths.length === 0) {
        // Parent listing returned empty (e.g. Android sandbox blocks /storage
        // AND /storage/emulated but allows /storage/emulated/0). Skip forward
        // through remaining head segments until we find one that's listable.
        let built = (rootOf(raw) || "/") + consumed.filter(Boolean).join("/")
        let found = false
        for (let j = headIdx; j < head.length; j++) {
          built = built.endsWith("/") ? built + head[j] : built + "/" + head[j]
          const probe = await dirs(built)
          if (!active()) return []
          if (probe.length > 0) {
            paths = [built]
            consumed.push(...head.slice(headIdx, j + 1))
            headIdx = j + 1
            found = true
            break
          }
        }
        if (!found) return [] as string[]
        continue
      }
      consumed.push(part)
      headIdx++
    }

    const out = (await Promise.all(paths.map((p) => match(p, tail, 50)))).flat()
    if (!active()) return []
    const deduped = Array.from(new Set(out))
    const base = raw.startsWith("~") ? trimTrailing(scopedInput.directory) : ""
    const expand = !raw.endsWith("/")
    if (!expand || !tail) {
      const items = base ? Array.from(new Set([base, ...deduped])) : deduped
      return items.slice(0, 50)
    }

    const needle = tail.toLowerCase()
    const exact = deduped.filter((p) => getFilename(p).toLowerCase() === needle)
    const target = exact[0]
    if (!target) return deduped.slice(0, 50)

    const children = await match(target, "", 30)
    if (!active()) return []
    const items = Array.from(new Set([...deduped, ...children]))
    return (base ? Array.from(new Set([base, ...items])) : items).slice(0, 50)
  }
}

export function DialogSelectDirectory(props: DialogSelectDirectoryProps) {
  const sync = useGlobalSync()
  const sdk = useGlobalSDK()
  const layout = useLayout()
  const dialog = useDialog()
  const language = useLanguage()
  const platform = usePlatform()
  const isMobile = platform.platform === "mobile"

  const [filter, setFilter] = createSignal("")
  let list: ListRef | undefined

  const missingBase = createMemo(() => !(sync.data.path.home || sync.data.path.directory))
  const [fallbackPath] = createResource(
    () => (missingBase() ? true : undefined),
    async () => {
      return sdk.client.path
        .get()
        .then((x) => x.data)
        .catch(() => undefined)
    },
    { initialValue: undefined },
  )

  const home = createMemo(() => sync.data.path.home || fallbackPath()?.home || "")
  const start = createMemo(
    () => sync.data.path.home || sync.data.path.directory || fallbackPath()?.home || fallbackPath()?.directory,
  )

  const directories = useDirectorySearch({
    sdk,
    home,
    start,
  })

  // Mobile-only: probe storage roots (internal storage, SD cards, OTG drives,
  // app home) since /storage/ itself can't be enumerated due to Android sandbox.
  // On desktop/web platform.listStorageRoots is undefined → empty list.
  const [storageRoots] = createResource(
    async () => {
      if (!platform.listStorageRoots) return [] as Array<{ path: string; label: string }>
      try {
        return await platform.listStorageRoots()
      } catch {
        return []
      }
    },
    { initialValue: [] },
  )

  const storageRows = createMemo<Row[]>(() => {
    const roots = storageRoots() ?? []
    return roots.map((r) => {
      const row = toRow(r.path, home(), "storage")
      return {
        ...row,
        label: r.label,
        search: `${row.search}\n${r.label}`,
      }
    })
  })

  const recentProjects = createMemo(() => {
    const projects = layout.projects.list()
    const byProject = new Map<string, number>()

    for (const project of projects) {
      let at = 0
      const dirs = [project.worktree, ...(project.sandboxes ?? [])]
      for (const directory of dirs) {
        const sessions = sync.child(directory, { bootstrap: false })[0].session
        for (const session of sessions) {
          if (session.time.archived) continue
          const updated = session.time.updated ?? session.time.created
          if (updated > at) at = updated
        }
      }
      byProject.set(project.worktree, at)
    }

    return projects
      .map((project, index) => ({ project, at: byProject.get(project.worktree) ?? 0, index }))
      .sort((a, b) => b.at - a.at || a.index - b.index)
      .slice(0, 5)
      .map(({ project }) => {
        const row = toRow(project.worktree, home(), "recent")
        const name = project.name || getFilename(project.worktree)
        return {
          ...row,
          search: `${row.search}\n${name}`,
        }
      })
  })

  const items = async (value: string) => {
    const results = await directories(value)
    const directoryRows = results.map((absolute) => toRow(absolute, home(), "folders"))
    return uniqueRows([...recentProjects(), ...storageRows(), ...directoryRows])
  }

  function resolve(absolute: string) {
    props.onSelect(props.multiple ? [absolute] : absolute)
    dialog.close()
  }

  /** The "current" directory the user is browsing. Derived from the search bar
   *  if it parses as a path, otherwise the start directory. Used by mobile
   *  "Open here" and "New folder" actions. */
  function currentDir(): string | null {
    const v = cleanInput(filter())
    if (v) {
      const trimmed = trimTrailing(normalizeDriveRoot(v))
      // Only treat as a path if it looks like one
      if (trimmed.startsWith("/") || trimmed.startsWith("~")) {
        if (trimmed.startsWith("~")) {
          const h = home()
          if (h) return h + trimmed.slice(1)
        }
        return trimmed
      }
    }
    return start() ?? null
  }

  /** Mobile: tap on a folder navigates into it instead of opening as project. */
  function navigateInto(absolute: string) {
    const withSlash = absolute.endsWith("/") ? absolute : absolute + "/"
    list?.setFilter(withSlash)
    setFilter(withSlash)
  }

  const [creatingFolder, setCreatingFolder] = createSignal(false)
  const [newFolderName, setNewFolderName] = createSignal("")
  const [createError, setCreateError] = createSignal<string | null>(null)
  const [creating, setCreating] = createSignal(false)

  async function handleCreateFolder() {
    const name = newFolderName().trim()
    if (!name) {
      setCreateError("Folder name is required")
      return
    }
    if (/[\\/]/.test(name)) {
      setCreateError("Folder name cannot contain slashes")
      return
    }
    const base = currentDir()
    if (!base) {
      setCreateError("No current directory")
      return
    }
    setCreating(true)
    setCreateError(null)
    try {
      const target = base.endsWith("/") ? base + name : base + "/" + name
      // Call POST /file/mkdir directly via the server URL since the typed SDK
      // hasn't been regenerated yet for this new endpoint.
      const baseUrl = sdk.url.replace(/\/+$/, "")
      const resp = await (platform.fetch ?? fetch)(baseUrl + "/file/mkdir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: target }),
      })
      if (!resp.ok) {
        const text = await resp.text().catch(() => "")
        throw new Error(text || `HTTP ${resp.status}`)
      }
      const data = (await resp.json().catch(() => null)) as { absolute?: string } | null
      const absolute = data?.absolute ?? target
      // Open the newly created folder as a project
      resolve(absolute)
    } catch (e: any) {
      setCreateError(e?.message ?? String(e))
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog title={props.title ?? language.t("command.project.open")}>
      {/* Mobile action bar: back + "Open here" + "New folder" buttons */}
      <Show when={isMobile && currentDir()}>
        <div class="flex gap-2 px-3 pb-2">
          <Show when={filter()}>
            <Button
              size="small"
              variant="ghost"
              onClick={() => {
                const cur = currentDir()
                if (!cur) return
                const parent = parentOf(cur)
                if (parent === cur) {
                  list?.setFilter("")
                  setFilter("")
                } else {
                  navigateInto(parent)
                }
              }}
            >
              &#8592; Back
            </Button>
            <Button size="small" variant="secondary" onClick={() => { const d = currentDir(); if (d) resolve(d) }}>
              Open here
            </Button>
          </Show>
          <Button
            size="small"
            variant="secondary"
            onClick={() => { setCreatingFolder(true); setNewFolderName(""); setCreateError(null) }}
          >
            New folder
          </Button>
        </div>
      </Show>

      {/* New folder inline form */}
      <Show when={creatingFolder()}>
        <div class="flex flex-col gap-2 px-3 pb-3">
          <div class="text-12-regular text-text-weak">
            Create in: {currentDir() ?? "?"}
          </div>
          <div class="flex gap-2">
            <input
              type="text"
              class="flex-1 rounded border border-border-base bg-background-base px-2 py-1 text-14-regular text-text-strong outline-none focus:border-border-focus"
              placeholder="Folder name"
              value={newFolderName()}
              onInput={(e) => setNewFolderName(e.currentTarget.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreateFolder(); if (e.key === "Escape") setCreatingFolder(false) }}
              autofocus
            />
            <Button size="small" disabled={creating()} onClick={handleCreateFolder}>
              {creating() ? "..." : "Create"}
            </Button>
            <Button size="small" variant="ghost" onClick={() => setCreatingFolder(false)}>
              Cancel
            </Button>
          </div>
          <Show when={createError()}>
            <div class="text-12-regular text-icon-critical-base">{createError()}</div>
          </Show>
        </div>
      </Show>

      <List
        search={{ placeholder: language.t("dialog.directory.search.placeholder"), autofocus: !creatingFolder() }}
        emptyMessage={language.t("dialog.directory.empty")}
        loadingMessage={language.t("common.loading")}
        items={items}
        key={(x) => x.absolute}
        filterKeys={["search"]}
        groupBy={(item) => item.group}
        sortGroupsBy={(a, b) => {
          const order: Record<string, number> = { recent: 0, storage: 1, folders: 2 }
          return (order[a.category] ?? 99) - (order[b.category] ?? 99)
        }}
        groupHeader={(group) => {
          if (group.category === "recent") return language.t("home.recentProjects")
          if (group.category === "storage") return "Device storage"
          return language.t("command.project.open")
        }}
        ref={(r) => (list = r)}
        onFilter={(value) => setFilter(cleanInput(value))}
        onKeyEvent={(e, item) => {
          if (e.key !== "Tab") return
          if (e.shiftKey) return
          if (!item) return

          e.preventDefault()
          e.stopPropagation()

          const value = displayPath(item.absolute, filter(), home())
          list?.setFilter(value.endsWith("/") ? value : value + "/")
        }}
        onSelect={(path) => {
          if (!path) return
          if (isMobile && (path.group === "storage" || path.group === "folders")) {
            // Mobile: tap navigates into the folder instead of opening as project
            navigateInto(path.absolute)
          } else {
            resolve(path.absolute)
          }
        }}
      >
        {(item) => {
          const path = displayPath(item.absolute, filter(), home())
          // Storage roots: show their human label prominently with the path subtitle
          if (item.group === "storage" && item.label) {
            return (
              <div class="w-full flex items-center justify-between rounded-md">
                <div class="flex items-center gap-x-3 grow min-w-0">
                  <FileIcon node={{ path: item.absolute, type: "directory" }} class="shrink-0 size-4" />
                  <div class="flex flex-col text-14-regular min-w-0">
                    <span class="text-text-strong whitespace-nowrap">{item.label}</span>
                    <span class="text-12-regular text-text-weak whitespace-nowrap overflow-hidden overflow-ellipsis truncate min-w-0">
                      {item.absolute}
                    </span>
                  </div>
                </div>
              </div>
            )
          }
          if (path === "~") {
            return (
              <div class="w-full flex items-center justify-between rounded-md">
                <div class="flex items-center gap-x-3 grow min-w-0">
                  <FileIcon node={{ path: item.absolute, type: "directory" }} class="shrink-0 size-4" />
                  <div class="flex items-center text-14-regular min-w-0">
                    <span class="text-text-strong whitespace-nowrap">~</span>
                    <span class="text-text-weak whitespace-nowrap">/</span>
                  </div>
                </div>
              </div>
            )
          }
          return (
            <div class="w-full flex items-center justify-between rounded-md">
              <div class="flex items-center gap-x-3 grow min-w-0">
                <FileIcon node={{ path: item.absolute, type: "directory" }} class="shrink-0 size-4" />
                <div class="flex items-center text-14-regular min-w-0">
                  <span class="text-text-weak whitespace-nowrap overflow-hidden overflow-ellipsis truncate min-w-0">
                    {getDirectory(path)}
                  </span>
                  <span class="text-text-strong whitespace-nowrap">{getFilename(path)}</span>
                  <span class="text-text-weak whitespace-nowrap">/</span>
                </div>
              </div>
            </div>
          )
        }}
      </List>
    </Dialog>
  )
}
