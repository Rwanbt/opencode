/* SPDX-License-Identifier: MIT */

import { Show, createSignal, type Component } from "solid-js"
import { Button } from "@unifia/ui/button"
import { useCollaborativeAuth } from "@/context/collaborative-auth"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { LoginForm } from "./auth/login-form"
import { SettingsList } from "./settings-list"
import { SettingsRow } from "./settings-row"

export const SettingsCollaborativeAuth: Component = () => {
  const auth = useCollaborativeAuth()
  const language = useLanguage()
  const platform = usePlatform()
  const server = useServer()
  const [error, setError] = createSignal<string>()

  async function handleLogin(tokens: Parameters<typeof auth.login>[0]) {
    try {
      setError(undefined)
      await auth.login(tokens)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : language.t("auth.connectionFailed"))
    }
  }

  return (
    <div class="flex flex-col gap-4 p-5">
      <Show
        when={auth.current()}
        fallback={
          <LoginForm
            serverUrl={server.current?.http.url ?? ""}
            fetch={platform.fetch}
            onLogin={(tokens) => void handleLogin(tokens)}
          />
        }
      >
        {(session) => (
          <>
            <SettingsList>
              <SettingsRow title={session().user.displayName ?? session().user.username} description={session().user.email ?? session().serverUrl}>
                <span class="rounded bg-surface-raised-base px-2 py-1 text-12-medium text-text-weak">
                  {session().user.role}
                </span>
              </SettingsRow>
            </SettingsList>
            <Button variant="secondary" class="self-start" onClick={() => void auth.logout()}>
              {language.t("common.disconnect")}
            </Button>
          </>
        )}
      </Show>
      <Show when={error()}>{(message) => <p class="text-12-regular text-text-danger">{message()}</p>}</Show>
    </div>
  )
}
