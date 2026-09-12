/* SPDX-License-Identifier: MIT */

import { Show, lazy, type JSX } from "solid-js"
import { useMode } from "@/context/mode"
import { useLanguage } from "@/context/language"
import { useGlobalSync } from "@/context/global-sync"
import { useSync } from "@/context/sync"
import { WorkSurface } from "@/pages/workbench/work-surface"

// F10 — frontière lazy par mode. Work reste synchrone (c'est le mode
// par défaut, le coût d'un import statique est amorti dès le premier
// workspace ouvert). Design et Automate sont lazy : leur chunk ne
// rejoint l'entrée que lorsque `mode.active()` bascule dessus. Le
// helper `workbench-mode-loader.ts` exporte la même fonction de
// préchargement pour le hover/focus et expose des compteurs testables
// («Work ne charge pas Design/Automate» oracle du runbook).
import { ensureModeLoaded, MODE_LOADERS } from "./workbench-mode-loader"

const DesignSurface = lazy(() => MODE_LOADERS.design.load() as Promise<{ default: (props: any) => JSX.Element }>)
const AutomateSurface = lazy(() => MODE_LOADERS.automate.load() as Promise<{ default: (props: any) => JSX.Element }>)

export default function WorkbenchMode(): JSX.Element {
  const mode = useMode()
  const language = useLanguage()
  const globalSync = useGlobalSync()
  const sync = useSync()
  const t = language.t
  return (
    <main
      class="size-full min-h-0 bg-background-base"
      data-workbench-mode={mode.active()}
      data-workbench-bootstrap={globalSync.ready && sync.ready ? "ready" : "pending"}
    >
      <Show when={mode.routeKind() === "invalid"}>
        <section class="size-full p-6" data-workbench-error="invalid-route">
          <h1 class="text-18-medium">{t("workbench.errors.invalidMode")}</h1>
          <p class="mt-2 text-14-regular text-text-weak">{t("workbench.errors.invalidModeDescription")}</p>
        </section>
      </Show>
      <Show when={mode.active() === "work"}>
        <WorkSurface />
      </Show>
      <Show when={mode.active() === "design"}>
        <DesignSurface />
      </Show>
      <Show when={mode.active() === "automate"}>
        <AutomateSurface />
      </Show>
    </main>
  )
}

// Re-export so existing imports keep resolving and so the test
// (workbench-mode-loader.test.ts) can introspect the loaders table.
export { ensureModeLoaded, MODE_LOADERS }
