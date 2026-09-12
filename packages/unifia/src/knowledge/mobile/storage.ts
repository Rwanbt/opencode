/* SPDX-License-Identifier: MIT */
/**
 * Android storage matrix (P10.1).
 *
 * Per runbook §20 P10.1, four storage types are tested:
 * - app-private,
 * - shared / emulated,
 * - SAF (Storage Access Framework),
 * - removable (SD card).
 *
 * Managed write is enabled only where atomicity, fsync, lock,
 * and recovery are proven. The other modes are read-only with
 * an explicit UI signal.
 *
 * V1: the matrix data is published as a static table; the
 * runtime is filled in by the device tests in Phase 10.2.
 */

export type StorageKind = "app_private" | "shared_emulated" | "saf" | "removable"

export type StorageCapability = "read" | "write" | "fsync" | "lock" | "atomic" | "recover"

export interface StorageResult {
  kind: StorageKind
  /** True if the storage is currently usable on this device. */
  available: boolean
  /** Capabilities that the test suite has proven. */
  capabilities: StorageCapability[]
  /** Notes from the test. */
  notes: string
}

export const STORAGE_MATRIX_TEMPLATE: StorageResult[] = [
  {
    kind: "app_private",
    available: false,
    capabilities: [],
    notes: "to be filled in by P10.2 device tests",
  },
  {
    kind: "shared_emulated",
    available: false,
    capabilities: [],
    notes: "to be filled in by P10.2 device tests",
  },
  {
    kind: "saf",
    available: false,
    capabilities: [],
    notes: "to be filled in by P10.2 device tests",
  },
  {
    kind: "removable",
    available: false,
    capabilities: [],
    notes: "to be filled in by P10.2 device tests",
  },
]

/** Decide whether a storage kind may be used in managed-write mode. */
export function canManagedWrite(result: StorageResult): boolean {
  const required: StorageCapability[] = ["write", "fsync", "lock", "atomic", "recover"]
  return result.available && required.every((c) => result.capabilities.includes(c))
}
