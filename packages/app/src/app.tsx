import "@/index.css"
import { I18nProvider } from "@opencode-ai/ui/context"
import { DialogProvider } from "@opencode-ai/ui/context/dialog"
import { FileComponentProvider } from "@opencode-ai/ui/context/file"
import { MarkedProvider } from "@opencode-ai/ui/context/marked"
import { File } from "@opencode-ai/ui/file"
import { Font } from "@opencode-ai/ui/font"
import { Splash } from "@opencode-ai/ui/logo"
import { ThemeProvider } from "@opencode-ai/ui/theme/context"
import { MetaProvider } from "@solidjs/meta"
import { type BaseRouterProps, Navigate, Route, Router } from "@solidjs/router"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import { type Duration, Effect } from "effect"
import {
  type Component,
  createMemo,
  createResource,
  createSignal,
  ErrorBoundary,
  For,
  type JSX,
  lazy,
  onCleanup,
  type ParentProps,
  Show,
  Suspense,
} from "solid-js"
import { Dynamic } from "solid-js/web"
import { CommandProvider } from "@/context/command"
import { CommandPaletteMount } from "@/components/dialog-command-palette"
import { CommentsProvider } from "@/context/comments"
import { FileProvider } from "@/context/file"
import { GlobalSDKProvider } from "@/context/global-sdk"
import { GlobalSyncProvider } from "@/context/global-sync"
import { HighlightsProvider } from "@/context/highlights"
import { LanguageProvider, type Locale, useLanguage } from "@/context/language"
import { LayoutProvider } from "@/context/layout"
import { ModelsProvider } from "@/context/models"
import { NotificationProvider } from "@/context/notification"
import { PermissionProvider } from "@/context/permission"
import { PromptProvider } from "@/context/prompt"
import { ServerConnection, ServerProvider, serverName, useServer } from "@/context/server"
import { SDKProvider } from "@/context/sdk"
import { SettingsProvider } from "@/context/settings"
import { TerminalProvider } from "@/context/terminal"
import DirectoryLayout from "@/pages/directory-layout"
import Layout from "@/pages/layout"
import { ErrorPage } from "./pages/error"
import { useCheckServerHealth } from "./utils/server-health"

const HomeRoute = lazy(() => import("@/pages/home"))
const loadSession = () => import("@/pages/session")
const Session = lazy(loadSession)
const Loading = () => <div class="size-full" />

if (typeof location === "object" && /\/session(?:\/|$)/.test(location.pathname)) {
  void loadSession()
}

const SessionRoute = () => (
  <SessionProviders>
    <Session />
  </SessionProviders>
)

const SessionIndexRoute = () => <Navigate href="session" />

function UiI18nBridge(props: ParentProps) {
  const language = useLanguage()
  return <I18nProvider value={{ locale: language.intl, t: language.t }}>{props.children}</I18nProvider>
}

declare global {
  interface Window {
    __OPENCODE__?: {
      updaterEnabled?: boolean
      deepLinks?: string[]
      wsl?: boolean
    }
    api?: {
      setTitlebar?: (theme: { mode: "light" | "dark" }) => Promise<void>
    }
  }
}

function QueryProvider(props: ParentProps) {
  const client = new QueryClient()
  return <QueryClientProvider client={client}>{props.children}</QueryClientProvider>
}

function AppShellProviders(props: ParentProps) {
  return (
    <PermissionProvider>
      <LayoutProvider>
        <NotificationProvider>
          <CommandProvider>
            <HighlightsProvider>
              <Layout>{props.children}</Layout>
            </HighlightsProvider>
            <CommandPaletteMount />
          </CommandProvider>
        </NotificationProvider>
      </LayoutProvider>
    </PermissionProvider>
  )
}

function SessionProviders(props: ParentProps) {
  return (
    <TerminalProvider>
      {/* FileStoreProvider moved to DirectoryLayout — it must wrap EditorProvider,
          which is rendered above the SessionRoute. See fix/pre-flight-0-filestore-scope. */}
      <FileProvider>
        <PromptProvider>
          <CommentsProvider>{props.children}</CommentsProvider>
        </PromptProvider>
      </FileProvider>
    </TerminalProvider>
  )
}

// FORK (REGRESSION FIX 2026-06-27, round 2): DialogProvider sits ABOVE the
// SDKProvider in the provider tree (see AppBaseProviders below) — when an app
// component calls `dialog.show(() => <MyDialog />)`, the rendered MyDialog
// mounts inside DialogProvider's <Show> branch but BELOW any router-scoped
// provider. That broke DialogFileCreate / DialogFileRename / etc. that
// depend on `useSDK()` + `useFile()` (both scoped via DirectoryLayout).
//
// Wrapping DialogProvider with SDKProvider at the AppBaseProviders level
// (NOT RouterRoot) is required because entry.tsx mounts AppBaseProviders
// OUTSIDE the Router. useParams() therefore does not work here — fall back
// to an empty directory accessor. File ops inside dialogs use absolute
// paths (parentDir prop) so the empty directory is irrelevant for the
// SDK client; it only exists to satisfy useSDK()/useFile() context lookup.
// The DirectoryLayout's own SDKProvider further down still takes precedence
// for components rendered inside a route.
function FallbackSDKForDialogs(props: ParentProps) {
  const directory = createMemo(() => "")
  return <SDKProvider directory={directory}>{props.children}</SDKProvider>
}

function RouterRoot(props: ParentProps<{ appChildren?: JSX.Element }>) {
  return (
    <AppShellProviders>
      <Suspense fallback={<Loading />}>
        {props.appChildren}
        {props.children}
      </Suspense>
    </AppShellProviders>
  )
}

// Bottom-half providers — MUST be mounted as a descendant of
// GlobalSDKProvider so FallbackSDKForDialogs (SDKProvider.init → useGlobalSDK)
// resolves. Caller (AppProviders) is responsible for placing LanguageProvider
// and the outer ErrorBoundary ABOVE this so the fallback of the inner
// ErrorBoundary here can still call useLanguage() / usePlatform().
//
// The inner ErrorBoundary catches runtime errors from QueryProvider /
// DialogProvider / etc. so a runtime crash doesn't take down the whole tree.
export function AppBaseProviders(props: ParentProps) {
  return (
    <ErrorBoundary fallback={(error) => <ErrorPage error={error} />}>
      <SettingsProvider>
        <ModelsProvider>
          <QueryProvider>
            <FallbackSDKForDialogs>
              <DialogProvider>
                <MarkedProvider>
                  <FileComponentProvider component={File}>{props.children}</FileComponentProvider>
                </MarkedProvider>
              </DialogProvider>
            </FallbackSDKForDialogs>
          </QueryProvider>
        </ModelsProvider>
      </SettingsProvider>
    </ErrorBoundary>
  )
}

const effectMinDuration =
  (duration: Duration.Input) =>
  <A, E, R>(e: Effect.Effect<A, E, R>) =>
    Effect.all([e, Effect.sleep(duration)], { concurrency: "unbounded" }).pipe(Effect.map((v) => v[0]))

function ConnectionGate(props: ParentProps<{ disableHealthCheck?: boolean }>) {
  const server = useServer()
  const checkServerHealth = useCheckServerHealth()

  const [checkMode, setCheckMode] = createSignal<"blocking" | "background">("blocking")

  // performs repeated health check with a grace period for
  // non-http connections, otherwise fails instantly
  const [startupHealthCheck, healthCheckActions] = createResource(() =>
    props.disableHealthCheck
      ? true
      : Effect.gen(function* () {
          if (!server.current) return true
          const { http, type } = server.current

          while (true) {
            const res = yield* Effect.promise(() => checkServerHealth(http))
            if (res.healthy) return true
            if (checkMode() === "background" || type === "http") return false
          }
        }).pipe(
          effectMinDuration(checkMode() === "blocking" ? "1.2 seconds" : 0),
          Effect.timeoutOrElse({ duration: "10 seconds", orElse: () => Effect.succeed(false) }),
          Effect.ensuring(Effect.sync(() => setCheckMode("background"))),
          Effect.runPromise,
        ),
  )

  return (
    <Show
      when={checkMode() === "blocking" ? !startupHealthCheck.loading : startupHealthCheck.state !== "pending"}
      fallback={
        <div class="h-dvh w-screen flex flex-col items-center justify-center bg-background-base">
          <Splash class="w-16 h-20 opacity-50 animate-pulse" />
        </div>
      }
    >
      <Show
        when={startupHealthCheck()}
        fallback={
          <ConnectionError
            onRetry={() => {
              if (checkMode() === "background") healthCheckActions.refetch()
            }}
            onServerSelected={(key) => {
              setCheckMode("blocking")
              server.setActive(key)
              healthCheckActions.refetch()
            }}
          />
        }
      >
        {props.children}
      </Show>
    </Show>
  )
}

function ConnectionError(props: { onRetry?: () => void; onServerSelected?: (key: ServerConnection.Key) => void }) {
  const language = useLanguage()
  const server = useServer()
  const others = () => server.list.filter((s) => ServerConnection.key(s) !== server.key)
  const name = createMemo(() => server.name || server.key)
  const serverToken = "\u0000server\u0000"
  const unreachable = createMemo(() => language.t("app.server.unreachable", { server: serverToken }).split(serverToken))

  const timer = setInterval(() => props.onRetry?.(), 1000)
  onCleanup(() => clearInterval(timer))

  return (
    <div class="h-dvh w-screen flex flex-col items-center justify-center bg-background-base gap-6 p-6">
      <div class="flex flex-col items-center max-w-md text-center">
        <Splash class="w-12 h-15 mb-4" />
        <p class="text-14-regular text-text-base">
          {unreachable()[0]}
          <span class="text-text-strong font-medium">{name()}</span>
          {unreachable()[1]}
        </p>
        <p class="mt-1 text-12-regular text-text-weak">{language.t("app.server.retrying")}</p>
      </div>
      <Show when={others().length > 0}>
        <div class="flex flex-col gap-2 w-full max-w-sm">
          <span class="text-12-regular text-text-base text-center">{language.t("app.server.otherServers")}</span>
          <div class="flex flex-col gap-1 bg-surface-base rounded-lg p-2">
            <For each={others()}>
              {(conn) => {
                const key = ServerConnection.key(conn)
                return (
                  <button
                    type="button"
                    class="flex items-center gap-3 w-full px-3 py-2 rounded-md hover:bg-surface-raised-base-hover transition-colors text-left"
                    onClick={() => props.onServerSelected?.(key)}
                  >
                    <span class="text-14-regular text-text-strong truncate">{serverName(conn)}</span>
                  </button>
                )
              }}
            </For>
          </div>
        </div>
      </Show>
    </div>
  )
}

function ServerKey(props: ParentProps) {
  const server = useServer()
  return (
    <Show when={server.key} keyed>
      {props.children}
    </Show>
  )
}

// Canonical provider tree (Fix-GlobalSDK Phase 1). AppProviders is the
// single source of truth for the order in which ServerProvider →
// GlobalSDKProvider → AppBaseProviders are mounted. Entry points (desktop
// Tauri, desktop Electron, mobile, web) MUST use AppProviders instead of
// manually assembling ServerProvider/GlobalSDKProvider around
// AppBaseProviders/AppInterface — that mistake reproduces the boot-time
// "GlobalSDK context must be used within a context provider" crash.
//
// Order rationale:
//   • ServerProvider is at the top because GlobalSDKProvider.init calls
//     useServer() (global-sdk.tsx:20). Mounting GlobalSDKProvider above
//     ServerProvider causes useServer() to throw at SDK init.
//   • GlobalSDKProvider must sit above AppBaseProviders because
//     FallbackSDKForDialogs (inside AppBaseProviders, app.tsx) renders
//     SDKProvider whose init calls useGlobalSDK() (sdk.tsx:14). Mounting
//     GlobalSDKProvider below AppBaseProviders → boot crash.
//   • ErrorBoundary wraps GlobalSDKProvider so SDK init errors surface a
//     clean ErrorPage instead of an uncaught throw. A second ErrorBoundary
//     remains inside AppBaseProviders for runtime errors.
//   • ConnectionGate, ServerKey, and GlobalSyncProvider sit above
//     AppBaseProviders so that DialogProvider (inside AppBaseProviders)
//     has access to GlobalSyncProvider. This fixes 11 dialogs that
//     crashed with "useGlobalSync must be used within GlobalSyncProvider".
//
// See [[Fix-GlobalSDK-Provider-Tree]] for the full target topology and
// [[Fix-GlobalSDK-Phase0-prep]] for the diagnostic of the bug.
export function AppProviders(props: ParentProps<{
  locale?: Locale
  defaultServer: ServerConnection.Key
  servers?: Array<ServerConnection.Any>
  router?: Component<BaseRouterProps>
  disableHealthCheck?: boolean
}>) {
  return (
    <ServerProvider
      defaultServer={props.defaultServer}
      disableHealthCheck={props.disableHealthCheck}
      servers={props.servers}
    >
      <MetaProvider>
        <Font />
        <ThemeProvider
          onThemeApplied={(_, mode) => {
            void window.api?.setTitlebar?.({ mode })
          }}
        >
          <LanguageProvider locale={props.locale}>
            <UiI18nBridge>
              <ErrorBoundary fallback={(error) => <ErrorPage error={error} />}>
                <GlobalSDKProvider>
                  <ConnectionGate disableHealthCheck={props.disableHealthCheck}>
                    <ServerKey>
                      <GlobalSyncProvider>
                        <AppBaseProviders>
                          <AppInterface
                            router={props.router}
                          >
                            {props.children}
                          </AppInterface>
                        </AppBaseProviders>
                      </GlobalSyncProvider>
                    </ServerKey>
                  </ConnectionGate>
                </GlobalSDKProvider>
              </ErrorBoundary>
            </UiI18nBridge>
          </LanguageProvider>
        </ThemeProvider>
      </MetaProvider>
    </ServerProvider>
  )
}

// Reduced from the original full provider tree. ServerProvider,
// GlobalSDKProvider, ConnectionGate, ServerKey, and GlobalSyncProvider have
// moved up into AppProviders (Fix-GlobalSDK Phase 1 + P7-DialogContext fix).
// AppInterface now only mounts the Router. Kept exported so legacy callers
// compile during the transition — new entry points should prefer AppProviders.
export function AppInterface(props: {
  children?: JSX.Element
  router?: Component<BaseRouterProps>
  // @deprecated moved to AppProviders. Kept optional+ignored here so
  // existing entry points (desktop/src/index.tsx, desktop-electron, mobile)
  // keep compiling until they migrate to AppProviders in Phases 2-4.
  defaultServer?: ServerConnection.Key
  servers?: Array<ServerConnection.Any>
  disableHealthCheck?: boolean
}) {
  return (
    <Dynamic
      component={props.router ?? Router}
      root={(routerProps) => (
        <RouterRoot appChildren={props.children}>{routerProps.children}</RouterRoot>
      )}
    >
      <Route path="/" component={HomeRoute} />
      <Route path="/:dir" component={DirectoryLayout}>
        <Route path="/" component={SessionIndexRoute} />
        <Route path="/session/:id?" component={SessionRoute} />
      </Route>
    </Dynamic>
  )
}
