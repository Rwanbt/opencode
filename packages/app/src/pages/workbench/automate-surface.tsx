/* SPDX-License-Identifier: MIT */

import { For, Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from "solid-js"
import { createQuery } from "@tanstack/solid-query"
import { NodeFamilySchema } from "@unifia/contracts"
import { createIndexedDbWorkflowDraftStore } from "@unifia/workbench-shell"
import { useLanguage } from "@/context/language"
import { useWorkspaceWorkbench } from "@/context/workbench/provider"
import { workbenchQueryKey } from "@/context/workbench/query-keys"
import { WorkbenchChat } from "@/pages/workbench-chat"
import { ConnectionBanner } from "@/pages/workbench/connection-banner"
import { decodeFile, parseWorkflowDefinition } from "./automate-decode"
import { publishedDraftPath, summarizeWorkflowSteps } from "./automate-workflow-model"

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
  const workflowFiles = createMemo(() => definitions.data?.entries.filter((entry) => entry.kind === "file") ?? [])
  const workflowRunsQueryOptions = createMemo(() => {
    const current = connection()
    return { queryKey: workbenchQueryKey(current, "workflow-runs"), enabled: !!current, queryFn: () => current!.client.listWorkflows() }
  })
  const workflowRuns = createQuery(workflowRunsQueryOptions)
  const [selectedDefinition, setSelectedDefinition] = createSignal<string>()
  const [workflowState, setWorkflowState] = createSignal<string>()
  const [workflowError, setWorkflowError] = createSignal<string>()
  const [approvalId, setApprovalId] = createSignal<string>()
  const [pendingDefinition, setPendingDefinition] = createSignal<Record<string, unknown>>()
  const [nodeFilter, setNodeFilter] = createSignal("")
  const [draftSource, setDraftSource] = createSignal("")
  const [draftRevision, setDraftRevision] = createSignal<number>()
  const [draftStatus, setDraftStatus] = createSignal("Published definition")
  const draftStore = createIndexedDbWorkflowDraftStore()
  let draftTimer: ReturnType<typeof setTimeout> | undefined
  let draftLoadEpoch = 0
  onCleanup(() => { if (draftTimer) clearTimeout(draftTimer) })
  const visibleNodeFamilies = createMemo(() => {
    const term = nodeFilter().trim().toLocaleLowerCase()
    return term ? NodeFamilySchema.options.filter((family) => family.includes(term)) : NodeFamilySchema.options
  })
  const definitionFileQueryOptions = createMemo(() => {
    const current = connection()
    const selectedPath = selectedDefinition()
    return { queryKey: workbenchQueryKey(current, "file", { path: selectedPath ?? "" }), enabled: !!current && !!selectedPath, queryFn: () => current!.client.readFiles(current!.workspaceId, [selectedPath!]) }
  })
  const definitionFile = createQuery(definitionFileQueryOptions)
  createEffect(() => {
    const current = connection()
    const path = selectedDefinition()
    const file = definitionFile.data?.results[0]
    if (!current || !path || !file) return
    const epoch = ++draftLoadEpoch
    const published = decodeFile(file)
    setDraftSource(published)
    setDraftRevision(undefined)
    setDraftStatus("Published definition")
    void draftStore.load(current.workspaceId, path).then((draft) => {
      if (epoch !== draftLoadEpoch || !draft) return
      setDraftSource(draft.source)
      setDraftRevision(draft.revision)
      setDraftStatus("Local draft restored")
    }).catch(() => {
      if (epoch === draftLoadEpoch) setDraftStatus("Local drafts unavailable")
    })
  })

  function updateDraftSource(source: string): void {
    const current = connection()
    const path = selectedDefinition()
    setDraftSource(source)
    if (!current || !path) return
    if (draftTimer) clearTimeout(draftTimer)
    draftTimer = setTimeout(() => {
      void draftStore.save(current.workspaceId, path, source, draftRevision()).then((draft) => {
        setDraftRevision(draft.revision)
        setDraftStatus("Local draft saved")
      }).catch(() => setDraftStatus("Local draft conflict — reload before editing"))
    }, 700)
  }

  async function publishDraft(): Promise<void> {
    const current = connection()
    const path = selectedDefinition()
    if (!current || !path) return
    const parsed = parseWorkflowDefinition(draftSource())
    if (parsed.kind === "error") {
      setWorkflowError(t("workbench.automate.invalidDefinition"))
      return
    }
    const targetPath = publishedDraftPath(path, new Date())
    try {
      await current.client.createFiles(current.workspaceId, [{ path: targetPath, content: draftSource() }])
      setSelectedDefinition(targetPath)
      setDraftStatus("Published as a new workflow file")
      setWorkflowError(undefined)
      await definitions.refetch()
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message : t("workbench.automate.startFailed"))
    }
  }
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
    void workflowRuns.refetch()
  }

  async function startSelectedWorkflow(): Promise<void> {
    const current = connection()
    const file = definitionFile.data?.results[0]
    if (!current || !file) return
    try {
      const parsed = parseWorkflowDefinition(draftSource() || decodeFile(file))
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
        <section class="rounded-lg border border-border-base bg-background-stronger p-4" data-automate-node-library>
          <div class="flex flex-wrap items-baseline justify-between gap-3"><div><h2 class="text-14-medium">Node library</h2><p class="mt-1 text-12-regular text-text-weak">Families available in the connected workflow runtime.</p></div><input class="rounded border border-border-base bg-background-base px-2 py-1 text-12-regular" value={nodeFilter()} onInput={(event) => setNodeFilter(event.currentTarget.value)} placeholder="Search nodes" aria-label="Search workflow nodes" /></div>
          <div class="mt-3 flex flex-wrap gap-2"><For each={visibleNodeFamilies()}>{(family) => <span class="rounded border border-border-base bg-background-base px-2 py-1 text-12-regular">{family}</span>}</For></div>
        </section>
        <Show when={definitions.error}>
          <p data-automate-definitions="failed" class="text-14-regular text-text-danger">{definitions.error instanceof Error ? definitions.error.message : String(definitions.error)}</p>
        </Show>
        <Show when={workflowFiles().length > 0}>
          <ul class="space-y-2" data-automate-definition-count={workflowFiles().length}>
            <For each={workflowFiles()}>
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
            <Show when={definitionFile.data?.results[0]}>
              {(file) => {
                const parsed = parseWorkflowDefinition(draftSource() || decodeFile(file()))
                return (
                  <div class="mt-3 rounded border border-border-weaker-base bg-background-base p-3" data-automate-definition-preview={parsed.kind}>
                    <Show when={parsed.kind === "ok"} fallback={<p class="text-12-regular text-text-danger">{t("workbench.automate.invalidDefinition")}</p>}>
                      <p class="text-12-medium">{parsed.kind === "ok" ? parsed.definition.id : ""}</p>
                      <p class="text-12-regular text-text-weak">v{parsed.kind === "ok" ? parsed.definition.version : ""} · {parsed.kind === "ok" ? parsed.definition.steps.length : 0} steps</p>
                      <Show when={parsed.kind === "ok" && parsed.definition.steps.length > 0}>
                        <ol class="mt-3 space-y-2 border-l border-border-base pl-3" aria-label="Workflow steps">
                          <For each={parsed.kind === "ok" ? summarizeWorkflowSteps(parsed.definition) : []}>
                            {(step, index) => <li class="relative rounded border border-border-base bg-background-stronger px-3 py-2 text-12-regular before:absolute before:-left-[18px] before:top-4 before:size-2 before:rounded-full before:bg-accent-base"><div class="flex items-center justify-between gap-3"><span class="font-medium">{index() + 1}. {step.id}</span><Show when={step.requiresApproval}><span class="rounded bg-background-base px-2 py-0.5 text-11-regular">Approval</span></Show></div><p class="mt-1 text-11-regular text-text-weak">{step.label}</p></li>}
                          </For>
                        </ol>
                      </Show>
                    </Show>
                  </div>
                )
              }}
            </Show>
            <Show when={definitionFile.data?.results[0]}>
              {(file) => <details class="mt-3 rounded border border-border-base bg-background-base p-3"><summary class="cursor-pointer text-12-medium">Local draft</summary><p class="mt-2 text-11-regular text-text-weak">{draftStatus()}</p><textarea class="mt-3 h-48 w-full resize-y rounded border border-border-base bg-background-stronger p-2 font-mono text-11-regular leading-5" value={draftSource()} onInput={(event) => updateDraftSource(event.currentTarget.value)} aria-label="Edit local workflow draft" /><div class="mt-2 flex flex-wrap gap-2"><button type="button" class="rounded border border-border-base px-2 py-1 text-11-medium" onClick={() => updateDraftSource(decodeFile(file()))}>Reset to published</button><button type="button" class="rounded border border-border-base px-2 py-1 text-11-medium" onClick={() => void publishDraft()}>Publish as new file</button></div></details>}
            </Show>
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
        <Show when={!definitions.isLoading && !definitions.error && workflowFiles().length === 0}>
          <p data-automate-definitions="empty" class="text-14-regular text-text-weak">{t("workbench.automate.noDefinitions")}</p>
        </Show>
        <section class="rounded-lg border border-border-base bg-background-stronger p-4" data-automate-runs>
          <div class="flex items-baseline justify-between gap-3"><h2 class="text-14-medium">Recent runs</h2><button type="button" class="text-12-regular text-text-weak underline" disabled={workflowRuns.isFetching} onClick={() => void workflowRuns.refetch()}>Refresh</button></div>
          <Show when={workflowRuns.error}><p class="mt-2 text-12-regular text-text-danger">Unable to load run history.</p></Show>
          <Show when={!workflowRuns.isLoading && !workflowRuns.error && workflowRuns.data?.workflows.length === 0}><p class="mt-2 text-12-regular text-text-weak">No durable workflow run for this workspace.</p></Show>
          <ul class="mt-3 space-y-2"><For each={workflowRuns.data?.workflows ?? []}>{(run) => <li class="flex items-center justify-between gap-3 rounded border border-border-weaker-base bg-background-base px-3 py-2 text-12-regular"><span class="min-w-0 truncate">{run.definitionId}</span><span class="shrink-0 text-text-weak">{run.status}</span></li>}</For></ul>
        </section>
      </div>
    </section>
  )
}
