/* SPDX-License-Identifier: MIT */
import { z } from "zod"
import { OwnershipScopeSchema } from "./scope.js"

export const CredentialRefSchema = z.object({
  kind: z.literal("credential"),
  credentialId: z.string(),
  scope: OwnershipScopeSchema,
})
export type CredentialRef = z.infer<typeof CredentialRefSchema>

export const SecretRefSchema = z.object({
  kind: z.literal("secret"),
  secretId: z.string(),
  scope: OwnershipScopeSchema,
})
export type SecretRef = z.infer<typeof SecretRefSchema>

export const OAuthConnectionRefSchema = z.object({
  kind: z.literal("oauth"),
  connectionId: z.string(),
  provider: z.string(),
  scope: OwnershipScopeSchema,
})
export type OAuthConnectionRef = z.infer<typeof OAuthConnectionRefSchema>

export const BrowserAuthProfileRefSchema = z.object({
  kind: z.literal("browser-auth"),
  profileId: z.string(),
  scope: OwnershipScopeSchema,
})
export type BrowserAuthProfileRef = z.infer<typeof BrowserAuthProfileRefSchema>

export const AnyCredentialRefSchema = z.discriminatedUnion("kind", [
  CredentialRefSchema,
  SecretRefSchema,
  OAuthConnectionRefSchema,
  BrowserAuthProfileRefSchema,
])
export type AnyCredentialRef = z.infer<typeof AnyCredentialRefSchema>
