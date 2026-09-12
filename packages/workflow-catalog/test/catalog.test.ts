/* SPDX-License-Identifier: MIT */
import {
  BUILT_IN_WORKFLOWS,
  WorkflowDeclarationError,
  findWorkflow,
  toRuntimeDefinition,
  validateWorkflow,
  workflowCapabilities,
  workflowCost,
  type StepDeclaration,
} from "../src/index.js"

let checks = 0
const check = (condition: boolean, message: string): void => {
  checks += 1
  if (!condition) throw new Error(message)
}
const refuses = (run: () => unknown, message: string): void => {
  checks += 1
  try {
    run()
  } catch (error) {
    if (error instanceof WorkflowDeclarationError) return
    throw new Error(`${message} (threw ${String(error)})`)
  }
  throw new Error(`${message} (was accepted)`)
}

/** A fully declared, reversible step used as the base for mutation tests. */
const base = (): StepDeclaration => ({
  id: "sample-step",
  capability: "workspace.read",
  scope: "workspace://input",
  sandbox: "none",
  costUnits: 1,
  timeoutMs: 60_000,
  retry: { attempts: 1, backoffMs: 500 },
  output: { name: "result", kind: "text" },
  approval: "none",
  reversible: true,
})
const wrap = (step: StepDeclaration) => ({ id: "sample-workflow", version: 1, title: "Sample", steps: [step] })

// --- The eight workflows of section 28 --------------------------------------
const PLAN_WORKFLOWS = [
  "document-from-folder",
  "weekly-project-report",
  "code-review-to-presentation",
  "research-to-brief",
  "spreadsheet-analysis",
  "remote-request-with-local-approval",
  "browser-data-to-artifact",
  "release-prep",
]
check(BUILT_IN_WORKFLOWS.length === PLAN_WORKFLOWS.length, `catalog holds ${BUILT_IN_WORKFLOWS.length} workflows instead of ${PLAN_WORKFLOWS.length}`)
for (const id of PLAN_WORKFLOWS) check(findWorkflow(id) !== undefined, `workflow declared by the plan is missing: ${id}`)
for (const workflow of BUILT_IN_WORKFLOWS) {
  checks += 1
  try {
    validateWorkflow(workflow)
  } catch (error) {
    throw new Error(`built-in workflow ${workflow.id} does not satisfy its own rules: ${String(error)}`)
  }
}

// --- Every one of the nine declarations is mandatory -------------------------
const NINE = ["capability", "scope", "sandbox", "costUnits", "timeoutMs", "retry", "output", "approval", "reversible"] as const
for (const field of NINE) {
  const step = base() as unknown as Record<string, unknown>
  delete step[field]
  refuses(() => validateWorkflow(wrap(step as unknown as StepDeclaration)), `a step without "${field}" was accepted`)
}
check(NINE.length === 9, "the mandatory declaration list is not the nine the plan requires")

// --- Field-level validation ---------------------------------------------------
refuses(() => validateWorkflow(wrap({ ...base(), id: "X" })), "a non-kebab step id was accepted")
refuses(() => validateWorkflow(wrap({ ...base(), capability: "workspace.teleport" as never })), "an unknown capability was accepted")
refuses(() => validateWorkflow(wrap({ ...base(), scope: "" })), "an empty scope was accepted")
refuses(() => validateWorkflow(wrap({ ...base(), sandbox: "vm" as never })), "an unknown sandbox was accepted")
refuses(() => validateWorkflow(wrap({ ...base(), costUnits: -1 })), "a negative cost was accepted")
refuses(() => validateWorkflow(wrap({ ...base(), timeoutMs: 0 })), "a zero timeout was accepted")
refuses(() => validateWorkflow(wrap({ ...base(), timeoutMs: 60 * 60 * 1000 })), "a timeout beyond the ceiling was accepted")
refuses(() => validateWorkflow(wrap({ ...base(), retry: { attempts: 99, backoffMs: 0 } })), "a retry count beyond the ceiling was accepted")
refuses(() => validateWorkflow(wrap({ ...base(), output: { name: "", kind: "text" } })), "an unnamed output was accepted")
refuses(() => validateWorkflow(wrap({ ...base(), output: { name: "x", kind: "pdf" as never } })), "an unknown output kind was accepted")
refuses(() => validateWorkflow({ id: "dup-workflow", version: 1, title: "d", steps: [base(), base()] }), "duplicate step ids were accepted")
refuses(() => validateWorkflow({ id: "empty-workflow", version: 1, title: "e", steps: [] }), "a workflow without steps was accepted")
refuses(() => validateWorkflow({ ...wrap(base()), version: 0 }), "version zero was accepted")

// --- Cross-field rules the plan states ---------------------------------------
refuses(() => validateWorkflow(wrap({ ...base(), reversible: false, approval: "none", retry: { attempts: 0, backoffMs: 0 } })), "an irreversible step without approval was accepted")
refuses(() => validateWorkflow(wrap({ ...base(), reversible: false, approval: "required", retry: { attempts: 2, backoffMs: 100 } })), "an irreversible step with retries was accepted")
checks += 1
validateWorkflow(wrap({ ...base(), reversible: false, approval: "required", retry: { attempts: 0, backoffMs: 0 } }))

for (const capability of ["terminal.run", "desktop.control", "secret.read", "package.install", "network.request", "remote.respond"] as const) {
  const sandbox = capability === "terminal.run" || capability === "network.request" ? "docker" : "none"
  refuses(() => validateWorkflow(wrap({ ...base(), capability, sandbox, approval: "none" })), `critical capability ${capability} was accepted without approval`)
}
for (const capability of ["terminal.run", "network.request", "browser.navigate"] as const) {
  refuses(() => validateWorkflow(wrap({ ...base(), capability, sandbox: "none", approval: "required" })), `${capability} was accepted with sandbox "none"`)
}

// --- Budgeting and capability discovery --------------------------------------
const releasePrep = findWorkflow("release-prep")
check(releasePrep !== undefined, "release-prep is missing")
check(workflowCost(releasePrep!) === releasePrep!.steps.reduce((total, step) => total + step.costUnits, 0), "workflowCost does not sum the declared costs")
const capabilities = workflowCapabilities(releasePrep!)
check(capabilities.includes("terminal.run") && capabilities.includes("artifact.export"), "capability discovery missed a declared capability")
check(new Set(capabilities).size === capabilities.length, "capability discovery returned duplicates")

// --- Projection onto the runtime ----------------------------------------------
const definition = toRuntimeDefinition(releasePrep!, "ws-1")
check(definition.workspaceId === "ws-1" && definition.steps.length === releasePrep!.steps.length, "projection lost steps or scope")
const exportStep = definition.steps.find((step) => step.id === "export-bundle")
check(exportStep?.requiresApproval === true, "the irreversible export step lost its approval requirement in projection")
check((exportStep?.input as { reversible: boolean }).reversible === false, "the projection dropped the reversibility declaration")
check((exportStep?.input as { sandbox: string }).sandbox === "none", "the projection dropped the sandbox declaration")
refuses(() => toRuntimeDefinition({ ...wrap({ ...base(), reversible: false, approval: "none", retry: { attempts: 0, backoffMs: 0 } }) }, "ws-1"), "projection accepted an invalid workflow")

// --- The projection is deliberately contract-only ----------------------------
// Execution belongs to the substrate-backed runtime after ADR-000; this test
// must not recreate the removed V1 executor as a competing authority.
const projected = toRuntimeDefinition(findWorkflow("document-from-folder")!, "ws-1")
check(projected.steps.every((step) => typeof step.id === "string"), "projection produced an invalid runtime step")
check(toRuntimeDefinition(releasePrep!, "ws-1").steps.some((step) => step.requiresApproval), "projection lost approval requirements")

console.log(`WorkflowCatalog: ${checks}/${checks} passed`)
