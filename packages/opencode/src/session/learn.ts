import { Effect } from "effect"
import { SessionID } from "./schema"
import { MessageV2 } from "./message-v2"
import { Agent } from "../agent/agent"
import { Provider } from "../provider/provider"
import { LLM } from "./llm"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { Filesystem } from "../util/filesystem"
import path from "path"
import { ProviderID, ModelID } from "../provider/schema"
import { RAG } from "../rag"
import type { ProjectID } from "../project/schema"

const log = Log.create({ service: "session.learn" })
const MIN_MESSAGES_FOR_LEARNING = 6

interface Lesson {
  title: string
  content: string
  tags: string[]
}

export namespace SessionLearn {
  export const extract = Effect.fn("SessionLearn.extract")(function* (input: {
    sessionID: SessionID
    providerID: ProviderID
    modelID: ModelID
    projectID?: ProjectID
  }) {
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service

    // Get messages for this session
    const msgs = yield* MessageV2.filterCompactedEffect(input.sessionID)
    if (msgs.length < MIN_MESSAGES_FOR_LEARNING) {
      log.info("session too short for learning", { sessionID: input.sessionID, messages: msgs.length })
      return
    }

    const ag = yield* agents.get("learner")
    if (!ag) {
      log.warn("learner agent not found")
      return
    }

    const mdl = ag.model
      ? yield* provider.getModel(ag.model.providerID, ag.model.modelID)
      : ((yield* provider.getSmallModel(input.providerID)) ??
        (yield* provider.getModel(input.providerID, input.modelID)))

    const modelMsgs = yield* Effect.promise(() => MessageV2.toModelMessages(msgs, mdl))

    const text = yield* Effect.promise(async (signal) => {
      const result = await LLM.stream({
        agent: ag,
        user: msgs.find((m) => m.info.role === "user")?.info as MessageV2.User,
        system: [],
        small: true,
        tools: {},
        model: mdl,
        abort: signal,
        sessionID: input.sessionID,
        retries: 2,
        messages: [
          ...modelMsgs,
          {
            role: "user",
            content:
              "Analyze this completed session and extract lessons learned. Return ONLY a JSON array as specified in your instructions.",
          },
        ],
      })
      return result.text
    })

    // Parse lessons from response
    const cleaned = text.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim()
    let lessons: Lesson[]
    try {
      // Extract JSON array from response (handle markdown code blocks)
      const jsonMatch = cleaned.match(/\[[\s\S]*\]/)
      if (!jsonMatch) {
        log.info("no lessons extracted", { sessionID: input.sessionID })
        return
      }
      lessons = JSON.parse(jsonMatch[0])
      if (!Array.isArray(lessons) || lessons.length === 0) {
        log.info("no lessons extracted", { sessionID: input.sessionID })
        return
      }
    } catch (e) {
      log.warn("failed to parse lessons", { sessionID: input.sessionID, error: e })
      return
    }

    // Write lessons to .opencode/learnings/
    const date = new Date().toISOString().split("T")[0]
    const filename = `${date}-${input.sessionID.slice(0, 8)}.md`
    const filepath = path.join(Instance.worktree, ".opencode", "learnings", filename)

    const content = lessons
      .map((l) => `### ${l.title}\n\n${l.content}\n\nTags: ${l.tags.map((t) => `\`${t}\``).join(", ")}`)
      .join("\n\n---\n\n")

    const fileContent = `# Session Learnings\n\nDate: ${date}\nSession: ${input.sessionID}\n\n---\n\n${content}\n`

    yield* Effect.promise(() => Filesystem.write(filepath, fileContent))
    log.info("lessons saved", { sessionID: input.sessionID, count: lessons.length, file: filepath })

    // Auto-index learnings into RAG if enabled
    const ragEnabled = yield* Effect.promise(() => RAG.isEnabled())
    if (ragEnabled && input.projectID) {
      yield* Effect.promise(async () => {
        try {
          await RAG.indexLearning(input.projectID!, filepath, fileContent)
        } catch (e) {
          log.warn("failed to index learnings into RAG", { error: e })
        }
      })
    }
  })
}
