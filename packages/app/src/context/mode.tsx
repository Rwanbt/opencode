import { createMemo, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { useLocation, useNavigate } from "@solidjs/router"
import { createSimpleContext } from "@unifia/ui/context"
import { SHELL_MODES, type ShellMode } from "@unifia/workbench-shell/modes"
import { modeHref, parseModeLocation, sessionAdoptionPath, type AutomateAccess } from "./mode-directory"
import { Persist, persisted } from "@/utils/persist"

// ADR-1041 supersedes ADR-1033. SHELL_MODES is still the 4-entry contract
// (check-mode-registry depends on it). The Automate surface is reachable
// from the rail whenever the workspace has `workflow.run` granted; the
// decision is reactive — it tracks the connection's `grants` set so a
// rotation that adds or removes a grant updates the rail on the next
// microtask without a hard navigation.

const { use: useMode, provider: ModeContextProvider } = createSimpleContext({
  name: "Mode",
  init: () => {
    const location = useLocation()
    const navigate = useNavigate()
    // DA-UI-01 — the rail hides Automate unless the principal holds
    // `workflow.run` on the active workspace. The route remains pending while
    // the broker resolves the grant, so a deep link is not normalized away.
    //
    // The grant is PUSHED in by `AutomateGrantBridge` (directory-layout),
    // never pulled from here. Reading `useWorkspaceWorkbench()` in this
    // init inverted the provider hierarchy — `ModeProvider` is mounted in
    // `app.tsx` above the router, while `WorkspaceWorkbenchProvider` sits
    // inside `directory-layout.tsx` and takes `mode.sessionId()` as a
    // prop. A parent cannot read a context its own descendant provides:
    // the lookup threw during init and the error boundary replaced the
    // whole application, on every route.
    const [automateAccess, setAutomateAccess] = createSignal<AutomateAccess>("unknown")
    const visibleModes = createMemo<readonly ShellMode[]>(() =>
      automateAccess() === "allowed" ? SHELL_MODES : SHELL_MODES.filter((mode) => mode !== "automate"),
    )
    const isMode = (value: string | undefined): value is ShellMode =>
      !!value && SHELL_MODES.includes(value as ShellMode) && (value !== "automate" || automateAccess() !== "denied")
    const route = createMemo(() => parseModeLocation(location.pathname, location.search, automateAccess()))
    const directory = createMemo(() => route().directory)
    const sessionId = createMemo(() => {
      const current = route()
      return current.kind === "invalid" ? undefined : current.sessionId
    })
    const [pendingMode, setPendingMode] = createSignal<ShellMode>()
    const [preferences, setPreferences] = persisted(
      Persist.global("shell-modes", ["shell-modes.v1"]),
      createStore<{ lastModeByWorkspace: Record<string, ShellMode> }>({ lastModeByWorkspace: {} }),
    )
    const active = createMemo<ShellMode>(() => {
      const routeMode = route().mode
      return isMode(routeMode) ? routeMode : "code"
    })

    function select(mode: ShellMode): void {
      if (route().kind === "home") {
        setPendingMode(mode)
        return
      }
      const path = modeHref(route(), mode)
      if (!path) return
      setPreferences("lastModeByWorkspace", directory(), mode)
      navigate(path)
    }

    /**
     * Records a session the app just created into the current location.
     *
     * WHY it belongs here: the route is the only carrier that survives a mode
     * change — `modeHref` already forwards `sessionId` both ways. A session
     * created inside a surface and kept in that surface's own signal is
     * invisible to the next mode, which then starts a second conversation for
     * the same project. `replace` because the user did not navigate; the app
     * is naming where it already is.
     */
    function adoptSession(sessionId: string): void {
      const path = sessionAdoptionPath(route(), active(), sessionId)
      if (!path) return
      navigate(path, { replace: true })
    }

    function hrefFor(workspace: string, mode: ShellMode): string | undefined {
      return modeHref({ kind: "workspace-root", directory: workspace, mode: "code" }, mode)
    }

    function preferredMode(workspace: string): ShellMode {
      const value = preferences.lastModeByWorkspace[workspace]
      return isMode(value) ? value : "code"
    }

    return {
      modes: visibleModes,
      /**
       * Reports whether the active workspace grants `workflow.run`.
       *
       * Only `AutomateGrantBridge` calls this. It is a setter rather than a
       * read of the workbench context because of the hierarchy described
       * above; see `automate-flag.ts` for the predicate itself.
       */
       setAutomateAccess,
       automateAccess,
      active,
      select,
      directory,
      sessionId,
      adoptSession,
      routeKind: () => route().kind,
      pendingMode,
      cancelPendingMode: () => setPendingMode(undefined),
      takePendingMode: () => {
        const value = pendingMode()
        setPendingMode(undefined)
        return value
      },
      hrefFor,
      preferredMode,
    }
  },
})

export { useMode }
export const ModeProvider = ModeContextProvider
