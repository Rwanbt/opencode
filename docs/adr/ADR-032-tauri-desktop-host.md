<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-032 — Tauri Desktop Host (DK-01)

> **Statut** : DECIDED
> **Date** : 2026-09-02
> **Source** : POST-M3-TRACKS-PLAN §2.2 (DK-01 RED), plan V2.3.1
>   §234, ADR-024 (extension runtime trust isolation, DECIDED),
>   ADR-029 (UX policy, DECIDED), ADR-008 (scheduler/worker time
>   authority, DECIDED), ADR-010 (key/secret model, DECIDED),
>   `@unifia/contracts/src/ux.ts` (UX-01 livré R2),
>   `docs/adr/0008-tauri-exact-version-pin.md` (Tauri pinning).
> **Cible** : profiles `desktop-host-assisted` et
>   `desktop-isolated-worker` du plan §187. **PAS** la cible
>   première `local-single-node` (qui n'a pas besoin de Tauri
>   host pour fonctionner en headless).

## Status

DECIDED. ADR d'**impact architectural** (plan §197) mais **n'est
PAS** bloqué par ADR-000 (Tauri host est au-dessus du substrate, pas
à l'intérieur). Le contrat est livrable maintenant.

## Contexte

DK-01 (Tauri Host) est la dernière carte RED du track Desktop. Elle
définit comment Unifia tourne en mode desktop natif (Tauri 2.0 +
Rust backend + SolidJS frontend), avec :

- **Window management** : création, focus, plein écran, multi-window.
- **System tray** : icône + menu contextuel.
- **Native menus** : barre de menu OS-specific.
- **Notifications** : native OS notifications.
- **IPC** : backend Rust ↔ frontend SolidJS via tauri::command.
- **File dialogs** : open/save natifs (sandbox-safe via ADR-024).
- **Auto-update** : Tauri updater (signature vérifiée).
- **Single instance** : un seul process par workspace.

La cible première `local-single-node` est headless (CLI + workbench
web séparé). DK-01 est requis pour le profile `desktop-host-assisted`
(le workbench est servi par Tauri) et
`desktop-isolated-worker` (chaque worker est un process Tauri
distinct).

## Decision

### Architecture

- **Tauri 2.0** (version pinnée, cf. `0008-tauri-exact-version-pin.md`).
- **Backend Rust** : `packages/desktop/src-tauri/` (déjà existant,
  27 fichiers ≤ 200 LOC, refactor C-PRE1-04).
- **Frontend SolidJS** : `packages/console/app/` ou nouveau
  `packages/desktop/app/` (à créer).
- **IPC** : `tauri::command` typés via `specta` (TS bindings
  générés depuis Rust). Pas de string-based IPC.
- **Single instance** : `tauri-plugin-single-instance` (le 2e
  lancement focus la window existante au lieu d'en créer une
  nouvelle).

### Contrats (extension de `@unifia/contracts/src/ux.ts`)

```typescript
export const TauriWindowModeSchema = z.enum(["normal", "minimized", "maximized", "fullscreen", "hidden"])
export const TauriWindowSchema = z.object({
  id: z.string().min(1).max(128),
  title: z.string().min(1).max(256),
  mode: TauriWindowModeSchema.default("normal"),
  width: z.number().int().min(320).max(7680).default(1280),
  height: z.number().int().min(240).max(4320).default(720),
  /** Whether this window is the main workbench. */
  isMain: z.boolean().default(false),
  /** Visible on all workspaces (macOS) or only current (Linux/Win). */
  alwaysOnTop: z.boolean().default(false),
})

export const TauriMenuItemSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(128),
  /** Keyboard shortcut. Format: "CmdOrCtrl+Shift+P" */
  accelerator: z.string().optional(),
  enabled: z.boolean().default(true),
  /** Submenu (recursive, max depth 2). */
  submenu: z.array(TauriMenuItemSchema).readonly().optional(),
})

export const TauriMenuSchema = z.object({
  items: z.array(TauriMenuItemSchema).readonly(),
})

export const TauriNotificationSchema = z.object({
  id: z.string().min(1).max(128).optional(),
  title: z.string().min(1).max(128),
  body: z.string().min(1).max(1024).optional(),
  /** Icon path or bundled asset name. */
  icon: z.string().optional(),
  /** Notification level. */
  level: z.enum(["info", "warning", "error"]).default("info"),
})

export const TauriHostSchema = z.object({
  /** Single-instance enforcement. */
  singleInstance: z.boolean().default(true),
  /** Whether to use the system tray. */
  tray: z.boolean().default(true),
  /** Initial main window. */
  mainWindow: TauriWindowSchema,
  /** Native menu bar. */
  menu: TauriMenuSchema.optional(),
  /** Auto-update configuration. */
  autoUpdate: z.object({
    enabled: z.boolean().default(true),
    /** Public key for signature verification (PEM). */
    pubkey: z.string().min(1),
    /** Check interval in hours. */
    checkIntervalHours: z.number().int().min(1).max(168).default(24),
  }).optional(),
  /** Whether the host runs the workbench server in-process. */
  embedWorkbench: z.boolean().default(false),
})

export type TauriWindow = z.infer<typeof TauriWindowSchema>
export type TauriMenuItem = z.infer<typeof TauriMenuItemSchema>
export type TauriMenu = z.infer<typeof TauriMenuSchema>
export type TauriNotification = z.infer<typeof TauriNotificationSchema>
export type TauriHost = z.infer<typeof TauriHostSchema>
```

### Invariants

- **`singleInstance = true`** obligatoire pour `desktop-host-assisted`
  (sinon, multi-process sur le même workspace = violation
  OwnershipScope).
- **`mainWindow.isMain = true`** exactement une fois (un seul main
  window par host).
- **`autoUpdate.pubkey`** doit être un PEM valide (validation
  runtime dans le host).
- **Tauri commands** : tous les IPCs doivent être typés (specta).
  Pas de `serde_json::Value` à la frontière.
- **Pas de WebView caché** : chaque window utilise un WebView
  distinct, jamais partagé entre windows.
- **Sandbox OS** : Tauri active le sandbox OS-level par défaut
  (Windows AppContainer, macOS sandbox, Linux bubblewrap). Pas
  de désactivation permise.

### Profiles

- **`desktop-host-assisted`** : Tauri host + workbench servi
  localement. `embedWorkbench = true`. Multi-window autorisé.
  `autoUpdate` activé.
- **`desktop-isolated-worker`** : Tauri host minimal (window
  cachée), worker durable execution tourne en background. `mainWindow
  = hidden`, `tray = true`. `autoUpdate` activé.
- **Headless** (`local-single-node` sans Tauri) : pas de Tauri
  host. Le workbench est servi par `packages/workbench-server/`
  en CLI. Aucune dépendance à `packages/desktop/`.

## Consequences

- **DK-01 contracts** : livrables dans
  `@unifia/contracts/src/tauri.ts` (nouveau fichier, à postuler).
- **`packages/desktop/`** : existe déjà (27 fichiers refactorés
  C-PRE1-04). Le frontend SolidJS est à créer
  (`packages/desktop/app/`).
- **`specta`** : dépendance dev pour générer les bindings TS depuis
  Rust. À ajouter à `package.json#workspaces.catalog` quand
  l'implémentation commence.
- **Auto-update** : Tauri updater vérifie la signature avant
  installation. Pas de `autoUpdate = false` en production.
- **Sandbox OS-level** : activation par défaut, désactivation
  interdite par contrat. Threat Model §1 (TM-DK-01).

## Gating

- **DK-01 contrats** : peut être livré maintenant (extension de
  `ux.ts` ou nouveau `tauri.ts`).
- **DK-01 runtime** : bloqué par ADR-000 (substrate) pour la
  partie worker durable, mais Tauri host lui-même est
  indépendant.
- **Cert gate** : nouvelle section `gates.yaml §17 tauri_host` à
  ajouter quand le runtime est prêt.

## Liens

- `packages/contracts/src/ux.ts` (UX-01 livré, 8/8 tests)
- `packages/desktop/src-tauri/` (27 fichiers ≤ 200 LOC, C-PRE1-04
  refactor)
- `docs/adr/0008-tauri-exact-version-pin.md` (Tauri pin)
- `docs/adr/ADR-024-extension-runtime-trust-isolation.md` (DECIDED)
- `docs/adr/ADR-029-ux-policy.md` (DECIDED)
- `docs/adr/ADR-010-secret-credential-key-model.md` (DECIDED, pour
  signature key)
- Plan V2.3.1 §234 (Tauri host), §186-188 (cert profiles)

## Décisions de fond (rappel)

1. **Tauri 2.0** pinné (cf. ADR-008 + pin doc).
2. **IPC typé via specta**, pas de string-based.
3. **Single instance** obligatoire.
4. **Auto-update** avec signature PEM vérifiée, activé par défaut.
5. **Sandbox OS-level** obligatoire, désactivation interdite.
6. **Multi-window** autorisé sur `desktop-host-assisted`, pas sur
   `desktop-isolated-worker` (window cachée).
7. **Cible première `local-single-node`** : pas de Tauri host, headless
   seulement.
