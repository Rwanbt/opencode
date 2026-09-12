/**
 * SnapshotManager (TEAM-C03) — gestion des derniers snapshots valides
 * par (connectorID, opération), avec hash d'intégrité SHA-256, persistance
 * disque, restauration offline fail-closed, et invalidation explicite.
 *
 * C03 alimente ce module depuis HttpConnector pour permettre aux opérations
 * du contrat C02 de tomber en mode dégradé offline si le réseau échoue, sans
 * jamais perdre l'historique des derniers résultats valides.
 *
 * Doctrine :
 *   - Persistence : sous `${rootDir}/<connectorID>/<op>.json` (rootDir par
 *     défaut = `process.env.OPENCODE_SNAPSHOT_DIR` ou `~/.opencode/c03-snapshots`).
 *   - Fail-closed : `restore()` lève ConnectorError(cache_corrupted) si le
 *     hash d'intégrité stocké ne matche pas le contenu réel du fichier.
 *   - Pas de secret : les snapshots ne contiennent QUE le raw public
 *     (modèles/pricing/capabilities JSON publiés).
 *   - No silent degradation : `offline=true` + pas de snapshot
 *     retourne ConnectorError(offline_no_cache) — le caller décide.
 *
 * Allowed par TEAM-C03 scope manifest :
 *   - création : packages/unifia/src/model-intelligence/connectors/snapshot-manager.ts
 *
 * Dépendances :
 *   - C02 types.ts (ConnectorError, ConnectorOperationError) : import SEULEMENT
 *   - C01 schema.ts (isoUtcNow) : import SEULEMENT
 *   - node:crypto (SHA-256) : runtime standard
 *   - node:fs/promises : persistence disque
 */

import { createHash } from "node:crypto"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { ConnectorOperationError } from "./types"
import { isoUtcNow } from "../schema"

// =====================================================================
// 1. Constantes & types publics
// =====================================================================

export const SNAPSHOT_SCHEMA_VERSION = "1.0.0" as const
export const DEFAULT_MAX_SNAPSHOT_BYTES = 10 * 1024 * 1024 // 10 MB cohérent avec HttpConnector

export type SnapshotOpKind = "discover" | "pricing" | "capabilities" | "status"

export interface SnapshotRecord {
  /** Schéma version du wrapper (détection de migration future). */
  schemaVersion: string
  /** Identifiant du connecteur qui a produit ce snapshot. */
  connectorID: string
  /** Opération couverte (discover / pricing / capabilities / status). */
  op: SnapshotOpKind
  /** Contenu brut (tel quel, après décodage HTTP, avant parsing typé). */
  raw: string
  /** Hash SHA-256 hex 64 chars lowercase du contenu `raw`. */
  hash: string
  /** ISO 8601 UTC de capture (provenance `fetchedAtUTC` du connecteur). */
  fetchedAtUTC: string
  /** ISO 8601 UTC de persistance locale (≠ fetchedAtUTC). */
  storedAtUTC: string
  /** URL source d'origine (pour audit). */
  sourceURL: string
}

export interface SnapshotStatus {
  present: boolean
  hash: string | null
  fetchedAtUTC: string | null
  storedAtUTC: string | null
  sizeBytes: number | null
  sourceURL: string | null
  integrityOK: boolean | null
}

export interface SnapshotManagerOptions {
  /**
   * Répertoire racine des snapshots. Par défaut : `process.env.OPENCODE_SNAPSHOT_DIR`
   * ou `<home>/.opencode/c03-snapshots`.
   */
  rootDir?: string
  /**
   * Taille max d'un fichier snapshot (octets). Default 10 MB. Au-delà,
   * `record()` rejette avec ConnectorError.
   */
  maxBytes?: number
}

function defaultRootDir(): string {
  const env = process.env["OPENCODE_SNAPSHOT_DIR"]
  if (env && env.length > 0) return env
  return path.join(os.homedir(), ".opencode", "c03-snapshots")
}

export function snapshotFilePath(rootDir: string, connectorID: string, op: SnapshotOpKind): string {
  // Pas de traversal : connectorID doit être un nom sûr (alphanum + tirets + underscores)
  if (!/^[A-Za-z0-9._-]+$/.test(connectorID)) {
    throw new ConnectorOperationError({
      kind: "validation",
      sourceID: connectorID,
      path: "connectorID",
      expectedType: "alphanumeric (._-)",
      actualValueShape: typeof connectorID,
      cause: "connectorID contains unsafe characters for filesystem path",
    })
  }
  return path.join(rootDir, connectorID, `${op}.json`)
}

// =====================================================================
// 2. SnapshotManager
// =====================================================================

export class SnapshotManager {
  private readonly rootDir: string
  private readonly maxBytes: number
  private inMemoryIndex: Map<string, SnapshotRecord> = new Map()

  constructor(options: SnapshotManagerOptions = {}) {
    this.rootDir = options.rootDir ?? defaultRootDir()
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_SNAPSHOT_BYTES
  }

  /** Récupère le répertoire racine (utile pour tests / diagnostics). */
  getRootDir(): string {
    return this.rootDir
  }

  /** Récupère la taille max configurée. */
  getMaxBytes(): number {
    return this.maxBytes
  }

  /**
   * Persiste un snapshot.
   *
   * Calcule le hash SHA-256 du `raw`, écrit le SnapshotRecord sur disque,
   * met à jour l'index en mémoire.
   *
   * Fail-closed : si le raw dépasse `maxBytes`, la fonction rejette
   * SANS écrire et émet une erreur typée (ConnectorError non levée
   * ici car le caller n'est pas un Connector — on utilise Error simple).
   */
  async record(args: {
    connectorID: string
    op: SnapshotOpKind
    raw: string
    fetchedAtUTC: string
    sourceURL: string
  }): Promise<SnapshotRecord> {
    const hash = sha256Hex(args.raw)
    const sizeBytes = Buffer.byteLength(args.raw, "utf-8")
    if (sizeBytes > this.maxBytes) {
      throw new Error(
        `Snapshot too large: ${sizeBytes} bytes > maxBytes=${this.maxBytes} (connectorID=${args.connectorID}, op=${args.op})`,
      )
    }

    const record: SnapshotRecord = {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      connectorID: args.connectorID,
      op: args.op,
      raw: args.raw,
      hash,
      fetchedAtUTC: args.fetchedAtUTC,
      storedAtUTC: isoUtcNow(),
      sourceURL: args.sourceURL,
    }

    const filePath = snapshotFilePath(this.rootDir, args.connectorID, args.op)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    const serialized = JSON.stringify(record)
    await fs.writeFile(filePath, serialized, { encoding: "utf-8", flag: "w" })

    this.inMemoryIndex.set(this.indexKey(args.connectorID, args.op), record)
    return record
  }

  /**
   * Restaure un snapshot persistant.
   *
   * Vérifie le hash d'intégrité. Si mismatch → ConnectorError(cache_corrupted).
   * Si absent → retourne null (le caller tombe en mode dégradé).
   */
  async restore(connectorID: string, op: SnapshotOpKind): Promise<SnapshotRecord | null> {
    const memKey = this.indexKey(connectorID, op)
    const fromMemory = this.inMemoryIndex.get(memKey)
    if (fromMemory) {
      this.assertIntegrity(fromMemory)
      return fromMemory
    }

    const filePath = snapshotFilePath(this.rootDir, connectorID, op)
    let content: string
    try {
      content = await fs.readFile(filePath, "utf-8")
    } catch (e: unknown) {
      if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "ENOENT") {
        return null
      }
      throw e
    }

    let parsed: SnapshotRecord
    try {
      parsed = JSON.parse(content) as SnapshotRecord
    } catch (e) {
      throw new ConnectorOperationError({
        kind: "cache_corrupted",
        sourceID: connectorID,
        path: filePath,
        cause: `JSON parse error: ${(e as Error).message}`,
      })
    }

    if (parsed.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
      throw new ConnectorOperationError({
        kind: "unsupported_version",
        sourceID: connectorID,
        parserVersion: parsed.schemaVersion,
        currentParserVersion: SNAPSHOT_SCHEMA_VERSION,
      })
    }

    this.assertIntegrity(parsed)
    this.inMemoryIndex.set(memKey, parsed)
    return parsed
  }

  /**
   * Indique si un snapshot existe (en mémoire OU sur disque).
   * Asynchrone pour permettre la détection disque sans charger le raw.
   */
  async has(connectorID: string, op?: SnapshotOpKind): Promise<boolean> {
    if (op) {
      if (this.inMemoryIndex.has(this.indexKey(connectorID, op))) return true
      const filePath = snapshotFilePath(this.rootDir, connectorID, op)
      try {
        await fs.access(filePath)
        return true
      } catch {
        return false
      }
    }
    // all ops
    for (const candidate of ["discover", "pricing", "capabilities", "status"] as SnapshotOpKind[]) {
      if (await this.has(connectorID, candidate)) return true
    }
    return false
  }

  /**
   * Statut détaillé d'un snapshot. `integrityOK` est calculé si le fichier existe.
   */
  async status(connectorID: string, op?: SnapshotOpKind): Promise<SnapshotStatus | null> {
    if (op) {
      const rec = await this.tryLoad(connectorID, op)
      if (!rec) return null
      return this.recordToStatus(rec)
    }
    // aggregate : si plusieurs ops, retourne le plus récent
    let latest: SnapshotRecord | null = null
    for (const candidate of ["discover", "pricing", "capabilities", "status"] as SnapshotOpKind[]) {
      const rec = await this.tryLoad(connectorID, candidate)
      if (!rec) continue
      if (!latest || rec.storedAtUTC > latest.storedAtUTC) latest = rec
    }
    return latest ? this.recordToStatus(latest) : null
  }

  /**
   * Vérifie l'intégrité d'un snapshot sans le charger.
   * Retourne { ok, storedHash, actualHash }.
   */
  async verify(connectorID: string, op: SnapshotOpKind): Promise<{ ok: boolean; storedHash: string | null; actualHash: string | null }> {
    const filePath = snapshotFilePath(this.rootDir, connectorID, op)
    let content: string
    try {
      content = await fs.readFile(filePath, "utf-8")
    } catch {
      return { ok: false, storedHash: null, actualHash: null }
    }
    let parsed: SnapshotRecord
    try {
      parsed = JSON.parse(content) as SnapshotRecord
    } catch {
      return { ok: false, storedHash: null, actualHash: null }
    }
    const actual = sha256Hex(parsed.raw)
    return { ok: parsed.hash === actual, storedHash: parsed.hash, actualHash: actual }
  }

  /**
   * Invalide un ou plusieurs snapshots (retire de la mémoire + supprime
   * le fichier sur disque).
   */
  async invalidate(connectorID?: string, op?: SnapshotOpKind): Promise<void> {
    if (!connectorID) {
      this.inMemoryIndex.clear()
      try {
        await fs.rm(this.rootDir, { recursive: true, force: true })
      } catch {
        // noop
      }
      return
    }
    if (!op) {
      for (const candidate of ["discover", "pricing", "capabilities", "status"] as SnapshotOpKind[]) {
        this.inMemoryIndex.delete(this.indexKey(connectorID, candidate))
      }
      try {
        await fs.rm(path.join(this.rootDir, connectorID), { recursive: true, force: true })
      } catch {
        // noop
      }
      return
    }
    this.inMemoryIndex.delete(this.indexKey(connectorID, op))
    const filePath = snapshotFilePath(this.rootDir, connectorID, op)
    try {
      await fs.unlink(filePath)
    } catch (e: unknown) {
      if (e && typeof e === "object" && "code" in e && (e as { code: string }).code !== "ENOENT") {
        throw e
      }
    }
  }

  /** Liste les connectorIDs connus (en mémoire + scan disque). */
  async listConnectorIDs(): Promise<string[]> {
    const fromDisk = await this.scanDiskConnectors()
    const fromMem = new Set<string>()
    for (const key of this.inMemoryIndex.keys()) {
      const id = key.split("|")[0]
      if (id) fromMem.add(id)
    }
    return [...new Set([...fromDisk, ...fromMem])].sort()
  }

  // -------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------

  private indexKey(connectorID: string, op: SnapshotOpKind): string {
    return `${connectorID}|${op}`
  }

  private async tryLoad(connectorID: string, op: SnapshotOpKind): Promise<SnapshotRecord | null> {
    try {
      return await this.restore(connectorID, op)
    } catch {
      return null
    }
  }

  private assertIntegrity(rec: SnapshotRecord): void {
    const actual = sha256Hex(rec.raw)
    if (actual !== rec.hash) {
      throw new ConnectorOperationError({
        kind: "cache_corrupted",
        sourceID: rec.connectorID,
        path: snapshotFilePath(this.rootDir, rec.connectorID, rec.op),
        cause: `integrity check failed: stored=${rec.hash} actual=${actual}`,
      })
    }
  }

  private recordToStatus(rec: SnapshotRecord): SnapshotStatus {
    const actual = sha256Hex(rec.raw)
    return {
      present: true,
      hash: rec.hash,
      fetchedAtUTC: rec.fetchedAtUTC,
      storedAtUTC: rec.storedAtUTC,
      sizeBytes: Buffer.byteLength(rec.raw, "utf-8"),
      sourceURL: rec.sourceURL,
      integrityOK: actual === rec.hash,
    }
  }

  private async scanDiskConnectors(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.rootDir, { withFileTypes: true })
      return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort()
    } catch {
      return []
    }
  }
}

// =====================================================================
// 3. Helpers publics
// =====================================================================

/** SHA-256 hexadécimal 64 chars lowercase. */
export function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex")
}