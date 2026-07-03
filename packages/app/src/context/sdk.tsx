import type { Event } from "../types/sdk-shim"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { type Accessor, createEffect, createMemo, onCleanup } from "solid-js"
import { useGlobalSDK } from "./global-sdk"

type SDKEventMap = {
  [key in Event["type"]]: Extract<Event, { type: key }>
}

export const { use: useSDK, provider: SDKProvider } = createSimpleContext({
  name: "SDK",
  init: (props: { directory: Accessor<string> }) => {
    const globalSDK = useGlobalSDK()

    const directory = createMemo(props.directory)
    // FORK (Phase 4.4 — R-code&conv): the SDK default is now
    // throwOnError: false (see packages/sdk/js/src/v2/client.ts), so we
    // omit the explicit flag and let every consumer of `useSDK().client`
    // inspect `res.data` / `res.error` instead of catching throws.
    const client = createMemo(() =>
      globalSDK.createClient({
        directory: directory(),
      }),
    )

    const emitter = createGlobalEmitter<SDKEventMap>()

    createEffect(() => {
      const unsub = globalSDK.event.on(directory(), (event) => {
        emitter.emit(event.type, event)
      })
      onCleanup(unsub)
    })

    return {
      get directory() {
        return directory()
      },
      get client() {
        return client()
      },
      event: emitter,
      get url() {
        return globalSDK.url
      },
      createClient(opts: Parameters<typeof globalSDK.createClient>[0]) {
        return globalSDK.createClient(opts)
      },
    }
  },
})
