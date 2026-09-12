/**
 * Storage : persistance du registry.
 *
 * Pour cette version provisoire : sérialisation JSON en mémoire + export
 * filesystem. Une vraie DB SQLite WAL viendra en Phase 3 (T2-T3 du plan
 * §24). Ce fichier expose l'API stable pour permettre aux consommateurs
 * (B01, etc.) d'ingérer sans dépendre de l'implémentation de stockage.
 */

import type { Registry } from "./schema"
import { RegistryNotInitializedError } from "./errors"
import * as fs from "node:fs/promises"
import * as path from "node:path"

export interface StorageBackend {
  load(): Promise<Registry | null>
  save(registry: Registry): Promise<void>
  path(): string
}

export class MemoryStorage implements StorageBackend {
  private data: Registry | null = null
  constructor(private readonly label: string = "memory") {}
  path(): string {
    return `<memory:${this.label}>`
  }
  async load(): Promise<Registry | null> {
    return this.data
  }
  async save(registry: Registry): Promise<void> {
    this.data = registry
  }
}

export class FileStorage implements StorageBackend {
  constructor(private readonly filePath: string) {}
  path(): string {
    return this.filePath
  }
  async load(): Promise<Registry | null> {
    try {
      const content = await fs.readFile(this.filePath, "utf-8")
      return JSON.parse(content)
    } catch (e: unknown) {
      if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "ENOENT") {
        return null
      }
      throw e
    }
  }
  async save(registry: Registry): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true })
    await fs.writeFile(this.filePath, JSON.stringify(registry, null, 2), "utf-8")
  }
}

export class StorageManager {
  private registry: Registry | null = null
  constructor(private readonly backend: StorageBackend) {}

  async init(): Promise<void> {
    this.registry = await this.backend.load()
  }

  async get(): Promise<Registry> {
    if (!this.registry) {
      throw new RegistryNotInitializedError({
        dbPath: this.backend.path(),
        message: "StorageManager not initialized; call init() first",
      })
    }
    return this.registry
  }

  async set(registry: Registry): Promise<void> {
    this.registry = registry
    await this.backend.save(registry)
  }

  isLoaded(): boolean {
    return this.registry !== null
  }

  path(): string {
    return this.backend.path()
  }
}