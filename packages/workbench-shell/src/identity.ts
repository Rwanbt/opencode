/* SPDX-License-Identifier: MIT */

export type WorkbenchTaskIdentity = {
  codeSessionId?: string
  workbenchSessionId: string
  operationId: string
}

export function createWorkbenchTaskIdentity(input: {
  codeSessionId?: string
  workbenchSessionId: string
  operationId?: string
}): WorkbenchTaskIdentity {
  if (!input.workbenchSessionId) throw new Error("workbench session identity is required")
  return { codeSessionId: input.codeSessionId, workbenchSessionId: input.workbenchSessionId, operationId: input.operationId ?? crypto.randomUUID() }
}
