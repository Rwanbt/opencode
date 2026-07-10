import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { randomBytes } from "node:crypto"
import { Global } from "../global"

const FILE_NAME = "observability_hmac.key"
const SECRET_BYTES = 32

export function secretPath(configDirectory = Global.Path.config) {
  return path.join(configDirectory, FILE_NAME)
}

export async function loadOrCreateSecret(configDirectory = Global.Path.config): Promise<Uint8Array> {
  const file = secretPath(configDirectory)
  try {
    const existing = await readFile(file)
    if (existing.byteLength !== SECRET_BYTES) throw new Error("Invalid observability secret length")
    return new Uint8Array(existing)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    await mkdir(configDirectory, { recursive: true, mode: 0o700 })
    const secret = randomBytes(SECRET_BYTES)
    const temporary = `${file}.${process.pid}.tmp`
    await writeFile(temporary, secret, { mode: 0o600, flag: "wx" })
    await chmod(temporary, 0o600)
    await rename(temporary, file)
    return new Uint8Array(secret)
  }
}
