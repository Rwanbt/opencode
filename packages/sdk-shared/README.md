<!-- SPDX-License-Identifier: MIT -->

# @unifia/sdk-shared

The shared type surface layered on top of
[`@unifia/sdk`](https://www.npmjs.com/package/@unifia/sdk).

The generated v2 SDK exposes route-shaped types — `SessionListResponses`,
`FileReadResponses`, and so on. Most code wants the model itself: `Session`,
`Message`, `Part`, `Provider`. This package derives those structural aliases from
the route shapes and re-exports them next to the v2 client, so every
[Unifia](https://github.com/Rwanbt/unifia) surface — CLI, desktop, mobile, web,
plugins — reads the same definitions instead of maintaining private copies.

## Install

```bash
npm install @unifia/sdk-shared
```

`@unifia/sdk` is a dependency and is installed with it.

## Use

```ts
import type { Session, Message, Part, Provider } from "@unifia/sdk-shared"

function lastAssistantMessage(messages: Message[]): Message | undefined {
  return messages.findLast((message) => message.role === "assistant")
}
```

The v2 client is re-exported too, so a consumer can import both from one place:

```ts
import { createUnifiaClient, type Session } from "@unifia/sdk-shared"
```

## Entry points

| Import | Contents |
| --- | --- |
| `@unifia/sdk-shared` | The v2 client plus every structural model alias |
| `@unifia/sdk-shared/types/sdk-shim` | The aliases alone, without the client |

## Stability

These aliases exist to keep consumers source-compatible while the generated SDK
evolves. They are expected to be retired once the models get a stable home in
`@unifia/sdk` itself — prefer importing from `@unifia/sdk` where an equivalent
type already exists.

## Versioning

Released in lockstep with `@unifia/sdk` and the Unifia CLI, sharing their version
number.

## License

MIT
