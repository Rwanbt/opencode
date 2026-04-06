import z from "zod"

export const OllamaModel = z.object({
  name: z.string(),
  model: z.string().optional(),
  modified_at: z.string().optional(),
  size: z.number().optional(),
  digest: z.string().optional(),
  details: z
    .object({
      parent_model: z.string().optional(),
      format: z.string().optional(),
      family: z.string().optional(),
      families: z.array(z.string()).nullable().optional(),
      parameter_size: z.string().optional(),
      quantization_level: z.string().optional(),
    })
    .optional(),
})
export type OllamaModel = z.infer<typeof OllamaModel>

export const OllamaModelList = z.object({
  models: z.array(OllamaModel),
})

export const OllamaPullProgress = z.object({
  status: z.string(),
  digest: z.string().optional(),
  total: z.number().optional(),
  completed: z.number().optional(),
})
export type OllamaPullProgress = z.infer<typeof OllamaPullProgress>

export const OllamaModelInfo = z.object({
  modelfile: z.string().optional(),
  parameters: z.string().optional(),
  template: z.string().optional(),
  details: z
    .object({
      parent_model: z.string().optional(),
      format: z.string().optional(),
      family: z.string().optional(),
      families: z.array(z.string()).nullable().optional(),
      parameter_size: z.string().optional(),
      quantization_level: z.string().optional(),
    })
    .optional(),
})
export type OllamaModelInfo = z.infer<typeof OllamaModelInfo>
