/* SPDX-License-Identifier: MIT */

import type { TokenProvider } from "./client.js"

export type NativeTokenRequest = { workspaceId: string; capabilities: readonly string[] }
export type NativeIssuedToken = { token: string; instanceId: string; workspaceId: string; expiresAt: number }
export type NativeTokenRotation = { token: NativeIssuedToken | string; previousToken?: string | null; gracePeriodMs?: number }
export type NativeTokenBridge = {
  issue(request: NativeTokenRequest): Promise<NativeIssuedToken>
  rotate(request: NativeTokenRequest): Promise<NativeTokenRotation>
  revoke(workspaceId: string): Promise<void>
}

function assertIssuedToken(value: NativeIssuedToken, request: NativeTokenRequest): NativeIssuedToken {
  if (!value || typeof value.token !== "string" || value.token.length === 0) throw new Error("native bridge returned an invalid token")
  if (typeof value.instanceId !== "string" || value.instanceId.length === 0) throw new Error("native bridge returned an invalid instance id")
  if (typeof value.workspaceId !== "string" || value.workspaceId.length === 0) throw new Error("native bridge returned an invalid workspace id")
  if (!Number.isSafeInteger(value.expiresAt)) throw new Error("native bridge returned an invalid token expiry")
  if (value.workspaceId !== request.workspaceId) throw new Error("native bridge returned a token for another workspace")
  if (value.expiresAt <= Date.now()) throw new Error("native bridge returned an expired token")
  return value
}

/** Adapts the native bridge without exposing signing material to the WebView. */
export async function createNativeTokenProvider(bridge: NativeTokenBridge, request: NativeTokenRequest): Promise<{ provider: TokenProvider; instanceId: string; workspaceId: string; revoke(): Promise<void> }> {
  let issued = assertIssuedToken(await bridge.issue(request), request)
  const provider: TokenProvider = {
    current: () => issued.token,
    refresh: async () => {
      const rotation = await bridge.rotate(request)
      if (!rotation || typeof rotation !== "object") throw new Error("native bridge returned an invalid rotation")
      const rotated = typeof rotation.token === "string" ? { ...issued, token: rotation.token } : assertIssuedToken(rotation.token, request)
      issued = rotated
      return issued.token
    },
    applyRotation: (rotation) => { issued = { ...issued, token: rotation.token } },
  }
  return { provider, instanceId: issued.instanceId, workspaceId: issued.workspaceId, revoke: () => bridge.revoke(request.workspaceId) }
}
