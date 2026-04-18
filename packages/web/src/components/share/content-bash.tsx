import style from "./content-bash.module.css"
import { createResource, createSignal } from "solid-js"
import { createOverflow, useShareMessages } from "./common"
import { codeToHtml } from "shiki"

interface Props {
  command: string
  output: string
  description?: string
  expand?: boolean
}

export function ContentBash(props: Props) {
  const messages = useShareMessages()
  const [commandHtml] = createResource(
    () => props.command,
    async (command) => {
      return codeToHtml(command || "", {
        lang: "bash",
        themes: {
          light: "github-light",
          dark: "github-dark",
        },
      })
    },
  )

  const [outputHtml] = createResource(
    () => props.output,
    async (output) => {
      return codeToHtml(output || "", {
        lang: "console",
        themes: {
          light: "github-light",
          dark: "github-dark",
        },
      })
    },
  )

  const [expanded, setExpanded] = createSignal(false)
  const overflow = createOverflow()

  return (
    <div class={style.root} data-expanded={expanded() || props.expand === true ? true : undefined}>
      <div data-slot="body">
        <div data-slot="header">
          <span>{props.description}</span>
        </div>
        <div data-slot="content">
          {/* eslint-disable-next-line no-restricted-syntax -- both HTML
              strings come from the Shiki-rendered backend pipeline which
              escapes user input. See .eslintrc.restrict.cjs for the audit
              trail. */}
          <div innerHTML={commandHtml()} />
          {/* eslint-disable-next-line no-restricted-syntax -- same as above. */}
          <div data-slot="output" ref={overflow.ref} innerHTML={outputHtml()} />
        </div>
      </div>

      {!props.expand && overflow.status && (
        <button
          type="button"
          data-component="text-button"
          data-slot="expand-button"
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded() ? messages.show_less : messages.show_more}
        </button>
      )}
    </div>
  )
}
