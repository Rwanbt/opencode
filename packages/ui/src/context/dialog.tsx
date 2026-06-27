import {
  createContext,
  createEffect,
  createSignal,
  type JSX,
  onCleanup,
  type ParentProps,
  Show,
  useContext,
} from "solid-js"
import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { makeEventListener } from "@solid-primitives/event-listener"

type DialogElement = () => JSX.Element

type Active = {
  id: string
  element: DialogElement
  closing: () => boolean
  setClosing: (closing: boolean) => void
  onClose?: () => void
}

const Context = createContext<ReturnType<typeof init>>()

function init() {
  const [active, setActive] = createSignal<Active | undefined>()
  const timer = { current: undefined as ReturnType<typeof setTimeout> | undefined }
  const lock = { value: false }

  onCleanup(() => {
    if (timer.current === undefined) return
    clearTimeout(timer.current)
    timer.current = undefined
  })

  const close = () => {
    const current = active()
    if (!current || lock.value) return
    lock.value = true
    current.onClose?.()
    current.setClosing(true)

    const id = current.id
    if (timer.current !== undefined) {
      clearTimeout(timer.current)
      timer.current = undefined
    }

    // WHY: defer the unmount by 100ms so Kobalte can play its closing animation.
    // When setActive(undefined) fires, <Show> unmounts the Kobalte subtree which
    // triggers reactive cleanups for everything below the DialogContext.Provider.
    timer.current = setTimeout(() => {
      timer.current = undefined
      if (active()?.id === id) setActive(undefined)
      lock.value = false
    }, 100)
  }

  createEffect(() => {
    if (!active()) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      close()
      event.preventDefault()
      event.stopPropagation()
    }

    makeEventListener(window, "keydown", onKeyDown, { capture: true })
  })

  const show = (element: DialogElement, onClose?: () => void) => {
    // WHY: detach the previous dialog first so the new one mounts cleanly.
    // <Show when={active()}> handles the actual DOM unmount of the old tree
    // (reactive cleanups fire inside the unmounted subtree).
    const current = active()
    if (current) setActive(undefined)

    if (timer.current !== undefined) {
      clearTimeout(timer.current)
      timer.current = undefined
    }
    lock.value = false

    const id = Math.random().toString(36).slice(2)
    const [closing, setClosing] = createSignal(false)

    setActive({ id, element, closing, setClosing, onClose })
  }

  return {
    get active() {
      return active()
    },
    close,
    show,
  }
}

export function DialogProvider(props: ParentProps) {
  const ctx = init()
  return (
    <Context.Provider value={ctx}>
      {props.children}
      {/* WHY: render the active dialog inside the normal JSX tree of the
          DialogProvider. The previous implementation used runWithOwner +
          createRoot to construct the Kobalte subtree in a detached reactive
          scope, then mounted it later via {active.node}. That detached
          construction broke Solid's context-owner chain: Kobalte.Portal
          renders to document.body and propagates context through the owner
          it captures at call time. With a detached owner, the captured owner
          no longer reached the DialogContext.Provider provided by the Kobalte
          root above, and useDialogContext() threw "must be used within a
          Dialog component" at the first show() call (audit Phase 10,
          diagnostic #2). Rendering here, inside the Provider's own reactive
          scope, keeps the owner chain intact end-to-end. */}
      <Show when={ctx.active}>
        {(getActive) => (
          <div data-component="dialog-stack">
            <Kobalte
              modal
              open={!getActive().closing()}
              onOpenChange={(open: boolean) => {
                if (open) return
                ctx.close()
              }}
            >
              <Kobalte.Portal>
                <Kobalte.Overlay data-component="dialog-overlay" onClick={() => ctx.close()} />
                {getActive().element()}
              </Kobalte.Portal>
            </Kobalte>
          </div>
        )}
      </Show>
    </Context.Provider>
  )
}

export function useDialog() {
  const ctx = useContext(Context)

  if (!ctx) {
    throw new Error("useDialog must be used within a DialogProvider")
  }

  return {
    get active() {
      return ctx.active
    },
    show(element: DialogElement, onClose?: () => void) {
      ctx.show(element, onClose)
    },
    close() {
      ctx.close()
    },
  }
}