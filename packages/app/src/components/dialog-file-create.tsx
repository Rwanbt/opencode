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
import { createFile, createFolder, type FileOpDeps } from "@/context/file/operations"

export function DialogFileCreate(props: {
  mode: "file" | "folder"
  parentDir: string
  onCreated?: (path: string) => void
}) {
  const dialog = useDialog()
  const language = useLanguage()
  const sdk = useSDK()
  const file = useFile()

  const [name, setName] = createSignal("")

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
      if (!n) return
      const result =
        props.mode === "file" ? await createFile(deps, props.parentDir, n) : await createFolder(deps, props.parentDir, n)
      if (!result.ok) {
        const key = result.code === "exists" ? "toast.file.exists" : "toast.file.createFailed"
        showToast({ variant: "error", title: language.t(key) })
        return
      }
      const toastKey = props.mode === "file" ? "toast.file.created" : "toast.file.folderCreated"
      showToast({ variant: "success", title: language.t(toastKey) })
      const createdPath = props.parentDir ? `${props.parentDir}/${n}` : n
      props.onCreated?.(createdPath)
      dialog.close()
    },
  }))

  const valid = () => {
    const n = name().trim()
    return n.length > 0 && !n.includes("/") && !n.includes("\\")
  }

  const handleSubmit = (e: Event) => {
    e.preventDefault()
    if (valid()) mutation.mutate()
  }

  const title = () =>
    props.mode === "file" ? language.t("dialog.file.create.title.file") : language.t("dialog.file.create.title.folder")
  const placeholder = () =>
    props.mode === "file"
      ? language.t("dialog.file.create.placeholder.file")
      : language.t("dialog.file.create.placeholder.folder")

  return (
    <Dialog title={title()} class="w-full max-w-[400px]">
      <form onSubmit={handleSubmit} class="flex flex-col gap-4 p-6 pt-0">
        <TextField
          label={language.t("dialog.file.create.label")}
          placeholder={placeholder()}
          value={name()}
          onChange={setName}
          autofocus
        />
        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={!valid() || mutation.isPending}>
            {mutation.isPending ? language.t("common.loading") : language.t("common.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
