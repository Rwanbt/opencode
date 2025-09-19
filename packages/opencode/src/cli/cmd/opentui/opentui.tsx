import { cmd } from "../cmd"
import { render, useKeyHandler, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import { RouteProvider, useRoute } from "./context/route"
import { Home } from "./home"
import { Switch, Match, createEffect } from "solid-js"
import { Theme } from "./context/theme"
import { Installation } from "../../../installation"
import { Global } from "../../../global"
import { DialogProvider, useDialog } from "./ui/dialog"
import { bootstrap } from "../../bootstrap"
import { SDKProvider } from "./context/sdk"
import { SyncProvider } from "./context/sync"
import { LocalProvider, useLocal } from "./context/local"
import { DialogModel } from "./component/dialog-model"
import { DialogCommand } from "./component/dialog-command"
import { Session } from "./session"

export const OpentuiCommand = cmd({
  command: "opentui",
  describe: "print hello",
  handler: async () => {
    await bootstrap(process.cwd(), async () => {
      await render(
        () => (
          <RouteProvider>
            <SDKProvider>
              <SyncProvider>
                <LocalProvider>
                  <DialogProvider>
                    <App />
                  </DialogProvider>
                </LocalProvider>
              </SyncProvider>
            </SDKProvider>
          </RouteProvider>
        ),
        {
          targetFps: 60,
          gatherStats: false,
        },
      )
    })
  },
})

function App() {
  const route = useRoute()
  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()
  const dialog = useDialog()
  const local = useLocal()

  useKeyHandler(async (evt) => {
    if (evt.name === "tab") {
      local.agent.move(evt.shift ? -1 : 1)
      return
    }

    if (evt.ctrl && evt.name === "p") {
      dialog.replace(() => <DialogCommand />)
      return
    }

    if (evt.meta && evt.name === "t") {
      renderer.toggleDebugOverlay()
      return
    }

    if (evt.meta && evt.name === "d") {
      renderer.console.toggle()
      return
    }
    if (evt.meta && evt.name === "m") {
      dialog.replace(() => <DialogModel />)
      return
    }
  })

  createEffect(() => {
    console.log(JSON.stringify(route.data))
  })

  return (
    <box width={dimensions().width} height={dimensions().height} backgroundColor={Theme.background}>
      <box flexDirection="column" flexGrow={1}>
        <Switch>
          <Match when={route.data.type === "home"}>
            <Home />
          </Match>
          <Match when={route.data.type === "session"}>
            <Session />
          </Match>
        </Switch>
      </box>
      <box height={1} backgroundColor={Theme.backgroundPanel} flexDirection="row" justifyContent="space-between">
        <box flexDirection="row">
          <box flexDirection="row" backgroundColor={Theme.backgroundElement} paddingLeft={1} paddingRight={1}>
            <text fg={Theme.textMuted}>open</text>
            <text attributes={TextAttributes.BOLD}>code </text>
            <text fg={Theme.textMuted}>v{Installation.VERSION}</text>
          </box>
          <box paddingLeft={1} paddingRight={1}>
            <text fg={Theme.textMuted}>{process.cwd().replace(Global.Path.home, "~")}</text>
          </box>
        </box>
        <box flexDirection="row">
          <text paddingRight={1} fg={Theme.textMuted}>
            tab
          </text>
          <text fg={local.agent.color(local.agent.current().name)}>┃</text>
          <text bg={local.agent.color(local.agent.current().name)} fg={Theme.background}>
            {" "}
            <span style={{ bold: true }}>{local.agent.current().name.toUpperCase()}</span>
            <span> AGENT </span>
          </text>
        </box>
      </box>
    </box>
  )
}
