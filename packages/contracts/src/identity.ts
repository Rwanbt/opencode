/* SPDX-License-Identifier: MIT */
/**
 * Worker identity — Plan V2.3.1 §104, ADR-008.
 *
 * A WorkerId is the durable identity a worker process presents when it
 * joins a control plane. The proof is a signature made with the key
 * that ADR-010 binds to this worker at provisioning time; a control
 * plane that does not hold the matching public key refuses the join.
 *
 * The `version` field is the schema version of the WorkerId payload
 * itself, not of the worker process. Future fields are added by
 * bumping the version, not by overloading existing ones.
 *
 * `platform` is opaque — it carries whatever the OS / arch string the
 * provisioning step captured (e.g. "linux-x64", "darwin-arm64",
 * "win32-x64"). Matching against it is the schedulability check, not
 * here.
 *
 * `scopes` (added C-M1-08, M1-05 EVIDENCE §5) is the set of ownership
 * scopes this worker is authorized to operate in. `scopes[0]` is the
 * **primary scope** (the "home" workspace) and the remaining entries
 * are explicit delegations. The Capability Authority enforcer
 * (C-M1-08) refuses any execution that targets a scope not in this
 * list, and the scope-chain check (TM-T-02) requires the requested
 * deployment to be owned by the primary scope.
 *
 * Backward compatibility: `scopes` is `.default([])`, so legacy
 * WorkerIds that do not carry the field parse cleanly into an empty
 * scope list — the enforcer will then refuse all executions with
 * `CAPABILITY_NOT_IN_SCOPE`, which is the correct fail-closed behavior.
 * Once a control plane mints WorkerIds with `scopes` set, the enforcer
 * opens up to that worker.
 */
import { z } from "zod"
import { OwnershipScopeSchema } from "./scope.js"

export const WorkerIdSchema = z.object({
  /** Stable worker identifier (UUID / ULID / opaque handle). */
  workerId: z.string(),
  /** Signature of the remaining fields, produced by the ADR-010 key. */
  identityProof: z.string(),
  /** Schema version of this WorkerId payload. */
  version: z.string(),
  /** OS + arch string captured at provisioning time. */
  platform: z.string(),
  /** Capability tokens the worker has been issued (e.g. ["network.outbound"]). */
  capabilities: z.array(z.string()).readonly(),
  /** Execution profile ids the worker claims to satisfy (e.g. ["docker", "wasm"]). */
  executionProfiles: z.array(z.string()).readonly(),
  /** Coarse resource bucket (e.g. "small", "medium", "large", "gpu"). */
  resourceClass: z.string(),
  /**
   * Ownership scopes the worker is authorized to operate in. `scopes[0]`
   * is the primary scope (the worker's "home" workspace); subsequent
   * entries are explicit delegations. Defaults to `[]` for backward
   * compatibility with WorkerIds minted before C-M1-08.
   *
   * Why not derive scopes from `capabilities` (capability.scope)?
   *   - Couples two independent dimensions (what vs. where).
   *   - Prevents simple enumeration of authorized workspaces.
   *   - Complicates ADR-008 (TrustClass in WorkerId), which is about
   *     identity, not authorization.
   */
  scopes: z.array(OwnershipScopeSchema).readonly().default([]),
})

export type WorkerId = z.infer<typeof WorkerIdSchema>
