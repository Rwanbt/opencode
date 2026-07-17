import z from "zod"

export const CaptureModeSchema = z.enum(["local_metadata", "local_redacted"])

export const CapturePolicyInputSchema = z.object({
  enabled: z.boolean().optional(),
  captureMode: CaptureModeSchema.optional(),
  userIdHmac: z.string().regex(/^[0-9a-f]{64}$/).optional(),
}).strict()

export type CapturePolicy = {
  enabled: boolean
  level: z.infer<typeof CaptureModeSchema>
  userIdHmac?: string
  policyVersion: 3
}

export function resolveCapturePolicy(input: unknown): CapturePolicy {
  const config = CapturePolicyInputSchema.parse(input ?? {})
  return {
    enabled: config.enabled === true,
    level: config.captureMode ?? "local_metadata",
    userIdHmac: config.userIdHmac,
    policyVersion: 3,
  }
}
