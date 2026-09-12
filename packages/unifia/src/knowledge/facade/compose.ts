/* SPDX-License-Identifier: MIT */
/**
 * Production composition point (card C4).
 *
 * This is the only place that turns a workspace path into a working
 * `KnowledgeService`. It exists because the operator-editable policy at
 * `<workspace>/.unifia/policy.json` had no effect on retrieval: `readPolicy`
 * was called only by the `policy` CLI subcommand and a read-only report,
 * while the CLI built its plan with a hardcoded
 * `{ providerId: "x", defaultRestriction: "allow" }`.
 *
 * Everything that reaches a provider is now derived from the policy on disk,
 * and a missing or malformed policy file fails closed (see `readPolicy`).
 */

import { isAbsolute, join } from "node:path"
import { existsSync } from "node:fs"
import type { ProviderDestinationPlan, DestinationKind } from "@unifia/contracts/knowledge"
import { SourceRegistry } from "../source/source.js"
import { VaultSource } from "../source/vault.js"
import { PersonalSource } from "../source/personal.js"
import { ProjectSource } from "../source/project.js"
import { readPolicy, type KnowledgePolicy } from "../policy/store.js"
import { KnowledgeFailure } from "../domain/errors.js"
import { DefaultKnowledgeService } from "./service.js"
import { DomainBus } from "../events/bus.js"
import { InMemoryEgressAudit, type ReadableEgressAudit } from "../policy/audit.js"
import { PersistentEgressAudit } from "../policy/control-log.js"
import { GrantRegistry } from "../policy/grant.js"
import { VaultMutationWriter } from "../mutation/writer.js"

/** Where the personal space lives inside a workspace. */
export const PERSONAL_SUBDIR = "memory"

export interface ComposeInput {
  /** Absolute path to the workspace root. */
  workspaceRoot: string
  /**
   * Enable Class A writes. Off by default: a read-only composition cannot
   * mutate the vault even if a caller asks it to.
   */
  writable?: boolean
  /** Destination the resulting packs are bound for. */
  providerId: string
  /**
   * Whether that destination stays on the machine. Omitted means remote,
   * so an unspecified destination is treated as leaving the workspace.
   */
  destinationKind?: DestinationKind
  /**
   * Keep the egress trail only in memory.
   *
   * Off by default: ADR-KNOW-0006 §6 wants a persisted Class C control log,
   * and a trail that dies with the process cannot answer *did this note ever
   * leave?* after the incident that made someone ask. Callers that must not
   * write into the workspace at all opt out here, and accept that their
   * decisions leave no record.
   */
  ephemeralAudit?: boolean
  /**
   * Destinations the operator opened from the application's own settings.
   *
   * Consulted only where `.unifia/policy.json` is silent: a vault that has
   * stated its own posture for a destination keeps it, and this cannot
   * overrule it. It exists because the two files answer different questions
   * — the vault policy says what this vault permits at all, the application
   * config says whether this application sends memory to a cloud model — and
   * folding the second into the first at vault-creation time made it a
   * decision the user could take exactly once, then never change without
   * hand-editing JSON.
   *
   * It is not a way for code to widen a refusal: every entry here comes from
   * a setting the user wrote, and the note's own portable restriction still
   * governs on top of it (ADR-KNOW-0006 §1).
   */
  operatorEgress?: Record<string, "allow" | "deny">
}

export interface Composed {
  service: DefaultKnowledgeService
  registry: SourceRegistry
  policy: KnowledgePolicy
  plan: ProviderDestinationPlan
  /** Spaces that were actually mounted, for `status` to report honestly. */
  mounted: string[]
  /** True when a policy file existed; false when the built-in default applied. */
  policyFromFile: boolean
  /** Every egress decision this composition took (ADR-KNOW-0006 §6). */
  audit: ReadableEgressAudit
  /** Present when the trail is persisted, so a caller can flush it. */
  controlLog?: PersistentEgressAudit
  /**
   * Declassification grants (ADR-KNOW-0006 §3).
   *
   * Empty unless something issues one: the guard consults it only after a
   * deny, so an untouched registry leaves V1 behaviour exactly as it was.
   */
  grants: GrantRegistry
  /** The bus the audit emits `egress.decision` on. */
  bus: DomainBus
}

/**
 * Build the `ProviderDestinationPlan` from the workspace policy.
 *
 * The policy decides; nothing downstream may widen it. A destination with no
 * explicit entry inherits `policy.egress`, which defaults to `deny`.
 */
export function planFromPolicy(
  policy: KnowledgePolicy,
  providerId: string,
  destinationKind?: DestinationKind,
  operatorEgress?: Record<string, "allow" | "deny">,
): ProviderDestinationPlan {
  const key =
    destinationKind === "local" ? `provider:${providerId}` : `provider:${providerId}:remote`
  // The vault's own file first: where it has spoken about a destination, no
  // application setting may answer for it.
  const explicit =
    policy.egressByDestination[key] ??
    policy.egressByDestination[providerId] ??
    operatorEgress?.[key] ??
    operatorEgress?.[providerId]

  let defaultRestriction: ProviderDestinationPlan["defaultRestriction"]
  if (explicit !== undefined) {
    defaultRestriction = explicit
  } else if (destinationKind === "local") {
    // PERMISSIONS.md §3: a local provider defaults to allow. `policy.egress`
    // governs what leaves the machine; reading one's own vault on-device is
    // not egress, and gating it on that switch would make an unconfigured
    // workspace unreadable. The note's own `local_model` restriction still
    // applies, and an operator can still deny a local destination by name.
    defaultRestriction = "allow"
  } else {
    defaultRestriction = policy.egress
  }

  const plan: ProviderDestinationPlan = { providerId, defaultRestriction }
  if (destinationKind !== undefined) plan.destinationKind = destinationKind
  return plan
}

/**
 * Compose the service for a workspace.
 *
 * Only spaces that exist on disk are mounted. A workspace without a
 * `memory/` directory mounts the project space alone rather than
 * advertising a personal space that would answer nothing.
 */
export function composeKnowledgeService(input: ComposeInput): Composed {
  if (!isAbsolute(input.workspaceRoot)) {
    throw KnowledgeFailure.pathUnresolved(
      `workspaceRoot must be absolute, got ${input.workspaceRoot}`,
    )
  }
  if (!existsSync(input.workspaceRoot)) {
    throw KnowledgeFailure.pathUnresolved(`workspace does not exist: ${input.workspaceRoot}`)
  }

  const policyFromFile = existsSync(join(input.workspaceRoot, ".unifia", "policy.json"))
  const policy = readPolicy(input.workspaceRoot)
  const plan = planFromPolicy(
    policy,
    input.providerId,
    input.destinationKind,
    input.operatorEgress,
  )

  const registry = new SourceRegistry()
  const mounted: string[] = []

  const personalRoot = join(input.workspaceRoot, PERSONAL_SUBDIR)
  if (existsSync(personalRoot)) {
    registry.register(
      new PersonalSource(
        { spaceId: "personal" },
        new VaultSource({
          root: personalRoot,
          space: { kind: "personal", id: "personal", label: "Personal" },
        }),
      ),
    )
    mounted.push("personal")
  }

  // The workspace root is the project space, and `memory/` sits inside it.
  // The project vault must skip it: an earlier comment here claimed
  // retrieval deduped these two views, which it did not — the same note was
  // returned twice, under two locators and two spaces, inflating counts,
  // ranking and budgets.
  registry.register(
    new ProjectSource(
      { projectRef: input.providerId },
      new VaultSource({
        root: input.workspaceRoot,
        space: { kind: "project", id: "project", label: "Project" },
        excludeDirectories: [PERSONAL_SUBDIR],
      }),
    ),
  )
  mounted.push("project")

  // The writer targets the personal space when one exists, otherwise the
  // workspace root — the same corpus the reader mounts.
  const writer = input.writable === true
    ? new VaultMutationWriter({ root: existsSync(personalRoot) ? personalRoot : input.workspaceRoot })
    : undefined

  // Wired here rather than defaulted to a no-op: an audit sink that is
  // optional everywhere is an audit sink that is never present, which is how
  // ADR-KNOW-0006 §6 came to be declared and never emitted.
  const bus = new DomainBus()
  const controlLog =
    input.ephemeralAudit === true ? undefined : new PersistentEgressAudit(input.workspaceRoot, bus)
  controlLog?.flushOnExit()
  const audit: ReadableEgressAudit = controlLog ?? new InMemoryEgressAudit(bus)

  // Consulted by the guard only after a deny. Nothing issues a grant here:
  // widening a refusal is an act of consent, and a composition function is
  // not where consent is given.
  const grants = new GrantRegistry()

  const service = new DefaultKnowledgeService(registry, { providerPlan: plan, audit, grants }, {
    audit,
    ...(writer !== undefined ? { writer } : {}),
    // V1 has no FTS5 runtime and no embedding model. These stay false until
    // a real backend is wired; `status` reports them verbatim.
    ftsEnabled: false,
    // A policy flag states an intention; `status` must state a fact. This
    // reported vector: true from the flag alone, with no model and no
    // backend. It flips when a loader is actually wired.
    vectorEnabled: false,
  })

  return {
    service,
    registry,
    policy,
    plan,
    mounted,
    policyFromFile,
    audit,
    grants,
    bus,
    ...(controlLog !== undefined ? { controlLog } : {}),
  }
}
