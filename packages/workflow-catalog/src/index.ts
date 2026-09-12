/* SPDX-License-Identifier: MIT */

/**
 * Workflow catalog — Plan V3 section 28.
 *
 * The plan asks for eight initial workflows and states that **every step
 * declares** nine things: capability, scope, sandbox, cost, timeout, retry,
 * output, approval and reversibility.
 *
 * `WorkflowStep` in the runtime carries four fields, so "chaque step déclare"
 * was a sentence in a document rather than something a workflow could fail. The
 * declaration is made a type here and, more importantly, enforced: a step
 * missing any of the nine is refused, and two cross-field rules that the plan
 * states elsewhere are checked at the same time.
 */

import { P3_CAPABILITIES, type P3Capability } from "@unifia/contracts"
export * from "./loader"
export * from "./validator"

export type WorkflowStepPort = { id: string; capability: P3Capability; input: Record<string, unknown>; requiresApproval?: boolean }
export type WorkflowDefinitionPort = { id: string; version: number; workspaceId: string; steps: readonly WorkflowStepPort[] }

export type SandboxRequirement = "none" | "native-restricted" | "docker" | "wsl2" | "lima"
export type ApprovalRequirement = "none" | "required"

export type StepDeclaration = {
  id: string
  capability: P3Capability
  /** Resource the capability applies to — a path, host pattern or identity. */
  scope: string
  sandbox: SandboxRequirement
  /** Relative cost, used for budgeting. Unitless on purpose; only ordering matters. */
  costUnits: number
  timeoutMs: number
  retry: { attempts: number; backoffMs: number }
  output: { name: string; kind: "artifact" | "text" | "none" }
  approval: ApprovalRequirement
  /** Whether the step can be undone. Irreversible steps must be approved. */
  reversible: boolean
}

export type DeclaredWorkflow = {
  id: string
  version: number
  title: string
  steps: readonly StepDeclaration[]
}

export class WorkflowDeclarationError extends Error {
  readonly workflowId: string
  readonly stepId: string
  constructor(workflowId: string, stepId: string, message: string) {
    super(`${workflowId}/${stepId}: ${message}`)
    this.name = "WorkflowDeclarationError"
    this.workflowId = workflowId
    this.stepId = stepId
  }
}

const ID = /^[a-z][a-z0-9-]{2,63}$/
const SANDBOXES: ReadonlySet<string> = new Set<SandboxRequirement>(["none", "native-restricted", "docker", "wsl2", "lima"])
const OUTPUT_KINDS: ReadonlySet<string> = new Set(["artifact", "text", "none"])
const CAPABILITIES: ReadonlySet<string> = new Set(P3_CAPABILITIES)

/**
 * Capabilities whose combination with automation the plan treats as critical
 * (section 15, "combinaisons critiques"). A workflow step is unattended by
 * definition, so these always require an approval regardless of reversibility.
 */
const CRITICAL_CAPABILITIES: ReadonlySet<string> = new Set<P3Capability>([
  "terminal.run",
  "desktop.control",
  "secret.read",
  "package.install",
  "network.request",
  "remote.respond",
])

/** Steps that leave the workspace need real isolation, not "none". */
const REQUIRES_SANDBOX: ReadonlySet<string> = new Set<P3Capability>(["terminal.run", "network.request", "browser.navigate"])

const MAX_TIMEOUT_MS = 30 * 60 * 1000
const MAX_RETRY_ATTEMPTS = 5

/**
 * Validates one step's declaration.
 *
 * @throws WorkflowDeclarationError — an incompletely declared step is refused
 * rather than defaulted. Defaulting is how a step ends up unattended with a
 * capability nobody chose to grant it.
 */
export function validateStepDeclaration(workflowId: string, step: StepDeclaration): void {
  const fail = (message: string): never => {
    throw new WorkflowDeclarationError(workflowId, step.id ?? "<no id>", message)
  }
  if (!ID.test(step.id)) fail("step id must be kebab-case")
  if (!CAPABILITIES.has(step.capability)) fail(`unknown capability: ${step.capability}`)
  if (typeof step.scope !== "string" || step.scope.length === 0) fail("scope is required")
  if (!SANDBOXES.has(step.sandbox)) fail(`unknown sandbox: ${step.sandbox}`)
  if (!Number.isFinite(step.costUnits) || step.costUnits < 0) fail("costUnits must be a non-negative number")
  if (!Number.isSafeInteger(step.timeoutMs) || step.timeoutMs <= 0 || step.timeoutMs > MAX_TIMEOUT_MS) fail("timeoutMs must be a positive integer within the ceiling")
  if (!step.retry || !Number.isSafeInteger(step.retry.attempts) || step.retry.attempts < 0 || step.retry.attempts > MAX_RETRY_ATTEMPTS) fail("retry.attempts must be an integer within the ceiling")
  if (!Number.isSafeInteger(step.retry.backoffMs) || step.retry.backoffMs < 0) fail("retry.backoffMs must be a non-negative integer")
  if (!step.output || typeof step.output.name !== "string" || step.output.name.length === 0 || !OUTPUT_KINDS.has(step.output.kind)) fail("output must declare a name and a known kind")
  if (step.approval !== "none" && step.approval !== "required") fail("approval must be none or required")
  if (typeof step.reversible !== "boolean") fail("reversible must be declared explicitly")

  // Cross-field rules the plan states but that no type can express.
  if (!step.reversible && step.approval !== "required") fail("an irreversible step must require approval")
  if (CRITICAL_CAPABILITIES.has(step.capability) && step.approval !== "required") fail(`capability ${step.capability} is critical and must require approval`)
  if (REQUIRES_SANDBOX.has(step.capability) && step.sandbox === "none") fail(`capability ${step.capability} must run in a sandbox`)
  // A retry re-runs the step. Retrying something that cannot be undone applies
  // it more than once, which is the opposite of what retry is for.
  if (!step.reversible && step.retry.attempts > 0) fail("an irreversible step must not declare retries")
}

export function validateWorkflow(workflow: DeclaredWorkflow): void {
  if (!ID.test(workflow.id)) throw new WorkflowDeclarationError(workflow.id, "<workflow>", "workflow id must be kebab-case")
  if (!Number.isSafeInteger(workflow.version) || workflow.version < 1) throw new WorkflowDeclarationError(workflow.id, "<workflow>", "version must be a positive integer")
  if (workflow.steps.length === 0) throw new WorkflowDeclarationError(workflow.id, "<workflow>", "a workflow must declare at least one step")
  const seen = new Set<string>()
  for (const step of workflow.steps) {
    if (seen.has(step.id)) throw new WorkflowDeclarationError(workflow.id, step.id, "duplicate step id")
    seen.add(step.id)
    validateStepDeclaration(workflow.id, step)
  }
}

/** Total declared cost, for budgeting before a workflow is started. */
export function workflowCost(workflow: DeclaredWorkflow): number {
  return workflow.steps.reduce((total, step) => total + step.costUnits, 0)
}

/** Capabilities a workflow needs, so a caller can check them against a grant. */
export function workflowCapabilities(workflow: DeclaredWorkflow): readonly P3Capability[] {
  return [...new Set(workflow.steps.map((step) => step.capability))]
}

/**
 * Projects a declared workflow onto the runtime's shape.
 *
 * Validation runs first: the runtime accepts a four-field step, so an
 * unvalidated projection would silently drop the declarations this module
 * exists to enforce.
 */
export function toRuntimeDefinition(workflow: DeclaredWorkflow, workspaceId: string): WorkflowDefinitionPort {
  validateWorkflow(workflow)
  const steps: WorkflowStepPort[] = workflow.steps.map((step) => ({
    id: step.id,
    capability: step.capability,
    input: { scope: step.scope, sandbox: step.sandbox, timeoutMs: step.timeoutMs, retry: step.retry, output: step.output, reversible: step.reversible, costUnits: step.costUnits },
    requiresApproval: step.approval === "required",
  }))
  return { id: workflow.id, version: workflow.version, workspaceId, steps }
}

const read = (id: string, scope: string, name: string, cost: number): StepDeclaration => ({
  id,
  capability: "workspace.read",
  scope,
  sandbox: "none",
  costUnits: cost,
  timeoutMs: 60_000,
  retry: { attempts: 2, backoffMs: 500 },
  output: { name, kind: "text" },
  approval: "none",
  reversible: true,
})

const produce = (id: string, scope: string, name: string, cost: number): StepDeclaration => ({
  id,
  capability: "artifact.create",
  scope,
  sandbox: "none",
  costUnits: cost,
  timeoutMs: 300_000,
  retry: { attempts: 1, backoffMs: 1_000 },
  output: { name, kind: "artifact" },
  approval: "none",
  reversible: true,
})

/**
 * The eight workflows of plan section 28.
 *
 * Export steps are irreversible — once a file leaves the workspace it cannot be
 * recalled — so they require approval and declare no retries, which the
 * validator enforces rather than trusting the author to remember.
 */
export const BUILT_IN_WORKFLOWS: readonly DeclaredWorkflow[] = [
  {
    id: "document-from-folder",
    version: 1,
    title: "Produire un document à partir d'un dossier",
    steps: [read("scan-folder", "workspace://input", "file-list", 1), produce("render-document", "workspace://outbox", "document", 5)],
  },
  {
    id: "weekly-project-report",
    version: 1,
    title: "Rapport hebdomadaire de projet",
    steps: [read("collect-activity", "workspace://.unifia/audit.jsonl", "activity", 2), produce("render-report", "workspace://outbox", "report", 4)],
  },
  {
    id: "code-review-to-presentation",
    version: 1,
    title: "Transformer une revue de code en présentation",
    steps: [read("collect-review", "workspace://reviews", "review-notes", 2), produce("render-deck", "workspace://outbox", "deck", 6)],
  },
  {
    id: "research-to-brief",
    version: 1,
    title: "Synthétiser une recherche en note de cadrage",
    steps: [
      { ...read("gather-sources", "workspace://research", "sources", 2) },
      { id: "fetch-references", capability: "network.request", scope: "https://*.example.org", sandbox: "docker", costUnits: 3, timeoutMs: 120_000, retry: { attempts: 2, backoffMs: 2_000 }, output: { name: "references", kind: "text" }, approval: "required", reversible: true },
      produce("render-brief", "workspace://outbox", "brief", 4),
    ],
  },
  {
    id: "spreadsheet-analysis",
    version: 1,
    title: "Analyser un tableur",
    steps: [read("load-workbook", "workspace://data", "workbook", 2), produce("render-analysis", "workspace://outbox", "analysis", 5)],
  },
  {
    id: "remote-request-with-local-approval",
    version: 1,
    title: "Requête distante avec approbation locale",
    steps: [
      { id: "receive-request", capability: "remote.receive", scope: "transport://slack", sandbox: "none", costUnits: 1, timeoutMs: 30_000, retry: { attempts: 1, backoffMs: 500 }, output: { name: "request", kind: "text" }, approval: "required", reversible: true },
      read("resolve-context", "workspace://", "context", 2),
      { id: "answer-request", capability: "remote.respond", scope: "transport://slack", sandbox: "none", costUnits: 1, timeoutMs: 30_000, retry: { attempts: 0, backoffMs: 0 }, output: { name: "answer", kind: "none" }, approval: "required", reversible: false },
    ],
  },
  {
    id: "browser-data-to-artifact",
    version: 1,
    title: "Collecter des données web et en faire un artefact",
    steps: [
      { id: "browse-source", capability: "browser.navigate", scope: "https://example.org", sandbox: "docker", costUnits: 3, timeoutMs: 120_000, retry: { attempts: 2, backoffMs: 2_000 }, output: { name: "capture", kind: "text" }, approval: "required", reversible: true },
      produce("render-artifact", "workspace://outbox", "artifact", 4),
    ],
  },
  {
    id: "release-prep",
    version: 1,
    title: "Préparer une release",
    steps: [
      read("collect-changes", "workspace://", "changes", 2),
      { id: "run-checks", capability: "terminal.run", scope: "bun run typecheck", sandbox: "native-restricted", costUnits: 5, timeoutMs: 600_000, retry: { attempts: 1, backoffMs: 5_000 }, output: { name: "check-report", kind: "text" }, approval: "required", reversible: true },
      produce("render-notes", "workspace://outbox", "release-notes", 3),
      { id: "export-bundle", capability: "artifact.export", scope: "workspace://outbox", sandbox: "none", costUnits: 2, timeoutMs: 120_000, retry: { attempts: 0, backoffMs: 0 }, output: { name: "bundle", kind: "artifact" }, approval: "required", reversible: false },
    ],
  },
]

export function findWorkflow(id: string): DeclaredWorkflow | undefined {
  return BUILT_IN_WORKFLOWS.find((workflow) => workflow.id === id)
}
