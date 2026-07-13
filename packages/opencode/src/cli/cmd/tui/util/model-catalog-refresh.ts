// Control flow for the "refresh models.dev catalog" action shared by
// DialogModel and (once it lands on this branch) DialogDebateSetup.
//
// Deliberately framework-agnostic: this is the one piece of the Alt+R
// refresh flow that is worth unit testing in isolation (in-flight guard,
// error vs success branching, refetch-on-success). The SolidJS wiring
// (store-backed `refreshing` signal, toast, SDK client, sync.bootstrap) lives
// in context/local.tsx's `modelCatalog` and is intentionally thin glue over
// this function.
export type ModelCatalogRefreshResult = { ok: boolean; error?: string }

export interface ModelCatalogRefreshDeps {
  /** Current in-flight state. Used to ignore a concurrent second trigger. */
  isRefreshing: () => boolean
  setRefreshing: (value: boolean) => void
  /** POST /provider/refresh — never expected to throw (route always returns 200). */
  refresh: () => Promise<ModelCatalogRefreshResult>
  /** Refetch provider/model state into the TUI store on success. */
  refetch: () => Promise<void>
  notifyError: (message: string) => void
  notifySuccess: () => void
}

export async function performModelCatalogRefresh(deps: ModelCatalogRefreshDeps): Promise<void> {
  if (deps.isRefreshing()) return
  deps.setRefreshing(true)
  try {
    const result = await deps.refresh()
    if (!result.ok) {
      deps.notifyError(result.error ?? "Unknown error")
      return
    }
    await deps.refetch()
    deps.notifySuccess()
  } catch (error) {
    deps.notifyError(error instanceof Error ? error.message : String(error))
  } finally {
    deps.setRefreshing(false)
  }
}
