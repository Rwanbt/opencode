/* SPDX-License-Identifier: MIT */

import { createSimpleContext } from "@unifia/ui/context"
import { createMemo, createSignal, type Accessor } from "solid-js"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"

export type CollaborativeUser = {
  id: string
  username: string
  role: "admin" | "member" | "viewer"
  email?: string | null
  displayName?: string | null
}

type LoginResult = {
  accessToken: string
  refreshToken: string
  user: Pick<CollaborativeUser, "id" | "username" | "role">
}

/**
 * A collaborative token deliberately lives only in the running application.
 * The desktop bridge has no keychain contract for JWT refresh tokens yet, so
 * persisting one in browser storage would create a weaker credential boundary.
 */
export const { use: useCollaborativeAuth, provider: CollaborativeAuthProvider } = createSimpleContext({
  name: "CollaborativeAuth",
  init: () => {
    const server = useServer()
    const platform = usePlatform()
    const [session, setSession] = createSignal<{ serverUrl: string; accessToken: string; refreshToken: string; user: CollaborativeUser }>()
    const current = createMemo(() => {
      const value = session()
      const url = server.current?.http.url
      return value && url === value.serverUrl ? value : undefined
    })
    const authorization: Accessor<string | undefined> = createMemo(() => {
      const value = current()
      return value ? `Bearer ${value.accessToken}` : undefined
    })

    async function login(result: LoginResult) {
      const serverUrl = server.current?.http.url
      if (!serverUrl) return
      const response = await (platform.fetch ?? fetch)(`${serverUrl}/collab/me`, {
        headers: { Authorization: `Bearer ${result.accessToken}` },
      })
      const user = response.ok
        ? (await response.json()) as CollaborativeUser
        : result.user
      setSession({ serverUrl, accessToken: result.accessToken, refreshToken: result.refreshToken, user })
    }

    async function logout() {
      const value = current()
      if (!value) return
      try {
        await (platform.fetch ?? fetch)(`${value.serverUrl}/collab/logout`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${value.accessToken}` },
          body: JSON.stringify({ refreshToken: value.refreshToken }),
        })
      } finally {
        setSession(undefined)
      }
    }

    return { current, authorization, login, logout }
  },
})
