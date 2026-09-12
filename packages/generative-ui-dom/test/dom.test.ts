/* SPDX-License-Identifier: MIT */
import { GenerativeUiMountError, mountGenerativeUi, type DispatchedAction } from "../src/index.js"

let checks = 0
const check = (condition: boolean, message: string): void => {
  checks += 1
  if (!condition) throw new Error(message)
}
const refuses = (payload: unknown, message: string): void => {
  checks += 1
  try {
    mountGenerativeUi(payload, freshContainer(), baseOptions())
  } catch (error) {
    if (error instanceof GenerativeUiMountError) return
    throw new Error(`${message} (threw ${String(error)})`)
  }
  throw new Error(`${message} (mounted instead of refusing)`)
}

const allowedActions = new Set(["ui.run", "ui.fill"])
const dispatched: DispatchedAction[] = []
const baseOptions = () => ({ allowedActions, dispatcher: { dispatch: (action: DispatchedAction) => { dispatched.push(action) } }, document })
const freshContainer = (): Element => {
  const container = document.createElement("div")
  document.body.appendChild(container)
  return container
}

// --- Structure ---------------------------------------------------------------
const panel = freshContainer()
mountGenerativeUi(
  {
    type: "panel",
    id: "root",
    props: { title: "Report" },
    children: [
      { type: "text", id: "summary", props: { value: "All good" } },
      { type: "button", id: "run", props: { label: "Run", actionId: "ui.run" } },
      { type: "input", id: "name", props: { label: "Name", value: "initial", actionId: "ui.fill" } },
    ],
  },
  panel,
  baseOptions(),
)
const section = panel.firstElementChild as HTMLElement
check(section.tagName === "SECTION", `panel mounted as ${section.tagName} instead of SECTION`)
check(section.getAttribute("aria-label") === "Report", "panel title was not applied as an accessible label")
check(section.dataset.unifiaId === "root", "component id was not exposed on the element dataset")
check(section.children.length === 3, `panel mounted ${section.children.length} children instead of 3`)
check((section.children[0] as HTMLElement).textContent === "All good", "text node content was not applied")
check((section.children[1] as HTMLElement).tagName === "BUTTON", "button mounted as the wrong element")
const input = section.children[2] as HTMLInputElement
check(input.tagName === "INPUT" && input.type === "text", `input mounted with type ${input.type} instead of text`)
check(input.value === "initial", "input value was not applied")

// --- Behaviour flows through the dispatcher, never through the payload -------
;(section.children[1] as HTMLElement).click()
check(dispatched.length === 1, `click produced ${dispatched.length} dispatches instead of 1`)
check(dispatched[0].componentId === "run" && dispatched[0].actionId === "ui.run" && dispatched[0].kind === "click", "the dispatched click action was wrong")
check(dispatched[0].value === undefined, "a click action carried a value")
input.value = "typed by the user"
input.dispatchEvent(new Event("change"))
check(dispatched.length === 2 && dispatched[1].kind === "fill" && dispatched[1].value === "typed by the user", "the fill action did not carry the current input value")

// --- Hostile payloads --------------------------------------------------------
const hostile = freshContainer()
mountGenerativeUi(
  { type: "button", id: "evil", props: { label: "Click", actionId: "ui.run", onclick: "steal()", style: "position:fixed", href: "javascript:alert(1)" } },
  hostile,
  baseOptions(),
)
const evil = hostile.firstElementChild as HTMLElement
check(evil.getAttribute("onclick") === null, "an onclick attribute from the payload reached the DOM")
check(evil.getAttribute("style") === null, "a style attribute from the payload reached the DOM")
check(evil.getAttribute("href") === null, "an href attribute from the payload reached the DOM")
check((evil as unknown as { onclick: unknown }).onclick === null, "an inline handler property was assigned from the payload")
check(evil.attributes.length === 1, `the element carried ${evil.attributes.length} attributes instead of only data-unifia-id`)

const markup = freshContainer()
mountGenerativeUi({ type: "text", id: "xss", props: { value: "<img src=x onerror=alert(1)>" } }, markup, baseOptions())
const textNode = markup.firstElementChild as HTMLElement
check(textNode.children.length === 0, "markup in a text value was parsed into elements")
check(textNode.textContent === "<img src=x onerror=alert(1)>", "markup in a text value was not preserved as inert text")
check(markup.querySelector("img") === null, "an img element was created from a text value")

refuses({ type: "script", id: "s", props: {} }, "an unsupported component type was mounted")
refuses({ type: "button", id: "bad id!", props: {} }, "an invalid component id was mounted")
refuses({ type: "button", id: "b", props: { actionId: "ui.shutdown" } }, "an unallowlisted action was mounted")
refuses({ type: "panel", id: "p", children: [{ type: "button", id: "c", props: { actionId: "ui.shutdown" } }] }, "an unallowlisted action in a child was mounted")
refuses(null, "a null payload was mounted")
refuses("just a string", "a scalar payload was mounted")

// --- Remount replaces rather than accumulates --------------------------------
const remount = freshContainer()
mountGenerativeUi({ type: "text", id: "first", props: { value: "one" } }, remount, baseOptions())
mountGenerativeUi({ type: "text", id: "second", props: { value: "two" } }, remount, baseOptions())
check(remount.children.length === 1, "a remount appended instead of replacing")
check((remount.firstElementChild as HTMLElement).dataset.unifiaId === "second", "the remount did not render the newer tree")

// A refused payload must not leave the previous tree half-replaced.
const before = remount.innerHTML
try {
  mountGenerativeUi({ type: "button", id: "nope", props: { actionId: "ui.shutdown" } }, remount, baseOptions())
} catch { /* expected */ }
checks += 1
if (remount.innerHTML !== before) throw new Error("a refused payload mutated the container")

console.log(`GenerativeUiDom: ${checks}/${checks} passed`)
