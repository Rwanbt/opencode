import { createOpencodeClient, createOpencodeServer } from "../src/index"

const client = createOpencodeClient({
  baseUrl: "http://localhost:4096",
})

await client.event.subscribe().then(async (event) => {
  for await (const e of event.stream) {
    console.log(e)
  }
})
