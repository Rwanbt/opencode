// FORK: ADR-0005 Phase 4 — Task runner panel (Build/Test/Debug).
// Detects available commands from package.json, Cargo.toml, and Makefile in the
// project directory. Each "Run" button creates a new PTY pre-wired to the
// selected command (via terminal.newWithCommand) and opens the terminal panel.
import { createResource, For, Show } from "solid-js"
import { useSDK } from "@/context/sdk"

type TaskKind = "npm" | "cargo" | "make"
export type DetectedTask = { name: string; command: string; kind: TaskKind }

function kindLabel(kind: TaskKind) {
  if (kind === "npm") return "npm"
  if (kind === "cargo") return "cargo"
  return "make"
}

function kindClass(kind: TaskKind) {
  if (kind === "npm") return "text-[#cb3837] dark:text-[#f5655b]"
  if (kind === "cargo") return "text-[#dea584] dark:text-[#e8a87c]"
  return "text-text-weak"
}

async function parseNpmTasks(content: string): Promise<DetectedTask[]> {
  try {
    const pkg = JSON.parse(content) as Record<string, unknown>
    const scripts = pkg.scripts
    if (typeof scripts !== "object" || !scripts) return []
    return Object.entries(scripts as Record<string, string>)
      .filter(([, v]) => typeof v === "string")
      .map(([name]) => ({ name, command: `npm run ${name}`, kind: "npm" as const }))
  } catch {
    return []
  }
}

function cargoTasks(): DetectedTask[] {
  return [
    { name: "build", command: "cargo build", kind: "cargo" },
    { name: "test", command: "cargo test", kind: "cargo" },
    { name: "clippy", command: "cargo clippy --all-targets -- -D warnings", kind: "cargo" },
    { name: "run", command: "cargo run", kind: "cargo" },
  ]
}

function parseMakeTasks(content: string): DetectedTask[] {
  return content
    .split("\n")
    .filter((line) => /^[a-zA-Z0-9_][a-zA-Z0-9_-]*\s*:(?!=)/.test(line))
    .map((line) => line.split(":")[0]!.trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((name) => ({ name, command: `make ${name}`, kind: "make" as const }))
}

export function TaskPanel(props: {
  directory: string
  onRunTask: (command: string, title: string) => void
}) {
  const sdk = useSDK()

  const [tasks] = createResource(
    () => props.directory,
    async (dir) => {
      const sep = dir.includes("\\") ? "\\" : "/"
      const join = (name: string) => dir.replace(/[/\\]+$/, "") + sep + name

      const readContent = async (filename: string): Promise<string | undefined> => {
        try {
          const result = await sdk.client.file.read({ path: join(filename) })
          return result.data?.content
        } catch {
          return undefined
        }
      }

      const [pkgJson, cargoToml, makefile] = await Promise.all([
        readContent("package.json"),
        readContent("Cargo.toml"),
        readContent("Makefile"),
      ])

      const all: DetectedTask[] = []
      if (pkgJson) all.push(...(await parseNpmTasks(pkgJson)))
      if (cargoToml) all.push(...cargoTasks())
      if (makefile) all.push(...parseMakeTasks(makefile))
      return all
    },
  )

  return (
    <div class="flex flex-col h-full overflow-y-auto">
      <Show when={tasks.loading}>
        <div class="text-text-weak text-12-regular px-3 py-2">Détection…</div>
      </Show>

      <Show when={!tasks.loading && (tasks()?.length ?? 0) === 0 && !tasks.error}>
        <div class="text-text-weak text-12-regular px-4 py-6 text-center leading-relaxed">
          Aucune tâche détectée.
          <br />
          <span class="text-11-regular opacity-70">
            Ajoute un package.json, Cargo.toml ou Makefile.
          </span>
        </div>
      </Show>

      <For each={tasks()}>
        {(task) => (
          <div class="flex items-center gap-2 px-3 py-1.5 hover:bg-surface-base group cursor-default">
            <span
              class={`text-10-regular font-medium uppercase tracking-wide shrink-0 w-10 ${kindClass(task.kind)}`}
            >
              {kindLabel(task.kind)}
            </span>
            <span class="text-12-regular text-text-base flex-1 truncate">{task.name}</span>
            <button
              type="button"
              onClick={() => props.onRunTask(task.command, `${kindLabel(task.kind)}: ${task.name}`)}
              class="text-10-regular text-text-weak hover:text-text-base opacity-0 group-hover:opacity-100 transition-opacity px-1.5 py-0.5 rounded border border-transparent hover:border-border-weak-base shrink-0"
              title={task.command}
            >
              ▶
            </button>
          </div>
        )}
      </For>
    </div>
  )
}
