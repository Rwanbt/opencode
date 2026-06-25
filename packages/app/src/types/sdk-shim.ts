/**
 * SDK type shim — Phase 5 follow-up of Phase 4.3 regen.
 *
 * Why: the Phase 4.3 SDK regen (commit cc8816f188) replaced top-level model
 * types (Message, Part, Session, FileNode, FileContent, ...) with route-shaped
 * wrappers (*Data/*Response) only. Consumers across packages/app and
 * packages/ui still reference the old names — this file restores them as
 * structural type aliases sourced from the route shapes, so the app code can
 * stay source-compatible while the SDK evolves toward thin route types.
 *
 * When to delete this file: once consumers import model types from a stable
 * location (e.g. a dedicated `@opencode-ai/sdk/v2/model` subpath or a
 * package-local definition backed by the backend Zod schema).
 */
import type {
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
} from "@opencode-ai/sdk/v2"

// Re-export the SDK entry point (and client entry) so consumers can swap the
// import path to this shim without losing access to OpencodeClient and the
// route-shaped *Data/*Response wrappers they still consume alongside the
// shim's structural aliases.
export * from "@opencode-ai/sdk/v2/client"

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
// SessionStatusResponses[200] is the full status payload.
export type SessionStatus = SessionStatusResponses[200]

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
  id?: string
  permission?: string
  pattern?: string
  metadata?: any
  always?: string[]
}
export type QuestionRequest = {
  [key: string]: any
  id?: string
  questions?: any[]
}

// QuestionInfo / QuestionAnswer are derived fields on a question request.
export type QuestionInfo = {
  [key: string]: any
  question?: string
  header?: string
  options?: Array<{ label: string; description?: string }>
}
export type QuestionAnswer = {
  [key: string]: any
  answer?: string
}

// ----- Event -----
// EventSubscribeResponses[200] is the union of all SSE event shapes.
// Consumers that discriminated on `Event` pre-regen should switch to checking
// `event.type` against the literal strings documented in the EventSubscribe
// route response.
export type Event = EventSubscribeResponses[200]

// ----- Config -----
// ConfigGetResponses[200] is the global config snapshot.
export type Config = ConfigGetResponses[200]

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
export type Agent = ProjectListResponses[200][number] & { [key: string]: unknown }
export type Command = ProjectListResponses[200][number] & {
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
export type ProviderListResponse = ProviderListResponses[200]
export type Provider = ProviderListResponses[200]["all"][number]

// ----- Auth response -----
// The legacy `ProviderAuthResponse` was a top-level alias for the auth
// methods response — Record<string, Array<Method>>.
export type ProviderAuthResponse = ProviderAuthResponses[200]

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