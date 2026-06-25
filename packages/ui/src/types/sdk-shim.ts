/**
 * SDK type shim — Phase 5 follow-up of Phase 4.3 regen.
 *
 * Mirror of packages/app/src/types/sdk-shim.ts. The two shims are kept in
 * sync manually because packages/ui has no reverse dependency on packages/app.
 * When the SDK eventually exposes a stable `model` subpath, delete both.
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
} from "@opencode-ai/sdk/v2"

// Re-export the SDK entry so consumers can swap the import path to this shim
// without losing access to OpencodeClient and the *Data/*Response wrappers
// they still consume alongside the shim's structural aliases.
export * from "@opencode-ai/sdk/v2"

export type Session = SessionListResponses[200][number]

type MessageEnvelope = SessionMessagesResponses[200][number]
export type Message = MessageEnvelope["info"]
export type Part = MessageEnvelope["parts"][number]

export type UserMessage = Extract<Message, { role: "user" }>
export type AssistantMessage = Extract<Message, { role: "assistant" }>

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

export type TextPartInput = TextPart
export type FilePartInput = FilePart
export type AgentPartInput = AgentPart

export type FileContent = FileReadResponses[200]
export type FileNode = FileListResponses[200][number]
export type FileDiff = SessionDiffResponses[200][number]

// SessionStatusResponses[200] is the full status payload (Record from
// sessionID to variant). The shim historically exposed this Record as
// `SessionStatus`, but consumers always treat `state.session_status[sessionID]`
// as a single variant. Re-exposing the full Record through the index
// signature `[key: string]: VariantUnion` broke TS2367 discrimination on
// `status.type === "retry"`.
//
// Fix: expose SessionStatus as the discriminated union of single variants.
// Full response shape available as `SessionStatusResponse` for the rare
// cases where the consumer needs the whole Record.
export type SessionStatusResponse = SessionStatusResponses[200]
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
export type Todo = SessionTodoResponses[200][number]

export type PermissionRequest = { [key: string]: any; id?: string; permission?: string; pattern?: string; metadata?: any; always?: string[] }
export type QuestionRequest = { [key: string]: any; id?: string; questions?: any[] }
export type QuestionInfo = { [key: string]: any; question?: string; header?: string; options?: Array<{ label: string; description?: string }> }
export type QuestionAnswer = { [key: string]: any; answer?: string }

export type Event = EventSubscribeResponses[200]
export type Config = ConfigGetResponses[200]

export type Project = ProjectListResponses[200][number] & {
  [key: string]: unknown
  branch?: string
  mode?: string
  hidden?: boolean
  description?: string
  source?: { value: string; start: number; end: number }
}
export type Agent = ProjectListResponses[200][number] & {
  [key: string]: unknown
  name: string
  color?: string
  model?: { providerID: string; modelID: string }
  variant?: string
}
export type Command = CommandListResponses[200][number] & {
  [key: string]: unknown
  description?: string
  trigger?: string
  keybind?: string
}

export type ProviderAuthAuthorization = ProviderOauthAuthorizeResponses[200]
export type ProviderAuthMethod = ProviderAuthResponses[200][string][number]
export type ProviderAuthResponse = ProviderAuthResponses[200]

export type ProviderListResponse = ProviderListResponses[200]
export type Provider = ProviderListResponses[200]["all"][number]

export type SessionChild = SessionChildrenResponses[200][number]

export type LspStatus = LspStatusResponses[200][number] & { [key: string]: any }
export type McpStatus = McpStatusResponses[200][number] & { [key: string]: any }
export type Path = PathGetResponses[200] & { [key: string]: any }
export type VcsInfo = { [key: string]: any; branch?: string; default_branch?: string }

export type GitBranchEntry = { [key: string]: any; name?: string; commit?: string; parent?: string; subject?: string }
export type GitCommitEntry = { [key: string]: any; sha?: string; subject?: string; author?: string }
export type GitOpResult = { [key: string]: any; ok?: boolean; error?: string }
export type GitWorkingStatusEntry = { [key: string]: any; status?: string; file?: string }