/* SPDX-License-Identifier: MIT */

import { type JSX, type ParentProps, createContext, createMemo, createSignal, onCleanup, onMount, useContext } from "solid-js"
import { createStore, type SetStoreFunction } from "solid-js/store"
import { createPersistWriteMonitor } from "@/utils/persist-write-monitor"
import { createDebouncedPersist } from "./workspace-tabs-persist"
import {
  ENTRY_TAB_ID,
  emptyWorkspaceTabState,
  openWorkspaceTab,
  closeWorkspaceTab as reduceCloseTab,
  activateWorkspaceTab as reduceActivateTab,
  touchWorkspaceTab as reduceTouchTab,
  reorderWorkspaceTab as reduceReorderTab,
  deserializeWorkspaceTabState,
  serializeWorkspaceTabState,
  WORKSPACE_TABS_STORAGE_KEY,
  type WorkspaceTab,
  type WorkspaceTabState,
} from "@/context/workspace-tabs"

/**
 * Phase 5 — Provider Solid pour la barre d'onglets d'espace de travail.
 *
 * L'état est un store Solid (`createStore`) tenu par le provider. La
 * persistance localStorage est best-effort :
 *
 * 1. Au montage, on lit `WORKSPACE_TABS_STORAGE_KEY`. Si la valeur est
 *    un JSON valide, on l'adopte comme état initial. Sinon, on part
 *    de l'état vide (avec l'entry semé).
 * 2. À chaque changement du store, on sérialise et on écrit. Le write
 *    est debouncé (50 ms) pour éviter de marteler localStorage pendant
 *    un drag ou un re-render rapide.
 * 3. Côté `window.storage` indisponible (mode privé, SSR), l'écriture
 *    est silencieusement ignorée — l'état reste en mémoire.
 *
 * Le provider expose un `SetStoreFunction<WorkspaceTabState>` pour
 * les mutations externes (drag & drop, raccourcis clavier) en plus
 * des helpers typés. Le hook `useWorkspaceTabs()` retourne
 * `{state, setState, open, close, activate, touch}`.
 */

export type WorkspaceTabsApi = {
  state: WorkspaceTabState
  setState: SetStoreFunction<WorkspaceTabState>
  open: (tab: WorkspaceTab) => void
  close: (id: string) => void
  activate: (id: string) => void
  touch: (id: string) => void
  /** Phase 11.1 — déplace l'onglet `id` à l'index `toIndex` (voir reorderWorkspaceTab). */
  reorder: (id: string, toIndex: number) => void
  /** Recharge depuis localStorage. Utile pour les tests et le débogage. */
  reload: () => void
}

const WorkspaceTabsContext = createContext<WorkspaceTabsApi>()

function readPersistedState(): WorkspaceTabState {
  if (typeof window === "undefined" || !window.localStorage) return emptyWorkspaceTabState()
  try {
    const raw = window.localStorage.getItem(WORKSPACE_TABS_STORAGE_KEY)
    if (!raw) return emptyWorkspaceTabState()
    const restored = deserializeWorkspaceTabState(raw)
    return restored ?? emptyWorkspaceTabState()
  } catch {
    return emptyWorkspaceTabState()
  }
}

function writePersistedState(state: WorkspaceTabState): void {
  if (typeof window === "undefined" || !window.localStorage) return
  try {
    window.localStorage.setItem(WORKSPACE_TABS_STORAGE_KEY, serializeWorkspaceTabState(state))
  } catch {
    // Quota exceeded, mode privé, ou storage désactivé : on perd la
    // persistance, l'état reste en mémoire. Pas d'exception — la
    // barre continue de fonctionner pour la session courante.
  }
}

export function WorkspaceTabsProvider(props: ParentProps): JSX.Element {
  const [state, setState] = createStore<WorkspaceTabState>(readPersistedState())
  const [hydrated, setHydrated] = createSignal(false)
  const writes = import.meta.env.DEV ? createPersistWriteMonitor() : undefined

  // Hydratation : la première lecture depuis localStorage est faite
  // dans `readPersistedState()`. On ne sérialise pas avant que
  // l'hydratation soit terminée, pour éviter d'écrire l'état vide
  // initial par-dessus une valeur persistée (race condition SSR / web).
  onMount(() => {
    setHydrated(true)
  })

  // Persistance debouncée. Le debounce est volontairement court : la
  // barre peut recevoir un événement toutes les 50–100 ms pendant un
  // drag, et 50 ms lisse les rafales sans risque de perte visible.
  // The write-storm counter lives on the request side (see
  // createDebouncedPersist): counting after the debounce caps any key at
  // 20 writes/s, which a 50/s threshold can never reach.
  const persist = createDebouncedPersist<WorkspaceTabState>({
    key: WORKSPACE_TABS_STORAGE_KEY,
    write: writePersistedState,
    writes,
  })
  createMemo(() => {
    // Lire l'état pour s'abonner aux changements du store.
    const snapshot: WorkspaceTabState = { tabs: [...state.tabs], activeId: state.activeId }
    if (!hydrated()) return
    persist.schedule(snapshot)
  })
  onCleanup(() => persist.dispose())

  const api: WorkspaceTabsApi = {
    state,
    setState,
    open(tab) {
      setState(openWorkspaceTab(state, tab, Date.now()))
    },
    close(id) {
      setState(reduceCloseTab(state, id, Date.now()))
    },
    activate(id) {
      setState(reduceActivateTab(state, id, Date.now()))
    },
    touch(id) {
      setState(reduceTouchTab(state, id, Date.now()))
    },
    reorder(id, toIndex) {
      setState(reduceReorderTab(state, id, toIndex))
    },
    reload() {
      const restored = readPersistedState()
      setState(restored)
    },
  }
  return (
    <WorkspaceTabsContext.Provider value={api}>
      {props.children}
    </WorkspaceTabsContext.Provider>
  )
}

export function useWorkspaceTabs(): WorkspaceTabsApi {
  const ctx = useContext(WorkspaceTabsContext)
  if (!ctx) {
    // En dehors du provider, on retombe sur un store local jetable.
    // C'est l'équivalent du pattern "no-op outside provider" qu'on
    // utilise déjà pour `useWorkspaceWorkbench` ; le composant n'a
    // alors aucune persistance, mais il s'affiche et fonctionne
    // pour la session.
    if (typeof window === "undefined") {
      throw new Error("useWorkspaceTabs called outside of WorkspaceTabsProvider")
    }
    return createDetachedApi()
  }
  return ctx
}

function createDetachedApi(): WorkspaceTabsApi {
  const [state, setState] = createStore<WorkspaceTabState>(emptyWorkspaceTabState())
  return {
    state,
    setState,
    open(tab) {
      setState(openWorkspaceTab(state, tab, Date.now()))
    },
    close(id) {
      setState(reduceCloseTab(state, id, Date.now()))
    },
    activate(id) {
      setState(reduceActivateTab(state, id, Date.now()))
    },
    touch(id) {
      setState(reduceTouchTab(state, id, Date.now()))
    },
    reorder(id, toIndex) {
      setState(reduceReorderTab(state, id, toIndex))
    },
    reload() {
      // No-op : pas de source persistante en mode détaché.
    },
  }
}

export type { WorkspaceTab, WorkspaceTabState }
export { ENTRY_TAB_ID }
