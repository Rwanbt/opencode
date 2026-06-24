import { Show, type JSX } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { ContextMenu } from "@opencode-ai/ui/context-menu"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { useLanguage } from "@/context/language"
import type { FileNode } from "@opencode-ai/sdk/v2"

export interface FileTreeActionsProps {
  node: FileNode
  onNewFile?: (parentDir: string) => void
  onNewFolder?: (parentDir: string) => void
  onRename?: (node: FileNode) => void
  onDelete?: (node: FileNode) => void
  onMove?: (node: FileNode) => void
  onCopyPath?: (path: string) => void
  onCopyRelativePath?: (path: string) => void
  children: JSX.Element
}

function ActionItems(props: {
  node: FileNode
  onNewFile?: (parentDir: string) => void
  onNewFolder?: (parentDir: string) => void
  onRename?: (node: FileNode) => void
  onDelete?: (node: FileNode) => void
  onMove?: (node: FileNode) => void
  onCopyPath?: (path: string) => void
  onCopyRelativePath?: (path: string) => void
  Item: any
  ItemLabel: any
  Separator: any
}) {
  const language = useLanguage()
  const isDir = () => props.node.type === "directory"
  const dirPath = () => (isDir() ? props.node.path : "")

  return (
    <>
      <Show when={isDir() && props.onNewFile}>
        <props.Item onSelect={() => props.onNewFile?.(dirPath())}>
          <props.ItemLabel>{language.t("fileOps.newFile")}</props.ItemLabel>
        </props.Item>
      </Show>
      <Show when={isDir() && props.onNewFolder}>
        <props.Item onSelect={() => props.onNewFolder?.(dirPath())}>
          <props.ItemLabel>{language.t("fileOps.newFolder")}</props.ItemLabel>
        </props.Item>
      </Show>
      <Show when={isDir() && (props.onNewFile || props.onNewFolder)}>
        <props.Separator />
      </Show>
      <Show when={props.onRename}>
        <props.Item onSelect={() => props.onRename?.(props.node)}>
          <props.ItemLabel>{language.t("fileOps.rename")}</props.ItemLabel>
        </props.Item>
      </Show>
      <Show when={props.onDelete}>
        <props.Item onSelect={() => props.onDelete?.(props.node)}>
          <props.ItemLabel>{language.t("fileOps.delete")}</props.ItemLabel>
        </props.Item>
      </Show>
      <props.Separator />
      <Show when={props.onMove}>
        <props.Item onSelect={() => props.onMove?.(props.node)}>
          <props.ItemLabel>{language.t("fileOps.moveTo")}</props.ItemLabel>
        </props.Item>
        <props.Separator />
      </Show>
      <Show when={props.onCopyPath}>
        <props.Item onSelect={() => props.onCopyPath?.(props.node.absolute)}>
          <props.ItemLabel>{language.t("fileOps.copyPath")}</props.ItemLabel>
        </props.Item>
      </Show>
      <Show when={props.onCopyRelativePath}>
        <props.Item onSelect={() => props.onCopyRelativePath?.(props.node.path)}>
          <props.ItemLabel>{language.t("fileOps.copyRelativePath")}</props.ItemLabel>
        </props.Item>
      </Show>
    </>
  )
}

export function FileTreeActions(props: FileTreeActionsProps) {
  const isTouch = createMediaQuery("(hover: none)")

  const actionProps = () => ({
    node: props.node,
    onNewFile: props.onNewFile,
    onNewFolder: props.onNewFolder,
    onRename: props.onRename,
    onDelete: props.onDelete,
    onMove: props.onMove,
    onCopyPath: props.onCopyPath,
    onCopyRelativePath: props.onCopyRelativePath,
  })

  return (
    <ContextMenu>
      <ContextMenu.Trigger class="flex items-center w-full group/node">
        <div class="flex-1 min-w-0">{props.children}</div>
        <DropdownMenu gutter={4}>
          <DropdownMenu.Trigger
            as={IconButton}
            icon="dot-grid"
            variant="ghost"
            size="small"
            data-slot="node-actions"
            class="shrink-0 transition-opacity"
            classList={{
              "opacity-0 group-hover/node:opacity-100 focus-visible:opacity-100": !isTouch(),
              "opacity-60": isTouch(),
            }}
            onClick={(e: MouseEvent) => e.stopPropagation()}
            onPointerDown={(e: PointerEvent) => e.stopPropagation()}
          />
          <DropdownMenu.Portal>
            <DropdownMenu.Content>
              <ActionItems
                {...actionProps()}
                Item={DropdownMenu.Item}
                ItemLabel={DropdownMenu.ItemLabel}
                Separator={DropdownMenu.Separator}
              />
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content>
          <ActionItems
            {...actionProps()}
            Item={ContextMenu.Item}
            ItemLabel={ContextMenu.ItemLabel}
            Separator={ContextMenu.Separator}
          />
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu>
  )
}
