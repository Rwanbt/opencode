import { TextAttributes, RGBA } from "@opentui/core"
import { createMemo, For, Show } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { brandColors, compactBelowColumns, logo } from "@/cli/logo"

const color = {
  P: RGBA.fromHex(brandColors.purple),
  B: RGBA.fromHex(brandColors.blue),
  O: RGBA.fromHex(brandColors.orange),
}
const white = RGBA.fromHex(brandColors.white)

export function Logo() {
  const dimensions = useTerminalDimensions()
  const compact = createMemo(() => dimensions().width < compactBelowColumns)

  return (
    <box>
      <Show
        when={!compact()}
        fallback={
          <box flexDirection="row">
            <text fg={color.P} attributes={TextAttributes.BOLD} selectable={false}>{logo.compact.purple}</text>
            <text fg={color.B} attributes={TextAttributes.BOLD} selectable={false}>{logo.compact.blue}</text>
            <text fg={color.O} attributes={TextAttributes.BOLD} selectable={false}>{logo.compact.orange}</text>
            <text fg={white} attributes={TextAttributes.BOLD} selectable={false}> {logo.compact.wordmark}</text>
          </box>
        }
      >
        <For each={logo.symbol}>
          {(row, index) => (
            <box flexDirection="row">
              <For each={[...row.text]}>
                {(char, charIndex) => (
                  <text
                    fg={color[row.colors[charIndex()] as keyof typeof color] ?? white}
                    attributes={TextAttributes.BOLD}
                    selectable={false}
                  >
                    {char}
                  </text>
                )}
              </For>
              <text selectable={false}>{"  "}</text>
              <text fg={white} attributes={TextAttributes.BOLD} selectable={false}>{logo.wordmark[index()]}</text>
            </box>
          )}
        </For>
      </Show>
    </box>
  )
}
