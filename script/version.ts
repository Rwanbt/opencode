import { Script } from "@opencode-ai/script"

let output = `version=${Script.version}\n`

if (process.env.GITHUB_OUTPUT) {
  await Bun.write(process.env.GITHUB_OUTPUT, output)
}
