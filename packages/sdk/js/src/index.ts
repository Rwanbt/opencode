export * from "./client.js"
export * from "./server.js"

import { createUnifiaClient } from "./client.js"
import { createUnifiaServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export async function createUnifia(options?: ServerOptions) {
  const server = await createUnifiaServer({
    ...options,
  })

  const client = createUnifiaClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}
