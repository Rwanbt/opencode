/* SPDX-License-Identifier: MIT */

/** Transport payload returned by the Workbench file-read route. */
export type WorkbenchFilePayload = {
  readonly content: string
  readonly encoding: "utf-8" | "base64"
}

/** Decode a Workbench file payload into UTF-8 text. */
export function decodeWorkbenchFile(value: WorkbenchFilePayload): string {
  if (value.encoding === "utf-8") return value.content
  const bytes = Uint8Array.from(atob(value.content), (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}
