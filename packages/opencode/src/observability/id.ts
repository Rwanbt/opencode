import { ulid } from "ulid"

export const ObservabilityId = {
  create: ulid,
  isValid(value: string) {
    return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value)
  },
} as const
