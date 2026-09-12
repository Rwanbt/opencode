/* SPDX-License-Identifier: MIT */

import { Channel, invoke } from "@tauri-apps/api/core"
import { connectWorkbench, type NativeTokenBridge, type WorkbenchConnection } from "@unifia/workbench-shell"
import type { Platform } from "@unifia/app"
import { commands, type InitStep } from "./bindings"

type Ready = { url: string }
type Workspace = { workspaceId: string; instanceId: string }
type Lease = {
  token: string
  tokenId: string
  instanceId: string
  workspaceId: string
  capabilities: string[]
  issuedAt: number
  expiresAt: number
}
type Rotation = { token: Lease; previousToken: string | null; gracePeriodMs: number }

function nativeBridge(): NativeTokenBridge {
  return {
    issue: (request) => invoke<Lease>("workbench_issue_token", { workspaceId: request.workspaceId, capabilities: [...request.capabilities] }),
    rotate: (request) => invoke<Rotation>("workbench_rotate_token", { workspaceId: request.workspaceId, capabilities: [...request.capabilities] }),
    revoke: (workspaceId) => invoke<void>("workbench_revoke_token", { workspaceId }),
  }
}

/** Desktop-only platform adapter; no signing key or IPC secret enters the WebView. */
export function createDesktopWorkbenchBridge(): NonNullable<Platform["workbench"]> {
  return {
    async connect(input): Promise<WorkbenchConnection> {
      const ready = await commands.awaitInitialization(new Channel<InitStep>() as any) as Ready
      const workspace = await invoke<Workspace>("workbench_open_workspace", { workspacePath: input.workspacePath })
      return connectWorkbench({
        baseUrl: `${ready.url}/workbench`,
        bridge: nativeBridge(),
        tokenRequest: { workspaceId: workspace.workspaceId, capabilities: [...input.capabilities] },
      })
    },
  }
}
