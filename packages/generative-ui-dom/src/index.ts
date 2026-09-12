/* SPDX-License-Identifier: MIT */

/**
 * DOM consumer for the Generative UI renderer.
 *
 * WHY this package exists: `renderGenerativeUi` returned a validated tree that
 * nothing ever rendered, so the allowlist had never been confronted with a real
 * document. A validated tree is not a safe document — the safety of the final
 * page depends entirely on *how* the tree is turned into nodes.
 *
 * Non-negotiable rules, all enforced structurally rather than by review:
 *
 * - `innerHTML`, `outerHTML`, `insertAdjacentHTML` and `document.write` are
 *   never used. Text reaches the document through `textContent` only, so markup
 *   in a value is inert by construction.
 * - There is no generic `setAttribute(key, value)` loop. Every property is
 *   applied by an explicit per-(type, prop) setter, so a property the model
 *   invents cannot become an attribute.
 * - Behaviour is never read from the tree. Handlers are attached in code and
 *   call an injected dispatcher; no string from the payload is ever evaluated,
 *   assigned to an `on*` property, or used as a URL.
 * - The tree is re-validated here even though the server validated it. This
 *   layer does not trust its input, including its own server.
 */

import { renderGenerativeUi, type RenderedUiNode, type UiNode } from "@unifia/contracts"

export type DispatchedAction = {
  componentId: string
  actionId: string
  kind: "click" | "fill"
  value?: string
}

export type ActionDispatcher = { dispatch(action: DispatchedAction): void | Promise<void> }

/** Element used for each component type. Anything absent here cannot be mounted. */
const TAG_BY_TYPE: Readonly<Record<RenderedUiNode["type"], string>> = {
  text: "span",
  button: "button",
  input: "input",
  panel: "section",
}

const ID_PATTERN = /^[A-Za-z0-9_-]+$/

export class GenerativeUiMountError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "GenerativeUiMountError"
  }
}

export type MountOptions = {
  /** Actions the host accepts. A node referencing anything else is refused. */
  allowedActions: ReadonlySet<string>
  dispatcher: ActionDispatcher
  /** Injected so the module works under happy-dom, a browser, or a test double. */
  document: Document
}

/**
 * Validates an untrusted payload and mounts it into `container`.
 *
 * The container is emptied with `replaceChildren()` rather than
 * `innerHTML = ""`, which never parses markup.
 *
 * @throws GenerativeUiMountError when the payload is not renderable.
 */
export function mountGenerativeUi(payload: unknown, container: Element, options: MountOptions): RenderedUiNode {
  const validated = validatePayload(payload, options.allowedActions)
  container.replaceChildren(buildElement(validated, options))
  return validated
}

function validatePayload(payload: unknown, allowedActions: ReadonlySet<string>): RenderedUiNode {
  try {
    // Re-running the canonical renderer is what keeps a single definition of
    // "allowed": this package must never grow a second, drifting allowlist.
    return renderGenerativeUi(payload as UiNode, allowedActions)
  } catch (error) {
    throw new GenerativeUiMountError(error instanceof Error ? error.message : "payload is not renderable")
  }
}

function buildElement(node: RenderedUiNode, options: MountOptions): Element {
  const tag = TAG_BY_TYPE[node.type]
  if (!tag) throw new GenerativeUiMountError(`unsupported component type: ${node.type}`)
  if (!ID_PATTERN.test(node.id)) throw new GenerativeUiMountError(`invalid component id: ${node.id}`)
  const element = options.document.createElement(tag)
  // dataset, not setAttribute with a computed name: the key is a literal here.
  element.dataset.unifiaId = node.id
  applyProps(element, node, options)
  for (const child of node.children) element.appendChild(buildElement(child, options))
  return element
}

function applyProps(element: Element, node: RenderedUiNode, options: MountOptions): void {
  const { label, value, title, actionId } = node.props
  switch (node.type) {
    case "text":
      element.textContent = value ?? ""
      break
    case "panel":
      if (title !== undefined) element.setAttribute("aria-label", title)
      break
    case "button":
      element.textContent = label ?? ""
      if (actionId) attachAction(element, node.id, actionId, "click", options)
      break
    case "input":
      applyInputProps(element as HTMLInputElement, node.id, label, value, actionId, options)
      break
  }
}

function applyInputProps(input: HTMLInputElement, id: string, label: string | undefined, value: string | undefined, actionId: string | undefined, options: MountOptions): void {
  // WHY the type is hardcoded: letting the payload choose would allow
  // type="password" or type="file", turning a generated panel into a
  // credential or file-exfiltration surface.
  input.type = "text"
  if (label !== undefined) input.setAttribute("aria-label", label)
  if (value !== undefined) input.value = value
  if (actionId) attachAction(input, id, actionId, "fill", options)
}

function attachAction(element: Element, componentId: string, actionId: string, kind: "click" | "fill", options: MountOptions): void {
  if (!options.allowedActions.has(actionId)) throw new GenerativeUiMountError(`action is not allowlisted: ${actionId}`)
  const eventName = kind === "click" ? "click" : "change"
  element.addEventListener(eventName, (event) => {
    const target = event.target as HTMLInputElement | null
    void options.dispatcher.dispatch({ componentId, actionId, kind, value: kind === "fill" ? target?.value : undefined })
  })
}
