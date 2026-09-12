/* SPDX-License-Identifier: MIT */

import { For, Show, createEffect, untrack, type JSX } from "solid-js"
import { useLocation, useNavigate } from "@solidjs/router"
import {
  closestCenter,
  createSortable,
  DragDropProvider,
  DragDropSensors,
  SortableProvider,
  type DragEvent,
} from "@thisbeyond/solid-dnd"
import { ConstrainDragYAxis } from "@/utils/solid-dnd"
import { useWorkspaceTabs } from "@/context/workspace-tabs-provider"
import { useGlobalSync } from "@/context/global-sync"
import { ENTRY_TAB_ID, type WorkspaceTab } from "@/context/workspace-tabs"
import { decodeBase64Segment, routeToWorkspaceTab } from "@/components/workspace-tabs-route"

/**
 * Phase 5 / 11 — Barre d'onglets d'espace de travail.
 *
 * Position : en haut de la fenêtre, juste sous le titlebar. C'est le
 * choix fait par Open Design (`.workspace-tabs-chrome.app-chrome-header`,
 * 38 px de haut) et le pattern navigateur web : un onglet par espace
 * de travail, séparé du rail d'icônes (qui choisit le mode dans un
 * espace). Deux axes orthogonaux : ne pas fusionner.
 *
 * Règles respectées :
 * - Entry (Accueil) est non fermable, toujours premier, et n'est pas
 *   draggable — elle est rendue hors du `DragDropProvider`, exactement
 *   comme le bouton "Nouveau workspace" dans `sidebar-panel.tsx` est
 *   rendu hors de la zone sortable des workspaces.
 * - Cliquer sur un onglet navigue vers son `href` ET l'active.
 * - Cliquer sur × ferme un onglet (sauf entry). La fermeture du
 *   dernier project ramène l'utilisateur sur entry.
 * - L'URL courante est synchronisée avec l'état : naviguer vers
 *   un projet ouvre/met à jour son onglet, naviguer vers la home
 *   active l'entry. `openWorkspaceTab` est idempotent (active
 *   l'existant au lieu de dupliquer), donc la boucle onglet → URL
 *   → onglet converge en une seule mutation.
 * - Phase 11.1 : les onglets project sont réordonnables par
 *   glisser-déposer (axe horizontal contraint via `ConstrainDragYAxis`
 *   — même pattern que la barre latérale des workspaces, qui contraint
 *   l'axe X puisqu'elle est verticale).
 * - Phase 11.3 : le titre affiché d'un onglet project est calculé à la
 *   lecture (`friendlyTabTitle`) à partir de la branche VCS du
 *   workspace quand elle est connue, plutôt que figé dans `tab.title`
 *   au premier `open()` — sinon le titre resterait le nom de dossier
 *   brut même une fois la branche chargée de façon asynchrone.
 */
export function WorkspaceTabsBar(): JSX.Element {
  const tabs = useWorkspaceTabs()
  const globalSync = useGlobalSync()
  const navigate = useNavigate()
  const location = useLocation()

  function isActive(tab: WorkspaceTab): boolean {
    // L'entry est actif quand on est sur la home. Les projects sont
    // actifs quand leur `href` correspond à l'URL courante (avec ou
    // sans session). La comparaison exacte évite les faux positifs
    // entre deux projets qui partagent un prefix.
    if (tab.id === ENTRY_TAB_ID) {
      return location.pathname === "/" || location.pathname === ""
    }
    return location.pathname.startsWith(tab.href.split("/").slice(0, 3).join("/"))
  }

  function activate(tab: WorkspaceTab): void {
    tabs.activate(tab.id)
    if (location.pathname + location.search !== tab.href) {
      navigate(tab.href)
    }
  }

  function close(tab: WorkspaceTab): void {
    tabs.close(tab.id)
    // Si on ferme l'onglet actif, on saute vers l'onglet suivant. Le
    // hook useWorkspaceTabs a déjà mis à jour activeId ; il reste à
    // naviguer si l'URL courante pointe vers l'onglet fermé.
    if (isActive(tab)) {
      const next = tabs.state.tabs.find((t) => t.id === tabs.state.activeId)
      if (next) navigate(next.href)
    }
  }

  // Phase 11.1 / V07 — réordonnancement par glisser-déposer.
  //
  // Avant V07 ce handler était branché sur `onDragOver` et appelait
  // `tabs.reorder(...)` à chaque mouvement : un commit par frame. Le
  // problème : pendant un resize (1440 -> 375), le `SortableProvider`
  // re-render avec une nouvelle liste d'ids, et un `onDragOver` qui
  // arrive APRÈS ce re-render pointe sur un `droppable.id` qui n'est
  // plus dans la liste — d'où les warnings "nonexistent droppable"
  // et "nonexistent draggable" que l'audit F-06 a relevés.
  //
  // V07 — la politique devient :
  //   1. `onDragOver` ne commit plus : on garde un signal local
  //      `dragOverId` (l'id du droppable survolé) pour le feedback
  //      visuel éventuel, mais aucune mutation du store.
  //   2. Le commit arrive dans `onDragEnd`, une seule fois, sur la
  //      cible finale. Le `droppable` y est toujours vivant (le drag
  //      est terminé), donc pas de course avec le re-render.
  //   3. `onDragEnd` filtre les ids orphelins : si pour une raison
  //      quelconque le droppable n'est plus dans le store, on ignore
  //      l'événement plutôt que d'appeler `reorder(undefined, -1)`
  //      et de polluer la console.
  //   4. `console.warn` reste actif — la discipline du plan est de
  //      *ne pas* masquer les warnings. La vraie correction est de
  //      supprimer la cause.
  function handleDragOver(event: DragEvent): void {
    // No-op on purpose : we do not commit during drag-over anymore.
    // The SortableProvider still drives the visual transform via
    // `use:sortable`; we only need the final drop to mutate the
    // store, which happens in `handleDragEnd`.
    void event
  }
  function handleDragEnd(event: DragEvent): void {
    const { draggable, droppable } = event
    if (!draggable || !droppable) return
    const fromId = draggable.id.toString()
    const toId = droppable.id.toString()
    if (fromId === toId) return
    // Guard: a droppable that is no longer in the store would log
    // a "nonexistent droppable" warning inside solid-dnd. We
    // pre-check here so the warning stays meaningful for genuine
    // bugs and not for a benign resize race.
    const toIndex = tabs.state.tabs.findIndex((t) => t.id === toId)
    if (toIndex === -1) return
    const fromStillPresent = tabs.state.tabs.some((t) => t.id === fromId)
    if (!fromStillPresent) return
    tabs.reorder(fromId, toIndex)
  }

  // P5-2 — un onglet project porte une route complète. Quand la
  // navigation arrive sur un projet, on ouvre ou on active son
  // onglet. Quand la navigation arrive sur la home, on active
  // l'entry. L'effet lit `location.pathname` (signal), donc il se
  // déclenche à chaque changement d'URL.
  /**
   * WHY the body is `untrack`ed and lives in a pure module: `tabs.open` and
   * `tabs.activate` READ the store before writing it, so running them inside
   * the effect's tracking scope made the effect its own dependency. Every write
   * produced a fresh state object, so the effect re-entered itself thousands of
   * times per navigation — one mode switch blocked the main thread for ~10 s in
   * a single task (measured 2026-08-28: ~9 700 base64 decodes and ~26 000
   * attribute writes per switch, 0 network requests).
   *
   * The route is the only input; the store is a destination, never a source.
   * The rule itself is unit-tested in `workspace-tabs-route.test.ts`.
   */
  createEffect(() => {
    const path = location.pathname
    const search = location.search
    untrack(() => routeToWorkspaceTab({ path, search, tabs, now: Date.now() }))
  })

  // Phase 11.3 — titre "amical" calculé à la lecture depuis la branche
  // VCS du workspace, quand elle est connue. `tab.title` (le nom de
  // dossier décodé, figé à l'ouverture) reste le fallback tant que la
  // branche n'a pas encore été chargée par `globalSync`.
  function friendlyTabTitle(tab: WorkspaceTab): string {
    if (tab.kind !== "project") return tab.title
    const directory = decodeBase64Segment(tab.id)
    if (!directory) return tab.title
    const [data] = globalSync.child(directory, { bootstrap: false })
    return data.vcs?.branch || tab.title
  }

  const entryTab = () => tabs.state.tabs.find((t) => t.kind === "entry")
  const projectTabs = () => tabs.state.tabs.filter((t) => t.kind === "project")
  const projectIds = () => projectTabs().map((t) => t.id)

  return (
    <div
      class="flex h-9 shrink-0 items-center gap-1 border-b border-border-base bg-background-stronger px-2"
      role="tablist"
      aria-label="Espaces de travail ouverts"
      data-workspace-tabs-bar
    >
      <Show when={entryTab()}>
        {(tab) => (
          <TabRow
            tab={tab()}
            title={friendlyTabTitle(tab())}
            active={isActive(tab())}
            onActivate={() => activate(tab())}
            onClose={() => close(tab())}
          />
        )}
      </Show>
      <DragDropProvider onDragOver={handleDragOver} onDragEnd={handleDragEnd} collisionDetector={closestCenter}>
        <DragDropSensors />
        <ConstrainDragYAxis />
        <SortableProvider ids={projectIds()}>
          <For each={projectTabs()}>
            {(tab) => (
              <SortableTabRow
                tab={tab}
                title={friendlyTabTitle(tab)}
                active={isActive(tab)}
                onActivate={() => activate(tab)}
                onClose={() => close(tab)}
              />
            )}
          </For>
        </SortableProvider>
      </DragDropProvider>
    </div>
  )
}

type TabRowProps = {
  tab: WorkspaceTab
  title: string
  active: boolean
  onActivate: () => void
  onClose: () => void
}

/** Markup partagé entre l'entry (non draggable) et les onglets project (draggables). */
function TabInner(props: TabRowProps): JSX.Element {
  return (
    <>
      <button
        type="button"
        class="flex h-7 items-center gap-1 px-1"
        data-workspace-tab-button={props.tab.id}
        onClick={props.onActivate}
        title={props.tab.href}
      >
        <span class="truncate max-w-[160px]">{props.title}</span>
      </button>
      <Show when={props.tab.closable}>
        <button
          type="button"
          aria-label={`Fermer ${props.title}`}
          class="rounded p-1 text-12-regular text-text-weak hover:bg-border-base hover:text-text-base"
          data-workspace-tab-close={props.tab.id}
          onClick={props.onClose}
        >
          ×
        </button>
      </Show>
    </>
  )
}

function TabRow(props: TabRowProps): JSX.Element {
  return (
    <div
      class="flex min-h-11 items-center gap-1 rounded px-2 text-12-medium transition-colors motion-reduce:transition-none focus-within:outline focus-within:outline-2 focus-within:outline-offset-[-2px] focus-within:outline-border-focus"
      classList={{
        "bg-background-base text-text-base": props.active,
        "text-text-weak hover:bg-background-base": !props.active,
      }}
      data-workspace-tab={props.tab.id}
      data-workspace-tab-kind={props.tab.kind}
      data-workspace-tab-active={props.active ? "true" : "false"}
      role="tab"
      aria-selected={props.active}
    >
      <TabInner {...props} />
    </div>
  )
}

function SortableTabRow(props: TabRowProps): JSX.Element {
  const sortable = createSortable(props.tab.id)
  return (
    <div
      use:sortable
      class="flex min-h-11 items-center gap-1 rounded px-2 text-12-medium transition-colors motion-reduce:transition-none focus-within:outline focus-within:outline-2 focus-within:outline-offset-[-2px] focus-within:outline-border-focus"
      classList={{
        "bg-background-base text-text-base": props.active,
        "text-text-weak hover:bg-background-base": !props.active,
        "opacity-30": sortable.isActiveDraggable,
      }}
      data-workspace-tab={props.tab.id}
      data-workspace-tab-kind={props.tab.kind}
      data-workspace-tab-active={props.active ? "true" : "false"}
      role="tab"
      aria-selected={props.active}
    >
      <TabInner {...props} />
    </div>
  )
}

