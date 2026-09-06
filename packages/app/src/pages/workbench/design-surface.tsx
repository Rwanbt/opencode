/* SPDX-License-Identifier: MIT */

import { createEffect, createMemo, createSignal, onCleanup, onMount, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { createQuery } from "@tanstack/solid-query"
import { useLanguage } from "@/context/language"
import { useMode } from "@/context/mode"
import { useSync } from "@/context/sync"
import { useWorkspaceWorkbench } from "@/context/workbench/provider"
import { workbenchQueryKey } from "@/context/workbench/query-keys"
import { createWorkbenchSession } from "@/pages/workbench/workbench-session"
import { WorkbenchThread } from "@/pages/workbench/workbench-thread"
import { DesignSplit } from "@/pages/workbench/design-split"
import { DesignWorkspace, seedDesignTabState } from "@/pages/workbench/design-workspace"
import { DesignFilesTab } from "@/pages/workbench/design-files-tab"
import { DesignArtifactTab } from "@/pages/workbench/design-artifact-tab"
import { DesignSpecEditor } from "@/pages/workbench/design-spec-editor"
import { createArtifactParser } from "@unifia/artifact-render"
import { createArtifactStreamController } from "@/pages/workbench/use-artifact-stream"
import { adaptRenderArtifactEvents } from "@/pages/workbench/artifact-event-adapter"
import { extractMessageText } from "@/pages/workbench/workbench-thread-shared"
import { toggleAttachedCommentId } from "@/pages/workbench/thread-comment-attach"
import { toggleActiveDesignSystemId } from "@/pages/workbench/context-chips"
import { encodeBase64 } from "@/pages/workbench/design-files-preview"
import {
  createDesignPreviewPanelState,
  createDesignSpecPanelState,
  renderDesignSpecSvg,
  createArtifactVersionPanelState,
  diffArtifactVersions,
  createIndexedDbDesignDraftStore,
  createIndexedDbCommentStore,
  describeGithubConnection,
  addComment,
  newCommentId,
  DesignDraftConflictError,
  EMPTY_COMMENT_STATE,
  type CommentState,
  type CommentTargetRect,
} from "@unifia/workbench-shell"
import { openTab, type DesignTab } from "@/pages/workbench/design-tabs"
import { TerminalPanel } from "@/pages/session/terminal-panel"
import { DesignBrowserTab } from "@/pages/workbench/design-browser-tab"
import { DesignSketchTab } from "@/pages/workbench/design-sketch-tab"
import { createDesignSnapshot } from "@/pages/workbench/design-snapshot"
import { createDesignToolbarState } from "@/pages/workbench/design-toolbar-state"
import {
  canStartApproval,
  createApprovalOperations,
  isApprovalModalVisible,
  reduceApprovalState,
  type ApprovalEvent,
  type ApprovalState,
} from "@/pages/workbench/design-approval"

export type { ApprovalState, ApprovalEvent } from "@/pages/workbench/design-approval"

export function DesignSurface(): JSX.Element {
  const language = useLanguage()
  const t = language.t
  const mode = useMode()
  const sync = useSync()
  const workbench = useWorkspaceWorkbench()
  const connection = workbench.connection
  createEffect(() => { void workbench.ensureConnected().catch(() => undefined) })
  const manifestQueryOptions = createMemo(() => {
    const current = connection()
    return { queryKey: workbenchQueryKey(current, "design-systems"), enabled: !!current, queryFn: () => current!.client.listDesignSystems(current!.workspaceId) }
  })
  const skillsQueryOptions = createMemo(() => {
    const current = connection()
    return { queryKey: workbenchQueryKey(current, "design-skills"), enabled: !!current, queryFn: () => current!.client.listDesignSkills(current!.workspaceId) }
  })
  const githubQueryOptions = createMemo(() => {
    const current = connection()
    return { queryKey: workbenchQueryKey(current, "github-status"), enabled: !!current, queryFn: () => current!.client.githubStatus(current!.workspaceId) }
  })
  const manifest = createQuery(manifestQueryOptions)
  const skills = createQuery(skillsQueryOptions)
  const github = createQuery(githubQueryOptions)
  const [source, setSource] = createSignal("")
  const [draftRevision, setDraftRevision] = createSignal<number | undefined>()
  const [draftError, setDraftError] = createSignal<string>()
  const [artifactId, setArtifactId] = createSignal<string>()
  const [saveState, setSaveState] = createSignal<"idle" | "saving" | "saved" | "error">("idle")
  const [saveMessage, setSaveMessage] = createSignal("")
  const [exportState, setExportState] = createSignal<"idle" | "exporting" | "exported" | "error">("idle")
  const [openState, setOpenState] = createSignal<"idle" | "opening" | "opened" | "error">("idle")
  // DA-UI-02 — recoverable approval UX for the create/export flow.
  // The 8-state machine lives here; the modal, the timer, and the
  // navigation-cleanup hook all read it.
  const [approvalState, setApprovalStateRaw] = createSignal<ApprovalState>({ kind: "idle" })
  const setApprovalState = (event: ApprovalEvent) => setApprovalStateRaw((current) => reduceApprovalState(current, event))
  // DA-UI-03 — the in-flight request handle. The `runExportFlow`
  // writes it before the first `await` and clears it on every
  // terminal transition; `onCleanup` (below) calls `abort()` so a
  // navigation away from the Design surface never leaves a half-
  // finished operation talking to the broker.
  let exportAbort: AbortController | undefined
  // DA-UI-03 — the approval TTL timer. Set when the modal opens,
  // cleared when the user acts (allow/deny/cancel) or when the
  // approval state transitions to a terminal state. The timer
  // dispatches the `expire` event, which only takes effect when
  // the state is still `approval-required` (the reducer guards it).
  let approvalExpireTimer: ReturnType<typeof setTimeout> | undefined
  const draftStore = createIndexedDbDesignDraftStore()

  // Phase 3 — `DesignSurface` holds the workshop's tab state. Before phase 3,
  // `DesignWorkspace` owned its own store and `createDesignWorkspaceController`
  // offered a sibling store that no caller ever imported (verified: zero
  // consumers). Two stores means two truths and no way to open an artifact
  // tab from a streaming event. The seed plants the two non-closable tabs
  // ("Fichiers" + "Spec") so the workshop is never empty when the surface
  // mounts.
  const [tabState, setTabState] = createStore(seedDesignTabState())

  // P4-4 — `designContextPreview` (P22) et son placeholder DESIGN.md sont
  // retirés. C'était une étiquette statique de P22 servant à valider
  // l'observabilité du câblage catalogue → preamble ; le câblage est
  // désormais porté par l'agent lui-même, et le fil rend le contenu réel.
  let draftTimer: ReturnType<typeof setTimeout> | undefined
  let draftLoadEpoch = 0

  // P15 — Moteur de streaming des artefacts produits par l'agent Design.
  // L'agent lui-même (capability "design-agent") émettra `artifact:start/chunk/end`
  // via le SDK quand il sera branché ; en attendant, le controller est prêt et
  // exposé au reste de la surface (panneau live + persistance automatique).
  const stream = createArtifactStreamController({ debounceMs: 100 })
  const [streamPersisted, setStreamPersisted] = createSignal<ReadonlySet<string>>(new Set())

  // Phase 4 — ouverture automatique d'un onglet artifact à chaque
  // `artifact:start`. Le Set local mémorise les ids déjà introduits : si
  // l'utilisateur ferme un onglet artifact puis qu'un nouveau chunk arrive
  // pour le même id, on ne le rouvre pas (l'utilisateur a exprimé un
  // choix de navigation explicite). Côté Phase 4, l'agent n'est pas
  // encore branché ; le câblage réel passe par `adaptRenderArtifactEvent`
  // quand l'adaptateur sera consommé par le controller.
  const seenArtifactIds = new Set<string>()
  // P3-5 — état du toolbar remonté au niveau de la surface. L'onglet
  // artifact rend `ArtifactPreview` ; le `DesignToolbar` qui le surplombe
  // est piloté ici pour que les sélections (viewport, zoom, mode, snapshot,
  // sélection) survivent à un changement d'onglet puis un retour, et pour
  // qu'une seule instance d'état existe par surface (et non par panneau
  // éphémère, comme avant P3-5).
  // F11 — extracted to `design-toolbar-state.ts` so the surface file
  // stays under the 800-LOC gate. The factory returns the same
  // signals as before; the surface assigns them once and the
  // toolbar receives the accessors + setters as before.
  const { viewport, setViewport, zoom, setZoom, toolbarMode, setToolbarMode, selectMode, setSelectMode } = createDesignToolbarState()
  // F11 — snapshot state machine extracted to `design-snapshot.ts`.
  // The surface holds the controller (so it survives tab switches)
  // and the iframe plugs `setCapture` once mounted. The controller
  // owns Solid signals, so the toolbar re-renders on transitions
  // without a polling tick.
  const snapshotController = createDesignSnapshot()
  // P3-5 / P17 — la fonction de capture vit dans l'iframe (postMessage
  // same-origin impossible depuis l'hôte). `ArtifactPreview` la remonte
  // via `onSnapshotReady` à chaque montage d'iframe ; on la garde ici
  // pour qu'un seul `requestSnapshot` (ci-dessous) puisse la déclencher
  // depuis le toolbar remonté. Une seule instance visible à la fois, donc
  // un seul `capture` survit à un changement d'onglet.
  // F11: now wired through the controller's setCapture slot.
  const setCapture = (fn: (() => Promise<{ dataUrl: string; w: number; h: number }>) | undefined) => {
    snapshotController.setCapture(fn)
  }
  const requestSnapshot = () => snapshotController.requestSnapshot()

  // Phase 8.3/9.6 — visibilité du panneau de commentaires, remontée au
  // même niveau que le reste du toolbar (P3-5) pour survivre à un
  // changement d'onglet. Ouvert par défaut : c'est le comportement
  // observable avant cette phase (le panneau était toujours affiché).
  const [commentPanelOpen, setCommentPanelOpen] = createSignal(true)

  // Phase 9.6 — copie la dernière capture dans le presse-papiers, en plus
  // du téléchargement déjà câblé. F11: the copy state machine lives in
  // `design-snapshot.ts`; the toolbar reads `copyState()` and calls
  // `copySnapshot()` on the controller.
  const copySnapshot = () => snapshotController.copySnapshot()

  // P19 + P20 — Panneau de commentaires, rebranché. `CommentState` est un
  // registre plat (chaque `DesignComment` porte son propre `artifactId`),
  // donc un seul signal suffit pour tous les onglets artefact — pas besoin
  // d'un state par onglet. `commentTarget` mémorise le dernier élément
  // piqué (P18) tant qu'aucun autre pick ne le remplace ; il survit à un
  // changement d'onglet volontairement (revenir sur l'artefact retrouve
  // la cible en cours).
  const [commentState, setCommentState] = createSignal<CommentState>(EMPTY_COMMENT_STATE)
  const [commentTarget, setCommentTarget] = createSignal<{ elementId: string; artifactId: string; entryFile: string; rect?: CommentTargetRect }>()
  // Phase 10.3 — "Commenter la conversation" ; deliberately NOT a field on
  // `CommentState` (see `thread-comment-attach.ts`'s doc comment): this is
  // an ephemeral "will ride along with my next message" selection, not a
  // persisted property of the comment, so it lives in its own signal and
  // is never written to `commentStore` below.
  const [attachedCommentIds, setAttachedCommentIds] = createSignal<ReadonlySet<string>>(new Set())
  // Phase 10.5 — which design system(s) the user has marked "active" for
  // context chips. Local/ephemeral, same reasoning as attachedCommentIds
  // above: not a property of the workspace manifest, just a per-session
  // UI selection.
  const [activeDesignSystemIds, setActiveDesignSystemIds] = createSignal<ReadonlySet<string>>(new Set())
  // Phase 8.1 — clicking a pin scrolls the sidebar to its comment; the
  // scroll target is a DOM id derived from the comment id (see CommentPanel).
  const [highlightedCommentId, setHighlightedCommentId] = createSignal<string>()

  // Phase 8.2 — persistance IndexedDB, même forme que `draftStore` juste en
  // dessous (epoch guard contre une réponse de `load` en retard qui
  // écraserait un changement de workspace plus récent ; sauvegarde
  // debouncée à 250 ms). `updateCommentState` est le seul chemin
  // d'écriture passé en aval (`onCommentChange`) — chaque mutation de
  // `CommentPanel` (add/update/remove/markSent/markResolved) passe par le
  // même `props.onChange`, donc les intercepter tous ici suffit.
  const commentStore = createIndexedDbCommentStore()
  const [commentPersistError, setCommentPersistError] = createSignal<string>()
  let commentLoadEpoch = 0
  let commentSaveTimer: ReturnType<typeof setTimeout> | undefined
  onMount(() => {
    createEffect(() => {
      const workspaceId = connection()?.workspaceId
      if (!workspaceId) return
      const epoch = ++commentLoadEpoch
      void commentStore
        .load(workspaceId)
        .then((state) => {
          if (epoch !== commentLoadEpoch || !state) return
          setCommentState(state)
        })
        .catch((error) => setCommentPersistError(error instanceof Error ? error.message : "design comments could not be loaded"))
    })
  })
  onCleanup(() => {
    if (commentSaveTimer) clearTimeout(commentSaveTimer)
  })
  function updateCommentState(state: CommentState): void {
    setCommentState(state)
    const workspaceId = connection()?.workspaceId
    if (!workspaceId) return
    if (commentSaveTimer) clearTimeout(commentSaveTimer)
    commentSaveTimer = setTimeout(() => {
      void commentStore.save(workspaceId, state).catch((error) => {
        setCommentPersistError(error instanceof Error ? error.message : "design comments could not be saved")
      })
    }, 250)
  }

  function addTokenComment(catalogId: string, elementId: string): void {
    updateCommentState(addComment(commentState(), {
      id: newCommentId(Date.now(), Math.random()),
      artifactId: `design-system:${catalogId}`,
      elementId,
      note: `Réviser le token ${elementId}.`,
      status: "open",
      createdAt: new Date().toISOString(),
    }))
  }

  // P4-3 — chaque `artifact:start` du moteur de streaming ouvre (ou active)
  // un onglet `kind: "artifact"`. L'effet lit `stream.state()` (signal) et
  // itère sur les ids connus ; le Set local garantit qu'on n'ouvre pas
  // deux fois le même onglet et qu'on n'écrase pas la navigation explicite
  // de l'utilisateur (un onglet fermé n'est pas rouvert par un chunk
  // ultérieur). Le tracking fin de Solid gère la dépendance sur la
  // référence du `byId` (la Map est reconstruite à chaque event).
  createEffect(() => {
    const byId = stream.state().byId
    for (const [id, entry] of byId.entries()) {
      if (seenArtifactIds.has(id)) continue
      seenArtifactIds.add(id)
      setTabState(openTab(tabState, {
        id,
        kind: "artifact",
        title: entry.filename,
        closable: true,
      }))
    }
  })

  // Phase 7 — P4-1 closed: the real producer. `WorkbenchThread` shows the
  // same session this effect reads (`mode.sessionId()`); nothing here
  // creates a session or duplicates `sync.session.sync` — the thread already
  // keeps it warm. Every assistant message is fed, incrementally, through
  // its own `createArtifactParser()` instance (one per message id, so two
  // concurrent messages never share buffer state); the parser only sees the
  // *new* slice of text since last run (`fed` tracks how much of the
  // message has already been parsed — `feed()` is a streaming API, calling
  // it with the full text again on every render would re-emit every event).
  // `adaptRenderArtifactEvents` reuses the P4-2 adapter to translate into
  // the shape `stream` expects. If the agent behind "build" ever answers
  // with an `<artifact>` block, it renders here with no further wiring. If
  // it never does, this effect simply never yields an event — a silent
  // no-op, not a failure.
  const messageParsers = new Map<string, { parser: ReturnType<typeof createArtifactParser>; fed: number }>()
  let parsedSessionId: string | undefined
  createEffect(() => {
    const sessionId = mode.sessionId()
    if (sessionId !== parsedSessionId) {
      // A session switch starts every message's parse state over — a
      // message id from a previous conversation is never revisited.
      messageParsers.clear()
      parsedSessionId = sessionId
    }
    if (!sessionId) return
    const messages = sync.data.message[sessionId] ?? []
    for (const message of messages) {
      if (message.role !== "assistant") continue
      const text = extractMessageText(sync.data.part[message.id])
      if (!text) continue
      let tracked = messageParsers.get(message.id)
      if (!tracked) {
        tracked = { parser: createArtifactParser(), fed: 0 }
        messageParsers.set(message.id, tracked)
      }
      if (text.length <= tracked.fed) continue
      const delta = text.slice(tracked.fed)
      tracked.fed = text.length
      for (const event of adaptRenderArtifactEvents(tracked.parser.feed(delta))) stream.push(event)
    }
  })

  // P18 → P19 — callback de pick d'élément dans l'artefact : mémorise la
  // cible pour que `CommentPanel` sache sur quel `data-unifia-id` le
  // prochain "Ajouter" doit s'attacher. Phase 8.1 : le rect du pick est
  // capturé ici aussi, pour que le commentaire créé porte une épingle.
  function onArtifactSelectTarget(elementId: string, artifactId: string, entryFile: string, rect: CommentTargetRect): void {
    setCommentTarget({ elementId, artifactId, entryFile, rect })
  }
  /**
   * P4-5 — boucle commentaire → raffinement → fil.
   *
   * Le contrat est porté par `createWorkbenchSession` (P1-1) : une seule
   * session par workspace, partagée entre tous les consumers (fil,
   * raffinement, `CommentPanel`). `sendRefinePrompt` est le seul appelant
   * de `refineSession.prompt` ; la réponse de l'agent apparaît dans le fil
   * parce que c'est la même session — pas de câblage supplémentaire côté
   * `WorkbenchThread`. Le test de l'ownership unique vit dans
   * `workbench-session.test.ts`.
   */
  const refineSession = createWorkbenchSession({ title: () => t("workbench.chat.design") })
  async function sendRefinePrompt(prompt: string, label: string): Promise<void> {
    setSaveMessage(`Envoi ${label}…`)
    try {
      await refineSession.prompt(prompt)
      setSaveMessage(`Prompt ${label} envoyé (${prompt.length} caractères)`)
    } catch (error) {
      setSaveMessage(`Envoi échoué : ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  let lastConnectionPhase: ReturnType<typeof workbench.phase> | undefined
  createEffect(() => {
    const phase = workbench.phase()
    if (lastConnectionPhase === phase) return
    const wasConnected = lastConnectionPhase === "ready" || lastConnectionPhase === undefined
    if (phase === "failed" || phase === "rolling_back" || phase === "cleanup_failed") {
      // Spec P15 §6 : la connexion qui tombe en cours de flux NE VIDE PAS
      // le rendu déjà obtenu. On pose juste un bandeau ; les byId restent intacts.
      if (wasConnected) stream.setConnectionError(t("workbench.errors.eventStreamDisconnected"))
    } else if (phase === "ready" && !wasConnected) {
      stream.setConnectionError(undefined)
    }
    lastConnectionPhase = phase
  })
  // Persistance automatique : quand une entry passe `complete: true`, on la
  // sauvegarde via `client.createArtifact` avec la provenance `design-agent`.
  // Idempotent : on garde un Set des ids déjà persistés pour éviter les doubles POST.
  createEffect(() => {
    const persisted = streamPersisted()
    const state = stream.state()
    const current = connection()
    if (!current) return
    for (const entry of state.byId.values()) {
      if (!entry.complete || persisted.has(entry.artifactId)) continue
      if (entry.error) continue
      const filename = entry.filename
      const kind = entry.kind
      const content = entry.content
      setStreamPersisted((set) => {
        if (set.has(entry.artifactId)) return set
        const next = new Set(set)
        next.add(entry.artifactId)
        return next
      })
      void current.client
        .createArtifact({
          workspaceId: current.workspaceId,
          kind,
          filename,
          content,
          metadata: { source: "design-agent-stream", sessionId: state.activeId ?? "" },
          provenance: { sourceTool: "design-agent", capabilityPack: "workbench-design" },
        })
        .then((result) => {
          setSaveMessage(`Artefact ${result.artifact.filename} persisté (v${result.artifact.version})`)
        })
        .catch((error) => {
          setSaveMessage(`Persistance échouée : ${error instanceof Error ? error.message : String(error)}`)
          setStreamPersisted((set) => {
            const next = new Set(set)
            next.delete(entry.artifactId)
            return next
          })
        })
    }
  })
  // P4-4 — `pushDemoStream` a été retiré : la démo manuelle n'a plus sa
  // place dans la surface. Le vrai câblage agent→artefact passe par
  // `adaptRenderArtifactEvent` (P4-2) branché sur le controller Solid via
  // l'effet P4-3 qui ouvre l'onglet. Tant que l'agent "design-agent" n'est
  // pas branché, la surface n'invente pas d'événements.
  onMount(() => {
    createEffect(() => {
      const workspaceId = connection()?.workspaceId
      if (!workspaceId) return
      const epoch = ++draftLoadEpoch
      void draftStore.load(workspaceId).then((draft) => {
        if (epoch !== draftLoadEpoch || !draft) return
        setSource(draft.source)
        setDraftRevision(draft.revision)
      }).catch((error) => setDraftError(error instanceof Error ? error.message : "design draft could not be loaded"))
    })
  })
  onCleanup(() => { if (draftTimer) clearTimeout(draftTimer) })
  function updateDraft(value: string): void {
    setSource(value)
    const workspaceId = connection()?.workspaceId
    if (!workspaceId) return
    if (draftTimer) clearTimeout(draftTimer)
    draftTimer = setTimeout(() => {
      void draftStore.save(workspaceId, value, draftRevision()).then((draft) => {
        setDraftRevision(draft.revision)
        setDraftError(undefined)
      }).catch((error) => {
        if (error instanceof DesignDraftConflictError) setDraftError("Design draft changed in another window; reload it before editing again")
        else setDraftError(error instanceof Error ? error.message : "design draft could not be saved")
      })
    }, 250)
  }
  const spec = createMemo(() => createDesignSpecPanelState({ kind: "inline", value: source() }))
  const preview = createMemo(() => createDesignPreviewPanelState(spec()))
  const validationQueryOptions = createMemo(() => {
    const current = connection()
    const value = source()
    return {
      queryKey: workbenchQueryKey(current, "spec-validation", { source: value }),
      enabled: !!current && value.trim().length > 0 && spec().diagnostics.length === 0,
      staleTime: 5_000,
      queryFn: () => current!.client.validateSpec(current!.workspaceId, value),
    }
  })
  const historyQueryOptions = createMemo(() => {
    const current = connection()
    const currentArtifactId = artifactId()
    return {
      queryKey: workbenchQueryKey(current, "design-history", { artifactId: currentArtifactId ?? "" }),
      enabled: !!current && !!currentArtifactId,
      queryFn: () => current!.client.artifactHistory(current!.workspaceId, currentArtifactId!),
    }
  })
  const validation = createQuery(validationQueryOptions)
  const history = createQuery(historyQueryOptions)
  async function saveDesignVersion(): Promise<void> {
    const current = connection()
    if (!current || !spec().spec || saveState() === "saving") return
    setSaveState("saving")
    setSaveMessage("")
    try {
      const result = await current.client.createArtifact({
        workspaceId: current.workspaceId,
        kind: "text",
        filename: "design-spec.json",
        content: source(),
        ...(artifactId() ? { artifactId: artifactId() } : {}),
        metadata: { target: "design", specId: spec().spec!.id, specVersion: spec().spec!.version },
        provenance: { sourceTool: "design-editor", capabilityPack: "workbench-design" },
      })
      setArtifactId(result.artifact.artifactId)
      setSaveState("saved")
      setSaveMessage(`Version ${result.artifact.version} enregistrée`)
      await history.refetch()
    } catch (error) {
      setSaveState("error")
      setSaveMessage(error instanceof Error ? error.message : "design version could not be saved")
    }
  }
  /**
   * DA-UI-02 — `runExportFlow` is the state-machine wrapper around the
   * old `exportDesignRender` call. The pre-DA-UI-02 code did two
   * things wrong: (1) it folded the `202 approvalRequired` response
   * into the same success branch as the nominal `exported` result,
   * leaving the user with no way to allow/deny/retry, and (2) it
   * had no guard against a second concurrent click racing the first
   * (a "double-click" could have queued two requests and confused
   * the broker). The new flow:
   *
   *   1. `canStartApproval` rejects the click when the machine is
   *      mid-flight — this is the DA-UI-03 double-click guard.
   *   2. The first `await` (createArtifact) and second (exportArtifact)
   *      both observe the abort signal so navigating away from the
   *      Design surface tears the operation down cleanly.
   *   3. On `202 approvalRequired` we transition to the
   *      `approval-required` sub-state, schedule the expiry timer,
   *      and render the modal. The user can then allow, deny, or
   *      cancel; the resolve path is `runResolveApproval` below.
   *   4. On any other error, the machine transitions to `failed`
   *      and the surface shows the message.
   *
   * The function is also self-contained so the retry path (after
   * an `allow` decision) calls it recursively from the `resolving`
   * branch of the modal handler.
   */
  async function runExportFlow(): Promise<void> {
    const live = connection()
    const designSpec = spec().spec
    if (!live || !designSpec) return
    // DA-UI-03 — double-click idempotency. A second click while the
    // machine is mid-flight is a no-op (the button is also visually
    // disabled in the spec editor, but the guard here is the
    // authoritative one).
    if (!canStartApproval(approvalState())) return
    if (exportAbort) exportAbort.abort()
    exportAbort = new AbortController()
    const signal = exportAbort.signal
    const isRetry = approvalState().kind === "retrying"
    if (isRetry) {
      setApprovalState({ type: "retry-start" })
    } else {
      setApprovalState({ type: "request-start" })
    }
    setExportState("exporting")
    setSaveMessage("")
    try {
      const render = await live.client.createArtifact(
        {
          workspaceId: live.workspaceId,
          kind: "svg",
          filename: "design-preview.svg",
          content: renderDesignSpecSvg(designSpec, { width: 1440, height: 1080 }),
          metadata: { derivedFrom: artifactId() ?? "draft", format: "image/svg+xml" },
          provenance: { sourceTool: "design-renderer", capabilityPack: "workbench-design" },
        },
        signal,
      )
      const result = await live.client.exportArtifact(
        live.workspaceId,
        render.artifact.artifactId,
        { metadata: "keep", outbox: "design" },
        signal,
      )
      if ("approvalId" in result && result.approvalId) {
        // 202 — broker gated the operation. The default TTL mirrors
        // the broker's `ttlMs` (5 min in the workbench-server
        // bootstrap); we accept whatever the server reported via
        // `expiresAt` if it ever adds one. Today
        // `AcceptedOperation` carries no `expiresAt`, so we
        // synthesize it from the documented default.
        const expiresAt = Date.now() + 5 * 60_000
        setApprovalState({ type: "request-approval-required", approvalId: result.approvalId, capability: "artifact.export", resource: render.artifact.artifactId, expiresAt })
        clearApprovalTimer()
        approvalExpireTimer = setTimeout(() => setApprovalState({ type: "expire" }), Math.max(0, expiresAt - Date.now()))
        // P6-2 — approval ≠ error: the spec editor's button still
        // shows the "submitted" state; the modal is the surface the
        // user acts on.
        setExportState("exported")
        setSaveMessage(`Export soumis à approbation : ${result.approvalId}`)
        return
      }
      if ("exported" in result) {
        setApprovalState({ type: "request-succeeded" })
        setExportState("exported")
        setSaveMessage(`SVG exporté : ${result.exported.relativePath}`)
        return
      }
      throw new Error("export returned an unrecognised envelope")
    } catch (error) {
      if (signal.aborted) {
        // Navigation away from the Design surface — the onCleanup
        // hook already cancelled the machine; the aborted promise
        // is a no-op here, not a failure.
        return
      }
      setApprovalState({ type: "request-failed", error: error instanceof Error ? error.message : "design render export failed" })
      setExportState("error")
      setSaveMessage(error instanceof Error ? error.message : "design render export failed")
    }
  }

  /** Drop the expiry timer, wherever the machine leaves `approval-required`. */
  function clearApprovalTimer(): void {
    if (approvalExpireTimer) {
      clearTimeout(approvalExpireTimer)
      approvalExpireTimer = undefined
    }
  }

  // DA-UI-02 / DA-UI-03 — allow, deny, cancel, re-request and the
  // navigation teardown. They live in `design-approval.ts` with the client
  // injected: this file cannot be loaded by `bun:test` (Solid's `use` is
  // client-only), so anything written here can only ever be checked by a
  // regex over its own source — which is how an expiry shipped with no
  // reachable control and a request left pending on the broker.
  const approvalOps = createApprovalOperations({
    client: () => connection()?.client,
    state: approvalState,
    dispatch: setApprovalState,
    clearTimer: clearApprovalTimer,
    restart: runExportFlow,
    report: (outcome) => {
      setExportState(outcome.exportState)
      setSaveMessage(outcome.message)
    },
  })

  // DA-UI-03 — navigation cleanup. The Design surface unmounts when the
  // user switches mode or closes the workspace. Both paths must withdraw
  // any pending approval: aborting the local fetch does not tell the
  // broker, so the request would sit there until its TTL ran out and the
  // next attempt would race it.
  onCleanup(() => {
    if (exportAbort) {
      exportAbort.abort()
      exportAbort = undefined
    }
    approvalOps.detach()
  })

  /**
   * Phase 7 — manual, production-grade artifact generation, no agent
   * required. `runExportFlow` above already proves the spec renders to
   * a real, persisted SVG artifact; this reuses the same render call but,
   * instead of sending it to the outbox, opens it in the workshop through
   * the exact `stream` pipeline a real agent's `<artifact>` block would use
   * (P4-2's target shape, applied directly — there's no markdown to parse,
   * so the parser/adapter step is skipped, not reimplemented). The result
   * is a real `DesignArtifactTab` showing a real, server-persisted artifact:
   * this is the "generate a real artifact" affordance the design decided on
   * for the case where no agent emits `<artifact>` tags yet.
   */
  async function openSpecInWorkshop(): Promise<void> {
    const current = connection()
    const designSpec = spec().spec
    if (!current || !designSpec || openState() === "opening") return
    setOpenState("opening")
    setSaveMessage("")
    try {
      const content = renderDesignSpecSvg(designSpec, { width: 1440, height: 1080 })
      const result = await current.client.createArtifact({
        workspaceId: current.workspaceId,
        kind: "svg",
        filename: "design-preview.svg",
        content,
        metadata: { derivedFrom: artifactId() ?? "draft", format: "image/svg+xml" },
        provenance: { sourceTool: "design-workshop-preview", capabilityPack: "workbench-design" },
      })
      const id = result.artifact.artifactId
      stream.push({ type: "artifact:start", artifactId: id, filename: result.artifact.filename, kind: result.artifact.kind, sessionId: "manual" })
      stream.push({ type: "artifact:chunk", artifactId: id, chunk: content })
      stream.push({ type: "artifact:end", artifactId: id, reason: "complete" })
      setOpenState("opened")
      setSaveMessage(`Ouvert dans l'atelier : ${result.artifact.filename} (v${result.artifact.version})`)
    } catch (error) {
      setOpenState("error")
      setSaveMessage(error instanceof Error ? error.message : "design preview could not be opened")
    }
  }
  /**
   * Phase 9.2 — a manual edit was already persisted server-side (createArtifact,
   * called from DesignArtifactTab, which owns the connection needed for
   * that call). This just syncs entry.content with what was saved, same
   * start/chunk/end sequence as openSpecInWorkshop above — the stream is
   * the only write path DesignArtifactTab has for its own props.entry.
   */
  function onArtifactEdited(artifactId: string, filename: string, kind: string, content: string): void {
    stream.push({ type: "artifact:start", artifactId, filename, kind, sessionId: "manual-edit" })
    stream.push({ type: "artifact:chunk", artifactId, chunk: content })
    stream.push({ type: "artifact:end", artifactId, reason: "complete" })
  }

  /**
   * Phase 10.4 — uploads one composer attachment via the same route
   * Phase 7.3's file tab already uses (`createFiles`, refuses on EEXIST —
   * `WorkbenchThread` generates a timestamp-prefixed path precisely so
   * this never collides). Rejects (surfaced as the attachment's own
   * "Échec" state) when there's no live connection.
   */
  async function uploadComposerAttachment(path: string, file: File): Promise<void> {
    const current = connection()
    if (!current) throw new Error("Aucune connexion au workspace")
    const bytes = new Uint8Array(await file.arrayBuffer())
    await current.client.createFiles(current.workspaceId, [{ path, content: encodeBase64(bytes), encoding: "base64" }])
  }

  const versionPanel = createMemo(() => createArtifactVersionPanelState(history.data?.history ?? []))
  const latestDiff = createMemo(() => {
    const versions = versionPanel().history
    return diffArtifactVersions(versions.at(-2), versions.at(-1))
  })

  // Phase 3 — `renderTabContent` resolves the body of the active tab. The
  // workshop's `kind` enum drives the routing: the spec editor lives behind
  // the "spec" tab (P3-4), the file listing will land in "file" (P-pending),
  // and the artifact preview keeps the "artifact" slot. Keeping the routing
  // in a single function makes the seam between tabs and the surface's own
  // signals (source, manifest, validation, …) obvious at a glance.
  function renderTabContent(tab: DesignTab): JSX.Element {
    if (tab.kind === "file") {
      return <DesignFilesTab />
    }
    if (tab.kind === "spec") {
      return <DesignSpecEditor
        source={source()}
        onInput={updateDraft}
        draftError={draftError()}
        empty={spec().empty}
        specDiagnostics={spec().diagnostics}
        specEmpty={spec().empty ? t("workbench.design.specEmpty") : (spec().diagnostics[0]?.message ?? t("workbench.design.specEmpty"))}
        validationLoading={validation.isLoading}
        validationError={validation.error}
        validationValid={validation.data?.valid === true}
        validationDenied={validation.data?.capabilities.denied ?? []}
        previews={preview().previews}
        saveState={saveState()}
        saveMessage={saveMessage()}
        onSave={() => void saveDesignVersion()}
        exportState={exportState()}
        onExport={() => void runExportFlow()}
        openState={openState()}
        onOpenInWorkshop={() => void openSpecInWorkshop()}
        versionPanel={versionPanel()}
        latestDiff={latestDiff()}
        manifestError={manifest.error}
        manifestLoading={manifest.isLoading}
        catalogs={manifest.data?.designSystems ?? []}
        onAddTokenComment={addTokenComment}
      />
    }
    if (tab.kind === "artifact") {
      return <DesignArtifactTab
        entry={stream.state().byId.get(tab.id)}
        connectionError={stream.renderState().connectionError}
        viewport={viewport()}
        zoom={zoom()}
        toolbarMode={toolbarMode()}
        snapshot={snapshotController.snapshot()}
        selectMode={selectMode()}
        onViewport={setViewport}
        onZoom={setZoom}
        onToolbarMode={setToolbarMode}
        onSnapshot={requestSnapshot}
        onSelectMode={setSelectMode}
        onSelectTarget={onArtifactSelectTarget}
        onSnapshotReady={setCapture}
        commentState={commentState()}
        onCommentChange={updateCommentState}
        commentTarget={commentTarget()}
        onSendCommentBatch={(prompt) => void sendRefinePrompt(prompt, "commentaires")}
        onSendCommentOne={(prompt) => void sendRefinePrompt(prompt, "commentaire")}
        highlightedCommentId={highlightedCommentId()}
        onPinClick={(id) => setHighlightedCommentId(id)}
        commentPersistError={commentPersistError()}
        commentPanelOpen={commentPanelOpen()}
        onToggleCommentPanel={() => setCommentPanelOpen((value) => !value)}
        copyState={snapshotController.copyState()}
        onCopySnapshot={() => void copySnapshot()}
        onArtifactEdited={onArtifactEdited}
      />
    }
    if (tab.kind === "terminal") return <TerminalPanel />
    if (tab.kind === "browser") return <DesignBrowserTab />
    if (tab.kind === "sketch") return <DesignSketchTab id={tab.id} />
    return <div data-design-workspace-tab-empty={tab.id} />
  }

  return (
    <section class="size-full" data-workbench-surface="design">
      <DesignSplit
        chat={
          <WorkbenchThread
            mode="design"
            prompt={t("workbench.design.chatPrompt")}
            description={t("workbench.design.description")}
            connection={{ dataAttr: "design-connection", dataRetryAttr: "design-retry" }}
            comments={{
              state: commentState(),
              attachedIds: attachedCommentIds(),
              onToggleAttach: (commentId) => setAttachedCommentIds((ids) => toggleAttachedCommentId(ids, commentId)),
              onClearAttached: () => setAttachedCommentIds(new Set()),
              resolveEntryFile: (artifactId) => stream.state().byId.get(artifactId)?.filename,
            }}
            files={{ upload: uploadComposerAttachment }}
            contextChips={{
              catalogs: manifest.data?.designSystems ?? [],
              activeIds: activeDesignSystemIds(),
              onToggleActive: (id) => setActiveDesignSystemIds((ids) => toggleActiveDesignSystemId(ids, id)),
            }}
            skills={{
              skills: skills.data?.skills ?? [],
              hasDesignSystem: (manifest.data?.designSystems.length ?? 0) > 0,
            }}
          />
        }
        workspace={
          <div class="flex h-full min-h-0 flex-col">
            <DesignWorkspace
              state={tabState}
              setState={setTabState}
              renderContent={renderTabContent}
              github={describeGithubConnection({ status: github.data, loading: github.isLoading, error: github.error })}
              onOpenTerminal={() => setTabState(openTab(tabState, { id: "terminal", kind: "terminal", title: "Terminal", closable: true }))}
              onOpenBrowser={() => setTabState(openTab(tabState, { id: "browser", kind: "browser", title: "Navigateur", closable: true }))}
              onOpenSketch={() => setTabState(openTab(tabState, { id: "sketch", kind: "sketch", title: "Croquis", closable: true }))}
            />
          </div>
        }
      />
      {/* DA-UI-02 — the approval modal. Visible only when the machine
          is in `approval-required` or `resolving`; the modal owns its
          own Allow/Deny/Cancel buttons and reads the machine for the
          approval id, capability and deadline. The expiration warning
          (DA-UI-03) is rendered non-modally inside the same component
          when `state.expired` is true. */}
      <ApprovalModal
        state={approvalState()}
        onAllow={() => void approvalOps.resolve("allow")}
        onDeny={() => void approvalOps.resolve("deny")}
        onCancel={() => void approvalOps.cancel()}
        onRerequest={() => void approvalOps.rerequest()}
      />
    </section>
  )
}

/**
 * DA-UI-02 — the approval modal. Renders nothing when the machine
 * is not waiting on the user. The visible states are:
 *   - `approval-required` (waiting for the user's decision),
 *   - `resolving` (request to broker in flight, brief).
 *
 * When `state.expired` is true the modal keeps its warning but swaps the
 * allow/deny/cancel trio for "annuler" and "demander une nouvelle
 * approbation" — both wired to the broker. The doc comment used to
 * promise "a single re-approve button" that the markup never rendered:
 * every control was behind `!expired`, so an expiry left a full-screen
 * overlay with no way out.
 */
function ApprovalModal(props: {
  state: ApprovalState
  onAllow: () => void
  onDeny: () => void
  onCancel: () => void
  onRerequest: () => void
}): JSX.Element {
  return (
    <Show when={isApprovalModalVisible(props.state)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="design-approval-title"
        data-design-approval-modal={props.state.kind}
        data-design-approval-expired={props.state.kind === "approval-required" && props.state.expired ? "true" : "false"}
        class="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      >
        <div class="w-full max-w-md rounded-lg border border-border-base bg-background-base p-5 shadow-xl">
          <h2 id="design-approval-title" class="text-16-medium text-text-base">
            Approbation requise
          </h2>
          <Show when={props.state.kind === "approval-required" ? props.state : null}>
            {(s) => (
              <>
                <p class="mt-2 text-13-regular text-text-weak" data-design-approval-id={s().approvalId}>
                  Cette opération nécessite une approbation ({s().capability}). Le serveur attend votre décision avant de continuer.
                </p>
                <Show when={s().expired}>
                  <p
                    data-design-approval-expired-warning
                    class="mt-2 rounded border border-border-warning bg-background-warning/30 p-2 text-12-regular text-text-warning"
                  >
                    L'approbation a expiré. Vous pouvez en demander une nouvelle.
                  </p>
                </Show>
                <p class="mt-2 text-11-regular text-text-weak" data-design-approval-deadline>
                  Expire à : {new Date(s().expiresAt).toLocaleTimeString()}
                </p>
              </>
            )}
          </Show>
          <Show when={props.state.kind === "resolving"}>
            <p class="mt-2 text-13-regular text-text-weak">Envoi de la décision au serveur…</p>
          </Show>
          <div class="mt-4 flex flex-wrap justify-end gap-2">
            {/* An expired approval gets its own pair of actions. The first
                version hid every button here, leaving a full-screen modal
                with a warning and no way out — and the pending request on
                the server with it. */}
            <Show when={props.state.kind === "approval-required" && props.state.expired}>
              <button
                type="button"
                data-design-approval-action="cancel"
                class="rounded border border-border-base px-3 py-1.5 text-12-medium"
                onClick={() => props.onCancel()}
              >
                Annuler
              </button>
              <button
                type="button"
                data-design-approval-action="rerequest"
                class="rounded border border-border-focus bg-background-focus px-3 py-1.5 text-12-medium text-text-inverse"
                onClick={() => props.onRerequest()}
              >
                Demander une nouvelle approbation
              </button>
            </Show>
            <Show when={props.state.kind === "approval-required" && !props.state.expired}>
              <button
                type="button"
                data-design-approval-action="deny"
                class="rounded border border-border-base px-3 py-1.5 text-12-medium"
                onClick={() => props.onDeny()}
              >
                Refuser
              </button>
              <button
                type="button"
                data-design-approval-action="cancel"
                class="rounded border border-border-base px-3 py-1.5 text-12-medium"
                onClick={() => props.onCancel()}
              >
                Annuler
              </button>
              <button
                type="button"
                data-design-approval-action="allow"
                class="rounded border border-border-focus bg-background-focus px-3 py-1.5 text-12-medium text-text-inverse"
                onClick={() => props.onAllow()}
              >
                Approuver et réessayer
              </button>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  )
}

// Phase 3 → Phase 7 — the "Fichiers" tab was a placeholder proving only that
// a non-closable tab survives `closeTab` (P3-3). It's now `DesignFilesTab`
// from `design-files-tab.tsx`, imported above: a real listing backed by
// `listFiles(workspaceId, ".")`, the same client call Automate already used
// (`automate-surface.tsx`) — no new server surface, no duplicated query.
// V02 — spec editor + token review + their shared type live in
// `design-spec-editor.tsx` and `design-token-review.tsx`.
