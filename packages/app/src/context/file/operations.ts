export type FileOpResult = { ok: true } | { ok: false; code: "conflict" | "not-found" | "exists" | "denied" | "error"; message: string }

export interface FileOpDeps {
  write: (input: { path: string; content: string }) => Promise<unknown>
  mkdir: (input: { path: string }) => Promise<unknown>
  rename: (input: { from: string; to: string }) => Promise<unknown>
  move: (input: { from: string; to: string }) => Promise<unknown>
  del: (input: { path: string }) => Promise<unknown>
  refreshDir: (dir: string) => Promise<void> | void
}

function parentDir(filePath: string): string {
  const idx = filePath.lastIndexOf("/")
  return idx === -1 ? "" : filePath.slice(0, idx)
}

function basename(filePath: string): string {
  const idx = filePath.lastIndexOf("/")
  return idx === -1 ? filePath : filePath.slice(idx + 1)
}

function join(dir: string, name: string): string {
  if (!dir) return name
  return `${dir}/${name}`
}

function mapError(e: unknown): FileOpResult {
  const msg = typeof e === "object" && e !== null && "message" in e
    ? String((e as { message: unknown }).message)
    : e instanceof Error ? e.message
    : typeof e === "string" ? e
    : "Unknown error"
  const lower = msg.toLowerCase()
  if (lower.includes("already exists") || lower.includes("expectedhash") || lower.includes("changed on disk"))
    return { ok: false, code: "exists", message: msg }
  if (lower.includes("not found") || lower.includes("no longer exists"))
    return { ok: false, code: "not-found", message: msg }
  if (lower.includes("access denied") || lower.includes("permission"))
    return { ok: false, code: "denied", message: msg }
  return { ok: false, code: "error", message: msg }
}

export async function createFile(deps: FileOpDeps, dir: string, name: string): Promise<FileOpResult> {
  try {
    await deps.write({ path: join(dir, name), content: "" })
    await deps.refreshDir(dir)
    return { ok: true }
  } catch (e) {
    return mapError(e)
  }
}

export async function createFolder(deps: FileOpDeps, dir: string, name: string): Promise<FileOpResult> {
  try {
    await deps.mkdir({ path: join(dir, name) })
    await deps.refreshDir(dir)
    return { ok: true }
  } catch (e) {
    return mapError(e)
  }
}

export async function renameNode(deps: FileOpDeps, fromPath: string, newName: string): Promise<FileOpResult> {
  const dir = parentDir(fromPath)
  try {
    await deps.rename({ from: fromPath, to: join(dir, newName) })
    await deps.refreshDir(dir)
    return { ok: true }
  } catch (e) {
    return mapError(e)
  }
}

export async function deleteNode(deps: FileOpDeps, path: string): Promise<FileOpResult> {
  const dir = parentDir(path)
  try {
    await deps.del({ path })
    await deps.refreshDir(dir)
    return { ok: true }
  } catch (e) {
    return mapError(e)
  }
}

export async function moveNode(deps: FileOpDeps, fromPath: string, toDir: string): Promise<FileOpResult> {
  const srcDir = parentDir(fromPath)
  const name = basename(fromPath)
  try {
    await deps.move({ from: fromPath, to: join(toDir, name) })
    await deps.refreshDir(srcDir)
    if (toDir !== srcDir) await deps.refreshDir(toDir)
    return { ok: true }
  } catch (e) {
    return mapError(e)
  }
}
