import { createSignal, Show } from "solid-js"

export interface LoginFormProps {
  onLogin: (tokens: { accessToken: string; refreshToken: string; user: { id: string; username: string; role: string } }) => void
  serverUrl: string
}

/**
 * Login/register form for collaborative mode.
 * Talks to the /collab/login and /collab/register endpoints.
 */
export function LoginForm(props: LoginFormProps) {
  const [mode, setMode] = createSignal<"login" | "register">("login")
  const [username, setUsername] = createSignal("")
  const [password, setPassword] = createSignal("")
  const [email, setEmail] = createSignal("")
  const [error, setError] = createSignal("")
  const [loading, setLoading] = createSignal(false)

  async function submit(e: Event) {
    e.preventDefault()
    if (!username().trim() || !password().trim()) return

    setLoading(true)
    setError("")

    try {
      const endpoint = mode() === "login" ? "/collab/login" : "/collab/register"
      const body: Record<string, string> = {
        username: username(),
        password: password(),
      }
      if (mode() === "register" && email()) body.email = email()

      const res = await fetch(`${props.serverUrl}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data.error || `Error ${res.status}`)
        return
      }

      props.onLogin(data)
    } catch (e: any) {
      setError(e.message || "Connection failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={submit} class="flex flex-col gap-3 p-6 max-w-sm mx-auto">
      <h2 class="text-lg font-semibold text-center">
        {mode() === "login" ? "Sign In" : "Create Account"}
      </h2>

      <label class="flex flex-col gap-1">
        <span class="text-xs font-medium text-secondary">Username</span>
        <input
          type="text"
          value={username()}
          onInput={(e) => setUsername(e.currentTarget.value)}
          class="px-3 py-2 border rounded-lg bg-background text-sm"
          autocomplete="username"
          required
        />
      </label>

      <Show when={mode() === "register"}>
        <label class="flex flex-col gap-1">
          <span class="text-xs font-medium text-secondary">Email (optional)</span>
          <input
            type="email"
            value={email()}
            onInput={(e) => setEmail(e.currentTarget.value)}
            class="px-3 py-2 border rounded-lg bg-background text-sm"
          />
        </label>
      </Show>

      <label class="flex flex-col gap-1">
        <span class="text-xs font-medium text-secondary">Password</span>
        <input
          type="password"
          value={password()}
          onInput={(e) => setPassword(e.currentTarget.value)}
          class="px-3 py-2 border rounded-lg bg-background text-sm"
          autocomplete={mode() === "login" ? "current-password" : "new-password"}
          required
          minLength={8}
        />
      </label>

      <Show when={error()}>
        <p class="text-xs text-red-500">{error()}</p>
      </Show>

      <button
        type="submit"
        disabled={loading()}
        class="px-4 py-2 bg-primary text-white rounded-lg font-medium text-sm disabled:opacity-50"
      >
        {loading() ? "..." : mode() === "login" ? "Sign In" : "Register"}
      </button>

      <button
        type="button"
        class="text-xs text-secondary hover:text-primary"
        onClick={() => setMode((m) => (m === "login" ? "register" : "login"))}
      >
        {mode() === "login" ? "Need an account? Register" : "Already have an account? Sign in"}
      </button>
    </form>
  )
}
