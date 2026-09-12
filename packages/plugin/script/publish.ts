#!/usr/bin/env bun

import { Script } from "@unifia/script"
import { publish } from "@unifia/script/npm"
import { fileURLToPath } from "url"

await publish({
  dir: fileURLToPath(new URL("..", import.meta.url)),
  channel: Script.channel,
})
