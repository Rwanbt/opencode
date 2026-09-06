import { DataProvider } from "@unifia/ui/context"
import { showToast } from "@unifia/ui/toast"
import { base64Encode } from "@unifia/util/encode"
import { useLocation, useNavigate, useParams } from "@solidjs/router"
import { createEffect, createMemo, onCleanup, onMount, type ParentProps, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { LocalProvider } from "@/context/local"
import { SDKProvider } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { TeamProvider } from "@/context/team"
import { decode64 } from "@/utils/base64"
// FORK: editor context (ADR-0005)
import { EditorProvider, EditorTabCleanup } from "@/context/editor"
// Phase 5.5: LSP diagnostics store (lives alongside SyncProvider so the listener
// auto-tears-down on directory change).
import { LspDiagnosticsProvider } from "@/context/lsp-diagnostics"
// FileStoreProvider lives at directory scope (sibling of SDKProvider) so EditorProvider
// (which calls useFileStore) sees it as an ancestor. Fix: pre-flight-0-filestore-scope.
import { FileStoreProvider } from "@/context/file/store"
import { WorkspaceWorkbenchProvider, useWorkspaceWorkbench } from "@/context/workbench/provider"
import { isAutomateAccessible } from "@/context/automate-flag"
import { TerminalProvider } from "@/context/terminal"
import { useMode } from "@/context/mode"

/**
 * DA-UI-01 — mirrors the connection's capability grants into the mode context.
 *
 * The rail's Automate entry is gated on `workflow.run`, which only the
 * workbench connection knows. `ModeProvider` cannot read that connection:
 * it is mounted above the router in `app.tsx`, and
 * `WorkspaceWorkbenchProvider` — mounted here — consumes `mode.sessionId()`.
 * Making the mode context read the workbench closed that loop and threw on
 * every route. This component sits on the child side of the boundary, where
 * both contexts are in scope, and pushes the decision upward.
 *
 * Resetting on cleanup matters: leaving the workspace must take Automate out
 * of the rail again, or a workspace without the grant inherits the previous
 * one's visibility.
 */
function AutomateGrantBridge(props: ParentProps) {
  const workbench = useWorkspaceWorkbench()
  const mode = useMode()
  onMount(() => {
    let current = true
    mode.setAutomateAccess("unknown")
    // A direct Automate deep link cannot mount AutomateSurface until the grant
    // is known, so connect here at the provider boundary to avoid a cold-load
    // deadlock. Unsupported web runtimes remain fail-closed in the provider.
    void workbench.ensureConnected().then(
      (connection) => {
        if (current) {
          mode.setAutomateAccess(isAutomateAccessible(connection.grants) ? "allowed" : "denied")
        }
      },
      () => {
        if (current) mode.setAutomateAccess("denied")
      },
    )
    onCleanup(() => { current = false })
  })
  return <>{props.children}</>
}

function DirectoryDataProvider(props: ParentProps<{ directory: string }>) {
  const location = useLocation()
  const navigate = useNavigate()
  const params = useParams()
  const sync = useSync()
  const slug = createMemo(() => base64Encode(props.directory))

  createEffect(() => {
    const next = sync.data.path.directory
    if (!next || next === props.directory) return
    const path = location.pathname.slice(slug().length + 1)
    navigate(`/${base64Encode(next)}${path}${location.search}${location.hash}`, { replace: true })
  })

  createEffect(() => {
    const id = params.id
    if (!id) return
    void sync.session.sync(id)
  })

  return (
    <DataProvider
      data={sync.data}
      directory={props.directory}
      onNavigateToSession={(sessionID: string) => navigate(`/${slug()}/session/${sessionID}`)}
      onSessionHref={(sessionID: string) => `/${slug()}/session/${sessionID}`}
    >
      <LocalProvider>
        {/* FORK: editor store scoped to the current directory (ADR-0005) */}
        <EditorProvider>
          {/* Phase 2.6: drop editor entries when their file tab closes. */}
          <EditorTabCleanup />
          {props.children}
        </EditorProvider>
      </LocalProvider>
    </DataProvider>
  )
}

export default function Layout(props: ParentProps) {
  const params = useParams()
  const mode = useMode()
  const language = useLanguage()
  const navigate = useNavigate()
  let invalid = ""

  const resolved = createMemo(() => {
    if (!params.dir) return ""
    return decode64(params.dir) ?? ""
  })

  createEffect(() => {
    const dir = params.dir
    if (!dir) return
    if (resolved()) {
      invalid = ""
      return
    }
    if (invalid === dir) return
    invalid = dir
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: language.t("directory.error.invalidUrl"),
    })
    navigate("/", { replace: true })
  })

  return (
    <Show when={resolved()} keyed>
      {(resolved) => (
        <SDKProvider directory={() => resolved}>
          <FileStoreProvider>
            <SyncProvider>
              <LspDiagnosticsProvider>
                <TeamProvider>
                  <DirectoryDataProvider directory={resolved}>
                    {/* Terminals are workspace-scoped (getWorkspaceTerminalCacheKey keys
                        on the directory, and the session id is optional), so the provider
                        belongs to the directory, not to one route under it. It used to sit
                        in SessionProviders, which wraps SessionRoute only — Design's
                        Terminal tab therefore threw "Terminal context must be used within
                        a context provider" the moment it mounted, and switching Code→Design
                        disposed every open terminal. */}
                    <TerminalProvider>
                      <WorkspaceWorkbenchProvider workspacePath={resolved} codeSessionId={mode.sessionId()}>
                        <AutomateGrantBridge>{props.children}</AutomateGrantBridge>
                      </WorkspaceWorkbenchProvider>
                    </TerminalProvider>
                  </DirectoryDataProvider>
                </TeamProvider>
              </LspDiagnosticsProvider>
            </SyncProvider>
          </FileStoreProvider>
        </SDKProvider>
      )}
    </Show>
  )
}
