import type { Agent, Project, ProviderListResponse } from "../../types/sdk-shim"

export const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

function isAgent(input: unknown): input is Agent {
  if (!input || typeof input !== "object") return false
  const item = input as { name?: unknown; mode?: unknown }
  if (typeof item.name !== "string") return false
  return item.mode === "subagent" || item.mode === "primary" || item.mode === "all"
}

export function normalizeAgentList(input: unknown): Agent[] {
  if (Array.isArray(input)) return input.filter(isAgent)
  if (isAgent(input)) return [input]
  if (!input || typeof input !== "object") return []
  return Object.values(input).filter(isAgent)
}

export function visibleAgents(input: Agent[]) {
  const preferredOrder = ["chat", "plan", "debate", "build", "auto"]
  const rank = (name: string) => {
    const index = preferredOrder.indexOf(name)
    return index === -1 ? preferredOrder.length : index
  }
  return input
    .filter((item) => item.mode !== "subagent" && !item.hidden && !item.app_hidden)
    .map((item, index) => ({ item, index }))
    .sort((a, b) => rank(a.item.name) - rank(b.item.name) || a.index - b.index)
    .map(({ item }) => item)
}

export function normalizeProviderList(input: ProviderListResponse): ProviderListResponse {
  return {
    ...input,
    all: input.all.map((provider) => ({
      ...provider,
      models: Object.fromEntries(Object.entries(provider.models).filter(([, info]) => info.status !== "deprecated")),
    })),
  }
}

export function sanitizeProject(project: Project) {
  if (!project.icon?.url && !project.icon?.override) return project
  return {
    ...project,
    icon: {
      ...project.icon,
      url: undefined,
      override: undefined,
    },
  }
}
