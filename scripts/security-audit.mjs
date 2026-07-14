import { mkdir, writeFile } from "node:fs/promises"
import { spawn } from "node:child_process"

const outputPath = process.env.BUN_AUDIT_OUTPUT ?? "artifacts/bun-audit.json"
await mkdir(outputPath.replace(/\\[^\\]*$/, ""), { recursive: true }).catch(() => {})

const result = await new Promise((resolve) => {
  let child
  try {
    child = spawn("bun", ["audit", "--json"], { stdio: ["ignore", "pipe", "pipe"] })
  } catch (error) {
    resolve({ code: 1, stdout: "", stderr: String(error) })
    return
  }
  let stdout = ""
  let stderr = ""
  child.stdout.on("data", (chunk) => { stdout += chunk })
  child.stderr.on("data", (chunk) => { stderr += chunk })
  child.on("error", (error) => resolve({ code: 1, stdout, stderr: String(error) }))
  child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }))
})

const report = {
  generatedAt: new Date().toISOString(),
  command: "bun audit --json",
  exitCode: result.code,
  stdout: result.stdout,
  stderr: result.stderr,
  networkUnavailable: /connection refused|network|fetch|timeout/i.test(result.stderr),
}
await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n", "utf8")
console.log(`Wrote ${outputPath} (exit=${result.code})`)
if (result.code !== 0 && !report.networkUnavailable) process.exit(result.code)