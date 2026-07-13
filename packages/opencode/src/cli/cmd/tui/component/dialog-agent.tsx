import { createMemo } from "solid-js"
import { useLocal } from "@tui/context/local"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { DialogConfirm } from "@tui/ui/dialog-confirm"
import { DialogDebateSetup } from "./dialog-debate-setup"

export function DialogAgent() {
  const local = useLocal()
  const dialog = useDialog()
  const options = createMemo(() =>
    local.agent.list().map((item) => {
      return {
        value: item.name,
        title: item.name,
        description: item.description ?? (item.native ? "native" : undefined),
      }
    }),
  )

  return (
    <DialogSelect
      title="Select agent"
      current={local.agent.current().name}
      options={options()}
      onSelect={async (option) => {
        if (local.agent.requiresConfirmation(option.value)) {
          const confirmed = await DialogConfirm.show(
            dialog,
            "Dangerous auto mode",
            "Auto mode can run commands and modify files without permission prompts. Continue?",
          )
          if (!confirmed) return
          local.agent.confirmAuto()
        }
        local.agent.set(option.value)
        if (option.value === "debate") {
          const valid = await local.debate.ensureConfigured()
          if (!valid) dialog.replace(() => <DialogDebateSetup />)
          else dialog.clear()
          return
        }
        dialog.clear()
      }}
    />
  )
}
