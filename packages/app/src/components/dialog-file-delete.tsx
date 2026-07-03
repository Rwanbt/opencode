import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { showToast } from "@opencode-ai/ui/toast"
import { useMutation } from "@tanstack/solid-query"
import { useLanguage } from "@/context/language"
import { deleteNode, type FileOpDeps } from "@/context/file/operations"
import type { FileNode } from "../types/sdk-shim"

// FORK: deps injected by the call site — see createFileOpDeps.
export function DialogFileDelete(props: {
  node: FileNode
  deps: FileOpDeps
  onDeleted?: (path: string) => void
}) {
  const dialog = useDialog()
  const language = useLanguage()

  const mutation = useMutation(() => ({
    mutationFn: async () => {
      const result = await deleteNode(props.deps, props.node.path)
      if (!result.ok) {
        showToast({ variant: "error", title: language.t("toast.file.deleteFailed") })
        return
      }
      showToast({ variant: "success", title: language.t("toast.file.deleted") })
      props.onDeleted?.(props.node.path)
      dialog.close()
    },
  }))

  return (
    <Dialog title={language.t("dialog.file.delete.title")} class="w-full max-w-[400px]">
      <div class="flex flex-col gap-4 p-6 pt-0">
        <p class="text-13-regular text-text-base">
          {language.t("dialog.file.delete.confirm", { name: props.node.name })}
        </p>
        <p class="text-12-regular text-text-weak">{language.t("dialog.file.delete.warning")}</p>
        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? language.t("common.loading") : language.t("fileOps.delete")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
