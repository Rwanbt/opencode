/* SPDX-License-Identifier: MIT */

import { For, Show, createEffect, createMemo, createSignal, type JSX } from "solid-js"
import { createQuery } from "@tanstack/solid-query"
import { useMode } from "@/context/mode"
import { useLanguage } from "@/context/language"
import { useWorkspaceWorkbench } from "@/context/workbench/provider"
import { workbenchQueryKey } from "@/context/workbench/query-keys"
import { base64Encode } from "@unifia/util/encode"
import { useNavigate } from "@solidjs/router"
import { WorkbenchChat } from "@/pages/workbench-chat"
import { ConnectionBanner } from "@/pages/workbench/connection-banner"
import { createMobileNavigationModel, WORK_V1_FUNCTIONS, type WorkFunction } from "@unifia/workbench-shell"

const OPERATION_I18N_KEY: Record<WorkFunction, string> = {
  "workspace-switcher": "workbench.operations.workspaceSwitcher",
  "session-chat": "workbench.operations.sessionChat",
  "files": "workbench.operations.files",
  "search": "workbench.operations.search",
  "artifacts": "workbench.operations.artifacts",
  "documents": "workbench.operations.documents",
  "trace": "workbench.operations.trace",
  "approvals": "workbench.operations.approvals",
  "activity-log": "workbench.operations.activityLog",
  "capability-picker": "workbench.operations.capabilityPicker",
  "export": "workbench.operations.export",
}

const labelFor = (t: (key: string) => string, operation: WorkFunction) => t(OPERATION_I18N_KEY[operation])

export function WorkSurface(): JSX.Element {
  const mode = useMode()
  const language = useLanguage()
  const t = language.t
  const workbench = useWorkspaceWorkbench()
  const connection = workbench.connection
  const navigate = useNavigate()
  createEffect(() => { void workbench.ensureConnected().catch(() => undefined) })
  const [activeOperation, setActiveOperation] = createSignal<WorkFunction>("documents")
  const [exportState, setExportState] = createSignal<"idle" | "running" | "success" | "error">("idle")
  const [exportMessage, setExportMessage] = createSignal("")
  const documentQueryOptions = createMemo(() => {
    const current = connection()
    return { queryKey: workbenchQueryKey(current, "documents"), enabled: !!current, queryFn: () => current!.client.listDocuments(current!.workspaceId) }
  })
  const artifactQueryOptions = createMemo(() => {
    const current = connection()
    return { queryKey: workbenchQueryKey(current, "artifacts"), enabled: !!current, queryFn: () => current!.client.listArtifacts(current!.workspaceId) }
  })
  const fileQueryOptions = createMemo(() => {
    const current = connection()
    return { queryKey: workbenchQueryKey(current, "files", { prefix: "." }), enabled: !!current, queryFn: () => current!.client.listFiles(current!.workspaceId) }
  })
  const documents = createQuery(documentQueryOptions)
  const artifacts = createQuery(artifactQueryOptions)
  const files = createQuery(fileQueryOptions)
  const navigation = createMemo(() =>
    createMobileNavigationModel({ viewportWidth: window.innerWidth, documents: documents.data?.documents.length ?? 0, designPreviews: 0, active: activeOperation() }),
  )

  async function exportFirstArtifact(): Promise<void> {
    const artifact = artifacts.data?.artifacts[0]
    const current = connection()
    if (!artifact || !current || exportState() === "running") return
    setExportState("running")
    setExportMessage("")
    try {
      workbench.beginOperation()
      const result = await current.client.exportArtifact(current.workspaceId, artifact.artifactId)
      if ("approvalId" in result && result.approvalId) {
        setExportState("error")
        setExportMessage(t("workbench.export.approvalRequired", { approvalId: result.approvalId }))
      } else if ("exported" in result) {
        setExportState("success")
        setExportMessage(t("workbench.export.exported", { path: result.exported.relativePath }))
      } else {
        setExportState("error")
        setExportMessage(t("workbench.export.noResult"))
      }
    } catch (error) {
      setExportState("error")
      setExportMessage(error instanceof Error ? error.message : t("workbench.export.failed"))
    }
  }

  function openArtifactInCode(): void {
    const artifact = artifacts.data?.artifacts[0]
    if (!artifact || !mode.directory()) return
    const session = mode.sessionId()
    const target = `/${base64Encode(mode.directory())}/session${session ? `/${encodeURIComponent(session)}` : ""}?artifact=${encodeURIComponent(artifact.artifactId)}`
    navigate(target)
  }

  return (
    <section class="size-full overflow-auto p-6 md:p-10" data-workbench-surface="work">
      <div class="mx-auto max-w-5xl space-y-8">
        <header class="space-y-2">
          <p class="text-12-medium uppercase tracking-wide text-text-weak">{t("workbench.work.title")}</p>
          <h1 class="text-24-medium">{t("workbench.work.heading")}</h1>
          <p class="max-w-2xl text-14-regular text-text-weak">{t("workbench.work.description")}</p>
          <ConnectionBanner dataAttr="workbench-connection" dataRetryAttr="workbench-retry" />
        </header>
        <WorkbenchChat
          mode="work"
          prompt={t("workbench.work.chatPrompt")}
          description={t("workbench.work.chatDescription")}
        />
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-workbench-navigation={navigation().layout}>
          <For each={WORK_V1_FUNCTIONS}>
            {(operation) => (
              <button
                type="button"
                class="w-full rounded-lg border border-border-base bg-background-stronger p-4 text-left transition-colors hover:bg-background-strong"
                classList={{ "border-border-focus": activeOperation() === operation }}
                data-workbench-operation={operation}
                aria-pressed={activeOperation() === operation}
                onClick={() => setActiveOperation(operation)}
              >
                <div class="flex items-center justify-between gap-3">
                  <h2 class="text-14-medium">{labelFor(t, operation)}</h2>
                  <Show when={activeOperation() === operation}>
                    <span class="text-12-medium text-text-success">{t("workbench.operations.active")}</span>
                  </Show>
                </div>
                <p class="mt-2 text-12-regular text-text-weak">
                  {operation === "documents" ? t("workbench.operations.documentsCount", { count: navigation().workCount })
                    : operation === "artifacts" ? t("workbench.operations.artifactsCount", { count: artifacts.data?.artifacts.length ?? 0 })
                    : operation === "files" ? t("workbench.operations.filesCount", { count: files.data?.entries.length ?? 0 })
                    : operation === "export" ? t("workbench.operations.exportDescription")
                    : t("workbench.operations.scopedToWorkspace")}
                </p>
              </button>
            )}
          </For>
        </div>
        <div class="rounded-lg border border-border-base bg-background-stronger p-5" data-workbench-selected-operation={activeOperation()}>
          <p class="text-12-medium uppercase tracking-wide text-text-weak">{t("workbench.operations.selectedLabel")}</p>
          <h2 class="mt-2 text-18-medium">{labelFor(t, activeOperation())}</h2>
          <p class="mt-2 text-14-regular text-text-weak">{t("workbench.operations.selectedDescription")}</p>
          <Show when={activeOperation() === "export"}>
            <button type="button" data-workbench-open-artifact class="mt-4 mr-2 rounded border border-border-base px-3 py-2 text-12-medium disabled:opacity-50" disabled={!artifacts.data?.artifacts.length} onClick={openArtifactInCode}>
              {t("workbench.export.openInCode")}
            </button>
            <button type="button" data-workbench-export class="mt-4 rounded border border-border-base px-3 py-2 text-12-medium disabled:opacity-50" disabled={!artifacts.data?.artifacts.length || exportState() === "running"} onClick={() => void exportFirstArtifact()}>
              {exportState() === "running" ? t("workbench.export.exporting") : t("workbench.export.exportFirst")}
            </button>
            <Show when={exportMessage()}>
              <p data-workbench-export-result={exportState()} class="mt-3 text-12-regular text-text-weak">{exportMessage()}</p>
            </Show>
          </Show>
        </div>
      </div>
    </section>
  )
}
