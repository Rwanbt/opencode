import { Effect } from "effect"
import { generateObject } from "ai"
import z from "zod"
import { Provider } from "../provider/provider"
import type { ProviderID, ModelID } from "../provider/schema"
import { Log } from "../util/log"

export namespace RoleAssigner {
  const log = Log.create({ service: "role-assigner" })

  const RoleAssignmentSchema = z.object({
    roles: z.array(
      z.object({
        participantIndex: z.number(),
        role: z.string().describe("Short role name (2-4 words)"),
        perspective: z.string().describe("One sentence describing the perspective to adopt"),
      }),
    ),
  })

  const FALLBACK_ROLES: Record<number, string[]> = {
    2: ["Advocate (strengths & opportunities)", "Critic (risks & weaknesses)"],
    3: [
      "Security & correctness analyst",
      "Architecture & maintainability reviewer",
      "Performance & scalability auditor",
    ],
    4: [
      "Security & correctness analyst",
      "Architecture & design reviewer",
      "Performance & scalability auditor",
      "UX & developer experience advocate",
    ],
    5: [
      "Security & correctness analyst",
      "Architecture & design reviewer",
      "Performance & scalability auditor",
      "UX & developer experience advocate",
      "Devil's advocate & edge case hunter",
    ],
  }

  export const assign = Effect.fn("RoleAssigner.assign")(function* (
    question: string,
    participantCount: number,
    assignerProviderID: ProviderID,
    assignerModelID: ModelID,
    explicitRoles?: Record<string, string>,
  ) {
    if (explicitRoles && Object.keys(explicitRoles).length >= participantCount) {
      log.info("using explicit roles", { count: Object.keys(explicitRoles).length })
      return Object.values(explicitRoles).slice(0, participantCount)
    }

    if (participantCount <= 5) {
      const fallback = FALLBACK_ROLES[participantCount] ?? FALLBACK_ROLES[5]!
      try {
        const model = yield* Effect.promise(() =>
          Provider.getLanguage({
            providerID: assignerProviderID,
            id: assignerModelID,
          } as Provider.Model),
        )

        const result = yield* Effect.tryPromise({
          try: () =>
            generateObject({
              model,
              schema: RoleAssignmentSchema,
              system: ROLE_ASSIGNMENT_PROMPT,
              prompt: `Question: ${question}\nNumber of participants: ${participantCount}`,
              temperature: 0.3,
            }),
          catch: (e) => new Error(`Role assignment failed: ${e}`),
        }).pipe(Effect.orElseSucceed(() => null))

        if (result && result.object.roles.length >= participantCount) {
          const roles = result.object.roles
            .slice(0, participantCount)
            .map((r) => `${r.role}: ${r.perspective}`)
          log.info("dynamic roles assigned", { roles })
          return roles
        }
      } catch {
        // fallthrough to static roles
      }

      log.info("using fallback roles", { count: participantCount })
      return fallback!.slice(0, participantCount)
    }

    const base = FALLBACK_ROLES[5]!
    const extra = participantCount - 5
    const extraRoles = [
      "Data integrity & edge case specialist",
      "Testing & verification strategist",
      "Cost & resource optimization analyst",
    ]
    return [...base, ...extraRoles.slice(0, extra)]
  })

  const ROLE_ASSIGNMENT_PROMPT = `You are a meta-prompt engineer for a collective intelligence system. Given a question and a number of AI participants, assign DIVERSE and COMPLEMENTARY roles.

RULES:
- Each role must cover a DIFFERENT perspective on the question
- Roles should be specific to the question domain, not generic
- Ensure at least one adversarial/critical role
- Ensure at least one constructive/opportunity role
- Roles must not overlap significantly
- Each role gets a "hors rôle" (out-of-role) clause: they can flag insights outside their assigned area

Output roles as short names with one-sentence perspective descriptions.`
}
