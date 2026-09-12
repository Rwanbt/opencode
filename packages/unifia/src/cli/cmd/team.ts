// =============================================================================
// cli/cmd/team.ts — TEAM-L04
//
// Headless CLI over the Team surface and its shared server-owned lifecycle.
//
// Built for scripts first. Every subcommand emits JSON on stdout when stdout is
// not a TTY (or when --json is passed), keeps human formatting and progress on
// stderr, and exits with a code a shell can branch on. A pipeline should never
// have to parse a spinner.
//
//   Exit codes (sysexits.h, so they mean the same thing as everywhere else)
//     0   success
//     64  EX_USAGE        the arguments are wrong
//     66  EX_NOINPUT      the run, plan or file does not exist
//     69  EX_UNAVAILABLE  the operation exists but nothing can serve it
//     70  EX_SOFTWARE     an unexpected internal failure
//     130 SIGINT          cancelled by the operator
//
// Lifecycle commands use the running server as the process owner. This keeps
// pause/resume/cancel attached to the same in-memory controllers as the HTTP,
// desktop, TUI and mobile clients instead of pretending a fresh CLI process
// can control workers owned by another process.
// =============================================================================

import type { Argv } from "yargs"
import path from "node:path"
import fs from "node:fs/promises"
import { cmd } from "./cmd"
import { Flag } from "../../flag/flag"
import { Global } from "../../global"
import {
  TeamStore,
  TeamStoreCursorError,
  TEAM_STORE_MAX_PAGE_SIZE,
  type TeamEventRow,
} from "../../team/team-store"
import { TEAM_STORE_SCHEMA_VERSION } from "../../team/team-store.sql"
import { TaskPlanSchema } from "../../team/task-planner"
import {
  simulateDryRun,
  DryRunModelCandidateListSchema,
  DryRunEnvironmentSnapshotSchema,
  type DryRunModelCandidate,
  type DryRunEnvironmentSnapshot,
} from "../../team/dry-run"
import { makeRuntime } from "../../effect/run-service"
import { Registry, LiveRegistryLayer } from "../../model-intelligence/registry"

export const EXIT_OK = 0
export const EXIT_USAGE = 64
export const EXIT_NO_INPUT = 66
export const EXIT_UNAVAILABLE = 69
export const EXIT_SOFTWARE = 70
export const EXIT_INTERRUPTED = 130

/** A failure with the exit code the shell should see. */
class TeamCliError extends Error {
  constructor(
    readonly exitCode: number,
    message: string,
  ) {
    super(message)
    this.name = "TeamCliError"
  }
}

function storePath(): string {
  return path.join(Global.Path.data, "team.db")
}

function openStore(): TeamStore {
  return TeamStore.open(storePath())
}

/**
 * JSON unless a human is looking.
 *
 * Defaulting on `isTTY` rather than requiring --json is what makes this usable
 * from a script that nobody thought to pass a flag to — including CI, cron and
 * anything piping into jq.
 */
function wantsJson(args: { json?: boolean }): boolean {
  if (args.json !== undefined) return args.json
  return !process.stdout.isTTY
}

function emit(args: { json?: boolean }, payload: unknown, human: () => string): void {
  if (wantsJson(args)) {
    process.stdout.write(JSON.stringify({ schemaVersion: TEAM_STORE_SCHEMA_VERSION, ...(payload as object) }, null, 2) + "\n")
    return
  }
  process.stdout.write(human() + "\n")
}

/** Progress goes to stderr so stdout stays a clean data stream. */
function progress(message: string): void {
  process.stderr.write(message + "\n")
}

/**
 * Run a subcommand, mapping failures onto exit codes.
 *
 * yargs swallows a rejected handler into an unhandled rejection and a exit code
 * of 1 for everything, which tells a script nothing about what went wrong.
 */
async function run(fn: () => Promise<void> | void): Promise<void> {
  const onInterrupt = () => {
    process.stderr.write("interrupted\n")
    process.exit(EXIT_INTERRUPTED)
  }
  process.once("SIGINT", onInterrupt)
  process.once("SIGTERM", onInterrupt)
  try {
    await fn()
  } catch (error) {
    if (error instanceof TeamCliError) {
      process.stderr.write(error.message + "\n")
      process.exit(error.exitCode)
    }
    if (error instanceof TeamStoreCursorError || error instanceof RangeError || error instanceof TypeError) {
      process.stderr.write((error as Error).message + "\n")
      process.exit(EXIT_USAGE)
    }
    process.stderr.write((error instanceof Error ? error.message : String(error)) + "\n")
    process.exit(EXIT_SOFTWARE)
  } finally {
    process.off("SIGINT", onInterrupt)
    process.off("SIGTERM", onInterrupt)
  }
}

function requireRun(store: TeamStore, runID: string) {
  const found = store.getRun(runID)
  if (found === null) throw new TeamCliError(EXIT_NO_INPUT, `run ${runID} not found in ${storePath()}`)
  return found
}

function parseLimit(raw: number | undefined): number | undefined {
  if (raw === undefined) return undefined
  if (!Number.isInteger(raw) || raw <= 0 || raw > TEAM_STORE_MAX_PAGE_SIZE) {
    throw new TeamCliError(EXIT_USAGE, `--limit must be an integer between 1 and ${TEAM_STORE_MAX_PAGE_SIZE}`)
  }
  return raw
}

async function readJsonFile(file: string, what: string): Promise<unknown> {
  const resolved = path.resolve(file)
  let text: string
  try {
    text = await fs.readFile(resolved, "utf8")
  } catch {
    throw new TeamCliError(EXIT_NO_INPUT, `cannot read ${what}: ${resolved}`)
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new TeamCliError(EXIT_USAGE, `${what} is not valid JSON (${resolved}): ${(error as Error).message}`)
  }
}

// Must match what server/auth-jwt.ts validates: the isolated UNIFIA_SERVER_*
// pair, defaulting to "unifia". Reading the legacy OPENCODE_ spelling here left
// this the only client that could not authenticate — no shell emits it, and the
// default username disagreed with the server's on top of that.
function authHeaders(): HeadersInit {
  const password = Flag.UNIFIA_SERVER_PASSWORD
  if (!password) return { "content-type": "application/json" }
  const username = Flag.UNIFIA_SERVER_USERNAME ?? "unifia"
  return {
    "content-type": "application/json",
    authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
  }
}

function validateAttachUrl(attach: string): URL {
  let base: URL
  try {
    base = new URL(attach)
  } catch {
    throw new TeamCliError(EXIT_USAGE, `invalid --attach URL: ${attach}`)
  }
  const loopback = base.hostname === "localhost" || base.hostname === "127.0.0.1" || base.hostname === "[::1]"
  if (base.protocol !== "https:" && !(base.protocol === "http:" && loopback)) {
    throw new TeamCliError(EXIT_USAGE, "--attach requires HTTPS except for localhost/127.0.0.1/[::1]")
  }
  return base
}

async function teamRequest(attach: string, route: string, body?: unknown): Promise<unknown> {
  const base = validateAttachUrl(attach)
  const response = await fetch(new URL(`/team${route}`, base), {
    method: "POST",
    headers: authHeaders(),
    redirect: "error",
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch((error) => { throw new TeamCliError(EXIT_UNAVAILABLE, `cannot reach Team server: ${error instanceof Error ? error.message : String(error)}`) })
  const payload = await response.json().catch(() => ({ error: response.statusText })) as { error?: string }
  if (!response.ok) throw new TeamCliError(response.status === 404 ? EXIT_NO_INPUT : EXIT_UNAVAILABLE, payload.error ?? `Team server returned ${response.status}`)
  return payload
}

const TeamStartCommand = cmd({
  command: "start",
  describe: "start a durable Team plan through a running Unifia server",
  builder: (yargs: Argv) => yargs
    .option("attach", { type: "string", demandOption: true, describe: "Unifia server URL" })
    .option("plan", { type: "string", demandOption: true, describe: "TaskPlan JSON file" })
    .option("max-agents", { type: "number", default: 5 })
    .option("max-cost", { type: "number" })
    .option("max-tokens", { type: "number" })
    .option("json", { type: "boolean" }),
  handler: async (args) => run(async () => {
    const plan = TaskPlanSchema.parse(await readJsonFile(args.plan as string, "plan"))
    const payload = await teamRequest(args.attach as string, "/runs", {
      description: plan.tasks.map((task) => task.objective).join("; "),
      tasks: plan.tasks.map((task, index) => ({
        id: task.id,
        description: task.title,
        prompt: `${task.objective}\n\nAcceptance criteria:\n${task.acceptanceCriteria.map((criterion) => `- ${criterion}`).join("\n")}`,
        agent: task.writeSet.length > 0 ? "general" : "explore",
        mode: task.writeSet.length > 0 ? "write" : "read",
        required: true,
        risk: task.risks.length > 0 ? "medium" : "low",
        dependsOn: task.dependsOn,
        readSet: task.readSet,
        writeSet: task.writeSet,
        modelIndex: index,
      })),
      budget: { maxParallel: args.maxAgents, maxCostUsd: args.maxCost, maxTokens: args.maxTokens },
    })
    emit(args, payload as object, () => `Team run accepted: ${(payload as { runId: string }).runId}`)
  }),
})

function controlCommand(operation: "pause" | "resume" | "cancel") {
  return cmd({
    command: `${operation} <runID>`,
    describe: `${operation} an active Team run through a running Unifia server`,
    builder: (yargs: Argv) => yargs
      .positional("runID", { type: "string", demandOption: true })
      .option("attach", { type: "string", demandOption: true, describe: "Unifia server URL" })
      .option("json", { type: "boolean" }),
    handler: async (args) => run(async () => {
      const payload = await teamRequest(args.attach as string, `/runs/${args.runID}/${operation}`)
      emit(args, payload as object, () => `Team run ${args.runID}: ${(payload as { controlStatus: string }).controlStatus}`)
    }),
  })
}
const TeamListCommand = cmd({
  command: "list",
  describe: "list persisted team runs, newest first",
  builder: (yargs: Argv) =>
    yargs
      .option("json", { type: "boolean", describe: "force JSON output (default when stdout is not a TTY)" })
      .option("limit", { type: "number", describe: "page size" })
      .option("cursor", { type: "string", describe: "resume from a previous page's nextCursor" }),
  handler: async (args) =>
    run(() => {
      const store = openStore()
      try {
        const page = store.listRuns({ limit: parseLimit(args.limit), cursor: args.cursor ?? null })
        emit(args, page, () =>
          page.items.length === 0
            ? "no team runs recorded"
            : page.items.map((r) => `${r.runId}  ${r.status.padEnd(9)}  plan=${r.planId}  ${r.updatedAt}`).join("\n"),
        )
      } finally {
        store.close()
      }
    }),
})

const TeamStatusCommand = cmd({
  command: "status <runID>",
  describe: "show a run and the state of its tasks",
  builder: (yargs: Argv) =>
    yargs
      .positional("runID", { type: "string", describe: "run id", demandOption: true })
      .option("json", { type: "boolean", describe: "force JSON output" }),
  handler: async (args) =>
    run(() => {
      const store = openStore()
      try {
        const found = requireRun(store, args.runID as string)
        const tasks = store.listTasks(found.runId)
        const byStatus = new Map<string, number>()
        for (const task of tasks) byStatus.set(task.status, (byStatus.get(task.status) ?? 0) + 1)

        emit(args, { run: found, taskCount: tasks.length, tasksByStatus: Object.fromEntries(byStatus), tasks }, () =>
          [
            `run    ${found.runId}`,
            `status ${found.status}`,
            `plan   ${found.planId}`,
            `tasks  ${tasks.length}` +
              (byStatus.size === 0
                ? ""
                : ` (${[...byStatus].map(([status, count]) => `${status}: ${count}`).join(", ")})`),
          ].join("\n"),
        )
      } finally {
        store.close()
      }
    }),
})

const TeamEventsCommand = cmd({
  command: "events <runID>",
  describe: "replay a run's events in append order",
  builder: (yargs: Argv) =>
    yargs
      .positional("runID", { type: "string", describe: "run id", demandOption: true })
      .option("json", { type: "boolean", describe: "force JSON output" })
      .option("limit", { type: "number", describe: "page size" })
      .option("cursor", { type: "string", describe: "resume after this sequence" })
      .option("all", { type: "boolean", describe: "drain every page instead of one" }),
  handler: async (args) =>
    run(() => {
      const store = openStore()
      try {
        const runID = args.runID as string
        requireRun(store, runID)
        const limit = parseLimit(args.limit)

        if (!args.all) {
          const page = store.listEvents(runID, { limit, cursor: args.cursor ?? null })
          emit(args, page, () => formatEvents(page.items))
          return
        }

        const items: TeamEventRow[] = []
        let cursor: string | null = args.cursor ?? null
        for (;;) {
          const page = store.listEvents(runID, { limit, cursor })
          items.push(...page.items)
          if (page.nextCursor === null) break
          cursor = page.nextCursor
        }
        emit(args, { items, nextCursor: null }, () => formatEvents(items))
      } finally {
        store.close()
      }
    }),
})

function formatEvents(events: readonly TeamEventRow[]): string {
  if (events.length === 0) return "no events"
  return events.map((event) => `${String(event.sequence).padStart(6)}  ${event.occurredAt}  ${event.kind}`).join("\n")
}

const TeamExportCommand = cmd({
  command: "export <runID>",
  describe: "export a run, its tasks, events and gates as a single JSON document",
  builder: (yargs: Argv) =>
    yargs
      .positional("runID", { type: "string", describe: "run id", demandOption: true })
      .option("out", { type: "string", describe: "write to this file instead of stdout" }),
  handler: async (args) =>
    run(async () => {
      const store = openStore()
      try {
        const runID = args.runID as string
        const found = requireRun(store, runID)

        // Drained rather than paged: an export that stops at the first page is
        // not an export, and the caller has no way to tell it was truncated.
        const events: TeamEventRow[] = []
        let cursor: string | null = null
        for (;;) {
          const page = store.listEvents(runID, { limit: TEAM_STORE_MAX_PAGE_SIZE, cursor })
          events.push(...page.items)
          if (page.nextCursor === null) break
          cursor = page.nextCursor
        }

        const document = {
          schemaVersion: TEAM_STORE_SCHEMA_VERSION,
          exportedAt: new Date().toISOString(),
          run: found,
          tasks: store.listTasks(runID),
          events,
          gates: store.listGates(runID),
        }
        const serialized = JSON.stringify(document, null, 2) + "\n"

        if (args.out) {
          const target = path.resolve(args.out)
          await fs.mkdir(path.dirname(target), { recursive: true })
          await fs.writeFile(target, serialized, "utf8")
          progress(`wrote ${events.length} event(s) to ${target}`)
          return
        }
        process.stdout.write(serialized)
      } finally {
        store.close()
      }
    }),
})

const TeamDryRunCommand = cmd({
  command: "dry-run",
  describe: "simulate a plan: waves, cost and duration estimate, blocking issues",
  builder: (yargs: Argv) =>
    yargs
      .option("plan", { type: "string", describe: "path to a task plan JSON file", demandOption: true })
      .option("models", { type: "string", describe: "path to a model candidate list JSON file" })
      .option("environment", { type: "string", describe: "path to an environment snapshot JSON file" })
      .option("json", { type: "boolean", describe: "force JSON output" }),
  handler: async (args) =>
    run(async () => {
      const plan = TaskPlanSchema.parse(await readJsonFile(args.plan as string, "plan"))

      let modelCandidates: readonly DryRunModelCandidate[] = []
      if (args.models) {
        modelCandidates = DryRunModelCandidateListSchema.parse(await readJsonFile(args.models, "model candidates"))
      } else {
        // Falling back to the registry rather than to an empty list: an
        // estimate with no candidates reports "no eligible model" and looks
        // like a plan problem when it is a missing argument.
        progress("no --models given; reading candidates from the model registry")
        modelCandidates = await candidatesFromRegistry()
      }

      const environment: DryRunEnvironmentSnapshot = args.environment
        ? DryRunEnvironmentSnapshotSchema.parse(await readJsonFile(args.environment, "environment snapshot"))
        : {
            snapshotId: "cli-default",
            diskFreeBytes: Number.MAX_SAFE_INTEGER,
            diskRequiredBytesPerTask: 1,
            existingWorktreeCount: 0,
            maxConcurrentWorktrees: plan.tasks.length,
          }

      const report = simulateDryRun({ plan, modelCandidates, environment })

      emit(args, report as unknown as object, () =>
        [
          `tasks       ${plan.tasks.length}`,
          `waves       ${report.waves.length}`,
          `cost        $${report.estimate.costUsd.min.toFixed(4)} - $${report.estimate.costUsd.max.toFixed(4)}`,
          `duration    ${report.estimate.durationSeconds.min}s - ${report.estimate.durationSeconds.max}s`,
          `confidence  ${report.estimate.confidence}`,
          report.estimate.riskFactors.length
            ? "risks       " + report.estimate.riskFactors.join("; ")
            : "risks       none",
        ].join("\n"),
      )

      // A plan the validator rejects is not runnable, and a script piping this
      // into a deploy step needs that as an exit code, not as prose.
      if (!report.graphValidation.valid) {
        throw new TeamCliError(
          EXIT_USAGE,
          `plan is not runnable: ${report.graphValidation.issues.map((issue) => issue.rule).join(", ")}`,
        )
      }
    }),
})

/** Pricing is declared per-1k, per-1m or per-request; the estimator wants per-1m. */
const PER_MILLION_FACTOR: Record<string, number | null> = {
  per_1m_tokens: 1,
  per_1k_tokens: 1_000,
  // A per-request price carries no token dimension, so it cannot be converted.
  // Dropping the model is honest; inventing a rate is not.
  per_request: null,
}

/** Used when the registry has no measured latency for a model. Reported, not hidden. */
const ASSUMED_LATENCY_MS = 2_000

async function candidatesFromRegistry(): Promise<readonly DryRunModelCandidate[]> {
  const { runPromise } = makeRuntime(Registry, LiveRegistryLayer)
  const models = await runPromise((svc) => svc.listModels({ status: "active" })).catch(() => [])

  const candidates: DryRunModelCandidate[] = []
  let unpriced = 0
  for (const model of models) {
    const factor = PER_MILLION_FACTOR[model.pricing.unit]
    if (factor === null || factor === undefined) {
      unpriced++
      continue
    }
    candidates.push({
      modelId: `${model.providerID}/${model.id}`,
      // The registry allows a null family; the estimator requires one, and uses
      // it only to group candidates. The provider is the honest fallback
      // grouping — a literal "unknown" would merge unrelated models into one.
      family: model.family ?? model.providerID,
      lifecycleStage: model.lifecycleStage,
      costPerMillionInputTokens: model.pricing.input * factor,
      costPerMillionOutputTokens: model.pricing.output * factor,
      averageLatencyMs: model.health?.latencyP50Ms ?? ASSUMED_LATENCY_MS,
    })
  }
  if (unpriced > 0) progress(`skipped ${unpriced} model(s) priced per request, which carries no token dimension`)
  progress(`${candidates.length} candidate(s) from the registry`)
  return candidates
}

const TeamRegistrySyncCommand = cmd({
  command: "registry-sync",
  describe: "refresh the model registry from its configured source",
  builder: (yargs: Argv) =>
    yargs
      .option("force", { type: "boolean", describe: "sync even if the registry looks current" })
      .option("no-validate", { type: "boolean", describe: "skip schema validation of the fetched source" })
      .option("json", { type: "boolean", describe: "force JSON output" }),
  handler: async (args) =>
    run(async () => {
      const { runPromise } = makeRuntime(Registry, LiveRegistryLayer)
      progress("syncing model registry…")
      const result = await runPromise((svc) => svc.sync({ force: args.force === true, validate: args.noValidate !== true }))
        .catch((error: unknown) => {
          // The upstream source failing is not this command failing: say which
          // it was, so a retry loop can tell a network blip from a bad flag.
          throw new TeamCliError(
            EXIT_UNAVAILABLE,
            `registry source failed: ${error instanceof Error ? error.message : String(error)}`,
          )
        })

      emit(args, result as unknown as object, () =>
        [
          `source    ${result.sourceID}`,
          `providers ${result.providersCount}`,
          `models    ${result.modelsCount}`,
          `skipped   ${result.skippedCount}`,
          `duration  ${result.durationMs}ms`,
        ].join("\n"),
      )
    }),
})

export const TeamCommand = cmd({
  command: "team",
  describe: "inspect team runs, simulate plans, and sync the model registry",
  builder: (yargs: Argv) =>
    yargs
      .command(TeamListCommand)
      .command(TeamStatusCommand)
      .command(TeamEventsCommand)
      .command(TeamExportCommand)
      .command(TeamDryRunCommand)
      .command(TeamRegistrySyncCommand)
      .command(TeamStartCommand)
      .command(controlCommand("pause"))
      .command(controlCommand("resume"))
      .command(controlCommand("cancel"))
      .demandCommand(1, "specify a team subcommand")
      .strict(),
  handler: async () => {},
})
