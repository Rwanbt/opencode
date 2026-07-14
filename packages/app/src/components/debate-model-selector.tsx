import { createMemo, createSignal, onMount, type Component } from "solid-js"
import { Checkbox } from "@opencode-ai/ui/checkbox"
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
    const current = primary()
    const primaryKey = current ? modelKey({ providerID: current.provider.id, modelID: current.id }) : ""

    return props.local.model
      .list()
      .filter((item) => connected.has(item.provider.id))
      .filter((item) => props.local.model.visible({ providerID: item.provider.id, modelID: item.id }))
      .map((item) => ({ providerID: item.provider.id, modelID: item.id, name: item.name, providerName: item.provider.name }))
      .filter((item) => modelKey(item) !== primaryKey)
  })

  const selectedModels = () => annexes().filter((item) => available().some((candidate) => modelKey(candidate) === modelKey(item)))
  const selectedKeys = () => new Set(selectedModels().map(modelKey))
  const summary = () => {
    const count = selectedModels().length
    return count === 0 ? language.t("dialog.debate.select") : language.t("dialog.debate.selected", { count })
  }

  onMount(async () => {
    const existing = props.local.debate.current() ?? (await props.local.debate.load())
    if (!existing) return
    const keys = new Set(available().map(modelKey))
    setAnnexes(existing.participants.filter((item) => keys.has(modelKey(item))))
  })

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

  const toggle = (item: DebateModel) => {
    const key = modelKey(item)
    const next = annexes().some((selected) => modelKey(selected) === key)
      ? annexes().filter((selected) => modelKey(selected) !== key)
      : [...annexes(), item]
    setAnnexes(next)
    void save(next)
  }

  return (
    <Popover
      triggerAs={Button}
      triggerProps={{
        type: "button",
        variant: "ghost",
        size: "normal",
        class: "min-w-0 w-full max-w-[220px] text-text-base",
        "data-action": "prompt-debate-models",
        "aria-label": language.t("dialog.debate.annexLabel"),
        disabled: saving(),
      }}
      trigger={<span class="truncate">{summary()}</span>}
      class="w-[min(520px,calc(100vw-48px))]"
      modal
    >
      <div class="flex flex-col gap-2">
        <div class="px-1 text-12-regular text-text-muted">{language.t("dialog.debate.primary", { model: primary()?.name ?? "" })}</div>
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
        groupHeader={(group) => <span class="px-2 pt-2 pb-1 text-12-medium text-text-muted">{group.category === "Favorites" ? "Favorites" : group.items[0]?.providerName}</span>}
        sortGroupsBy={(a, b) => {
          if (a.category === "Favorites") return -1
          if (b.category === "Favorites") return 1
          return a.category.localeCompare(b.category)
        }}
        onSelect={(item) => {
          if (item) toggle(item)
        }}
      >
        {(item) => (
          <div class="w-full flex items-center gap-2">
            <Checkbox readOnly checked={selectedKeys().has(modelKey(item))} />
            <span class="truncate">{item.name}</span>
            <span
              class="ml-auto shrink-0 cursor-pointer text-14-regular text-text-muted hover:text-text-base"
              role="button"
              tabindex="0"
              title={props.local.model.favorite(item) ? "Remove from favorites" : "Add to favorites"}
              aria-label={props.local.model.favorite(item) ? "Remove from favorites" : "Add to favorites"}
              onClick={(event) => {
                event.stopPropagation()
                props.local.model.setFavorite(item, !props.local.model.favorite(item))
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return
                event.preventDefault()
                event.stopPropagation()
                props.local.model.setFavorite(item, !props.local.model.favorite(item))
              }}
            >
              {props.local.model.favorite(item) ? "★" : "☆"}
            </span>
          </div>
        )}
      </List>
      </div>
    </Popover>
  )
}
