// FORK: Phase 3 — Source Control panel (ADR-0005 roadmap).
// Provides a lightweight Git UI: view staged/unstaged changes, stage/unstage
// individual files, write a commit message and commit, push/pull, switch
// branch, and view the recent commit log. Heavy operations (push, pull, commit)
// show inline status so the user sees progress without leaving the panel.
//
// State is kept local — no global store — so the panel is self-contained and
// can be mounted anywhere (currently in the session side panel).
//
// The SDK `Git` class mirrors the routes in `server/routes/git.ts`.
// @thread-safety all operations run on the main thread; no audio/RT concerns.
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  type Component,
} from "solid-js"
import { createStore } from "solid-js/store"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"
import type { GitBranchEntry, GitCommitEntry, GitOpResult, GitWorkingStatusEntry } from "../types/sdk-shim"

// ─── Types ────────────────────────────────────────────────────────────────────

type FileStatus = {
  path: string
  // git status X/Y codes flattened to a display kind
  kind: "modified" | "added" | "deleted" | "renamed" | "untracked" | "other"
  staged: boolean
}

type SourceControlState = {
  loading: boolean
  files: FileStatus[]
  branches: GitBranchEntry[]
  log: GitCommitEntry[]
  logLoading: boolean
  commitMessage: string
  busy: string | null // label of the running operation
  lastError: string | null
  lastSuccess: string | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function statusKind(code: string): FileStatus["kind"] {
  if (code === "??") return "untracked"
  if (code.includes("A") && !code.includes("D")) return "added"
  if (code.includes("D") && !code.includes("A")) return "deleted"
  if (code.includes("R")) return "renamed"
  if (code.includes("M") || code.includes("U")) return "modified"
  return "other"
}

function kindLabel(kind: FileStatus["kind"]): string {
  return { modified: "M", added: "A", deleted: "D", renamed: "R", untracked: "U", other: "?" }[kind]
}

function kindClass(kind: FileStatus["kind"]): string {
  return (
    {
      modified: "text-[#E5C07B]",
      added: "text-[#98C379]",
      deleted: "text-[#E06C75]",
      renamed: "text-[#61AFEF]",
      untracked: "text-text-weak",
      other: "text-text-weak",
    }[kind] ?? "text-text-weak"
  )
}

// ─── Component ───────────────────────────────────────────────────────────────

export const SourceControl: Component<{
  directory?: string
  onOpenFile?: (path: string) => void
}> = (props) => {
  const language = useLanguage()
  const sdk = useSDK()

  const [state, setState] = createStore<SourceControlState>({
    loading: false,
    files: [],
    branches: [],
    log: [],
    logLoading: false,
    commitMessage: "",
    busy: null,
    lastError: null,
    lastSuccess: null,
  })

  const [tab, setTab] = createSignal<"changes" | "log">("changes")
  const [showBranchDropdown, setShowBranchDropdown] = createSignal(false)

  const currentBranch = createMemo(() => state.branches.find((b) => b.current)?.name ?? "")
  const staged = createMemo(() => state.files.filter((f) => f.staged))
  const unstaged = createMemo(() => state.files.filter((f) => !f.staged))

  // ── Data loaders ──────────────────────────────────────────────────────────

  const loadStatus = async () => {
    setState("loading", true)
    try {
      const [statusRes, branchRes] = await Promise.all([
        sdk.client.git.workingStatus({ directory: props.directory }),
        sdk.client.git.branches({ directory: props.directory }),
      ])

      const rawFiles = (statusRes.data ?? []) as GitWorkingStatusEntry[]

      const files: FileStatus[] = rawFiles
        .filter((f): f is typeof f & { file: string } => f.file !== undefined)
        .map((f) => {
          // XY code: X = index (staged), Y = worktree (unstaged)
          const x = f.code?.[0] ?? "?"
          const isStaged = x !== " " && x !== "?"
          return {
            path: f.file,
            kind: statusKind(f.code ?? "??"),
            staged: isStaged,
          }
        })

      setState("files", files)
      setState("branches", (branchRes.data ?? []) as GitBranchEntry[])
    } catch (err) {
      setState("lastError", err instanceof Error ? err.message : language.t("sourceControl.statusReadError"))
    } finally {
      setState("loading", false)
    }
  }

  const loadLog = async () => {
    setState("logLoading", true)
    try {
      const res = await sdk.client.git.log({ directory: props.directory, limit: "20" })
      setState("log", (res.data ?? []) as GitCommitEntry[])
    } catch {
      setState("log", [])
    } finally {
      setState("logLoading", false)
    }
  }

  onMount(() => {
    void loadStatus()
  })

  // Reload when directory changes
  createEffect(
    on(
      () => props.directory,
      () => {
        void loadStatus()
      },
    ),
  )

  // Load log lazily when the tab becomes active
  createEffect(
    on(tab, (t) => {
      if (t === "log" && state.log.length === 0) void loadLog()
    }),
  )

  // Close branch dropdown on outside click
  const handleDocClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement
    if (!target.closest("[data-branch-dropdown]")) setShowBranchDropdown(false)
  }
  onMount(() => document.addEventListener("click", handleDocClick))
  onCleanup(() => document.removeEventListener("click", handleDocClick))

  // ── Mutations ─────────────────────────────────────────────────────────────

  const withBusy = async (label: string, fn: () => Promise<void>) => {
    setState("busy", label)
    setState("lastError", null)
    setState("lastSuccess", null)
    try {
      await fn()
    } catch (err) {
      setState("lastError", err instanceof Error ? err.message : String(err))
    } finally {
      setState("busy", null)
    }
  }

  const stageFile = (path: string) =>
    withBusy(language.t("sourceControl.stagingProgress"), async () => {
      await sdk.client.git.add({ directory: props.directory, files: [path] })
      await loadStatus()
    })

  const unstageFile = (path: string) =>
    withBusy(language.t("sourceControl.unstagingProgress"), async () => {
      await sdk.client.git.reset({ directory: props.directory, files: [path] })
      await loadStatus()
    })

  const stageAll = () =>
    withBusy(language.t("sourceControl.stagingAllProgress"), async () => {
      await sdk.client.git.add({ directory: props.directory })
      await loadStatus()
    })

  const unstageAll = () =>
    withBusy(language.t("sourceControl.unstagingAllProgress"), async () => {
      await sdk.client.git.reset({ directory: props.directory })
      await loadStatus()
    })

  const commitChanges = () =>
    withBusy(language.t("sourceControl.committingProgress"), async () => {
      const msg = state.commitMessage.trim()
      if (!msg) {
        setState("lastError", language.t("sourceControl.emptyCommit"))
        return
      }
      const res = (await sdk.client.git.commit({ directory: props.directory, message: msg })) as {
        data?: { hash?: string; error?: string }
        error?: { error?: string }
      }
      if (res.error?.error) {
        setState("lastError", res.error.error)
        return
      }
      setState("commitMessage", "")
      setState("lastSuccess", language.t("sourceControl.commitSuccess", { hash: res.data?.hash ?? "" }))
      await loadStatus()
      // Reload log if open
      if (tab() === "log") await loadLog()
      else setState("log", []) // stale — force reload on next tab switch
    })

  const pushChanges = () =>
    withBusy(language.t("sourceControl.pushingProgress"), async () => {
      const res = (await sdk.client.git.push({ directory: props.directory })) as {
        data?: GitOpResult
      }
      const result = res.data
      if (result && !result.ok) {
        setState("lastError", result.error ?? "git push failed")
        return
      }
      setState("lastSuccess", language.t("sourceControl.pushed"))
    })

  const pullChanges = () =>
    withBusy(language.t("sourceControl.pullingProgress"), async () => {
      const res = (await sdk.client.git.pull({ directory: props.directory })) as {
        data?: GitOpResult
      }
      const result = res.data
      if (result && !result.ok) {
        setState("lastError", result.error ?? "git pull failed")
        return
      }
      setState("lastSuccess", language.t("sourceControl.pulled"))
      await loadStatus()
    })

  const switchBranch = (name: string) =>
    withBusy(language.t("sourceControl.checkoutProgress"), async () => {
      await sdk.client.git.branch({
        directory: props.directory,
        name,
        create: false,
      })
      setShowBranchDropdown(false)
      await loadStatus()
    })

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div class="flex flex-col h-full text-12-regular select-none">
      {/* ── Header ── */}
      <div class="px-3 py-2 border-b border-border-main flex items-center gap-2">
        <span class="text-12-medium text-text-base flex-1">{language.t("sourceControl.title")}</span>

        {/* Branch switcher */}
        <div class="relative" data-branch-dropdown>
          <button
            class="flex items-center gap-1 px-2 py-0.5 rounded text-11-regular text-text-weak hover:text-text-base hover:bg-bg-hover transition-colors"
            onClick={() => setShowBranchDropdown((v) => !v)}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 16 16"
              width="12"
              height="12"
              fill="currentColor"
              class="opacity-60 shrink-0"
            >
              <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Z" />
            </svg>
            <span class="max-w-[120px] truncate">{currentBranch() || "—"}</span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 16 16"
              width="10"
              height="10"
              fill="currentColor"
              class="opacity-40"
            >
              <path d="M4.427 7.427l3.396 3.396a.25.25 0 0 0 .354 0l3.396-3.396A.25.25 0 0 0 11.396 7H4.604a.25.25 0 0 0-.177.427Z" />
            </svg>
          </button>

          <Show when={showBranchDropdown() && state.branches.length > 0}>
            <div class="absolute right-0 top-full mt-1 z-50 min-w-[180px] max-h-[240px] overflow-y-auto bg-bg-overlay border border-border-main rounded shadow-lg">
              <For each={state.branches.filter((b) => !b.remote)}>
                {(b) => (
                  <button
                    class="w-full px-3 py-1.5 text-left text-11-regular hover:bg-bg-hover transition-colors flex items-center gap-2"
                    classList={{ "text-accent-primary font-medium": b.current }}
                    onClick={() => {
                      if (!b.current) void switchBranch(b.name ?? "")
                      else setShowBranchDropdown(false)
                    }}
                  >
                    <Show when={b.current}>
                      <span class="text-accent-primary">✓</span>
                    </Show>
                    <span class="truncate">{b.name}</span>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>

        {/* Refresh */}
        <button
          class="p-1 rounded hover:bg-bg-hover text-text-weak hover:text-text-base transition-colors"
          onClick={() => void loadStatus()}
          title={language.t("sourceControl.refresh")}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 16 16"
            width="12"
            height="12"
            fill="currentColor"
            classList={{ "animate-spin": state.loading }}
          >
            <path d="M8 2.5a5.487 5.487 0 0 0-4.131 1.869l1.204 1.204A.25.25 0 0 1 4.896 6H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.002 7.002 0 0 1 14.95 7.16a.75.75 0 0 1-1.49.178A5.5 5.5 0 0 0 8 2.5ZM1.705 8.005a.75.75 0 0 1 .834.656 5.501 5.501 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .656-.834Z" />
          </svg>
        </button>
      </div>

      {/* ── Status bar ── */}
      <Show when={state.busy || state.lastError || state.lastSuccess}>
        <div
          class="px-3 py-1.5 text-11-regular border-b border-border-main"
          classList={{
            "bg-bg-warning/20 text-text-warning": !!state.lastError,
            "bg-bg-success/20 text-text-success": !!state.lastSuccess,
            "text-text-weak": !!state.busy,
          }}
        >
          <Show when={state.busy}>
            <span class="opacity-70">{state.busy}</span>
          </Show>
          <Show when={state.lastError}>
            <span class="truncate">{state.lastError}</span>
          </Show>
          <Show when={state.lastSuccess}>
            <span>{state.lastSuccess}</span>
          </Show>
        </div>
      </Show>

      {/* ── Tabs ── */}
      <div class="flex border-b border-border-main">
        {(["changes", "log"] as const).map((t) => (
          <button
            class="px-3 py-1.5 text-11-regular transition-colors"
            classList={{
              "text-text-base border-b-2 border-accent-primary -mb-px": tab() === t,
              "text-text-weak hover:text-text-base": tab() !== t,
            }}
            onClick={() => setTab(t)}
          >
            {t === "changes" ? language.t("sourceControl.changes") : language.t("sourceControl.history")}
            <Show when={t === "changes" && state.files.length > 0}>
              <span class="ml-1 text-10-regular text-text-weaker">({state.files.length})</span>
            </Show>
          </button>
        ))}
      </div>

      {/* ── Changes tab ── */}
      <Show when={tab() === "changes"}>
        <div class="flex-1 overflow-y-auto min-h-0">
          {/* Staged files */}
          <Show when={staged().length > 0}>
            <div class="px-3 pt-2 pb-1 flex items-center justify-between">
              <span class="text-11-medium text-text-weak uppercase tracking-wide">
                {language.t("sourceControl.staging")} ({staged().length})
              </span>
              <button
                class="text-10-regular text-text-weaker hover:text-text-weak transition-colors"
                onClick={() => void unstageAll()}
                disabled={!!state.busy}
              >
                {language.t("sourceControl.unstageAll")}
              </button>
            </div>
            <For each={staged()}>
              {(f) => (
                <FileRow
                  file={f}
                  action="unstage"
                  onAction={() => void unstageFile(f.path)}
                  onOpen={() => props.onOpenFile?.(f.path)}
                  busy={!!state.busy}
                />
              )}
            </For>
          </Show>

          {/* Unstaged files */}
          <Show when={unstaged().length > 0}>
            <div class="px-3 pt-2 pb-1 flex items-center justify-between">
              <span class="text-11-medium text-text-weak uppercase tracking-wide">
                {language.t("sourceControl.modifications")} ({unstaged().length})
              </span>
              <button
                class="text-10-regular text-text-weaker hover:text-text-weak transition-colors"
                onClick={() => void stageAll()}
                disabled={!!state.busy}
              >
                {language.t("sourceControl.stageAll")}
              </button>
            </div>
            <For each={unstaged()}>
              {(f) => (
                <FileRow
                  file={f}
                  action="stage"
                  onAction={() => void stageFile(f.path)}
                  onOpen={() => props.onOpenFile?.(f.path)}
                  busy={!!state.busy}
                />
              )}
            </For>
          </Show>

          <Show when={state.files.length === 0 && !state.loading}>
            <div class="p-4 text-center text-text-weaker">{language.t("sourceControl.noChanges")}</div>
          </Show>
        </div>

        {/* ── Commit area ── */}
        <div class="border-t border-border-main p-2 flex flex-col gap-2">
          <textarea
            class="w-full text-12-regular bg-bg-input border border-border-input rounded px-2 py-1.5 resize-none text-text-base placeholder:text-text-weaker focus:outline-none focus:ring-1 focus:ring-accent-primary/40"
            rows={2}
            placeholder={language.t("sourceControl.commitPlaceholder")}
            value={state.commitMessage}
            onInput={(e) => setState("commitMessage", e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                void commitChanges()
              }
            }}
          />

          <div class="flex gap-1.5">
            <button
              class="flex-1 px-2 py-1 text-11-medium rounded bg-accent-primary text-white hover:bg-accent-primary/90 disabled:opacity-40 transition-colors"
              onClick={() => void commitChanges()}
              disabled={!!state.busy || staged().length === 0 || !state.commitMessage.trim()}
            >
              {language.t("sourceControl.commit")}
            </button>
            <button
              class="px-2 py-1 text-11-regular rounded border border-border-main text-text-weak hover:text-text-base hover:bg-bg-hover disabled:opacity-40 transition-colors"
              onClick={() => void pullChanges()}
              disabled={!!state.busy}
              title={language.t("sourceControl.pull")}
            >
              {language.t("sourceControl.pull")}
            </button>
            <button
              class="px-2 py-1 text-11-regular rounded border border-border-main text-text-weak hover:text-text-base hover:bg-bg-hover disabled:opacity-40 transition-colors"
              onClick={() => void pushChanges()}
              disabled={!!state.busy}
              title={language.t("sourceControl.push")}
            >
              {language.t("sourceControl.push")}
            </button>
          </div>
        </div>
      </Show>

      {/* ── Log tab ── */}
      <Show when={tab() === "log"}>
        <div class="flex-1 overflow-y-auto min-h-0">
          <Show when={state.logLoading}>
            <div class="p-4 text-center text-text-weaker">{language.t("sourceControl.loading")}</div>
          </Show>
          <Show when={!state.logLoading && state.log.length === 0}>
            <div class="p-4 text-center text-text-weaker">{language.t("sourceControl.noCommits")}</div>
          </Show>
          <For each={state.log}>
            {(entry) => (
              <div class="px-3 py-2 border-b border-border-faint hover:bg-bg-hover group">
                <div class="flex items-start gap-2">
                  <span class="font-mono text-10-regular text-text-weaker shrink-0 mt-0.5 w-[44px]">
                    {entry.shortHash}
                  </span>
                  <span class="text-12-regular text-text-base leading-tight line-clamp-2 flex-1">
                    {entry.subject}
                  </span>
                </div>
                <div class="mt-0.5 pl-[52px] flex items-center gap-2 text-10-regular text-text-weaker">
                  <span class="truncate max-w-[80px]">{entry.author}</span>
                  <span>·</span>
                  <span>{formatAge(entry.timestamp, language)}</span>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function FileRow(props: {
  file: FileStatus
  action: "stage" | "unstage"
  onAction: () => void
  onOpen: () => void
  busy: boolean
}) {
  const language = useLanguage()
  const label = () => (props.action === "stage" ? language.t("sourceControl.stage") : language.t("sourceControl.unstage"))
  const filename = () => {
    const parts = props.file.path.split(/[/\\]/)
    return parts[parts.length - 1] ?? props.file.path
  }
  const dirpart = () => {
    const parts = props.file.path.split(/[/\\]/)
    return parts.length > 1 ? parts.slice(0, -1).join("/") + "/" : ""
  }

  return (
    <div class="group flex items-center px-3 py-1 hover:bg-bg-hover gap-1.5">
      <span class={`text-11-mono shrink-0 w-[14px] text-center font-medium ${kindClass(props.file.kind)}`}>
        {kindLabel(props.file.kind)}
      </span>
      <button class="flex-1 min-w-0 text-left" onClick={props.onOpen}>
        <span class="text-12-regular text-text-base truncate">{filename()}</span>
        <Show when={dirpart()}>
          <span class="ml-1 text-10-regular text-text-weaker truncate">{dirpart()}</span>
        </Show>
      </button>
      <button
        class="shrink-0 opacity-0 group-hover:opacity-100 px-1.5 py-0.5 text-10-regular text-text-weak hover:text-text-base transition-all rounded hover:bg-bg-hover-strong disabled:opacity-30"
        onClick={props.onAction}
        disabled={props.busy}
        title={label()}
      >
        {props.action === "stage" ? "+" : "−"}
      </button>
    </div>
  )
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatAge(unixSeconds: number, language: ReturnType<typeof useLanguage>): string {
  const diff = Math.floor(Date.now() / 1000) - unixSeconds
  if (diff < 60) return language.t("sourceControl.justNow")
  if (diff < 3600) return language.t("sourceControl.minutesAgo", { count: Math.floor(diff / 60) })
  if (diff < 86400) return language.t("sourceControl.hoursAgo", { count: Math.floor(diff / 3600) })
  if (diff < 86400 * 30) return language.t("sourceControl.daysAgo", { count: Math.floor(diff / 86400) })
  return new Date(unixSeconds * 1000).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })
}
