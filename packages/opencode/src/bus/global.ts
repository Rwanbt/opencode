import { EventEmitter } from "events"
import { Broadcast } from "../server/broadcast"

export const GlobalBus = new EventEmitter<{
  event: [
    {
      directory?: string
      payload: any
    },
  ]
}>()

// Forward all GlobalBus events to WebSocket broadcast so connected clients
// receive real-time updates.
GlobalBus.on("event", ({ directory, payload }) => {
  Broadcast.send(payload, directory)
})
