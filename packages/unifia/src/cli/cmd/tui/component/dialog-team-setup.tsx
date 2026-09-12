import { createMemo, createSignal } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { useSDK } from "@tui/context/sdk"
import { useKeybind } from "@tui/context/keybind"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useToast } from "@tui/ui/toast"
import { Keybind } from "@/util/keybind"

type ModelRef = { providerID: string; modelID: string }

/** Team dispatches one worker per model, so fewer than two is not a team. */
const MINIMUM_MODELS = 2

function sameModel(a: ModelRef, b: ModelRef) {
  return a.providerID === b.providerID && a.modelID === b.modelID
}

export function DialogTeamSetup() {
  const local = useLocal()
  const sync = useSync()
  const sdk = useSDK()
  const dialog = useDialog()
  const toast = useToast()
  const keybind = useKeybind()
  const [selected, setSelected] = createSignal<ModelRef[]>(local.team.current()?.models ?? [])
  const [saving, setSaving] = createSignal(false)

  const models = createMemo(() =>
    sync.data.provider
      .filter((provider) => sync.data.provider_next.connected.includes(provider.id))
      .flatMap((provider) =>
        Object.values(provider.models).map((model) => ({
          providerID: provider.id,
          modelID: model.id,
          name: model.name ?? model.id,
          providerName: provider.name,
        })),
      )
      .sort((a, b) => (a.providerName + "/" + a.name).localeCompare(b.providerName + "/" + b.name)),
  )

  const ready = createMemo(() => selected().length >= MINIMUM_MODELS)

  const options = createMemo<DialogSelectOption<ModelRef | "confirm">[]>(() => [
    {
      value: "confirm",
      title: "Confirm (" + selected().length + " models selected)",
      description: ready()
        ? "Save and run Team tasks across these models"
        : "Select at least " + MINIMUM_MODELS + " models",
      disabled: !ready() || saving(),
    },
    ...models().map((model) => {
      const value = { providerID: model.providerID, modelID: model.modelID }
      const active = selected().some((item) => sameModel(item, value))
      return {
        value,
        title: (active ? "[x] " : "[ ] ") + model.name,
        description: model.providerName + (active ? " — selected" : ""),
      }
    }),
  ])

  async function save() {
    if (!ready() || saving()) return
    setSaving(true)
    try {
      const response = await sdk.client.team.config({ models: selected() }, { throwOnError: true })
      local.team.set(response.data)
      toast.show({
        variant: "success",
        message: "Team models configured and saved for Team mode.",
        duration: 3000,
      })
      dialog.clear()
    } catch (error) {
      toast.show({
        variant: "error",
        message: "Unable to save Team configuration: " + (error instanceof Error ? error.message : String(error)),
        duration: 5000,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <DialogSelect<ModelRef | "confirm">
      title={"Team — worker models (" + selected().length + " selected)"}
      placeholder="Enter toggles a model; ctrl+s saves once at least two are selected"
      options={options()}
      keybind={[
        {
          keybind: keybind.all.model_refresh?.[0],
          title: local.modelCatalog.refreshing ? "refreshing models" : "refresh models",
          disabled: local.modelCatalog.refreshing,
          onTrigger: () => {
            void local.modelCatalog.refresh()
          },
        },
        {
          // WHY: not ctrl+u — that is `input_delete_to_line_start`, which the
          // dialog's own filter field uses.
          keybind: Keybind.parse("alt+c")[0],
          title: "clear selection",
          disabled: selected().length === 0 || saving(),
          onTrigger: () => setSelected([]),
        },
        {
          keybind: Keybind.parse("ctrl+s")[0],
          title: saving() ? "saving" : "save",
          disabled: !ready() || saving(),
          onTrigger: () => {
            void save()
          },
        },
      ]}
      onSelect={(option) => {
        if (option.value === "confirm") {
          void save()
          return
        }
        const model = option.value as ModelRef
        setSelected((current) =>
          current.some((item) => sameModel(item, model))
            ? current.filter((item) => !sameModel(item, model))
            : [...current, model],
        )
      }}
    />
  )
}
