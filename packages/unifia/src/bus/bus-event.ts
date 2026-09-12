import z from "zod"
import type { ZodType } from "zod"

export namespace BusEvent {
  export type Definition = ReturnType<typeof define>

  const registry = new Map<string, Definition>()

  export function define<Type extends string, Properties extends ZodType>(type: Type, properties: Properties) {
    const result = {
      type,
      properties,
    }
    registry.set(type, result)
    return result
  }

  export function payloads() {
    return z
      .discriminatedUnion(
        "type",
        // Sorted rather than relying on Map insertion order: registration
        // happens as an import-time side effect in ~30 files, so the order
        // tracks module resolution order — which is not guaranteed stable
        // across platforms/bundlers. An unsorted order here is exactly what
        // made the generated OpenAPI spec (and SDK) reproducible on one
        // machine and drift on every other, since nothing else in the
        // pipeline re-canonicalizes it.
        [...registry.entries()]
          .toSorted(([a], [b]) => a.localeCompare(b))
          .map(([type, def]) => {
            return z
              .object({
                type: z.literal(type),
                properties: def.properties,
              })
              .meta({
                ref: "Event" + "." + def.type,
              })
          }) as any,
      )
      .meta({
        ref: "Event",
      })
  }
}
