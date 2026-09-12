/* SPDX-License-Identifier: MIT */

import { For, Show, createEffect, createMemo, createSignal, type JSX } from "solid-js"
import { createQuery } from "@tanstack/solid-query"
import { useLanguage } from "@/context/language"
import { useWorkspaceWorkbench } from "@/context/workbench/provider"
import { workbenchQueryKey } from "@/context/workbench/query-keys"
import { WorkbenchChat } from "@/pages/workbench-chat"
import { ConnectionBanner } from "@/pages/workbench/connection-banner"
import { decodeFile, parseWorkflowDefinition } from "./automate-decode"

export function AutomateSurface(): JSX.Element {
  const language = useLanguage()
  const t = language.t
  const workbench = useWorkspaceWorkbench()
  const connection = workbench.connection
  createEffect(() => { void workbench.ensureConnected().catch(() => undefined) })
  const definitionsQueryOptions = createMemo(() => {
    const current = connection()
    return { queryKey: workbenchQueryKey(current, "files", { prefix: ".unifia/workflows" }), enabled: !!current, queryFn: () => current!.client.listFiles(current!.workspaceId, ".unifia/workflows") }
  })
  const definitions = createQuery(definitionsQueryOptions)
  const [selectedDefinition, setSelectedDefinition] = createSignal<string>()
  const [workflowState, setWorkflowState] = createSignal<string>()
  const [workflowError, setWorkflowError] = createSignal<string>()
  const [approvalId, setApprovalId] = createSignal<string>()
  const [pendingDefinition, setPendingDefinition] = createSignal<Record<string, unknown>>()
  const definitionFileQueryOptions = createMemo(() => {
    const current = connection()
    const selectedPath = selectedDefinition()
    return { queryKey: workbenchQueryKey(current, "file", { path: selectedPath ?? "" }), enabled: !!current && !!selectedPath, queryFn: () => current!.client.readFiles(current!.workspaceId, [selectedPath!]) }
  })
  const definitionFile = createQuery(definitionFileQueryOptions)
  async function startDefinition(definition: Record<string, unknown>): Promise<void> {
    const current = connection()
    if (!current) return
    workbench.beginOperation()
    const result = await current.client.startWorkflow(current.workspaceId, definition)
    if ("approvalRequired" in result) {
      setApprovalId(result.approvalId)
      setPendingDefinition(definition)
      setWorkflowState("approval_required")
      return
    }
    setApprovalId(undefined)
    setPendingDefinition(undefined)
    setWorkflowState(result.state.status)
    setWorkflowError(undefined)
  }

  async function startSelectedWorkflow(): Promise<void> {
    const current = connection()
    const file = definitionFile.data?.results[0]
    if (!current || !file) return
    try {
      const parsed = parseWorkflowDefinition(decodeFile(file))
      if (parsed.kind === "error") throw new Error(t("workbench.automate.invalidDefinition"))
      const definition = { id: parsed.definition.id, version: parsed.definition.version, steps: parsed.definition.steps } as Record<string, unknown>
      await startDefinition(definition)
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : t("workbench.automate.startFailed"))
    }
  }
  async function resolveWorkflowApproval(decision: "allow" | "deny"): Promise<void> {
    const current = connection()
    const id = approvalId()
    if (!current || !id) return
    try {
      const result = await current.client.resolveApproval(id, decision)
      if (decision === "allow" && result.decision.kind === "allow" && pendingDefinition()) await startDefinition(pendingDefinition()!)
      else {
        setApprovalId(undefined)
        setPendingDefinition(undefined)
        setWorkflowState(result.decision.kind)
      }
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : t("workbench.automate.approvalFailed"))
    }
  }
  async function cancelWorkflowApproval(): Promise<void> {
    const current = connection()
    const id = approvalId()
    if (!current || !id) return
    try {
      await current.client.cancelApproval(id)
      setApprovalId(undefined)
      setPendingDefinition(undefined)
      setWorkflowState("cancelled")
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : t("workbench.automate.cancelFailed"))
    }
  }
  return (
    <section class="size-full overflow-auto p-6 md:p-10" data-workbench-surface="automate">
      <div class="mx-auto max-w-5xl space-y-8">
        <header class="space-y-2">
          <p class="text-12-medium uppercase tracking-wide text-text-weak">{t("workbench.automate.title")}</p>
          <h1 class="text-24-medium">{t("workbench.automate.heading")}</h1>
          <p class="max-w-2xl text-14-regular text-text-weak">{t("workbench.automate.description")}</p>
        </header>
        <WorkbenchChat
          mode="automate"
          prompt={t("workbench.automate.chatPrompt")}
          description={t("workbench.automate.chatDescription")}
        />
        <ConnectionBanner dataAttr="automate-connection" dataRetryAttr="automate-retry" />
        <Show when={definitions.error}>
          <p data-automate-definitions="failed" class="text-14-regular text-text-danger">{definitions.error instanceof Error ? definitions.error.message : String(definitions.error)}</p>
        </Show>
        <Show when={definitions.data?.entries.length}>
          <ul class="space-y-2" data-automate-definition-count={definitions.data!.entries.length}>
            <For each={definitions.data!.entries.filter((entry) => entry.kind === "file")}>
              {(entry) => (
                <li class="rounded-lg border border-border-base bg-background-stronger p-4" data-automate-definition={entry.path}>
                  <div class="flex items-center justify-between gap-3"><span>{entry.path}</span><button type="button" class="rounded border border-border-base px-2 py-1 text-12-medium" onClick={() => { setSelectedDefinition(entry.path); setWorkflowError(undefined) }}>{t("workbench.automate.inspect")}</button></div>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <Show when={selectedDefinition()}>
          <div class="rounded-lg border border-border-base bg-background-stronger p-4" data-automate-selected={selectedDefinition()}>
            <p class="text-12-regular text-text-weak">{t("workbench.automate.selectedDescription")}</p>
            <button type="button" class="mt-3 rounded border border-border-base px-3 py-2 text-12-medium" disabled={definitionFile.isLoading || !definitionFile.data} onClick={() => void startSelectedWorkflow()}>{t("workbench.automate.startWithApproval")}</button>
            <Show when={approvalId()}>
              <div class="mt-3 flex flex-wrap gap-2" data-automate-approval={approvalId()}>
                <button type="button" class="rounded border border-border-base px-3 py-2 text-12-medium" onClick={() => void resolveWorkflowApproval("allow")}>{t("workbench.automate.allow")}</button>
                <button type="button" class="rounded border border-border-base px-3 py-2 text-12-medium" onClick={() => void resolveWorkflowApproval("deny")}>{t("workbench.automate.deny")}</button>
                <button type="button" class="rounded border border-border-base px-3 py-2 text-12-medium" onClick={() => void cancelWorkflowApproval()}>{t("workbench.automate.cancel")}</button>
              </div>
            </Show>
            <Show when={workflowState()}><p class="mt-2 text-12-regular text-text-success">{t("workbench.automate.workflowState", { state: workflowState() ?? "" })}</p></Show>
            <Show when={workflowError()}><p class="mt-2 text-12-regular text-text-danger">{workflowError()}</p></Show>
          </div>
        </Show>
        <Show when={!definitions.isLoading && !definitions.error && definitions.data?.entries.length === 0}>
          <p data-automate-definitions="empty" class="text-14-regular text-text-weak">{t("workbench.automate.noDefinitions")}</p>
        </Show>
      </div>
    </section>
  )
}
