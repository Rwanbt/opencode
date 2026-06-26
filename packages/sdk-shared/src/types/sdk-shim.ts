/**
 * SDK type shim — Phase 5 follow-up of Phase 4.3 regen.
 *
 * Why: the Phase 4.3 SDK regen (commit cc8816f188) replaced top-level model
 * types (Message, Part, Session, FileNode, FileContent, ...) with route-shaped
 * wrappers (*Data/*Response) only. Consumers across packages/app,
 * packages/ui, packages/plugin, and packages/opencode still reference the old
 * names — this file restores them as structural type aliases sourced from the
 * route shapes, so consumer code can stay source-compatible while the SDK
 * evolves toward thin route types.
 *
 * Phase 7.2: this shim moved out of packages/app/src/types into the
 * @opencode-ai/sdk-shared workspace package so it can be imported by app,
 * ui, plugin, and backend from a single source of truth. The app/ui shims
 * are now thin re-exports of this file.
 *
 * When to delete this file: once consumers import model types from a stable
 * location (e.g. a dedicated `@opencode-ai/sdk/v2/model` subpath or a
 * package-local definition backed by the backend Zod schema).
 */
import type {
  CommandListResponses,
  ConfigGetResponses,
  EventSubscribeResponses,
  FileListResponses,
  FileReadResponses,
  LspStatusResponses,
  McpStatusResponses,
  PathGetResponses,
  ProjectListResponses,
  ProviderAuthResponses,
  ProviderListResponses,
  ProviderOauthAuthorizeResponses,
  SessionChildrenResponses,
  SessionDiffResponses,
  SessionListResponses,
  SessionMessagesResponses,
  SessionStatusResponses,
  SessionTodoResponses,
  ExperimentalWorkspaceListResponses,
  FormatterStatusResponses,
} from "@opencode-ai/sdk/v2/client"
import type { Model as ModelV1, Provider as ProviderV1 } from "@opencode-ai/sdk"

// ----- Session -----
// SessionListResponses[200] is Array<Session>.
export type Session = SessionListResponses[200][number]

// ----- Message -----
// SessionMessagesResponses[200] is Array<{info: Message, parts: Part[]}>.
type MessageEnvelope = SessionMessagesResponses[200][number]
export type Message = MessageEnvelope["info"]
export type Part = MessageEnvelope["parts"][number]

// Discriminated subtypes pulled out for readability at consumer callsites.
export type UserMessage = Extract<Message, { role: "user" }>
export type AssistantMessage = Extract<Message, { role: "assistant" }>

// Part subtypes — discriminated on `type`. Same backend Zod source
// (packages/opencode/src/session/message-v2.ts).
export type TextPart = Extract<Part, { type: "text" }>
export type FilePart = Extract<Part, { type: "file" }>
export type AgentPart = Extract<Part, { type: "agent" }>
export type ReasoningPart = Extract<Part, { type: "reasoning" }>
export type ToolPart = Extract<Part, { type: "tool" }>
export type StepStartPart = Extract<Part, { type: "step-start" }>
export type StepFinishPart = Extract<Part, { type: "step-finish" }>
export type SnapshotPart = Extract<Part, { type: "snapshot" }>
export type PatchPart = Extract<Part, { type: "patch" }>
export type RetryPart = Extract<Part, { type: "retry" }>
export type SubtaskPart = Extract<Part, { type: "subtask" }>
export type CompactionPart = Extract<Part, { type: "compaction" }>

// Part-input subtypes — used by prompt-input/build-request-parts.ts when
// building the prompt payload. Aliased to the same shapes since the
// input/output shape is structurally compatible.
export type TextPartInput = TextPart
export type FilePartInput = FilePart
export type AgentPartInput = AgentPart

// ----- File -----
// FileReadResponses[200] is the file-content shape (text | binary, with
// optional patch/diff/mimeType/encoding).
export type FileContent = FileReadResponses[200]
// FileListResponses[200] is Array<FileNode>.
export type FileNode = FileListResponses[200][number]
// SessionDiffResponses[200] is Array<FileDiff>.
export type FileDiff = SessionDiffResponses[200][number]

// ----- Session status -----
// SessionStatusResponses[200] is the full status payload (a Record from
// sessionID to variant). The shim historically exposed this full payload as
// `SessionStatus`, but consumers always treat `state.session_status[sessionID]`
// as a single variant (e.g. `sessionStatus().type !== "idle"`). Re-exposing
// the full Record through the index signature `[key: string]: VariantUnion`
// broke TS2367 discrimination on `status.type === "retry"` because the index
// signature widened `.type` from the literal union to the whole VariantUnion.
//
// Fix: expose SessionStatus as the discriminated union of single variants.
// Consumers can now narrow via `if (status.type === "retry")` and read
// variant-specific fields like `.attempt` / `.message` / `.next` without
// the index signature swallowing the narrowing.
//
// The full response shape is still available as `SessionStatusResponse`
// from the SDK v2 re-export (via @opencode-ai/sdk/v2/client). The shim does
// not re-export it because the SDK already provides it via the *Responses
// union pattern. Consumers import SessionStatusResponse through the shared
// package without needing a local alias.
export type SessionStatus =
  | { type: "idle" }
  | { type: "retry"; attempt: number; message: string; next: number }
  | { type: "busy" }
  | { type: "queued" }
  | { type: "blocked"; reason?: string }
  | { type: "awaiting_input"; question?: string }
  | { type: "completed"; result?: string }
  | { type: "failed"; error?: string }
  | { type: "cancelled" }

// ----- Todo -----
// SessionTodoResponses[200] is Array<Todo>.
export type Todo = SessionTodoResponses[200][number]

// ----- Question / Permission -----
// PermissionRequest / QuestionRequest were exported from the SDK client
// pre-regen but the regen dropped them as well. Fall back to a permissive
// shape that lets consumers call methods like `.includes()` and read fields
// like `.branch` / `.id` without a TS7006 cascade. Tighten once the SDK
// exposes the typed shapes.
export type PermissionRequest = {
  [key: string]: any
  id: string
  sessionID: string
  permission?: string
  pattern?: string
  patterns?: string[]
  metadata?: any
  always?: string[]
  tool?: { messageID: string; callID: string }
}
export type QuestionRequest = {
  [key: string]: any
  id: string
  sessionID: string
  questions?: any[]
}

// QuestionInfo / QuestionAnswer are derived fields on a question request.
// QuestionAnswer is a per-question array of selected option labels (the
// consumer at packages/opencode/src/cli/cmd/tui/routes/session/question.tsx
// treats each answer entry as a string[]: indexOf/push/splice/filter and
// passes it directly to sdk.client.question.reply which expects
// `answers: string[][]`). The previous `{ answer?: string }` shape was the
// pre-regen top-level alias; the regen dropped it and the consumer expects
// the array shape that matches the SDK's QuestionReplyData body.
export type QuestionInfo = {
  [key: string]: any
  question?: string
  header?: string
  options?: Array<{ label: string; description?: string }>
}
export type QuestionAnswer = string[]

// ----- Event -----
// EventSubscribeResponses[200] is the union of all SSE event shapes.
// Consumers that discriminated on `Event` pre-regen should switch to checking
// `event.type` against the literal strings documented in the EventSubscribe
// route response.
export type Event = EventSubscribeResponses[200]
// EventSessionError was a top-level alias pre-regen. Re-export the extracted
// discriminated variant so consumers like notification.tsx can index the
// error field without an inline Extract at every callsite.
export type EventSessionError = Extract<Event, { type: "session.error" }>
// EventMessagePartUpdated / EventMessagePartDelta — top-level aliases for
// the part-update SSE events. Re-export the extracted discriminated variants
// so test files (test/acp/event-subscription.test.ts) can construct payloads
// without an inline Extract at every callsite.
export type EventMessagePartUpdated = Extract<Event, { type: "message.part.updated" }>
export type EventMessagePartDelta = Extract<Event, { type: "message.part.delta" }>
// ToolStatePending / ToolStateRunning — discriminated variants of
// ToolPart["state"]. Mirrors the Zod schemas in
// packages/opencode/src/session/message-v2.ts (ToolStatePending/Running).
// The shim can only expose structural shapes; tightening to the exact Zod
// payload requires backend-side exposure of the typed schemas.
export type ToolStatePending = Extract<ToolPart["state"], { status: "pending" }>
export type ToolStateRunning = Extract<ToolPart["state"], { status: "running" }>

// ----- Config -----
// ConfigGetResponses[200] is the global config snapshot.
export type Config = ConfigGetResponses[200]

// ----- Workspace -----
// Phase 7.2 addition: Workspace is referenced by packages/plugin/src/tui.ts
// (workspace.list / workspace.get). The v2 SDK exposes the typed shape under
// `ExperimentalWorkspaceListResponses` (route /experimental/workspace). The
// shape includes `extra: unknown | null` which gives consumers a permissive
// catch-all for backend-populated fields without an explicit type extension.
// Tighten by extracting the typed `Workspace` shape into the SDK proper.
export type Workspace = ExperimentalWorkspaceListResponses[200][number]

// ----- Formatter status -----
// FormatterStatusResponses[200] is Array<{name, extensions, enabled}> — the
// per-formatter status payload returned by GET /formatter. Phase 7.3
// addition: backend context/sync.tsx imports this as a single-item type.
export type FormatterStatus = FormatterStatusResponses[200][number]

// ----- MCP resource -----
// McpResource was a top-level alias pre-regen. The SDK does not expose a
// typed shape post-regen. Fall back to a permissive shape so consumers
// in packages/opencode/src/cli/cmd/tui/context/sync.tsx can read fields
// without a TS7006 cascade. Tighten once the SDK surfaces the typed shape.
export type McpResource = {
  [key: string]: any
  uri?: string
  name?: string
  description?: string
  mimeType?: string
}

// ----- Agent / Command / Project -----
// ProjectListResponses[200] is Array<Project>. The `Agent`, `Command`, and
// `Project` types pre-regen had richer shapes (Command.description,
// Project.branch/mode/hidden/source). The regen SDK only carries the basic
// project list shape, so we add a permissive index signature to let
// consumers reach fields populated at runtime without a TS7006/TS2339 cascade.
// Tighten once the SDK exposes the richer sub-types.
export type Project = ProjectListResponses[200][number] & {
  [key: string]: unknown
  branch?: string
  mode?: string
  hidden?: boolean
  description?: string
  source?: { value: string; start: number; end: number }
}
// Agent — the backend Zod schema in
// packages/opencode/src/agent/agent.ts (Agent.Info) is the runtime contract:
//   { name, description?, mode: "subagent"|"primary"|"all", native?, hidden?,
//     topP?, temperature?, color?, permission?, model?, variant?, prompt?,
//     options?, steps?, mcp? }
// The previous shim derived Agent from ProjectListResponses[200][number]
// which has fields the runtime Agent.Info never carries (id, worktree, time,
// sandboxes), causing TS2345 cascade at setStore("agent", reconcile(...))
// in packages/opencode/src/cli/cmd/tui/context/sync.tsx:414. Redefine Agent
// explicitly so consumer code stays source-compatible. Keep [key: string]:
// unknown so consumers can reach any future Zod extension without an extra
// round-trip through the shim.
export type Agent = {
  name: string
  description?: string
  mode: "all" | "primary" | "subagent"
  native?: boolean
  hidden?: boolean
  topP?: number
  temperature?: number
  color?: string
  permission?: Array<{ permission: string; pattern?: string; action: "allow" | "ask" | "deny" }>
  model?: { providerID: string; modelID: string }
  variant?: string
  prompt?: string
  options?: Record<string, any>
  steps?: number
  mcp?: { allow?: string[]; deny?: string[] }
  [key: string]: unknown
}
export type Command = CommandListResponses[200][number] & {
  [key: string]: unknown
  description?: string
  trigger?: string
  keybind?: string
}

// ----- Provider auth -----
// ProviderAuthResponses[200] is Record<string, Array<{type,label,prompts?}>> —
// the list of auth methods available per provider (api/oauth).
// ProviderOauthAuthorizeResponses[200] is {url, method, instructions} — the
// authorize response for one oauth method.
export type ProviderAuthAuthorization = ProviderOauthAuthorizeResponses[200]
export type ProviderAuthMethod = ProviderAuthResponses[200][string][number]

// ----- Provider list -----
// ProviderListResponses[200] is {all: Provider[], default, connected}.
// ProviderListResponse comes from the SDK v2 re-export (the *Responses
// union pattern). The shim does not redeclare it to avoid TS2308 conflict
// with the SDK. Consumers import ProviderListResponse through the shared
// package without needing a local alias.
//
// Phase 7.3 widening: Provider historically came from the SDK v2 route
// response shape (provider.all[number]). After the regen, the backend
// constructs Provider objects at runtime that carry both v1 contract
// fields (providerID, api, capabilities) AND v2 list-shape fields
// (source, env, options, etc.). Union the two sources and normalize the
// models field to the widened Model shape so consumers like
// dialog-model.tsx:89 can read info.providerID (a ProviderHook contract
// field) without a per-call cast. Without the Omit/models override, the
// union's models field would resolve to the slim v2 list Model shape that
// omits providerID/api/capabilities, breaking both UI consumers and the
// plugin hook (copilot.ts:47/59 passes provider.models as the hook return).
export type Provider = Omit<ProviderListResponses[200]["all"][number] | ProviderV1, "models"> & {
  models: Record<string, Model>
  [key: string]: unknown
}

// ----- V1 aliases for plugin compat -----
// Phase 7.2 addition: packages/plugin/src/index.ts:14 imports
// `ProviderV2`/`ModelV2` from `@opencode-ai/sdk/v2` for the
// ProviderHook.models() signature. The v2 regen dropped those top-level
// types. Re-export the v1 shapes (which still exist) as `ProviderV2`/
// `ModelV2` so the plugin compiles without touching the hook contract.
//
// Also re-export `Model` directly because some plugin imports use
// `import { Model as ModelV2 }` syntax and need the source name visible.
//
// Phase 7.3 widening: the backend (packages/opencode/src/provider/
// provider.ts + plugin/github-copilot/*) constructs Model objects at runtime
// that extend the v1 shape with fields the SDK doesn't model yet
// (capabilities.interleaved, limit.input, family, release_date, variants).
// Re-declare Model with the runtime contract so consumer code (test fixtures,
// plugin hook returns, transcript formatters) can construct or access these
// fields without TS2353 (excess property check) or TS2339 (property missing)
// cascades. The strict v1 contract is preserved under ModelV1 for plugin
// code that wants the full contract.
//
// WHY v1 base: the SDK has not yet finished the v2 migration for Provider/Model.
// Until the v2 SDK exposes a typed Provider/Model top-level alias, this
// re-export keeps the plugin source-compatible. Remove when v2 surfaces
// the typed shapes natively.
export type Model = Omit<ModelV1, "capabilities" | "limit"> & {
  capabilities: ModelV1["capabilities"] & {
    interleaved?: boolean | { field: "reasoning_content" | "reasoning_details" }
  }
  limit: ModelV1["limit"] & { input?: number }
  family?: string
  release_date?: string
  variants?: Record<string, { [key: string]: unknown }>
  [key: string]: unknown
}
export type { ModelV1 as ModelV1, ModelV1 as ModelV2, ProviderV1 as ProviderV1, ProviderV1 as ProviderV2 }

// ----- Auth response -----
// ProviderAuthResponse comes from the SDK v2 re-export (the *Responses
// union pattern). The shim does not redeclare it to avoid TS2308 conflict
// with the SDK. Consumers import ProviderAuthResponse through the shared
// package without needing a local alias.

// ----- Children -----
// SessionChildrenResponses[200] is the child-sessions list shape.
export type SessionChild = SessionChildrenResponses[200][number]

// ----- LSP / MCP / Path / VCS -----
// LspStatusResponses / McpStatusResponses / PathGetResponses are the
// shapes used by the global state in packages/app/src/context/global-sync.
export type LspStatus = LspStatusResponses[200][number] & { [key: string]: any }
export type McpStatus = McpStatusResponses[200][number] & { [key: string]: any }
export type Path = PathGetResponses[200] & { [key: string]: any }
export type VcsInfo = {
  [key: string]: any
  branch?: string
  default_branch?: string
}

// ----- Git -----
// GitBranchEntry / GitCommitEntry / GitOpResult / GitWorkingStatusEntry
// were route response payloads pre-regen. The regen renamed the wrappers
// to Git*Data / Git*Response. Fall back to a permissive shape so consumers
// like source-control.tsx can read branch/sha/etc without a TS7006 cascade.
export type GitBranchEntry = {
  [key: string]: any
  name?: string
  commit?: string
  parent?: string
  subject?: string
}
export type GitCommitEntry = {
  [key: string]: any
  sha?: string
  subject?: string
  author?: string
}
export type GitOpResult = {
  [key: string]: any
  ok?: boolean
  error?: string
}
export type GitWorkingStatusEntry = {
  [key: string]: any
  status?: string
  file?: string
}