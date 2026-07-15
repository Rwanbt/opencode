// FORK: CodeMirror 6 editor component (ADR-0005, 1b-core + Phase 2 LSP).
// CodeMirror owns the document — this component is intentionally NOT reactive
// to content changes after mount. The parent keys it by path so it remounts
// when the active file changes (each mount = fresh CM state for that file).
// Programmatic mutations (post-format reconcile, conflict overwrite) go through
// the imperative handle returned via the `ref` prop.
import { onMount, onCleanup, type JSX } from "solid-js"
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  highlightSpecialChars,
} from "@codemirror/view"
import { EditorState, Compartment, Annotation } from "@codemirror/state"
import { history, defaultKeymap, historyKeymap, indentWithTab } from "@codemirror/commands"
import { search, searchKeymap, openSearchPanel } from "@codemirror/search"
import { indentOnInput, bracketMatching, syntaxHighlighting } from "@codemirror/language"
import { classHighlighter } from "@lezer/highlight"
import { buildLspExtensions, type LspCallbacks, type LspLocation } from "./code-mirror-lsp"

// Used to tag programmatic (non-user) document changes so the updateListener
// can skip them and avoid spurious onChange callbacks.
const programmaticChange = Annotation.define<true>()

// Imperative handle exposed to the parent component via `ref`.
export interface CodeMirrorHandle {
  focus(): void
  openSearch(): void
  getContent(): string
  /** Replace the document without triggering onChange (post-format reconcile). */
  setContent(content: string): void
}

// Minimal theme that adapts to OpenCode's CSS custom properties.
// Only structural/colour rules — no font stack override (inherited from body).
const openCodeTheme = EditorView.theme({
  "&": {
    background: "transparent",
    height: "100%",
    fontSize: "var(--font-size-small, 13px)",
    color: "inherit",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-family-mono)",
    overflow: "auto",
    lineHeight: "1.6",
  },
  ".cm-content": {
    caretColor: "var(--text-base, currentColor)",
    // Bottom padding so the last line scrolls into comfortable view.
    padding: "0 0 10rem 0",
    minHeight: "100%",
  },
  ".cm-cursor": { borderLeftColor: "var(--text-base, currentColor)" },
  ".cm-activeLine": { background: "var(--background-stronger, rgba(0,0,0,0.04))" },
  ".cm-gutters": {
    background: "transparent",
    border: "none",
    color: "rgba(127,127,127,0.45)",
    userSelect: "none",
  },
  ".cm-activeLineGutter": { background: "var(--background-stronger, rgba(0,0,0,0.04))" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 1rem 0 0.5rem", minWidth: "2.5rem" },
  // Selection: use the design system's subtle highlight rather than bright blue.
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    background: "var(--background-strong, rgba(0,0,0,0.12))",
  },
  ".cm-searchMatch": {
    background: "rgba(255,185,0,0.22)",
    outline: "1px solid rgba(255,185,0,0.45)",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    background: "rgba(255,185,0,0.5)",
  },
  ".cm-panels.cm-panels-top": {
    borderBottom: "1px solid var(--border-base, rgba(0,0,0,0.12))",
    background: "var(--background-base)",
  },
  ".cm-panel": { padding: "4px 8px" },
  ".cm-textfield": {
    background: "var(--background-weak, rgba(0,0,0,0.04))",
    border: "1px solid var(--border-base, rgba(0,0,0,0.12))",
    borderRadius: "4px",
    padding: "2px 6px",
    color: "inherit",
    outline: "none",
    fontSize: "inherit",
  },
  ".cm-button": {
    background: "var(--background-strong, rgba(0,0,0,0.08))",
    border: "1px solid var(--border-base, rgba(0,0,0,0.12))",
    borderRadius: "4px",
    padding: "2px 8px",
    cursor: "pointer",
    fontSize: "inherit",
    color: "inherit",
  },
})

// Lazy-load the language extension based on file extension.
// Returns null for unknown extensions (plain text, no highlighting).
function loadLangExtension(ext: string) {
  switch (ext) {
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return import("@codemirror/lang-javascript").then((m) => m.javascript())
    case "ts":
    case "tsx":
    case "mts":
    case "cts":
      return import("@codemirror/lang-javascript").then((m) => m.javascript({ typescript: true }))
    case "json":
    case "jsonc":
      return import("@codemirror/lang-json").then((m) => m.json())
    case "css":
    case "scss":
    case "less":
      return import("@codemirror/lang-css").then((m) => m.css())
    case "html":
    case "htm":
      return import("@codemirror/lang-html").then((m) => m.html())
    case "md":
    case "mdx":
    case "markdown":
      return import("@codemirror/lang-markdown").then((m) => m.markdown())
    case "rs":
      return import("@codemirror/lang-rust").then((m) => m.rust())
    case "py":
    case "pyi":
      return import("@codemirror/lang-python").then((m) => m.python())
    default:
      return Promise.resolve(null)
  }
}

export function CodeMirrorEditor(props: {
  /** File path — used only for language detection. */
  path: string
  /** Initial document content; CodeMirror owns the doc after mount. */
  initialContent: string
  /** Called on every user keystroke so the parent can track dirty state. */
  onChange: (content: string) => void
  /** Called when the user presses Ctrl/Cmd+S. */
  onSave?: (content: string) => void
  /** Exposes the imperative handle for focus, search, get/set content. */
  ref?: (handle: CodeMirrorHandle) => void
  /** Optional LSP callbacks — when provided, enables diagnostics, hover and F12 go-to-definition. */
  lsp?: LspCallbacks
  /** Called by the go-to-definition command (F12) when a definition is found. */
  onNavigate?: (file: string, line: number, character: number) => void
  /** Called by the find-all-references command (Shift+F12) with the list of locations. */
  onReferences?: (refs: LspLocation[]) => void
}): JSX.Element {
  let container!: HTMLDivElement
  let view: EditorView | undefined
  const langCompartment = new Compartment()

  onMount(() => {
    const ext = props.path.split(".").pop()?.toLowerCase() ?? ""

    const state = EditorState.create({
      doc: props.initialContent,
      extensions: [
        history(),
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        drawSelection(),
        highlightSpecialChars(),
        bracketMatching(),
        indentOnInput(),
        // Use literal token classes so syntax colours come from the static CSS.
        // HighlightStyle would inject a runtime <style>, which mobile CSP drops.
        syntaxHighlighting(classHighlighter),
        search({ top: true }),
        // Placeholder slot: reconfigured after the async language import resolves.
        langCompartment.of([]),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          indentWithTab,
          {
            key: "Mod-s",
            run: (v) => {
              props.onSave?.(v.state.doc.toString())
              return true
            },
          },
        ]),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return
          // Skip onChange for programmatic mutations (setContent, format reconcile).
          if (update.transactions.some((tr) => tr.annotation(programmaticChange))) return
          props.onChange(update.state.doc.toString())
        }),
        openCodeTheme,
        // Phase 2: LSP extensions (diagnostics, hover, F12).
        // Only activated when the parent passes lsp callbacks.
        ...(props.lsp ? buildLspExtensions(props.path, props.lsp, props.onNavigate, props.onReferences) : []),
      ],
    })

    view = new EditorView({ state, parent: container })
    view.focus()

    // Mobile IME: on Android WebView, a tap on a contenteditable div does not
    // always trigger focus + IME attachment. Listening on touchend and calling
    // focus() when CM is not already focused ensures the soft keyboard appears
    // reliably. passive:true so we never block scroll.
    container.addEventListener(
      "touchend",
      () => { if (!view?.hasFocus) view?.focus() },
      { passive: true },
    )

    // Async language load — safe to ignore if the component unmounts first.
    void loadLangExtension(ext).then((lang) => {
      if (!view || !lang) return
      view.dispatch({ effects: langCompartment.reconfigure(lang) })
    })

    props.ref?.({
      focus: () => view?.focus(),
      openSearch: () => view && openSearchPanel(view),
      getContent: () => view?.state.doc.toString() ?? "",
      setContent: (content) => {
        if (!view) return
        if (view.state.doc.toString() === content) return
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: content },
          annotations: programmaticChange.of(true),
        })
      },
    })
  })

  onCleanup(() => {
    view?.destroy()
    view = undefined
  })

  return <div ref={container} class="cm-opencode h-full overflow-hidden" />
}
