/* SPDX-License-Identifier: MIT */

import { For, Show, type JSX } from "solid-js"
import { VIEWPORT_IDS } from "@unifia/artifact-render"
import { useLanguage } from "@/context/language"
import { TokenReview, type DesignCatalogSummary } from "@/pages/workbench/design-token-review"

// Phase 3 — moved from inline slot in DesignSurface to an importable
// sub-component so the spec editor can be unit-tested. No behavior change.
export function DesignSpecEditor(props: {
  source: string
  onInput: (value: string) => void
  draftError: string | undefined
  empty: boolean
  specDiagnostics: readonly { line: number; column: number; message: string }[]
  specEmpty: string
  validationLoading: boolean
  validationError: unknown
  validationValid: boolean
  validationDenied: readonly string[]
  previews: readonly unknown[]
  saveState: "idle" | "saving" | "saved" | "error"
  saveMessage: string
  onSave: () => void
  exportState: "idle" | "exporting" | "exported" | "error"
  onExport: () => void
  openState: "idle" | "opening" | "opened" | "error"
  onOpenInWorkshop: () => void
  versionPanel: {
    history: readonly unknown[]
    provenance?: Record<string, string>
  }
  latestDiff: { changed: readonly string[]; added: readonly string[]; removed: readonly string[] }
  manifestError: unknown
  manifestLoading: boolean
  catalogs: readonly DesignCatalogSummary[]
  onAddTokenComment: (catalogId: string, elementId: string) => void
}): JSX.Element {
  const language = useLanguage()
  const t = language.t
  return (
    <div class="flex h-full min-h-0 flex-col gap-6 overflow-auto p-6" data-design-spec-editor>
      <Show when={props.manifestError}>
        <p data-design-manifest="failed" class="text-14-regular text-text-danger">
          {props.manifestError instanceof Error ? props.manifestError.message : String(props.manifestError)}
        </p>
      </Show>
      <Show when={props.catalogs.length > 0}>
        <div class="grid gap-3 md:grid-cols-2" data-design-catalog-count={props.catalogs.length}>
          <For each={props.catalogs}>
            {(catalog) => (
              <article class="rounded-lg border border-border-base bg-background-stronger p-4" data-design-catalog={catalog.id}>
                <h2 class="text-14-medium">
                  {catalog.name} · {catalog.version}
                </h2>
                <p class="mt-2 text-12-regular text-text-weak">{t("workbench.design.source", { source: catalog.source })}</p>
                <TokenReview catalog={catalog} onAdd={props.onAddTokenComment} />
              </article>
            )}
          </For>
        </div>
      </Show>
      <Show when={!props.manifestLoading && !props.manifestError && props.catalogs.length === 0}>
        <p data-design-manifest="empty" class="text-14-regular text-text-danger">
          {t("workbench.design.noManifest")}
        </p>
      </Show>
      {/* P4-4 — `data-design-context-length` removed: catalog→preamble wiring
          is now proven by the agent itself, not by a static label. */}
      <label class="block space-y-2" for="workbench-design-spec">
        <span class="text-14-medium">{t("workbench.design.specLabel")}</span>
        <textarea
          id="workbench-design-spec"
          class="min-h-48 w-full rounded-lg border border-border-base bg-background-stronger p-4 font-mono text-12-regular text-text-base"
          placeholder={t("workbench.design.specPlaceholder")}
          value={props.source}
          onInput={(event) => props.onInput(event.currentTarget.value)}
          spellcheck={false}
        />
      </label>
      <Show when={props.draftError}>
        <p data-design-draft="error" class="text-12-regular text-text-danger">
          {props.draftError}
        </p>
      </Show>
      {/* V04 — diagnostics are hidden when the source is empty. The
          audit caught the panel rendering "expected property name or
          '}'" as a red banner the moment the textarea was cleared.
          An empty spec is a neutral state, not a parse failure. */}
      <Show when={!props.empty && props.specDiagnostics.length > 0}>
        <aside class="rounded-lg border border-border-danger bg-background-stronger p-4" data-workbench-diagnostics>
          <h2 class="text-14-medium text-text-danger">{t("workbench.design.diagnostics")}</h2>
          <For each={props.specDiagnostics}>
            {(diagnostic) => (
              <p class="mt-2 text-12-regular text-text-weak">
                {t("workbench.design.diagnosticLine", {
                  line: diagnostic.line,
                  column: diagnostic.column,
                  message: diagnostic.message,
                })}
              </p>
            )}
          </For>
        </aside>
      </Show>
      <Show when={props.validationLoading}>
        <p data-design-validation="loading" class="text-12-regular text-text-weak">
          {t("workbench.design.validating")}
        </p>
      </Show>
      <Show when={props.validationError}>
        <p data-design-validation="failed" class="text-14-regular text-text-danger">
          {props.validationError instanceof Error ? props.validationError.message : String(props.validationError)}
        </p>
      </Show>
      <Show when={props.validationDenied.length > 0}>
        <p data-design-validation="denied" class="text-14-regular text-text-danger">
          {t("workbench.design.capabilitiesDenied", { list: props.validationDenied.join(", ") })}
        </p>
      </Show>
      <Show
        when={props.validationValid && props.validationDenied.length === 0 && props.previews.length > 0}
        fallback={
          // V04 — the empty state is neutral, the rest are not. Two
          // fallbacks: a quiet placeholder for an untouched spec, the
          // original danger line for an attempted but invalid one.
          props.empty ? (
            <p class="text-14-regular text-text-weak" data-design-spec-empty-placeholder>
              {props.specEmpty}
            </p>
          ) : (
            <p class="text-14-regular text-text-danger">{props.specEmpty}</p>
          )
        }
      >
        <div class="grid gap-5 md:grid-cols-3" data-workbench-preview-count={VIEWPORT_IDS.length}>
          <For each={VIEWPORT_IDS}>
            {(id) => (
              <figure class="flex flex-col items-center gap-2 rounded-lg border border-border-base bg-background-stronger p-3">
                <span class="text-12-medium">{id}</span>
                <span class="text-12-regular text-text-weak">{t("workbench.design.previewCaption", { label: id, width: 0 })}</span>
              </figure>
            )}
          </For>
        </div>
      </Show>
      <div class="flex flex-wrap items-center gap-3" data-design-versioning>
        <button
          type="button"
          data-design-save-version
          class="rounded border border-border-base px-3 py-2 text-12-medium disabled:opacity-50"
          disabled={!props.source || props.saveState === "saving"}
          onClick={props.onSave}
        >
          {props.saveState === "saving" ? "Enregistrement…" : "Enregistrer une version"}
        </button>
        <button
          type="button"
          data-design-export-render
          class="rounded border border-border-base px-3 py-2 text-12-medium disabled:opacity-50"
          disabled={!props.source || props.exportState === "exporting"}
          onClick={props.onExport}
        >
          {props.exportState === "exporting" ? "Export…" : "Exporter le rendu SVG"}
        </button>
        <button
          type="button"
          data-design-open-workshop
          class="rounded border border-border-base px-3 py-2 text-12-medium disabled:opacity-50"
          disabled={!props.source || props.openState === "opening"}
          onClick={props.onOpenInWorkshop}
          title="Rend la spec en SVG, la persiste comme artefact, et l'ouvre dans l'onglet atelier"
        >
          {props.openState === "opening" ? "Ouverture…" : "Ouvrir dans l'atelier"}
        </button>
        {/* One line reports both flows: saving a version and exporting the
            render both write `saveMessage`. Only `saveState` was exposed, so
            a completed export and a failed one were indistinguishable in the
            DOM — both read `idle`, because the export never touches
            `saveState`. The export state now has its own attribute. */}
        <Show when={props.saveMessage}>
          <span
            data-design-save-result={props.saveState}
            data-design-export-result={props.exportState}
            class="text-12-regular text-text-weak"
          >
            {props.saveMessage}
          </span>
        </Show>
      </div>
      <Show when={props.versionPanel.history.length > 0}>
        <section class="rounded-lg border border-border-base bg-background-stronger p-4" data-design-history>
          <h2 class="text-14-medium">Historique Design</h2>
          <p class="mt-2 text-12-regular text-text-weak">
            {props.versionPanel.history.length} version(s) · provenance : {props.versionPanel.provenance?.sourceTool ?? "inconnue"}
          </p>
          <p data-design-diff class="mt-2 text-12-regular text-text-weak">
            Diff dernière version : {props.latestDiff.changed.join(", ") || "aucun changement structurel"}
          </p>
        </section>
      </Show>
    </div>
  )
}
