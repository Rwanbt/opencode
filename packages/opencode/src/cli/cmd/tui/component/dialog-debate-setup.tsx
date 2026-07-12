import { createMemo, createSignal } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useRoute } from "@tui/context/route"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useToast } from "@tui/ui/toast"

type ModelRef = {
  providerID: string
  modelID: string
}

function modelLabel(sync: ReturnType<typeof useSync>, value: ModelRef) {
  const provider = sync.data.provider.find((item) => item.id === value.providerID)
  const model = provider?.models[value.modelID]
  return (provider?.name ?? value.providerID) + " / " + (model?.name ?? value.modelID)
}

function availableModels(sync: ReturnType<typeof useSync>) {
  const connected = new Set(sync.data.provider_next.connected)
  return sync.data.provider
    .filter((provider) => connected.has(provider.id))
    .flatMap((provider) =>
      Object.values(provider.models).map((model) => ({
        providerID: provider.id,
        modelID: model.id,
        name: model.name ?? model.id,
        providerName: provider.name,
      })),
    )
    .sort((a, b) => (a.providerName + "/" + a.name).localeCompare(b.providerName + "/" + b.name))
}

export function DialogDebateSetup() {
  const local = useLocal()
  const current = local.model.current()
  const existing = local.debate.current()

  if (!current) {
    return <text>Connect a provider before configuring debate.</text>
  }

  return <DialogDebateParticipants primary={current} initial={existing?.participants} />
}

function DialogDebateParticipants(props: { primary: ModelRef; initial?: ModelRef[] }) {
  const sync = useSync()
  const sdk = useSDK()
  const route = useRoute()
  const dialog = useDialog()
  const toast = useToast()
  const local = useLocal()
  const [selected, setSelected] = createSignal<ModelRef[]>(props.initial ?? [])
  const models = createMemo(() =>
    availableModels(sync).filter(
      (model) => model.providerID !== props.primary.providerID || model.modelID !== props.primary.modelID,
    ),
  )

  const options = createMemo<DialogSelectOption<ModelRef | "confirm">[]>(() => [
    {
      value: "confirm",
      title: "Confirm (" + selected().length + " annexes selected)",
      description: selected().length >= 2 ? "Run the debate with these models in parallel" : "Select at least two annex models",
      disabled: selected().length < 2,
    },
    ...models().map((model) => {
      const value = { providerID: model.providerID, modelID: model.modelID }
      const active = selected().some((item) => item.providerID === value.providerID && item.modelID === value.modelID)
      return {
        value,
        title: (active ? "[x] " : "[ ] ") + model.name,
        description: model.providerName + (active ? " — selected" : ""),
      }
    }),
  ])

  async function save() {
    try {
      await sdk.client.debate.config({
        primary: props.primary,
        participants: selected(),
      }, { throwOnError: true })
      local.debate.set({ primary: props.primary, participants: selected() })
      toast.show({ variant: "success", message: "Debate models configured and saved for Debate mode.", duration: 3000 })
      dialog.clear()
    } catch (error) {
      toast.show({
        variant: "error",
        message: "Unable to save debate configuration: " + (error instanceof Error ? error.message : String(error)),
        duration: 5000,
      })
    }
  }
  return (
    <DialogSelect<ModelRef | "confirm">
      title={"Debate — annex models (primary: " + modelLabel(sync, props.primary) + ")"}
      placeholder="Enter toggles a model; confirm when at least two are selected"
      options={options()}
      onSelect={(option) => {
        if (option.value === "confirm") {
          void save()
          return
        }
        const model = option.value as ModelRef
        setSelected((current) => {
          const exists = current.some(
            (item) => item.providerID === model.providerID && item.modelID === model.modelID,
          )
          return exists
            ? current.filter(
                (item) => item.providerID !== model.providerID || item.modelID !== model.modelID,
              )
            : [...current, model]
        })
      }}
    />
  )
}