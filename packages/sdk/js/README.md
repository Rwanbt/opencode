<!-- SPDX-License-Identifier: MIT -->

# @unifia/sdk

TypeScript client for the [Unifia](https://github.com/Rwanbt/unifia) server API.

Unifia runs as a local HTTP server; the CLI, the desktop apps and the mobile app
are all clients of it. This package is that client, generated from the server's
OpenAPI document so the types cannot drift from the routes.

## Install

```bash
npm install @unifia/sdk
```

## Use

```ts
import { createUnifiaClient } from "@unifia/sdk"

const client = createUnifiaClient({ baseUrl: "http://localhost:4096" })

const { data: sessions } = await client.session.list()
const { data: session } = await client.session.create({ body: { title: "Refactor the parser" } })
```

The event stream is server-sent events:

```ts
const events = await client.event.subscribe()

for await (const event of events.stream) {
  if (event.type === "session.idle") break
}
```

## Entry points

| Import | Contents |
| --- | --- |
| `@unifia/sdk` | The stable client surface |
| `@unifia/sdk/client` | Client construction and configuration |
| `@unifia/sdk/server` | Helpers for spawning and addressing a local server |
| `@unifia/sdk/v2` | The v2 surface — route-shaped types, generated |
| `@unifia/sdk/v2/client` | v2 client |
| `@unifia/sdk/v2/server` | v2 server helpers |
| `@unifia/sdk/v2/gen/client` | The raw generated client, unwrapped |

The v2 types are route-shaped (`SessionListResponses` and friends). For the
model-shaped aliases (`Session`, `Message`, `Part`, ...) use
[`@unifia/sdk-shared`](https://www.npmjs.com/package/@unifia/sdk-shared).

## Versioning

This package is released in lockstep with the Unifia CLI and desktop apps, and
shares their version number. Pin the version matching the server you talk to.

## License

MIT
