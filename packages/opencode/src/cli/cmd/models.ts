import type { Argv } from "yargs"
import { Instance } from "../../project/instance"
import { Provider } from "../../provider/provider"
import { ProviderID } from "../../provider/schema"
import { ModelsDev } from "../../provider/models"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { EOL } from "os"
import { Ollama } from "../../local-models/ollama"
import { LocalModels } from "../../local-models"
import * as prompts from "@clack/prompts"

const ModelsListCommand = cmd({
  command: "list [provider]",
  describe: "list all available models",
  builder: (yargs: Argv) => {
    return yargs
      .positional("provider", {
        describe: "provider ID to filter models by",
        type: "string",
        array: false,
      })
      .option("verbose", {
        describe: "use more verbose model output (includes metadata like costs)",
        type: "boolean",
      })
      .option("refresh", {
        describe: "refresh the models cache from models.dev",
        type: "boolean",
      })
      .option("local", {
        describe: "show only locally available models (Ollama)",
        type: "boolean",
      })
  },
  handler: async (args) => {
    if (args.refresh) {
      await ModelsDev.refresh(true)
      UI.println(UI.Style.TEXT_SUCCESS_BOLD + "Models cache refreshed" + UI.Style.TEXT_NORMAL)
    }

    // Show local models if --local flag
    if (args.local) {
      const running = await Ollama.isRunning()
      if (!running) {
        UI.println(UI.Style.TEXT_WARNING + "Ollama is not running." + UI.Style.TEXT_NORMAL)
        UI.println("Start it with: opencode models serve")
        return
      }
      const models = await Ollama.listModels()
      if (models.length === 0) {
        UI.println(UI.Style.TEXT_DIM + "No local models found." + UI.Style.TEXT_NORMAL)
        UI.println("Pull one with: opencode models pull <model>")
        return
      }
      UI.println(UI.Style.TEXT_NORMAL_BOLD + "Local models (Ollama):" + UI.Style.TEXT_NORMAL)
      for (const m of models) {
        const size = m.size ? ` (${Ollama.formatSize(m.size)})` : ""
        const params = m.details?.parameter_size ? ` [${m.details.parameter_size}]` : ""
        process.stdout.write(`  ollama/${m.name}${params}${size}${EOL}`)
      }
      return
    }

    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const providers = await Provider.list()

        function printModels(providerID: ProviderID, verbose?: boolean) {
          const provider = providers[providerID]
          const sortedModels = Object.entries(provider.models).sort(([a], [b]) => a.localeCompare(b))
          for (const [modelID, model] of sortedModels) {
            process.stdout.write(`${providerID}/${modelID}`)
            process.stdout.write(EOL)
            if (verbose) {
              process.stdout.write(JSON.stringify(model, null, 2))
              process.stdout.write(EOL)
            }
          }
        }

        if (args.provider) {
          const provider = providers[ProviderID.make(args.provider)]
          if (!provider) {
            UI.error(`Provider not found: ${args.provider}`)
            return
          }

          printModels(ProviderID.make(args.provider), args.verbose)
          return
        }

        const providerIDs = Object.keys(providers).sort((a, b) => {
          const aIsOpencode = a.startsWith("opencode")
          const bIsOpencode = b.startsWith("opencode")
          if (aIsOpencode && !bIsOpencode) return -1
          if (!aIsOpencode && bIsOpencode) return 1
          return a.localeCompare(b)
        })

        for (const providerID of providerIDs) {
          printModels(ProviderID.make(providerID), args.verbose)
        }
      },
    })
  },
})

const ModelsPullCommand = cmd({
  command: "pull <model>",
  describe: "download a model via Ollama",
  builder: (yargs: Argv) =>
    yargs
      .positional("model", {
        describe: "model name (e.g., llama3.1, codellama, mistral)",
        type: "string",
        demandOption: true,
      })
      .option("configure", {
        describe: "auto-configure the model in opencode.jsonc",
        type: "boolean",
        default: true,
      }),
  handler: async (args) => {
    const model = args.model as string

    // Check if Ollama is running
    UI.println(UI.Style.TEXT_DIM + "Checking Ollama..." + UI.Style.TEXT_NORMAL)
    const running = await Ollama.isRunning()

    if (!running) {
      UI.println(UI.Style.TEXT_WARNING + "Ollama is not running." + UI.Style.TEXT_NORMAL)
      UI.empty()

      const action = await prompts.select({
        message: "What would you like to do?",
        options: [
          { value: "install", label: "Install Ollama" },
          { value: "skip", label: "Skip (I'll start it manually)" },
        ],
      })

      if (prompts.isCancel(action) || action === "skip") {
        UI.println("Start Ollama and retry: opencode models pull " + model)
        return
      }

      UI.println(UI.Style.TEXT_DIM + "Installing Ollama..." + UI.Style.TEXT_NORMAL)
      const ok = await LocalModels.installOllama()
      if (!ok) {
        UI.println(UI.Style.TEXT_DANGER + "Installation failed." + UI.Style.TEXT_NORMAL)
        UI.println("Install manually: https://ollama.com/download")
        return
      }

      UI.println(UI.Style.TEXT_SUCCESS + "Ollama installed." + UI.Style.TEXT_NORMAL)
      UI.println("Start it with: ollama serve")
      UI.println("Then retry: opencode models pull " + model)
      return
    }

    // Pull model with progress
    UI.println(`Pulling ${UI.Style.TEXT_HIGHLIGHT}${model}${UI.Style.TEXT_NORMAL}...`)
    UI.empty()

    let lastStatus = ""
    let lastPercent = -1

    try {
      await Ollama.pull(model, {
        onProgress(progress) {
          if (progress.status !== lastStatus) {
            if (lastStatus && lastPercent >= 0) process.stderr.write(EOL)
            lastStatus = progress.status
            lastPercent = -1
          }

          if (progress.total && progress.completed !== undefined) {
            const percent = Math.floor((progress.completed / progress.total) * 100)
            if (percent !== lastPercent) {
              lastPercent = percent
              const bar = "█".repeat(Math.floor(percent / 2.5)) + "░".repeat(40 - Math.floor(percent / 2.5))
              process.stderr.write(
                `\r  ${progress.status}: ${bar} ${percent.toString().padStart(3)}% (${Ollama.formatSize(progress.completed)}/${Ollama.formatSize(progress.total)})`,
              )
            }
          } else if (progress.status !== lastStatus) {
            process.stderr.write(`  ${progress.status}${EOL}`)
          }
        },
      })

      process.stderr.write(EOL)
      UI.empty()
      UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Model ${model} downloaded successfully!` + UI.Style.TEXT_NORMAL)

      // Auto-configure
      if (args.configure) {
        const configPath = await LocalModels.configureModel(model)
        UI.println(UI.Style.TEXT_DIM + `Configured in ${configPath}` + UI.Style.TEXT_NORMAL)
        UI.println(`Use with: ${UI.Style.TEXT_HIGHLIGHT}opencode --model ollama/${model}${UI.Style.TEXT_NORMAL}`)
      }
    } catch (err) {
      process.stderr.write(EOL)
      UI.println(UI.Style.TEXT_DANGER + `Failed to pull model: ${err}` + UI.Style.TEXT_NORMAL)
    }
  },
})

const ModelsRemoveCommand = cmd({
  command: "remove <model>",
  describe: "remove a local model from Ollama",
  builder: (yargs: Argv) =>
    yargs.positional("model", {
      describe: "model name to remove",
      type: "string",
      demandOption: true,
    }),
  handler: async (args) => {
    const model = args.model as string

    if (!(await Ollama.isRunning())) {
      UI.println(UI.Style.TEXT_WARNING + "Ollama is not running." + UI.Style.TEXT_NORMAL)
      return
    }

    try {
      await Ollama.remove(model)
      UI.println(UI.Style.TEXT_SUCCESS + `Removed ${model}` + UI.Style.TEXT_NORMAL)
    } catch (err) {
      UI.println(UI.Style.TEXT_DANGER + `Failed to remove: ${err}` + UI.Style.TEXT_NORMAL)
    }
  },
})

const ModelsServeCommand = cmd({
  command: "serve",
  describe: "start Ollama server",
  builder: (yargs) => yargs,
  handler: async () => {
    const running = await Ollama.isRunning()
    if (running) {
      UI.println(UI.Style.TEXT_SUCCESS + "Ollama is already running." + UI.Style.TEXT_NORMAL)
      const models = await Ollama.listModels()
      UI.println(`${models.length} models available.`)
      return
    }

    UI.println(UI.Style.TEXT_DIM + "Starting Ollama..." + UI.Style.TEXT_NORMAL)

    try {
      const proc = Bun.spawn(["ollama", "serve"], {
        stdout: "inherit",
        stderr: "inherit",
      })

      // Wait a moment for startup
      await new Promise((r) => setTimeout(r, 2000))

      if (await Ollama.isRunning()) {
        UI.println(UI.Style.TEXT_SUCCESS + "Ollama started." + UI.Style.TEXT_NORMAL)
        UI.println("Press Ctrl+C to stop.")
        await proc.exited
      } else {
        UI.println(UI.Style.TEXT_DANGER + "Failed to start Ollama." + UI.Style.TEXT_NORMAL)
        UI.println("Install: https://ollama.com/download")
      }
    } catch {
      UI.println(UI.Style.TEXT_DANGER + "Ollama not found. Install: https://ollama.com/download" + UI.Style.TEXT_NORMAL)
    }
  },
})

export const ModelsCommand = cmd({
  command: "models [provider]",
  describe: "manage AI models (list, pull, remove, serve)",
  builder: (yargs: Argv) => {
    return yargs
      .command(ModelsListCommand)
      .command(ModelsPullCommand)
      .command(ModelsRemoveCommand)
      .command(ModelsServeCommand)
      .positional("provider", {
        describe: "provider ID to filter models by",
        type: "string",
        array: false,
      })
      .option("verbose", {
        describe: "use more verbose model output",
        type: "boolean",
      })
      .option("refresh", {
        describe: "refresh the models cache",
        type: "boolean",
      })
      .option("local", {
        describe: "show only local models",
        type: "boolean",
      })
  },
  handler: async (args) => {
    // Default behavior: run list (backward compat)
    await ModelsListCommand.handler!(args as any)
  },
})
