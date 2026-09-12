import type { McpServer } from "@agentclientprotocol/sdk"
import type { UnifiaClient } from "@unifia/sdk-shared"
import type { ProviderID, ModelID } from "../provider/schema"

export interface ACPSessionState {
  id: string
  cwd: string
  mcpServers: McpServer[]
  createdAt: Date
  model?: {
    providerID: ProviderID
    modelID: ModelID
  }
  variant?: string
  modeId?: string
}

export interface ACPConfig {
  sdk: UnifiaClient
  defaultModel?: {
    providerID: ProviderID
    modelID: ModelID
  }
}
