import type { Agent } from "../agent/agent"
import { Permission } from "../permission"
import PROMPT_DEBATE from "../agent/prompt/debate.txt"

export function createDebateAgent(
  defaults: Permission.Ruleset,
  user: Permission.Ruleset,
): Agent.Info {
  return {
    name: "debate",
    description:
      "Collective Intelligence agent that orchestrates multi-model debates. Surfaces blind spots by running N models in parallel, extracting atomic claims, and producing a synthesis report.",
    mode: "primary",
    color: "info",
    native: true,
    permission: Permission.merge(
      defaults,
      Permission.fromConfig({
        "*": "deny",
        read: "allow",
        grep: "allow",
        glob: "allow",
        websearch: "allow",
        webfetch: "allow",
        debate: "allow",
      }),
      user,
    ),
    prompt: PROMPT_DEBATE,
    options: {},
  }
}
