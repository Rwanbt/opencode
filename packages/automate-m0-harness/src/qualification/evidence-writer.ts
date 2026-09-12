/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * Shared evidence-folder writer used by both the qualification
 * runner and the multi-process FC-14 / FC-25 helpers.
 */

import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

export async function writeEvidence(
  fcFolder: string,
  filename: string,
  data: unknown,
): Promise<string> {
  await mkdir(fcFolder, { recursive: true })
  const path = join(fcFolder, filename)
  await writeFile(
    path,
    typeof data === "string" ? data : JSON.stringify(data, null, 2),
    "utf8",
  )
  return path
}
