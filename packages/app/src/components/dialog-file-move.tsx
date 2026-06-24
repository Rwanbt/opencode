import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { useMutation } from "@tanstack/solid-query"
import { createSignal } from "solid-js"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useFile } from "@/context/file"
import { moveNode, type FileOpDeps } from "@/context/file/operations"
import type { FileNode } from "@opencode-ai/sdk/v2"

export function DialogFileMove(props: {
  node: FileNode
  onMoved?: (oldPath: string, newPath: string) => void
}) {
  const dialog = useDialog()
  const language = useLanguage()
  const sdk = useSDK()
  const file = useFile()

  const currentDir = () => {
    const idx = props.node.path.lastIndexOf("/")
    return idx === -1 ? "" : props.node.path.slice(0, idx)
  }

  const [destDir, setDestDir] = createSignal(currentDir())

  const deps: FileOpDeps = {
    write: (input) => sdk.client.file.write(input),
    mkdir: (input) => sdk.client.file.mkdir(input),
    rename: (input) => sdk.client.file.rename(input),
    move: (input) => sdk.client.file.move(input),
    del: (input) => sdk.client.file.delete(input),
    refreshDir: (dir) => file.tree.refresh(dir),
  }

  const mutation = useMutation(() => ({
    mutationFn: async () => {
      const dest = destDir().trim()
      if (dest === currentDir()) return
      const result = await moveNode(deps, props.node.path, dest)
      if (!result.ok) {
        const key = result.code === "exists" ? "toast.file.exists" : "toast.file.moveFailed"
        showToast({ variant: "error", title: language.t(key) })
        return
      }
      showToast({ variant: "success", title: language.t("toast.file.moved") })
      const newPath = dest ? `${dest}/${props.node.name}` : props.node.name
      props.onMoved?.(props.node.path, newPath)
      dialog.close()
    },
  }))

  const valid = () => {
    const dest = destDir().trim()
    return dest !== currentDir()
  }

  const handleSubmit = (e: Event) => {
    e.preventDefault()
    if (valid()) mutation.mutate()
  }

  return (
    <Dialog title={language.t("dialog.file.move.title")} class="w-full max-w-[400px]">
      <form onSubmit={handleSubmit} class="flex flex-col gap-4 p-6 pt-0">
        <TextField
          label={language.t("dialog.file.move.label")}
          placeholder={language.t("dialog.file.move.placeholder")}
          value={destDir()}
          onChange={setDestDir}
          autofocus
        />
        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={!valid() || mutation.isPending}>
            {mutation.isPending ? language.t("common.loading") : language.t("fileOps.moveTo")}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
