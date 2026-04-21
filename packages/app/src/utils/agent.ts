const defaults: Record<string, string> = {
  ask: "var(--icon-agent-ask-base)",
  build: "var(--icon-agent-build-base)",
  docs: "var(--icon-agent-docs-base)",
  plan: "var(--icon-agent-plan-base)",
}

export function agentColor(name: string, custom?: string) {
  if (custom) return custom
  return defaults[name] ?? defaults[name.toLowerCase()]
}

export function messageAgentColor(
  list: readonly { role: string; agent?: string }[] | undefined,
  agents: readonly { name: string; color?: string }[],
) {
  if (!list) return undefined
  for (let i = list.length - 1; i >= 0; i--) {
    const item = list[i]
    if (item.role !== "user" || !item.agent) continue
    return agentColor(item.agent, agents.find((agent) => agent.name === item.agent)?.color)
  }
}

export function buildAgentColorMap(agents: readonly { name: string; color?: string }[]): Map<string, string | undefined> {
  const m = new Map<string, string | undefined>()
  for (const a of agents) m.set(a.name, a.color)
  return m
}

export function messageAgentColorMemo(
  list: readonly { role: string; agent?: string }[] | undefined,
  colorMap: Map<string, string | undefined>,
): string | undefined {
  if (!list) return undefined
  for (let i = list.length - 1; i >= 0; i--) {
    const item = list[i]
    if (item.role !== "user" || !item.agent) continue
    return agentColor(item.agent, colorMap.get(item.agent))
  }
}
