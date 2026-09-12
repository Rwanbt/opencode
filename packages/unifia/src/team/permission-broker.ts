import { createHash, randomUUID } from "node:crypto"
import { isAbsolute, relative, resolve } from "node:path"

const DEFAULT_TTL_MS = 120_000
const MAX_TTL_MS = 300_000
const DEFAULT_MAX_USES = 1

export type PermissionResourceKind = "path" | "network" | "prompt" | "log" | "event" | "subprocess"
export type PermissionOperation = "read" | "write" | "invoke" | "network" | "execute" | "emit"

export interface PermissionResource {
  kind: PermissionResourceKind
  value: string
}

export interface PermissionGrantInput {
  grantId: string
  runId: string
  taskId: string
  workerId: string
  providerId?: string
  operations: readonly PermissionOperation[]
  resource: PermissionResource
  ttlMs?: number
  maxUses?: number
  handleOnly?: boolean
  requiresHumanApproval?: boolean
  leaseId?: string
  fencingToken?: number
}

export interface PermissionRequest {
  grantId: string
  runId: string
  taskId: string
  workerId: string
  operation: PermissionOperation
  resource: PermissionResource
  providerId?: string
  nonce?: string
  leaseId?: string
  fencingToken?: number
  approvalId?: string
}

export interface ProviderHandle {
  readonly handleId: string
  readonly grantId: string
  readonly providerId: string
  readonly nonce: string
  readonly expiresAt: number
}

export interface PermissionDecision {
  readonly allowed: boolean
  readonly reason:
    | "ALLOWED"
    | "DEFAULT_DENY"
    | "GRANT_NOT_FOUND"
    | "REVOKED"
    | "EXPIRED"
    | "IDENTITY_MISMATCH"
    | "OPERATION_DENIED"
    | "RESOURCE_DENIED"
    | "PROVIDER_DENIED"
    | "LEASE_MISMATCH"
    | "APPROVAL_REQUIRED"
    | "QUOTA_EXHAUSTED"
    | "HANDLE_REQUIRED"
    | "NONCE_REQUIRED"
  readonly expiresAt?: number
  readonly remainingUses?: number
}

export interface PermissionAuditEntry {
  readonly at: number
  readonly action: "GRANT" | "AUTHORIZE" | "HANDLE_ISSUED" | "HANDLE_USED" | "REVOKE"
  readonly grantId: string
  readonly result: PermissionDecision["reason"] | "ISSUED" | "USED"
  readonly resourceHash: string
  readonly operation?: PermissionOperation
  readonly providerId?: string
}

export interface PermissionBrokerOptions {
  now?: () => number
  onAudit?: (entry: PermissionAuditEntry) => void
}

interface StoredGrant extends PermissionGrantInput {
  readonly expiresAt: number
  remainingUses: number
}

interface StoredHandle {
  readonly handle: ProviderHandle
  readonly nonce: string
  readonly grantId: string
  used: boolean
}

function assertNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) throw new TypeError(`${field} must not be empty`)
}

function assertBoundedTtl(ttlMs: number): void {
  if (!Number.isInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_TTL_MS) {
    throw new RangeError(`ttlMs must be an integer between 1 and ${MAX_TTL_MS}`)
  }
}

function assertQuota(maxUses: number): void {
  if (!Number.isInteger(maxUses) || maxUses <= 0) throw new RangeError("maxUses must be a positive integer")
}

function hashResource(resource: PermissionResource): string {
  return createHash("sha256").update(`${resource.kind}:${resource.value}`).digest("hex")
}

function pathWithin(root: string, candidate: string): boolean {
  const rootPath = resolve(root)
  const candidatePath = resolve(candidate)
  const remainder = relative(rootPath, candidatePath)
  return remainder === "" || (remainder !== ".." && !remainder.startsWith(`..${requireSeparator()}`) && !isAbsolute(remainder))
}

function requireSeparator(): string {
  return process.platform === "win32" ? "\\" : "/"
}

function resourceMatches(scope: PermissionResource, requested: PermissionResource): boolean {
  if (scope.kind !== requested.kind) return false
  if (scope.kind === "path") return pathWithin(scope.value, requested.value)
  if (scope.kind === "network") {
    try {
      const allowed = new URL(scope.value)
      const actual = new URL(requested.value)
      return allowed.protocol === actual.protocol &&
        allowed.hostname === actual.hostname &&
        (allowed.port === "" || allowed.port === actual.port)
    } catch {
      return false
    }
  }
  return scope.value === requested.value
}

export class PermissionBroker {
  readonly #now: () => number
  readonly #onAudit?: (entry: PermissionAuditEntry) => void
  readonly #grants = new Map<string, StoredGrant>()
  readonly #revoked = new Set<string>()
  readonly #approvals = new Map<string, Set<string>>()
  readonly #handles = new Map<string, StoredHandle>()
  readonly #audit: PermissionAuditEntry[] = []

  constructor(options: PermissionBrokerOptions = {}) {
    this.#now = options.now ?? Date.now
    this.#onAudit = options.onAudit
  }

  grant(input: PermissionGrantInput): void {
    assertNonEmpty(input.grantId, "grantId")
    assertNonEmpty(input.runId, "runId")
    assertNonEmpty(input.taskId, "taskId")
    assertNonEmpty(input.workerId, "workerId")
    assertNonEmpty(input.resource.value, "resource.value")
    if (input.operations.length === 0) throw new TypeError("operations must not be empty")
    const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS
    const maxUses = input.maxUses ?? DEFAULT_MAX_USES
    assertBoundedTtl(ttlMs)
    assertQuota(maxUses)
    if (input.fencingToken !== undefined && (!Number.isInteger(input.fencingToken) || input.fencingToken < 0)) {
      throw new RangeError("fencingToken must be a non-negative integer")
    }
    this.#grants.set(input.grantId, { ...input, expiresAt: this.#now() + ttlMs, remainingUses: maxUses })
    this.#revoked.delete(input.grantId)
    this.#approvals.delete(input.grantId)
    this.#record({ at: this.#now(), action: "GRANT", grantId: input.grantId, result: "ALLOWED", resourceHash: hashResource(input.resource) })
  }

  approve(grantId: string, approvalId: string): void {
    assertNonEmpty(grantId, "grantId")
    assertNonEmpty(approvalId, "approvalId")
    const approvals = this.#approvals.get(grantId) ?? new Set<string>()
    approvals.add(approvalId)
    this.#approvals.set(grantId, approvals)
  }

  revoke(grantId: string): void {
    this.#revoked.add(grantId)
    for (const [handleId, stored] of this.#handles) {
      if (stored.grantId === grantId) this.#handles.delete(handleId)
    }
    this.#record({ at: this.#now(), action: "REVOKE", grantId, result: "REVOKED", resourceHash: "" })
  }

  authorize(request: PermissionRequest): PermissionDecision {
    const decision = this.#check(request, false)
    if (decision.allowed) {
      const grant = this.#grants.get(request.grantId)
      if (grant) grant.remainingUses--
    }
    this.#record({
      at: this.#now(),
      action: "AUTHORIZE",
      grantId: request.grantId,
      result: decision.reason,
      resourceHash: hashResource(request.resource),
      operation: request.operation,
      providerId: request.providerId,
    })
    return decision
  }

  issueProviderHandle(request: PermissionRequest): ProviderHandle | null {
    const decision = this.#check(request, true)
    if (!decision.allowed || !request.providerId) {
      this.#record({ at: this.#now(), action: "HANDLE_ISSUED", grantId: request.grantId, result: decision.reason, resourceHash: hashResource(request.resource), providerId: request.providerId })
      return null
    }
    const grant = this.#grants.get(request.grantId)
    if (!grant) return null
    const nonce = request.nonce ?? randomUUID()
    const handle: ProviderHandle = { handleId: `hnd_${randomUUID()}`, grantId: grant.grantId, providerId: request.providerId, nonce, expiresAt: grant.expiresAt }
    this.#handles.set(handle.handleId, { handle, nonce, grantId: grant.grantId, used: false })
    this.#record({ at: this.#now(), action: "HANDLE_ISSUED", grantId: request.grantId, result: "ISSUED", resourceHash: hashResource(request.resource), providerId: request.providerId })
    return handle
  }

  useProviderHandle(handleId: string, request: PermissionRequest): PermissionDecision {
    const stored = this.#handles.get(handleId)
    if (!stored || stored.used || stored.handle.grantId !== request.grantId || stored.handle.providerId !== request.providerId) {
      const decision = { allowed: false, reason: "DEFAULT_DENY" as const }
      this.#record({ at: this.#now(), action: "HANDLE_USED", grantId: request.grantId, result: decision.reason, resourceHash: hashResource(request.resource), operation: request.operation, providerId: request.providerId })
      return decision
    }
    if (request.nonce !== stored.nonce) {
      const decision = { allowed: false, reason: "NONCE_REQUIRED" as const }
      this.#record({ at: this.#now(), action: "HANDLE_USED", grantId: request.grantId, result: decision.reason, resourceHash: hashResource(request.resource), operation: request.operation, providerId: request.providerId })
      return decision
    }
    const decision = this.#check(request, true)
    if (!decision.allowed) {
      this.#record({ at: this.#now(), action: "HANDLE_USED", grantId: request.grantId, result: decision.reason, resourceHash: hashResource(request.resource), operation: request.operation, providerId: request.providerId })
      return decision
    }
    stored.used = true
    const grant = this.#grants.get(request.grantId)
    if (grant) grant.remainingUses--
    this.#record({ at: this.#now(), action: "HANDLE_USED", grantId: request.grantId, result: "USED", resourceHash: hashResource(request.resource), operation: request.operation, providerId: request.providerId })
    return { ...decision, remainingUses: grant?.remainingUses }
  }
  audit(): readonly PermissionAuditEntry[] {
    return this.#audit.slice()
  }

  #check(request: PermissionRequest, handleOnlyCheck: boolean): PermissionDecision {
    const grant = this.#grants.get(request.grantId)
    if (!grant) return { allowed: false, reason: "GRANT_NOT_FOUND" }
    if (this.#revoked.has(grant.grantId)) return { allowed: false, reason: "REVOKED" }
    if (this.#now() >= grant.expiresAt) return { allowed: false, reason: "EXPIRED", expiresAt: grant.expiresAt }
    if (grant.runId !== request.runId || grant.taskId !== request.taskId || grant.workerId !== request.workerId) {
      return { allowed: false, reason: "IDENTITY_MISMATCH" }
    }
    if (grant.providerId !== request.providerId) return { allowed: false, reason: "PROVIDER_DENIED" }
    if (!grant.operations.includes(request.operation)) return { allowed: false, reason: "OPERATION_DENIED" }
    if (!resourceMatches(grant.resource, request.resource)) return { allowed: false, reason: "RESOURCE_DENIED" }
    if (grant.leaseId !== request.leaseId || grant.fencingToken !== request.fencingToken) return { allowed: false, reason: "LEASE_MISMATCH" }
    if (grant.requiresHumanApproval && (!request.approvalId || !this.#approvals.get(grant.grantId)?.has(request.approvalId))) {
      return { allowed: false, reason: "APPROVAL_REQUIRED" }
    }
    if (grant.handleOnly && handleOnlyCheck === false) return { allowed: false, reason: "HANDLE_REQUIRED" }
    if (grant.remainingUses <= 0) return { allowed: false, reason: "QUOTA_EXHAUSTED" }
    return { allowed: true, reason: "ALLOWED", expiresAt: grant.expiresAt, remainingUses: grant.remainingUses }
  }

  #record(entry: PermissionAuditEntry): void {
    this.#audit.push(entry)
    this.#onAudit?.(entry)
  }
}
