/* SPDX-License-Identifier: MIT */
import { classifyCorpus } from "../src/knowledge/admin/corpus-classify.js"

const vault = process.argv[2]
if (!vault) {
  process.stderr.write("usage: bun bin/classify-corpus-once.ts <vault-root>\n")
  process.exit(2)
}
const r = classifyCorpus(vault)
process.stdout.write(`vault:        ${r.vaultRoot}\n`)
process.stdout.write(`notes parsed: ${r.notesParsed}\n`)
process.stdout.write(`notes failed: ${r.notesFailed}\n`)
process.stdout.write(`total chunks: ${r.totalChunks}\n`)
process.stdout.write(`total edges:  ${r.totalEdges}\n`)
process.stdout.write(`duration:     ${r.durationMs}ms\n`)
process.stdout.write(`findings:     ${r.findings.length}\n`)
for (const f of r.findings) {
  process.stdout.write(`  - [${f.category}] ${f.message}\n`)
}
