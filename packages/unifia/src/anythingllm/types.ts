import z from "zod"

export const AnythingLLMWorkspace = z.object({
  id: z.number(),
  name: z.string(),
  slug: z.string(),
  vectorTag: z.string().nullable().optional(),
  createdAt: z.string(),
  openAiTemp: z.number().nullable().optional(),
  openAiHistory: z.number().nullable().optional(),
  lastUpdatedAt: z.string(),
  chatModel: z.string().nullable().optional(),
  pfpFilename: z.string().nullable().optional(),
  agentModel: z.string().nullable().optional(),
  agentProvider: z.string().nullable().optional(),
})
export type AnythingLLMWorkspace = z.infer<typeof AnythingLLMWorkspace>

export const AnythingLLMDocument = z.object({
  name: z.string(),
  url: z.string().optional(),
  title: z.string().optional(),
  docpath: z.string(),
  description: z.string().optional(),
  wordCount: z.number().optional(),
  cached: z.boolean().optional(),
  pinned: z.boolean().optional(),
})
export type AnythingLLMDocument = z.infer<typeof AnythingLLMDocument>

export const AnythingLLMSearchResult = z.object({
  text: z.string(),
  score: z.number(),
  document: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
})
export type AnythingLLMSearchResult = z.infer<typeof AnythingLLMSearchResult>

export const AnythingLLMChatMessage = z.object({
  id: z.string(),
  type: z.enum(["user", "assistant"]),
  textResponse: z.string(),
  sources: z.array(z.any()).optional(),
  close: z.boolean().optional(),
  error: z.string().nullable().optional(),
})
export type AnythingLLMChatMessage = z.infer<typeof AnythingLLMChatMessage>
