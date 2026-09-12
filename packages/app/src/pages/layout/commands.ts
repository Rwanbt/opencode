/**
 * Layout command registrations.
 *
 * Extracted from layout.tsx — call `registerLayoutCommands(deps)` once
 * inside the Layout component after all local functions are defined.
 */
import type { Accessor } from "solid-js"
import { showToast } from "@unifia/ui/toast"
import type { useCommand, CommandOption } from "@/context/command"
import type { useLayout } from "@/context/layout"
import type { useLanguage } from "@/context/language"
import type { useTheme, ColorScheme } from "@unifia/ui/theme/context"
import type { Session } from "../../types/sdk-shim"
import type { LocalProject } from "@/context/layout"
import type { useWorkspaceTabs } from "@/context/workspace-tabs-provider"
import {
  isActiveWorkspaceTabClosable,
  nextWorkspaceTabId,
  previousWorkspaceTabId,
  workspaceTabIdAtPosition,
} from "@/context/workspace-tabs"

export interface LayoutCommandsDeps {
  command: ReturnType<typeof useCommand>
  layout: ReturnType<typeof useLayout>
  language: ReturnType<typeof useLanguage>
  theme: ReturnType<typeof useTheme>
  /** Reactive accessor */
  params: { dir?: string; id?: string }
  /** Reactive accessor */
  currentSessions: Accessor<Session[]>
  /** Reactive accessor */
  currentProject: Accessor<LocalProject | undefined>
  /** Reactive accessor */
  workspaceSetting: Accessor<boolean>
  /** Reactive accessor — available [id, theme] pairs */
  availableThemeEntries: Accessor<readonly (readonly [string, any])[]>
  colorSchemeOrder: ColorScheme[]
  colorSchemeLabel: (scheme: ColorScheme) => string
  /** Phase 11.2 — état + mutateurs de la barre d'onglets d'espace de travail. */
  workspaceTabs: ReturnType<typeof useWorkspaceTabs>
  /** Navigue vers un `href` d'onglet (ex. `useNavigate()` de solid-router). */
  navigateToHref: (href: string) => void
  // Action functions
  chooseProject: () => void
  navigateProjectByOffset: (offset: number) => void
  navigateSessionByOffset: (offset: number) => void
  navigateSessionByUnseen: (offset: number) => void
  archiveSession: (session: Session) => Promise<void>
  createWorkspace: (project: LocalProject) => Promise<void>
  cycleTheme: (direction?: number) => void
  cycleColorScheme: (direction?: number) => void
  cycleLanguage: (direction?: number) => void
  setLocale: (locale: any) => void
  connectProvider: () => void
  openServer: () => void
  openSettings: () => void
  openTeam: () => void
}

/**
 * Phase 11.2 — active un onglet et navigue vers son `href`. Utilisé par
 * les raccourcis clavier (ctrl+tab / ctrl+shift+tab / ctrl+1..9), qui
 * n'ont pas de bouton à cliquer comme la barre d'onglets : ils doivent
 * reproduire le même couple activate+navigate que `WorkspaceTabsBar`.
 * No-op si `id` est `undefined` (onglet cible introuvable) ou si
 * l'onglet a disparu entre le calcul de l'id et l'exécution.
 */
function goToWorkspaceTab(
  workspaceTabs: ReturnType<typeof useWorkspaceTabs>,
  navigateToHref: (href: string) => void,
  id: string | undefined,
): void {
  if (!id) return
  const tab = workspaceTabs.state.tabs.find((t) => t.id === id)
  if (!tab) return
  workspaceTabs.activate(id)
  navigateToHref(tab.href)
}

export function registerLayoutCommands(deps: LayoutCommandsDeps) {
  const {
    command,
    layout,
    language,
    theme,
    params,
    currentSessions,
    currentProject,
    workspaceSetting,
    availableThemeEntries,
    colorSchemeOrder,
    colorSchemeLabel,
    workspaceTabs,
    navigateToHref,
    chooseProject,
    navigateProjectByOffset,
    navigateSessionByOffset,
    navigateSessionByUnseen,
    archiveSession,
    createWorkspace,
    cycleTheme,
    cycleColorScheme,
    cycleLanguage,
    setLocale,
    connectProvider,
    openServer,
    openSettings,
    openTeam,
  } = deps

  command.register("layout", () => {
    const commands: CommandOption[] = [
      {
        id: "sidebar.toggle",
        title: language.t("command.sidebar.toggle"),
        category: language.t("command.category.view"),
        keybind: "mod+b",
        onSelect: () => layout.sidebar.toggle(),
      },
      {
        id: "project.open",
        title: language.t("command.project.open"),
        category: language.t("command.category.project"),
        keybind: "mod+o",
        onSelect: () => chooseProject(),
      },
      {
        id: "project.previous",
        title: language.t("command.project.previous"),
        category: language.t("command.category.project"),
        keybind: "mod+alt+arrowup",
        onSelect: () => navigateProjectByOffset(-1),
      },
      {
        id: "project.next",
        title: language.t("command.project.next"),
        category: language.t("command.category.project"),
        keybind: "mod+alt+arrowdown",
        onSelect: () => navigateProjectByOffset(1),
      },
      {
        id: "provider.connect",
        title: language.t("command.provider.connect"),
        category: language.t("command.category.provider"),
        onSelect: () => connectProvider(),
      },
      {
        id: "server.switch",
        title: language.t("command.server.switch"),
        category: language.t("command.category.server"),
        onSelect: () => openServer(),
      },
      {
        id: "settings.open",
        title: language.t("command.settings.open"),
        category: language.t("command.category.settings"),
        keybind: "mod+comma",
        onSelect: () => openSettings(),
      },
      {
        id: "team.open",
        title: language.t("team.selector.title"),
        category: language.t("command.category.view"),
        onSelect: () => openTeam(),
      },
      {
        id: "session.previous",
        title: language.t("command.session.previous"),
        category: language.t("command.category.session"),
        keybind: "alt+arrowup",
        onSelect: () => navigateSessionByOffset(-1),
      },
      {
        id: "session.next",
        title: language.t("command.session.next"),
        category: language.t("command.category.session"),
        keybind: "alt+arrowdown",
        onSelect: () => navigateSessionByOffset(1),
      },
      {
        id: "session.previous.unseen",
        title: language.t("command.session.previous.unseen"),
        category: language.t("command.category.session"),
        keybind: "shift+alt+arrowup",
        onSelect: () => navigateSessionByUnseen(-1),
      },
      {
        id: "session.next.unseen",
        title: language.t("command.session.next.unseen"),
        category: language.t("command.category.session"),
        keybind: "shift+alt+arrowdown",
        onSelect: () => navigateSessionByUnseen(1),
      },
      {
        id: "session.archive",
        title: language.t("command.session.archive"),
        category: language.t("command.category.session"),
        keybind: "mod+shift+backspace",
        disabled: !params.dir || !params.id,
        onSelect: () => {
          const session = currentSessions().find((s) => s.id === params.id)
          if (session) archiveSession(session)
        },
      },
      {
        id: "workspace.new",
        title: language.t("workspace.new"),
        category: language.t("command.category.workspace"),
        keybind: "mod+shift+w",
        disabled: !workspaceSetting(),
        onSelect: () => {
          const project = currentProject()
          if (!project) return
          return createWorkspace(project)
        },
      },
      {
        id: "workspace.toggle",
        title: language.t("command.workspace.toggle"),
        description: language.t("command.workspace.toggle.description"),
        category: language.t("command.category.workspace"),
        slash: "workspace",
        disabled: !currentProject() || currentProject()?.vcs !== "git",
        onSelect: () => {
          const project = currentProject()
          if (!project) return
          if (project.vcs !== "git") return
          const wasEnabled = layout.sidebar.workspaces(project.worktree)()
          layout.sidebar.toggleWorkspaces(project.worktree)
          showToast({
            title: wasEnabled
              ? language.t("toast.workspace.disabled.title")
              : language.t("toast.workspace.enabled.title"),
            description: wasEnabled
              ? language.t("toast.workspace.disabled.description")
              : language.t("toast.workspace.enabled.description"),
          })
        },
      },
      {
        id: "workspaceTab.next",
        title: language.t("command.workspaceTab.next"),
        category: language.t("command.category.workspace"),
        keybind: "ctrl+tab",
        onSelect: () => goToWorkspaceTab(workspaceTabs, navigateToHref, nextWorkspaceTabId(workspaceTabs.state)),
      },
      {
        id: "workspaceTab.previous",
        title: language.t("command.workspaceTab.previous"),
        category: language.t("command.category.workspace"),
        keybind: "ctrl+shift+tab",
        onSelect: () =>
          goToWorkspaceTab(workspaceTabs, navigateToHref, previousWorkspaceTabId(workspaceTabs.state)),
      },
      {
        id: "workspaceTab.close",
        title: language.t("command.workspaceTab.close"),
        category: language.t("command.category.workspace"),
        keybind: "ctrl+w",
        disabled: !isActiveWorkspaceTabClosable(workspaceTabs.state),
        onSelect: () => {
          if (!isActiveWorkspaceTabClosable(workspaceTabs.state)) return
          workspaceTabs.close(workspaceTabs.state.activeId)
          const active = workspaceTabs.state.tabs.find((t) => t.id === workspaceTabs.state.activeId)
          if (active) navigateToHref(active.href)
        },
      },
      {
        id: "theme.cycle",
        title: language.t("command.theme.cycle"),
        category: language.t("command.category.theme"),
        keybind: "mod+shift+t",
        onSelect: () => cycleTheme(1),
      },
    ]

    // Phase 11.2 — ctrl+1..ctrl+9, un raccourci par position d'onglet
    // (entry comprise, donc ctrl+1 cible toujours l'entry). `disabled`
    // quand la position dépasse le nombre d'onglets ouverts : la
    // commande reste dans la palette (visibilité) mais son keybind
    // n'est pas enregistré (voir `keymap` dans context/command.tsx,
    // qui ignore les options `disabled`).
    for (let position = 1; position <= 9; position++) {
      commands.push({
        id: `workspaceTab.goto.${position}`,
        title: language.t("command.workspaceTab.goto", { n: position }),
        category: language.t("command.category.workspace"),
        keybind: `ctrl+${position}`,
        disabled: workspaceTabIdAtPosition(workspaceTabs.state, position) === undefined,
        onSelect: () =>
          goToWorkspaceTab(workspaceTabs, navigateToHref, workspaceTabIdAtPosition(workspaceTabs.state, position)),
      })
    }

    for (const [id] of availableThemeEntries()) {
      commands.push({
        id: `theme.set.${id}`,
        title: language.t("command.theme.set", { theme: theme.name(id) }),
        category: language.t("command.category.theme"),
        onSelect: () => theme.commitPreview(),
        onHighlight: () => {
          theme.previewTheme(id)
          return () => theme.cancelPreview()
        },
      })
    }

    commands.push({
      id: "theme.scheme.cycle",
      title: language.t("command.theme.scheme.cycle"),
      category: language.t("command.category.theme"),
      keybind: "mod+shift+s",
      onSelect: () => cycleColorScheme(1),
    })

    for (const scheme of colorSchemeOrder) {
      commands.push({
        id: `theme.scheme.${scheme}`,
        title: language.t("command.theme.scheme.set", { scheme: colorSchemeLabel(scheme) }),
        category: language.t("command.category.theme"),
        onSelect: () => theme.commitPreview(),
        onHighlight: () => {
          theme.previewColorScheme(scheme)
          return () => theme.cancelPreview()
        },
      })
    }

    commands.push({
      id: "language.cycle",
      title: language.t("command.language.cycle"),
      category: language.t("command.category.language"),
      onSelect: () => cycleLanguage(1),
    })

    for (const locale of language.locales) {
      commands.push({
        id: `language.set.${locale}`,
        title: language.t("command.language.set", { language: language.label(locale) }),
        category: language.t("command.category.language"),
        onSelect: () => setLocale(locale),
      })
    }

    return commands
  })
}
