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
import { renameNode, type FileOpDeps } from "@/context/file/operations"
import type { FileNode } from "../types/sdk-shim"

export function DialogFileRename(props: {
  node: FileNode
  onRenamed?: (oldPath: string, newPath: string) => void
}) {
  const dialog = useDialog()
  const language = useLanguage()
  const sdk = useSDK()
  const file = useFile()

  const [name, setName] = createSignal(props.node.name)

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
      const n = name().trim()
      if (!n || n === props.node.name) return
      const result = await renameNode(deps, props.node.path, n)
      if (!result.ok) {
        const key = result.code === "exists" ? "toast.file.exists" : "toast.file.renameFailed"
        showToast({ variant: "error", title: language.t(key) })
        return
      }
      showToast({ variant: "success", title: language.t("toast.file.renamed") })
      const dir = props.node.path.includes("/") ? props.node.path.slice(0, props.node.path.lastIndexOf("/")) : ""
      const newPath = dir ? `${dir}/${n}` : n
      props.onRenamed?.(props.node.path, newPath)
      dialog.close()
    },
  }))

  const valid = () => {
    const n = name().trim()
    return n.length > 0 && n !== props.node.name && !n.includes("/") && !n.includes("\\")
  }

  const handleSubmit = (e: Event) => {
    e.preventDefault()
    if (valid()) mutation.mutate()
  }

  return (
    <Dialog title={language.t("dialog.file.rename.title")} class="w-full max-w-[400px]">
      <form onSubmit={handleSubmit} class="flex flex-col gap-4 p-6 pt-0">
        <TextField
          label={language.t("dialog.file.rename.label")}
          value={name()}
          onChange={setName}
          autofocus
        />
        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={!valid() || mutation.isPending}>
            {mutation.isPending ? language.t("common.loading") : language.t("fileOps.rename")}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
