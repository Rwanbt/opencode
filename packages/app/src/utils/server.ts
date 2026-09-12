import { createUnifiaClient } from "../types/sdk-shim"
import type { ServerConnection } from "@/context/server"

export function createSdkForServer({
  server,
  ...config
}: Omit<NonNullable<Parameters<typeof createUnifiaClient>[0]>, "baseUrl"> & {
  server: ServerConnection.HttpBase
}) {
  const auth = (() => {
    if (!server.password) return
    return {
      Authorization: `Basic ${btoa(`${server.username ?? "unifia"}:${server.password}`)}`,
    }
  })()

  return createUnifiaClient({
    ...config,
    // An explicit Bearer session must take precedence over legacy Basic
    // connection credentials. Basic remains the fallback for unmodified flows.
    headers: { ...auth, ...config.headers },
    baseUrl: server.url,
  })
}
