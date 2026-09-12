import { createHash } from "node:crypto";

export const READ_ONLY_TOOLS = ["read", "list", "search"] as const;
export type ReadOnlyTool = (typeof READ_ONLY_TOOLS)[number];

export interface WorkerRuntimeRequest {
  readonly parentSessionId: string;
  readonly taskId: string;
  readonly capsule: Readonly<Record<string, unknown>>;
  readonly tools: readonly ReadOnlyTool[];
  readonly timeoutMs: number;
}

export interface ChildSession {
  readonly id: string;
}

export interface WorkerRuntimeAdapter {
  createChildSession(input: { parentSessionId: string; taskId: string; readOnly: true }): Promise<ChildSession>;
  injectCapsule(session: ChildSession, capsule: Readonly<Record<string, unknown>>, contextHash: string): Promise<void>;
  grantTools(session: ChildSession, tools: readonly ReadOnlyTool[]): Promise<void>;
  streamEvents(session: ChildSession, onEvent: (event: WorkerRuntimeEvent) => void): Promise<void>;
  cancel(session: ChildSession, reason: "timeout" | "aborted" | "crashed"): Promise<void>;
}

export interface WorkerRuntimeEvent {
  readonly type: string;
  readonly payload?: unknown;
}

export interface WorkerRuntimeResult {
  readonly status: "COMPLETED" | "CANCELLED" | "TIMED_OUT" | "CRASHED";
  readonly sessionId: string;
  readonly contextHash: string;
  readonly events: readonly WorkerRuntimeEvent[];
  readonly error?: string;
}

export function contextHash(capsule: Readonly<Record<string, unknown>>): string {
  return createHash("sha256").update(canonicalJson(capsule)).digest("hex");
}

export function validateReadOnlyTools(tools: readonly string[]): readonly ReadOnlyTool[] {
  const unique: ReadOnlyTool[] = [];
  for (const tool of tools) {
    if (!READ_ONLY_TOOLS.includes(tool as ReadOnlyTool)) {
      throw new TypeError(`tool ${tool} is not permitted in a read-only child session`);
    }
    if (!unique.includes(tool as ReadOnlyTool)) unique.push(tool as ReadOnlyTool);
  }
  return unique;
}

export class ChildSessionWorkerRuntime {
  async run(request: WorkerRuntimeRequest, adapter: WorkerRuntimeAdapter, signal?: AbortSignal): Promise<WorkerRuntimeResult> {
    validateRequest(request);
    const tools = validateReadOnlyTools(request.tools);
    const hash = contextHash(request.capsule);
    const session = await adapter.createChildSession({
      parentSessionId: request.parentSessionId,
      taskId: request.taskId,
      readOnly: true,
    });
    const events: WorkerRuntimeEvent[] = [];
    try {
      await adapter.injectCapsule(session, request.capsule, hash);
      await adapter.grantTools(session, tools);
      await this.streamWithCancellation(session, request.timeoutMs, signal, adapter, (event) => events.push(event));
      return { status: "COMPLETED", sessionId: session.id, contextHash: hash, events };
    } catch (error) {
      const reason = classifyFailure(error, signal);
      await adapter.cancel(session, reason);
      return {
        status: reason === "timeout" ? "TIMED_OUT" : reason === "aborted" ? "CANCELLED" : "CRASHED",
        sessionId: session.id,
        contextHash: hash,
        events,
        error: error instanceof Error ? error.message : "child session failed",
      };
    }
  }

  private async streamWithCancellation(
    session: ChildSession,
    timeoutMs: number,
    signal: AbortSignal | undefined,
    adapter: WorkerRuntimeAdapter,
    onEvent: (event: WorkerRuntimeEvent) => void,
  ): Promise<void> {
    const timeout = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error("child session timeout")), timeoutMs);
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new Error("child session aborted"));
      }, { once: true });
    });
    await Promise.race([adapter.streamEvents(session, onEvent), timeout]);
  }
}

function validateRequest(request: WorkerRuntimeRequest): void {
  if (!request.parentSessionId.trim()) throw new TypeError("parentSessionId must not be empty");
  if (!request.taskId.trim()) throw new TypeError("taskId must not be empty");
  if (!Number.isInteger(request.timeoutMs) || request.timeoutMs <= 0) throw new RangeError("timeoutMs must be positive");
}

function classifyFailure(error: unknown, signal: AbortSignal | undefined): "timeout" | "aborted" | "crashed" {
  if (signal?.aborted) return "aborted";
  if (error instanceof Error && error.message === "child session timeout") return "timeout";
  return "crashed";
}

function canonicalJson(value: unknown): string {
  const normalized = stableValue(value);
  const encoded = JSON.stringify(normalized);
  if (encoded === undefined) throw new TypeError("capsule must be JSON serializable");
  return encoded;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stableValue(child)]));
  }
  return value;
}

export interface WriteWorkerRuntimeRequest {
  readonly primaryWorkspacePath: string;
  readonly worktreePath: string;
  readonly branch: string;
  readonly fencingToken: number;
  readonly command: string;
  readonly allowedCommands: readonly string[];
  readonly timeoutMs: number;
}

export interface ScopeWatcher {
  assertClean(): void | Promise<void>;
  stop(): void | Promise<void>;
}

export interface WriteWorkerRuntimeAdapter {
  verifyFencing(request: WriteWorkerRuntimeRequest): void | Promise<void>;
  startScopeWatcher(request: WriteWorkerRuntimeRequest): ScopeWatcher;
  execute(request: WriteWorkerRuntimeRequest): void | Promise<void>;
  rollback(request: WriteWorkerRuntimeRequest): void | Promise<void>;
}

export interface WriteWorkerRuntimeResult {
  readonly status: "COMPLETED" | "ROLLED_BACK" | "ROLLBACK_FAILED";
  readonly branch: string;
  readonly worktreePath: string;
  readonly error?: string;
}

export class WriteWorkerRuntime {
  async run(request: WriteWorkerRuntimeRequest, adapter: WriteWorkerRuntimeAdapter): Promise<WriteWorkerRuntimeResult> {
    validateWriteRequest(request);
    if (samePath(request.primaryWorkspacePath, request.worktreePath)) {
      throw new Error("write runtime refuses the primary workspace");
    }
    if (!request.allowedCommands.includes(request.command)) {
      throw new Error(`command ${request.command} is not allowed by the scope manifest`);
    }
    await adapter.verifyFencing(request);
    const watcher = adapter.startScopeWatcher(request);
    try {
      await withWriteTimeout(adapter.execute(request), request.timeoutMs);
      await watcher.assertClean();
      return { status: "COMPLETED", branch: request.branch, worktreePath: request.worktreePath };
    } catch (error) {
      try {
        await adapter.rollback(request);
        return {
          status: "ROLLED_BACK",
          branch: request.branch,
          worktreePath: request.worktreePath,
          error: error instanceof Error ? error.message : "write execution failed",
        };
      } catch (rollbackError) {
        return {
          status: "ROLLBACK_FAILED",
          branch: request.branch,
          worktreePath: request.worktreePath,
          error: rollbackError instanceof Error ? rollbackError.message : "rollback failed",
        };
      }
    } finally {
      await watcher.stop();
    }
  }
}

function validateWriteRequest(request: WriteWorkerRuntimeRequest): void {
  if (!request.primaryWorkspacePath.trim() || !request.worktreePath.trim()) throw new TypeError("workspace paths must not be empty");
  if (!request.branch.trim()) throw new TypeError("branch must not be empty");
  if (!Number.isInteger(request.fencingToken) || request.fencingToken <= 0) throw new RangeError("fencingToken must be positive");
  if (!Number.isInteger(request.timeoutMs) || request.timeoutMs <= 0) throw new RangeError("timeoutMs must be positive");
}

function samePath(left: string, right: string): boolean {
  return left.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase() === right.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
}

async function withWriteTimeout(operation: void | Promise<void>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("write runtime timeout")), timeoutMs);
  });
  try {
    await Promise.race([Promise.resolve(operation), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
