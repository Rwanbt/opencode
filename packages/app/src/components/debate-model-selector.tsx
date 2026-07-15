import { createMemo, createSignal, onMount, For, type Component } from "solid-js"
import { List } from "@opencode-ai/ui/list"
import { Popover } from "@opencode-ai/ui/popover"
import { Button } from "@opencode-ai/ui/button"
import { showToast } from "@opencode-ai/ui/toast"
import { useLanguage } from "@/context/language"
import type { useLocal } from "@/context/local"
import { useProviders } from "@/hooks/use-providers"
import { modelKey, type DebateModel, validateDebateSelection } from "./debate-selection"

type LocalContext = ReturnType<typeof useLocal>
type SelectableModel = DebateModel & { name: string; providerName: string }

export const DebateModelSelector: Component<{ local: LocalContext }> = (props) => {
  const language = useLanguage()
  const providers = useProviders()
  const [annexes, setAnnexes] = createSignal<DebateModel[]>([])
  const [saving, setSaving] = createSignal(false)

  const primary = () => props.local.model.current()
  const available = createMemo<SelectableModel[]>(() => {
    const connected = new Set(providers.connected().map((provider) => provider.id))
    const primaryModel = primary()
    const primaryKey = primaryModel ? modelKey({ providerID: primaryModel.provider.id, modelID: primaryModel.id }) : ""

    return props.local.model
      .list()
      .filter((item) => connected.has(item.provider.id))
      .filter((item) => props.local.model.visible({ providerID: item.provider.id, modelID: item.id }))
      .map((item) => ({ providerID: item.provider.id, modelID: item.id, name: item.name, providerName: item.provider.name }))
      .filter((item) => modelKey(item) !== primaryKey)
  })

  const primaryChoices = createMemo<SelectableModel[]>(() => {
    const current = primary()
    if (!current) return available()
    return [
      { providerID: current.provider.id, modelID: current.id, name: current.name, providerName: current.provider.name },
      ...available(),
    ]
  })

  const selectedModels = createMemo(() =>
    annexes().flatMap((item) => {
      const model = available().find((candidate) => modelKey(candidate) === modelKey(item))
      return model ? [model] : []
    }),
  )

  onMount(async () => {
    const existing = props.local.debate.current() ?? (await props.local.debate.load())
    if (!existing) return
    const keys = new Set(available().map(modelKey))
    setAnnexes(existing.participants.filter((item) => keys.has(modelKey(item))))
  })

  const selectPrimary = (item: SelectableModel | undefined) => {
    if (!item || saving()) return
    props.local.model.set({ providerID: item.providerID, modelID: item.modelID })
  }

  const save = async (next: DebateModel[]) => {
    const current = primary()
    const participants = next.filter((item) => available().some((candidate) => modelKey(candidate) === modelKey(item)))
    if (!current || participants.length < 1 || saving()) return

    const selection = {
      primary: { providerID: current.provider.id, modelID: current.id },
      participants,
    }
    const availableKeys = new Set([modelKey(selection.primary), ...available().map(modelKey)])
    if (validateDebateSelection(selection, availableKeys)) return

    setSaving(true)
    try {
      await props.local.debate.save(selection)
    } catch (error) {
      showToast({
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSaving(false)
    }
  }

  const select = (current: SelectableModel | undefined, next: SelectableModel | undefined) => {
    if (!next || saving()) return
    const nextKey = modelKey(next)
    const currentKey = current ? modelKey(current) : undefined
    if (annexes().some((item) => modelKey(item) === nextKey && nextKey !== currentKey)) return

    const updated = current
      ? annexes().map((item) => (modelKey(item) === currentKey ? next : item))
      : [...annexes(), next]
    setAnnexes(updated)
    void save(updated)
  }

  const remove = (item: SelectableModel) => {
    if (saving()) return
    const updated = annexes().filter((candidate) => modelKey(candidate) !== modelKey(item))
    setAnnexes(updated)
    void save(updated)
  }

  const picker = (current?: SelectableModel) => (
    <Popover
      triggerAs={Button}
      triggerProps={{
        type: "button",
        variant: "ghost",
        size: "normal",
        "data-action": current ? "prompt-debate-annex" : "prompt-debate-add-annex",
        class: current
          ? "min-w-0 w-full justify-between text-text-base"
          : "min-w-0 w-full justify-start border border-dashed border-border-strong text-text-muted",
        disabled: saving(),
      }}
      trigger={
        <span class="flex min-w-0 items-center gap-2">
          <span class="truncate">{current?.name ?? language.t("dialog.debate.add")}</span>
          <span class="shrink-0 text-text-muted">⌄</span>
        </span>
      }
      class="w-[min(520px,calc(100vw-48px))]"
      modal
      portal={false}
    >
      <List
        class="w-full h-[min(520px,60vh)] [&_[data-slot=list-scroll]]:h-[min(460px,calc(60vh-60px))]"
        search={{ placeholder: language.t("dialog.debate.search"), autofocus: true }}
        emptyMessage={language.t("dialog.debate.empty")}
        items={available}
        scrollbar
        key={modelKey}
        filterKeys={["name", "providerName", "providerID", "modelID"]}
        sortBy={(a, b) => a.name.localeCompare(b.name)}
        groupBy={(item) => (props.local.model.favorite(item) ? "Favorites" : item.providerID)}
        groupHeader={(group) => (
          <span class="px-2 pt-2 pb-1 text-12-medium text-text-muted">
            {group.category === "Favorites" ? "Favorites" : group.items[0]?.providerName}
          </span>
        )}
        sortGroupsBy={(a, b) => {
          if (a.category === "Favorites") return -1
          if (b.category === "Favorites") return 1
          return a.category.localeCompare(b.category)
        }}
        onSelect={(item) => select(current, item)}
      >
        {(item) => <span class="truncate">{item.name}</span>}
      </List>
    </Popover>
  )

  return (
    <Popover
      triggerAs={Button}
      triggerProps={{
        type: "button",
        variant: "ghost",
        size: "normal",
        class: "min-w-0 max-w-[220px] text-text-base",
        "data-action": "prompt-debate-models",
        disabled: saving(),
      }}
      trigger={<span class="truncate">Models{selectedModels().length > 0 ? " (" + selectedModels().length + ")" : ""}</span>}
      class="w-[min(520px,calc(100vw-32px))]"
      modal
    >
      <div class="flex w-full flex-col gap-3">
        <div class="text-12-medium text-text-muted">{language.t("dialog.debate.primary", { model: primary()?.name ?? "" })}</div>
        <Popover
          triggerAs={Button}
          triggerProps={{
            type: "button",
            variant: "ghost",
            size: "normal",
                    class: "w-full justify-between text-text-base",
          }}
          trigger={<span class="truncate">{primary()?.name ?? language.t("dialog.model.select.title")}</span>}
          portal={false}
        >
          <List
            class="w-full h-[min(520px,60vh)]"
            search={{ placeholder: language.t("dialog.debate.search"), autofocus: true }}
            emptyMessage={language.t("dialog.debate.empty")}
            items={primaryChoices}
            scrollbar
            key={modelKey}
            filterKeys={["name", "providerName", "providerID", "modelID"]}
            sortBy={(a, b) => a.name.localeCompare(b.name)}
            onSelect={selectPrimary}
          >
            {(item) => <span class="truncate">{item.name}</span>}
          </List>
        </Popover>
        <div class="text-12-medium text-text-muted">{language.t("dialog.debate.annexLabel")}</div>
        <For each={selectedModels()}>
          {(item) => (
            <div class="flex w-full min-w-0 items-center gap-1.5">
              <div class="min-w-0 flex-1">{picker(item)}</div>
              <button
                type="button"
                class="size-7 shrink-0 rounded text-14-regular text-text-muted hover:bg-background-strong hover:text-text-base"
                aria-label={language.t("dialog.debate.remove")}
                onClick={() => remove(item)}
                disabled={saving()}
              >
                ×
              </button>
            </div>
          )}
        </For>
        {picker()}
      </div>
    </Popover>
  )
}
