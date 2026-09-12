/* SPDX-License-Identifier: MIT */

import { createSignal } from "solid-js"
import { createSimpleContext } from "@unifia/ui/context"

const { use: useTitlebarSlots, provider: TitlebarSlotsContextProvider } = createSimpleContext({
  name: "TitlebarSlots",
  init: () => {
    const [center, setCenter] = createSignal<HTMLElement>()
    const [right, setRight] = createSignal<HTMLElement>()
    return { center, right, registerCenter: setCenter, registerRight: setRight }
  },
})

export { useTitlebarSlots }
export const TitlebarSlotsProvider = TitlebarSlotsContextProvider
