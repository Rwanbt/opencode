/* SPDX-License-Identifier: MIT */

import { For, Show, type JSX, createMemo } from "solid-js"
import { createStore, type SetStoreFunction } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useWorkspaceWorkbench } from "@/context/workbench/provider"
import type { GithubConnectionView } from "@unifia/workbench-shell"
import { ArtifactPreview } from "@/pages/workbench/artifact-preview"
import {
  activateTab,
  closeTab,
  emptyDesignTabState,
  openTab,
  type DesignTab,
  type DesignTabState,
} from "@/pages/workbench/design-tabs"

/**
 * Phase 3 — atelier d'artefacts de la colonne droite du mode Design.
 *
 * Avant la phase 3, ce composant détenait son propre store d'onglets : la
 * surface Design avait beau vivre à côté, elle n'avait aucun moyen de
 * pousser un onglet depuis un événement de streaming. `createDesignWorkspaceController`
 * offrait bien un `controller` retour, mais il créait un second store sans
 * aucun consommateur (vérifié en P3-2 : zéro import hors ce fichier), donc
 * deux vérités qui ne pouvaient pas se parler.
 *
 * Phase 3 inverse : `DesignSurface` détient l'unique store, le passe à
 * `DesignWorkspace` via `state` + `setState`. Le composant ne pilote plus
 * rien, il rend la barre d'onglets et route vers le contenu. Le contenu
 * de chaque onglet est résolu par `props.renderContent(tab)` — `DesignSurface`
 * connaît les kinds possibles et choisit le rendu. Sans props contrôlées,
 * `DesignWorkspace` retombe sur un store interne (utile pour les tests et
 * pour l'état vide legacy).
 */
export function DesignWorkspace(props: {
  /** Store contrôlé par le parent. Si absent, le composant crée son propre store. */
  state?: DesignTabState
  setState?: SetStoreFunction<DesignTabState>
  /**
   * Rendu du contenu pour l'onglet actif. Le parent connaît le sens métier
   * de chaque `kind` et fournit le composant adapté. Si absent, on rend
   * un placeholder par kind.
   */
  renderContent?: (tab: DesignTab) => JSX.Element
  onOpenTerminal?: () => void
  onOpenBrowser?: () => void
  onOpenSketch?: () => void
  github?: GithubConnectionView
}): JSX.Element {
  const language = useLanguage()
  const workbench = useWorkspaceWorkbench()
  const connection = workbench.connection
  const t = language.t
  const [internalState, setInternalState] = createStore<DesignTabState>(emptyDesignTabState())
  const state = (): DesignTabState => props.state ?? internalState
  const setState: SetStoreFunction<DesignTabState> = props.setState ?? setInternalState

  const active = createMemo(() => state().tabs.find((tab) => tab.id === state().activeId))
  const isEmpty = createMemo(() => state().activeId === undefined)

  return (
    <div
      class="flex h-full min-h-0 flex-col"
      data-design-workspace={isEmpty() ? "empty" : "active"}
      data-design-workspace-tab-count={state().tabs.length}
    >
      <Show when={state().tabs.length > 0}>
        {/* The action cluster used to sit INSIDE role="tablist", which axe
            reports as aria-required-children (critical): a tablist may only
            contain tabs, and a screen reader announcing "tab 1 of 5" over a
            GitHub badge and three buttons is describing something that is not
            there. The bar keeps its own element and its attribute; only the
            tabs are inside the tablist now. */}
        <div
          class="flex h-9 shrink-0 items-center gap-1 border-b border-border-base bg-background-stronger px-2"
          data-design-workspace-tab-bar
        >
          <div class="ml-auto flex items-center gap-1"><Show when={props.github}>{(view) => <GithubBadge view={view()} />}</Show><Show when={props.onOpenTerminal}><button type="button" class="rounded border border-border-base px-2 py-1 text-12-regular" data-design-open-terminal onClick={() => props.onOpenTerminal?.()}>Terminal</button></Show><Show when={props.onOpenBrowser}><button type="button" class="rounded border border-border-base px-2 py-1 text-12-regular" data-design-open-browser onClick={() => props.onOpenBrowser?.()}>Navigateur</button></Show><Show when={props.onOpenSketch}><button type="button" class="rounded border border-border-base px-2 py-1 text-12-regular" data-design-open-sketch onClick={() => props.onOpenSketch?.()}>Croquis</button></Show></div>
          <div class="flex items-center gap-1" role="tablist" aria-label={t("design.workspace.tabsLabel")} data-design-workspace-tablist>
            <For each={state().tabs}>
              {(item) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={item.id === state().activeId}
                  class="flex h-7 items-center gap-2 rounded px-3 text-12-medium transition-colors"
                  classList={{
                    "bg-background-base text-text-base": item.id === state().activeId,
                    "text-text-weak hover:bg-background-base": item.id !== state().activeId,
                  }}
                  data-design-workspace-tab={item.id}
                  data-design-workspace-tab-kind={item.kind}
                  onClick={() => setState("activeId", activateTab(state(), item.id).activeId ?? undefined)}
                >
                  <span>{item.title}</span>
                  <Show when={item.closable}>
                    <button
                      type="button"
                      aria-label={t("design.workspace.closeTab", { title: item.title })}
                      class="rounded p-1 text-12-regular text-text-weak hover:bg-border-base hover:text-text-base"
                      data-design-workspace-tab-close={item.id}
                      onClick={(event) => {
                        event.stopPropagation()
                        setState(closeTab(state(), item.id))
                      }}
                    >
                      ×
                    </button>
                  </Show>
                </button>
              )}
            </For>
          </div>
        </div>
      </Show>
      <div class="flex h-full min-h-0 flex-col overflow-hidden" data-design-workspace-content>
        <Show
          when={active()}
          fallback={
            <div
              class="flex h-full min-h-0 flex-col items-center justify-center gap-2 p-6 text-center"
              data-design-workspace-empty
            >
              <p class="text-14-medium text-text-weak">{t("design.workspace.empty")}</p>
              <p class="text-12-regular text-text-weak">{t("design.workspace.emptyHint")}</p>
            </div>
          }
        >
          {(activeTab) => (
            <div
              class="flex h-full min-h-0 flex-col"
              data-design-workspace-active
              data-design-workspace-active-kind={activeTab().kind}
              data-design-workspace-active-id={activeTab().id}
            >
              {props.renderContent
                ? props.renderContent(activeTab())
                : defaultRenderContent(activeTab(), connection()?.workspaceId ?? "")}
            </div>
          )}
        </Show>
      </div>
    </div>
  )
}

/**
 * Rendu par défaut quand le parent ne fournit pas `renderContent`. Préserve
 * le comportement historique (ArtifactPreview pour les onglets artefact, vide
 * pour les autres kinds) ; les phases 4+ câbleront l'agent et l'éditeur de
 * spec depuis `DesignSurface` via `renderContent`.
 */
function defaultRenderContent(tab: DesignTab, workspaceId: string): JSX.Element {
  return (
    <Show when={tab.kind === "artifact"} fallback={<div data-design-workspace-default-empty />}>
      <ArtifactPreview artifactId={tab.id} workspaceId={workspaceId} />
    </Show>
  )
}

/**
 * Constructeur pur de l'état initial de l'atelier.
 *
 * WHY exported as a function rather than a constant: a frozen object is
 * the wrong shape for a Solid store (mutations would be no-ops, and the
 * reactivity would not propagate when a tab is added later). Returning a
 * fresh `DesignTabState` lets the parent feed it to `createStore` and get
 * a reactive tree from the first frame.
 *
 * Phase 3 seed: two non-closable tabs ("Fichiers" + "Spec"). The order
 * reflects the workflow — Files is the broader surface, Spec is the
 * focused editor — and the initial active is "files" because it is the
 * first tab users see when they enter Design mode.
 */
export function seedDesignTabState(): DesignTabState {
  const state: DesignTabState = emptyDesignTabState()
  // Open "Spec" first so the final `openTab` for "Fichiers" makes it the
  // active tab — `openTab` activates the tab it just added, so the order
  // is the only way to land on "files" without an explicit `activateTab`
  // after the fact. The order in the tab bar (left-to-right) follows the
  // insertion order, so users see Fichiers on the left, Spec on the right.
  const withSpec = openTab(state, { id: "spec", kind: "spec", title: "Spec", closable: false })
  return openTab(withSpec, { id: "files", kind: "file", title: "Fichiers", closable: false })
}

/**
 * Phase 17 — read-only. Connecting lives in Settings → GitHub (the Device
 * Flow panel that already owns the sidecar's /github routes); duplicating it
 * here would be a second flow to keep correct for no new capability.
 */
function GithubBadge(props: { view: GithubConnectionView }): JSX.Element {
  const language = useLanguage()
  const t = language.t
  const label = createMemo(() => props.view.kind === "connected"
    ? t("design.github.state.connected", { login: props.view.login })
    : t(`design.github.state.${props.view.kind}`))
  const title = createMemo(() => props.view.kind === "disconnected" || props.view.kind === "unconfigured" ? t("design.github.state.hint") : label())
  return <span
    class="rounded border border-border-base px-2 py-1 text-12-regular text-text-weak"
    data-design-github-state={props.view.kind}
    title={title()}
  >{label()}</span>
}
