import { batch, createEffect, createMemo, onCleanup } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { showToast } from "@opencode-ai/ui/toast"
import { useParams } from "@solidjs/router"
import { getFilename } from "@opencode-ai/util/path"
import { useSDK } from "./sdk"
import { useSync } from "./sync"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useFileStore } from "./file/store"
import { createPathHelpers } from "./file/path"
import {
  approxBytes,
  evictContentLru,
  getFileContentBytesTotal,
  getFileContentEntryCount,
  hasFileContent,
  removeFileContentBytes,
  resetFileContentLru,
  setFileContentBytes,
  touchFileContent,
} from "./file/content-cache"
import { createFileViewCache } from "./file/view-cache"
import { createFileTreeStore } from "./file/tree-store"
import { invalidateFromWatcher } from "./file/watcher"
import { createGenerationTracker } from "./file/generation"
import { createScopeEpochTracker } from "./file/scope-epoch"
import { requireFileContent } from "./file/load-response"
import {
  selectionFromLines,
  type FileState,
  type FileSelection,
  type FileViewState,
  type SelectedLineRange,
} from "./file/types"

export type { FileSelection, SelectedLineRange, FileViewState, FileState }
export { selectionFromLines }
export {
  evictContentLru,
  getFileContentBytesTotal,
  getFileContentEntryCount,
  removeFileContentBytes,
  resetFileContentLru,
  setFileContentBytes,
  touchFileContent,
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string" && error) return error
  return fallback
}

export const { use: useFile, provider: FileProvider } = createSimpleContext({
  name: "File",
  gate: false,
  init: () => {
    const sdk = useSDK()
    useSync()
    const params = useParams()
    const language = useLanguage()
    const layout = useLayout()
    const fileStore = useFileStore()

    const scope = createMemo(() => sdk.directory)
    const path = createPathHelpers(scope)
    const tabs = layout.tabs(() => `${params.dir}${params.id ? "/" + params.id : ""}`)

    const inflight = new Map<string, Promise<void>>()
    // FORK (PLAN-READONLY-VIEWER-REACTIVITY C1/Phase 2): seed() and every
    // real load() fetch bump the generation for that path; a load()
    // response only applies if its captured generation is still current
    // when it resolves. Without this, seed(pathA, "fresh") followed by a
    // slower, now-superseded load() response (e.g. the watcher, or a load()
    // that was already in flight before the seed) could overwrite fresher
    // content with stale bytes after the fact.
    const gen = createGenerationTracker()
    // FORK (CORRECTIF F8, 2026-07-19): gen.clear() resets each path's
    // generation counter to 0 on every scope change, so a directory round
    // trip (A -> B -> A) can hand two DIFFERENT requests for the same path
    // the SAME numeric generation — one from the old A visit still in
    // flight, one from the new A visit. `scope() !== directory` doesn't
    // distinguish them either: both requests capture directory="A", and
    // scope() reads "A" again once the round trip completes, so both pass.
    // If the stale request resolves last, its bytes win and stick until the
    // next refresh. scopeEpoch is strictly monotonic and never reset (see
    // scope-epoch.ts), so it uniquely tags each scope visit regardless of
    // how many times the user revisits the same directory.
    const scopeEpochTracker = createScopeEpochTracker()
    const [store, setStore] = createStore<{
      file: Record<string, FileState>
    }>({
      file: {},
    })

    const tree = createFileTreeStore({
      scope,
      normalizeDir: path.normalizeDir,
      list: (dir) => sdk.client.file.list({ path: dir }).then((x) => x.data ?? []),
      onError: (message) => {
        showToast({
          variant: "error",
          title: language.t("toast.file.listFailed.title"),
          description: message,
        })
      },
    })

    const evictContent = (keep?: Set<string>) => {
      evictContentLru(keep, (target) => {
        if (!store.file[target]) return
        setStore(
          "file",
          target,
          produce((draft) => {
            draft.content = undefined
            draft.loaded = false
          }),
        )
      })
    }

    createEffect(() => {
      scope()
      scopeEpochTracker.bump()
      inflight.clear()
      gen.clear()
      resetFileContentLru()
      batch(() => {
        setStore("file", reconcile({}))
        tree.reset()
      })
    })

    const viewCache = createFileViewCache()
    const view = createMemo(() => viewCache.load(scope(), params.id))

    const ensure = (file: string) => {
      if (!file) return
      if (store.file[file]) return
      setStore("file", file, { path: file, name: getFilename(file) })
    }

    const setLoading = (file: string) => {
      setStore(
        "file",
        file,
        produce((draft) => {
          draft.loading = true
          draft.error = undefined
        }),
      )
    }

    const setLoaded = (file: string, content: FileState["content"]) => {
      setStore(
        "file",
        file,
        produce((draft) => {
          draft.loaded = true
          draft.loading = false
          draft.content = content
        }),
      )
    }

    const setLoadError = (file: string, message: string) => {
      setStore(
        "file",
        file,
        produce((draft) => {
          draft.loading = false
          draft.error = message
        }),
      )
      showToast({
        variant: "error",
        title: language.t("toast.file.loadFailed.title"),
        description: message,
      })
    }

    const load = (input: string, options?: { force?: boolean }) => {
      const file = path.normalize(input)
      if (!file) return Promise.resolve()

      const directory = scope()
      const key = `${directory}\n${file}`
      ensure(file)

      // Phase 2.4e: skip-when-clean gate now consults FileStore, not the local
      // viewer cache. Reason: editor.save() / editor.reload() update FileStore
      // atomically (markClean), so a freshly-cleaned FileDoc is proof we just
      // saw the bytes — no need to re-read. `force: true` still bypasses this
      // for callers that genuinely need a fresh fetch (tab activation, agent
      // finish, watcher hot path). The viewer cache's `loaded` flag is no
      // longer the source of truth; it stays as a render hint for the spinner.
      if (!options?.force && fileStore.get(file)?.status === "clean") return Promise.resolve()

      const pending = inflight.get(key)
      if (pending) return pending

      setLoading(file)
      const myGen = gen.bump(file)
      // FORK (CORRECTIF F8): captured synchronously, same tick as myGen —
      // see scopeEpochTracker's declaration for why this closes the
      // A->B->A gap that `scope() !== directory` and the per-path gen
      // counter both miss.
      const myEpoch = scopeEpochTracker.capture()

      const promise: Promise<void> = Promise.all([
        sdk.client.file.read({ path: file }),
        sdk.client.file.readRaw({ path: file }),
      ])
        .then(([read, raw]) => {
          if (!scopeEpochTracker.isCurrent(myEpoch)) return
          if (scope() !== directory) return
          // A newer seed() or load() call for this path started after this
          // one — this response is stale, drop it instead of overwriting
          // fresher content (PLAN-READONLY-VIEWER-REACTIVITY Phase 2).
          if (!gen.isCurrent(file, myGen)) return
          const content = requireFileContent(read.data, read.error)
          // FORK (CORRECTIF F7, 2026-07-19): read.data is a FileContent
          // object, including for a legitimate empty file (content.content
          // === ""), so `!content` only trips when the SDK genuinely
          // returned no data — a failed request, not an empty file. Route
          // that through the catch below instead of calling setLoaded with
          // undefined, which would clobber content already seeded by a
          // recent save/recreate/overwrite with bytes that were never
          // actually stale.
          setLoaded(file, content)
          touchFileContent(file, approxBytes(content))
          evictContent(new Set([file]))

          // Phase 2.4b: also populate FileStore so viewer + editor share one
          // source of truth (R1 in PLAN-EDITEUR-IDE-DEFINITIF). readRaw returns
          // the disk stamp used by editor.save() to detect 409 conflicts. The
          // viewer cache above stays for loading/error flags + VCS payload
          // (diff/patch); 2.4c wires editor.tsx to read from FileStore too.
          //
          // Phase 2.4d: if the editor has flagged this path as "conflict"
          // (dirty buffer + external write), DO NOT overwrite that — the
          // conflict is sticky until the user resolves it via Save (force
          // overwrite) or Discard. Otherwise a viewer-driven re-read races
          // the editor and silently clears the warning.
          const rawData = raw.data
          if (rawData && fileStore.get(file)?.status !== "conflict") {
            const vcs = content.diff || content.patch ? { diff: content.diff, patch: content.patch } : undefined
            fileStore.markClean(file, rawData.content, rawData.stamp, vcs)
          }
        })
        .catch((e) => {
          if (!scopeEpochTracker.isCurrent(myEpoch)) return
          if (scope() !== directory) return
          // A superseded fetch failing is not a user-facing error — a newer
          // seed()/load() already owns this path's displayed content.
          if (!gen.isCurrent(file, myGen)) return
          setLoadError(file, errorMessage(e, language.t("error.chain.unknown")))
        })
        .finally(() => {
          // FORK (CORRECTIF F8): only remove OUR entry — a newer load() for
          // the same key may already have replaced it in `inflight` (e.g.
          // after a scope-clear + immediate re-request), and this stale
          // `finally` must not delete a pending promise it doesn't own.
          if (inflight.get(key) === promise) inflight.delete(key)
        })

      inflight.set(key, promise)
      return promise
    }

    // FORK (PLAN-READONLY-VIEWER-REACTIVITY C1/Phase 2): seed the viewer
    // cache directly with content already known to the caller (e.g. the
    // exact bytes editorStore.save() just wrote and mirrored into FileStore)
    // instead of re-fetching it over the SDK. Eliminates the redundant
    // network/IPC round-trip that was the dominant cost between "save
    // complete" and "viewer shows the new content" (measured ~200ms of a
    // ~425ms total, see PLAN-READONLY-VIEWER-REACTIVITY-2026-07-16.md cause
    // C1). Synchronous and side-effect-free beyond the store write — callers
    // that also need VCS diff/patch info (not part of a save result) should
    // follow up with a non-blocking `load(path, {force:true})`.
    const seed = (input: string, content: string) => {
      const file = path.normalize(input)
      if (!file) return
      ensure(file)
      gen.bump(file)
      // WHY type: "text" hardcoded, not inferred: seed() is only ever called
      // with content the editor just wrote via CodeMirror — binary files are
      // never editable (editor-panel.tsx's canEdit() excludes NUL bytes), so
      // a seeded payload is text by construction. diff/patch are
      // intentionally omitted — see the seed() doc comment above.
      const payload: NonNullable<FileState["content"]> = { type: "text", content }
      setLoaded(file, payload)
      touchFileContent(file, approxBytes(payload))
      evictContent(new Set([file]))
    }

    const search = (query: string, dirs: "true" | "false") =>
      sdk.client.find.files({ query: query.replaceAll("\\", "/"), dirs }).then(
        (x) => (x.data ?? []).map(path.normalize),
        () => [],
      )
    const stop = sdk.event.listen((e) => {
      invalidateFromWatcher(e.details, {
        normalize: path.normalize,
        hasFile: (file) => Boolean(store.file[file]),
        isOpen: (file) => tabs.all().some((tab) => path.pathFromTab(tab) === file),
        loadFile: (file) => {
          void load(file, { force: true })
        },
        node: tree.node,
        isDirLoaded: tree.isLoaded,
        refreshDir: (dir) => {
          void tree.listDir(dir, { force: true })
        },
      })
    })

    const get = (input: string) => {
      const file = path.normalize(input)
      const state = store.file[file]
      const content = state?.content
      if (!content) return state
      if (hasFileContent(file)) {
        touchFileContent(file)
        return state
      }
      touchFileContent(file, approxBytes(content))
      return state
    }

    function withPath(input: string, action: (file: string) => unknown) {
      return action(path.normalize(input))
    }
    const scrollTop = (input: string) => withPath(input, (file) => view().scrollTop(file))
    const scrollLeft = (input: string) => withPath(input, (file) => view().scrollLeft(file))
    const selectedLines = (input: string) => withPath(input, (file) => view().selectedLines(file))
    const setScrollTop = (input: string, top: number) => withPath(input, (file) => view().setScrollTop(file, top))
    const setScrollLeft = (input: string, left: number) => withPath(input, (file) => view().setScrollLeft(file, left))
    const setSelectedLines = (input: string, range: SelectedLineRange | null) =>
      withPath(input, (file) => view().setSelectedLines(file, range))

    onCleanup(() => {
      stop()
      viewCache.clear()
    })

    return {
      ready: () => view().ready(),
      normalize: path.normalize,
      tab: path.tab,
      pathFromTab: path.pathFromTab,
      tree: {
        list: tree.listDir,
        refresh: (input: string) => tree.listDir(input, { force: true }),
        state: tree.dirState,
        children: tree.children,
        expand: tree.expandDir,
        collapse: tree.collapseDir,
        toggle(input: string) {
          if (tree.dirState(input)?.expanded) {
            tree.collapseDir(input)
            return
          }
          tree.expandDir(input)
        },
      },
      get,
      load,
      seed,
      scrollTop,
      scrollLeft,
      setScrollTop,
      setScrollLeft,
      selectedLines,
      setSelectedLines,
      searchFiles: (query: string) => search(query, "false"),
      searchFilesAndDirectories: (query: string) => search(query, "true"),
    }
  },
})
