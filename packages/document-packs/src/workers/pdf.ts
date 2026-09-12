/* SPDX-License-Identifier: MIT */
import type { ArtifactInput } from "@unifia/artifact-runtime"

const escapePdfText = (value: string): string => value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)").replaceAll("\r", " ").replaceAll("\n", " ")

export const createDeterministicPdf = (input: string | Uint8Array): Uint8Array => {
  const text = typeof input === "string" ? input : new TextDecoder().decode(input)
  const content = `BT /F1 12 Tf 72 720 Td (${escapePdfText(text.slice(0, 4096))}) Tj ET`
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ]
  const chunks = ["%PDF-1.4\n%\\xE2\\xE3\\xCF\\xD3\n"]
  const offsets = [0]
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(chunks.join("")))
    chunks.push(`${index + 1} 0 obj\n${objects[index]}\nendobj\n`)
  }
  const xrefOffset = Buffer.byteLength(chunks.join(""))
  chunks.push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`)
  for (const offset of offsets.slice(1)) chunks.push(`${offset.toString().padStart(10, "0")} 00000 n \n`)
  chunks.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`)
  return new TextEncoder().encode(chunks.join(""))
}

export const pdfWorker = async (input: string | Uint8Array): Promise<ArtifactInput> => ({
  kind: "pdf",
  filename: "document.pdf",
  content: createDeterministicPdf(input),
})
