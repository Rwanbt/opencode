/* @refresh reload */
import { render } from "solid-js/web"
import { createPlatform } from "./platform"
import { AppInterface } from "@opencode-ai/app"
import { PlatformProvider } from "@opencode-ai/app/context/platform"

const root = document.getElementById("root")

const platform = await createPlatform()

render(
  () => (
    <PlatformProvider value={platform}>
      <AppInterface />
    </PlatformProvider>
  ),
  root!,
)
