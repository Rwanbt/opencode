// FORK: ADR-0005 Phase 5 — Plugin manager (MCP Servers full CRUD + Skills placeholder).
// Integrates as the "Plugins" tab in dialog-settings.tsx.
import { createMemo, createSignal, For, Show, type Component } from "solid-js"
import { useMutation } from "@tanstack/solid-query"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Switch } from "@opencode-ai/ui/switch"
import { TextField } from "@opencode-ai/ui/text-field"
import { Tabs } from "@opencode-ai/ui/tabs"
import { showToast } from "@opencode-ai/ui/toast"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { SettingsList } from "./settings-list"

// ─── status helpers ────────────────────────────────────────────────────────

type McpStatusKind = "connected" | "disabled" | "failed" | "needs_auth" | "needs_client_registration"

function statusDotClass(kind: McpStatusKind | undefined) {
  if (kind === "connected") return "bg-[#22c55e]"
  if (kind === "failed" || kind === "needs_client_registration") return "bg-[#ef4444]"
  if (kind === "needs_auth") return "bg-[#f59e0b]"
  return "bg-text-weaker"
}

function statusLabel(kind: McpStatusKind | undefined) {
  if (kind === "connected") return "connecté"
  if (kind === "failed") return "erreur"
  if (kind === "needs_auth") return "auth. requise"
  if (kind === "needs_client_registration") return "enregistrement requis"
  if (kind === "disabled") return "désactivé"
  return ""
}

// ─── MCP section ───────────────────────────────────────────────────────────

const McpSection: Component = () => {
  const sync = useSync()
  const sdk = useSDK()

  const [showAdd, setShowAdd] = createSignal(false)
  const [addType, setAddType] = createSignal<"remote" | "local">("remote")
  const [addName, setAddName] = createSignal("")
  const [addUrl, setAddUrl] = createSignal("")
  const [addCommand, setAddCommand] = createSignal("")

  const refreshStatus = async () => {
    const result = await sdk.client.mcp.status()
    if (result.data) sync.set("mcp", result.data)
  }

  const servers = createMemo(() =>
    Object.entries(sync.data.mcp ?? {})
      .map(([name, s]) => ({ name, status: s as { status: McpStatusKind; error?: string } }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  )

  const toggle = useMutation(() => ({
    mutationFn: async (name: string) => {
      const status = (sync.data.mcp[name] as { status: McpStatusKind })?.status
      if (status === "connected") {
        await sdk.client.mcp.disconnect({ name })
      } else {
        await sdk.client.mcp.connect({ name })
      }
      await refreshStatus()
    },
    onError: (err: unknown) => {
      showToast({
        variant: "error",
        title: "Erreur MCP",
        description: err instanceof Error ? err.message : String(err),
      })
    },
  }))

  const remove = useMutation(() => ({
    mutationFn: async (name: string) => {
      await sdk.client.mcp.remove({ name })
      await refreshStatus()
    },
    onError: (err: unknown) => {
      showToast({
        variant: "error",
        title: "Erreur MCP",
        description: err instanceof Error ? err.message : String(err),
      })
    },
  }))

  const auth = useMutation(() => ({
    mutationFn: async (name: string) => {
      await sdk.client.mcp.auth.authenticate({ name })
      await refreshStatus()
    },
    onError: (err: unknown) => {
      showToast({
        variant: "error",
        title: "Authentification MCP",
        description: err instanceof Error ? err.message : String(err),
      })
    },
  }))

  const addServer = useMutation(() => ({
    mutationFn: async () => {
      const name = addName().trim()
      if (!name) throw new Error("Nom requis")
      // McpLocalConfig.command is string[] (command + args as array)
      const config =
        addType() === "remote"
          ? { type: "remote" as const, url: addUrl().trim(), enabled: true }
          : {
              type: "local" as const,
              command: addCommand().trim().split(/\s+/).filter(Boolean),
              enabled: true,
            }
      await sdk.client.mcp.add({ name, config })
      setAddName("")
      setAddUrl("")
      setAddCommand("")
      setShowAdd(false)
      await refreshStatus()
    },
    onError: (err: unknown) => {
      showToast({
        variant: "error",
        title: "Ajout MCP échoué",
        description: err instanceof Error ? err.message : String(err),
      })
    },
  }))

  return (
    <div class="flex flex-col gap-3">
      <Show when={servers().length === 0}>
        <div class="text-12-regular text-text-weak text-center py-6 bg-surface-base rounded-lg">
          Aucun serveur MCP configuré.
          <br />
          <span class="text-11-regular opacity-70">Cliquez sur Ajouter pour en connecter un.</span>
        </div>
      </Show>

      <Show when={servers().length > 0}>
        <SettingsList>
          <For each={servers()}>
            {(server) => {
              const kind = () => server.status.status
              const isConnected = () => kind() === "connected"
              const isPending = () =>
                (toggle.isPending && toggle.variables === server.name) ||
                (remove.isPending && remove.variables === server.name) ||
                (auth.isPending && auth.variables === server.name)
              const error = () => ("error" in server.status ? server.status.error : undefined)

              return (
                <div class="flex items-start gap-3 py-3 border-b border-border-weak-base last:border-none">
                  {/* status dot */}
                  <div class="mt-1 shrink-0">
                    <div class={`w-2 h-2 rounded-full mt-1 ${statusDotClass(kind())}`} />
                  </div>

                  {/* name + error */}
                  <div class="flex flex-col gap-0.5 flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="text-14-medium text-text-strong truncate">{server.name}</span>
                      <span class="text-11-regular text-text-weaker shrink-0">{statusLabel(kind())}</span>
                    </div>
                    <Show when={error()}>
                      <span class="text-11-regular text-[#ef4444] truncate">{error()}</span>
                    </Show>
                  </div>

                  {/* actions */}
                  <div class="flex items-center gap-2 shrink-0">
                    <Show when={kind() === "needs_auth" || kind() === "needs_client_registration"}>
                      <Button
                        size="small"
                        variant="ghost"
                        disabled={isPending()}
                        onClick={() => auth.mutate(server.name)}
                      >
                        Autoriser
                      </Button>
                    </Show>

                    <div onClick={(e) => e.stopPropagation()}>
                      <Switch
                        checked={isConnected()}
                        disabled={isPending()}
                        onChange={() => toggle.mutate(server.name)}
                      />
                    </div>

                    <button
                      type="button"
                      class="text-text-weaker hover:text-[#ef4444] transition-colors p-1 rounded disabled:opacity-40"
                      disabled={isPending()}
                      title={`Supprimer ${server.name}`}
                      onClick={() => remove.mutate(server.name)}
                    >
                      <Icon name="trash" class="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )
            }}
          </For>
        </SettingsList>
      </Show>

      {/* Add form toggle */}
      <Show
        when={showAdd()}
        fallback={
          <button
            type="button"
            class="flex items-center gap-2 text-12-regular text-text-weak hover:text-text-base transition-colors py-1"
            onClick={() => setShowAdd(true)}
          >
            <Icon name="plus" class="w-3.5 h-3.5" />
            Ajouter un serveur MCP
          </button>
        }
      >
        <div class="bg-surface-base rounded-lg p-4 flex flex-col gap-3">
          <span class="text-13-medium text-text-strong">Nouveau serveur MCP</span>

          {/* type selector */}
          <div class="flex gap-2">
            <button
              type="button"
              class={`px-3 py-1 text-12-regular rounded border transition-colors ${addType() === "remote" ? "border-accent-primary text-accent-primary bg-accent-primary/10" : "border-border-weak-base text-text-weak hover:border-border-base"}`}
              onClick={() => setAddType("remote")}
            >
              Remote (HTTP)
            </button>
            <button
              type="button"
              class={`px-3 py-1 text-12-regular rounded border transition-colors ${addType() === "local" ? "border-accent-primary text-accent-primary bg-accent-primary/10" : "border-border-weak-base text-text-weak hover:border-border-base"}`}
              onClick={() => setAddType("local")}
            >
              Local (stdio)
            </button>
          </div>

          <TextField
            label="Nom"
            value={addName()}
            onChange={setAddName}
            placeholder="mon-serveur"
          />

          <Show
            when={addType() === "remote"}
            fallback={
              <TextField
                label="Commande"
                value={addCommand()}
                onChange={setAddCommand}
                placeholder="/usr/local/bin/mon-mcp-server"
              />
            }
          >
            <TextField
              label="URL"
              value={addUrl()}
              onChange={setAddUrl}
              placeholder="https://mon-serveur.example.com/mcp"
            />
          </Show>

          <div class="flex gap-2 justify-end">
            <Button
              variant="ghost"
              size="small"
              onClick={() => {
                setShowAdd(false)
                setAddName("")
                setAddUrl("")
                setAddCommand("")
              }}
            >
              Annuler
            </Button>
            <Button
              size="small"
              disabled={addServer.isPending || !addName().trim() || (addType() === "remote" ? !addUrl().trim() : !addCommand().trim())}
              onClick={() => addServer.mutate()}
            >
              {addServer.isPending ? "Ajout…" : "Ajouter"}
            </Button>
          </div>
        </div>
      </Show>
    </div>
  )
}

// ─── Skills section ─────────────────────────────────────────────────────────

const SkillsSection: Component = () => {
  return (
    <div class="flex flex-col gap-3">
      <div class="bg-surface-base rounded-lg p-4 text-12-regular text-text-weak leading-relaxed">
        <p class="text-13-medium text-text-strong mb-2">Format SKILL.md</p>
        <p class="mb-3">
          Les skills sont des fichiers Markdown avec un frontmatter YAML. Ils étendent les capacités de l'agent
          sans modifier le code.
        </p>
        <pre class="bg-background-stronger rounded p-3 text-11-regular font-mono overflow-x-auto whitespace-pre text-text-base mb-3">{`---
name: mon-skill
description: Description courte
metadata:
  category: text-only
---

# Instructions

Texte ajouté au prompt système...`}</pre>
        <p class="text-11-regular opacity-70">
          Catégories : <span class="font-mono">text-only</span> (prompt système),{" "}
          <span class="font-mono">js</span> (sandbox WebView),{" "}
          <span class="font-mono">native</span> (intents Android).
        </p>
      </div>

      <div class="text-12-regular text-text-weaker text-center py-4 border border-dashed border-border-weak-base rounded-lg">
        Installation des skills via URL — à venir
      </div>
    </div>
  )
}

// ─── Main export ────────────────────────────────────────────────────────────

export const SettingsPlugins: Component = () => {
  return (
    <div class="flex flex-col gap-6 px-5 py-4">
      <Tabs defaultValue="mcp" variant="pill">
        <Tabs.List class="mb-4">
          <Tabs.Trigger value="mcp">Serveurs MCP</Tabs.Trigger>
          <Tabs.Trigger value="skills">Skills</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="mcp">
          <McpSection />
        </Tabs.Content>
        <Tabs.Content value="skills">
          <SkillsSection />
        </Tabs.Content>
      </Tabs>
    </div>
  )
}
