import type { Prompt, FileAttachmentPart, AgentPart } from "@/context/prompt"
import { DEFAULT_PROMPT } from "@/context/prompt"

const MAX_BREAKS = 200

export function createTextFragment(content: string): DocumentFragment {
  const fragment = document.createDocumentFragment()
  let breaks = 0
  for (const char of content) {
    if (char !== "\n") continue
    breaks += 1
    if (breaks > MAX_BREAKS) {
      const tail = content.endsWith("\n")
      const text = tail ? content.slice(0, -1) : content
      if (text) fragment.appendChild(document.createTextNode(text))
      if (tail) fragment.appendChild(document.createElement("br"))
      return fragment
    }
  }

  const segments = content.split("\n")
  segments.forEach((segment, index) => {
    if (segment) {
      fragment.appendChild(document.createTextNode(segment))
    }
    if (index < segments.length - 1) {
      fragment.appendChild(document.createElement("br"))
    }
  })
  return fragment
}

export function getNodeLength(node: Node): number {
  if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR") return 1
  return (node.textContent ?? "").replace(/\u200B/g, "").length
}

export function getTextLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").replace(/\u200B/g, "").length
  if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR") return 1
  let length = 0
  for (const child of Array.from(node.childNodes)) {
    length += getTextLength(child)
  }
  return length
}

export function getCursorPosition(parent: HTMLElement): number {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return 0
  const range = selection.getRangeAt(0)
  if (!parent.contains(range.startContainer)) return 0
  const preCaretRange = range.cloneRange()
  preCaretRange.selectNodeContents(parent)
  preCaretRange.setEnd(range.startContainer, range.startOffset)
  return getTextLength(preCaretRange.cloneContents())
}

export function setCursorPosition(parent: HTMLElement, position: number) {
  let remaining = position
  let node = parent.firstChild
  while (node) {
    const length = getNodeLength(node)
    const isText = node.nodeType === Node.TEXT_NODE
    const isPill =
      node.nodeType === Node.ELEMENT_NODE &&
      ((node as HTMLElement).dataset.type === "file" || (node as HTMLElement).dataset.type === "agent")
    const isBreak = node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR"

    if (isText && remaining <= length) {
      const range = document.createRange()
      const selection = window.getSelection()
      range.setStart(node, remaining)
      range.collapse(true)
      selection?.removeAllRanges()
      selection?.addRange(range)
      return
    }

    if ((isPill || isBreak) && remaining <= length) {
      const range = document.createRange()
      const selection = window.getSelection()
      if (remaining === 0) {
        range.setStartBefore(node)
      }
      if (remaining > 0 && isPill) {
        range.setStartAfter(node)
      }
      if (remaining > 0 && isBreak) {
        const next = node.nextSibling
        if (next && next.nodeType === Node.TEXT_NODE) {
          range.setStart(next, 0)
        }
        if (!next || next.nodeType !== Node.TEXT_NODE) {
          range.setStartAfter(node)
        }
      }
      range.collapse(true)
      selection?.removeAllRanges()
      selection?.addRange(range)
      return
    }

    remaining -= length
    node = node.nextSibling
  }

  const fallbackRange = document.createRange()
  const fallbackSelection = window.getSelection()
  const last = parent.lastChild
  if (last && last.nodeType === Node.TEXT_NODE) {
    const len = last.textContent ? last.textContent.length : 0
    fallbackRange.setStart(last, len)
  }
  if (!last || last.nodeType !== Node.TEXT_NODE) {
    fallbackRange.selectNodeContents(parent)
  }
  fallbackRange.collapse(false)
  fallbackSelection?.removeAllRanges()
  fallbackSelection?.addRange(fallbackRange)
}

/** Creates a contenteditable pill span for a file/agent mention part. */
export function createPill(part: FileAttachmentPart | AgentPart): HTMLSpanElement {
  const pill = document.createElement("span")
  pill.textContent = part.content
  pill.setAttribute("data-type", part.type)
  if (part.type === "file") pill.setAttribute("data-path", part.path)
  if (part.type === "agent") pill.setAttribute("data-name", part.name)
  pill.setAttribute("contenteditable", "false")
  pill.style.userSelect = "text"
  pill.style.cursor = "default"
  return pill
}

/**
 * Returns true when every node in the editor is in its expected normalised
 * form: text nodes, pill spans, and lone `<br>` tags — no stray wrappers.
 */
export function isNormalizedEditor(root: HTMLElement): boolean {
  return Array.from(root.childNodes).every((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? ""
      if (!text.includes("\u200B")) return true
      if (text !== "\u200B") return false

      const prev = node.previousSibling
      const next = node.nextSibling
      const prevIsBr = prev?.nodeType === Node.ELEMENT_NODE && (prev as HTMLElement).tagName === "BR"
      return !!prevIsBr && !next
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return false
    const el = node as HTMLElement
    if (el.dataset.type === "file") return true
    if (el.dataset.type === "agent") return true
    return el.tagName === "BR"
  })
}

/** Re-renders the editor DOM from a Prompt parts array. */
export function renderEditor(root: HTMLElement, parts: Prompt): void {
  root.innerHTML = ""
  for (const part of parts) {
    if (part.type === "text") {
      root.appendChild(createTextFragment(part.content))
      continue
    }
    if (part.type === "file" || part.type === "agent") {
      root.appendChild(createPill(part))
    }
  }

  const last = root.lastChild
  if (last?.nodeType === Node.ELEMENT_NODE && (last as HTMLElement).tagName === "BR") {
    root.appendChild(document.createTextNode("\u200B"))
  }
}

/**
 * Parses the current contenteditable DOM tree into a typed Prompt parts array.
 * Handles text nodes, file/agent pill spans, and `<br>` line breaks.
 */
export function parseFromDOM(root: HTMLElement): Prompt {
  const parts: Prompt = []
  let position = 0
  let buffer = ""

  const flushText = () => {
    let content = buffer
    if (content.includes("\r")) content = content.replace(/\r\n?/g, "\n")
    if (content.includes("\u200B")) content = content.replace(/\u200B/g, "")
    buffer = ""
    if (!content) return
    parts.push({ type: "text", content, start: position, end: position + content.length })
    position += content.length
  }

  const pushFile = (file: HTMLElement) => {
    const content = file.textContent ?? ""
    parts.push({
      type: "file",
      path: file.dataset.path!,
      content,
      start: position,
      end: position + content.length,
    })
    position += content.length
  }

  const pushAgent = (agent: HTMLElement) => {
    const content = agent.textContent ?? ""
    parts.push({
      type: "agent",
      name: agent.dataset.name!,
      content,
      start: position,
      end: position + content.length,
    })
    position += content.length
  }

  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      buffer += node.textContent ?? ""
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return

    const el = node as HTMLElement
    if (el.dataset.type === "file") {
      flushText()
      pushFile(el)
      return
    }
    if (el.dataset.type === "agent") {
      flushText()
      pushAgent(el)
      return
    }
    if (el.tagName === "BR") {
      buffer += "\n"
      return
    }

    for (const child of Array.from(el.childNodes)) {
      visit(child)
    }
  }

  const children = Array.from(root.childNodes)
  children.forEach((child, index) => {
    const isBlock = child.nodeType === Node.ELEMENT_NODE && ["DIV", "P"].includes((child as HTMLElement).tagName)
    visit(child)
    if (isBlock && index < children.length - 1) {
      buffer += "\n"
    }
  })

  flushText()

  if (parts.length === 0) parts.push(...DEFAULT_PROMPT)
  return parts
}

export function setRangeEdge(parent: HTMLElement, range: Range, edge: "start" | "end", offset: number) {
  let remaining = offset
  const nodes = Array.from(parent.childNodes)

  for (const node of nodes) {
    const length = getNodeLength(node)
    const isText = node.nodeType === Node.TEXT_NODE
    const isPill =
      node.nodeType === Node.ELEMENT_NODE &&
      ((node as HTMLElement).dataset.type === "file" || (node as HTMLElement).dataset.type === "agent")
    const isBreak = node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR"

    if (isText && remaining <= length) {
      if (edge === "start") range.setStart(node, remaining)
      if (edge === "end") range.setEnd(node, remaining)
      return
    }

    if ((isPill || isBreak) && remaining <= length) {
      if (edge === "start" && remaining === 0) range.setStartBefore(node)
      if (edge === "start" && remaining > 0) range.setStartAfter(node)
      if (edge === "end" && remaining === 0) range.setEndBefore(node)
      if (edge === "end" && remaining > 0) range.setEndAfter(node)
      return
    }

    remaining -= length
  }
}
