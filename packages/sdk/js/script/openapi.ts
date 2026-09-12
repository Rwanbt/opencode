import { $ } from "bun"
import path from "path"

function sortSchemas(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value
  const document = value as Record<string, unknown>
  const components = document.components
  if (!components || typeof components !== "object" || Array.isArray(components)) return value
  const schemas = (components as Record<string, unknown>).schemas
  if (!schemas || typeof schemas !== "object" || Array.isArray(schemas)) return value
  return {
    ...document,
    components: {
      ...components,
      schemas: Object.fromEntries(
        Object.entries(schemas).sort(([left], [right]) => {
          if (left.startsWith("Event.") && right.startsWith("Event.")) return left.localeCompare(right)
          return 0
        }),
      ),
    },
  }
}

export async function generateOpenApi(outputPath: string): Promise<void> {
  const generated = await $`bun run dev generate`.cwd(path.resolve(import.meta.dir, "../../../unifia")).text()
  const document = JSON.parse(generated)
  await Bun.write(outputPath, JSON.stringify(sortSchemas(document), null, 2) + "\n")
}
