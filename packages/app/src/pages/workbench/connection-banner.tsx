/* SPDX-License-Identifier: MIT */

import { Show, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import { useWorkspaceWorkbench } from "@/context/workbench/provider"

export function ConnectionBanner(props: { dataAttr: "workbench-connection" | "design-connection" | "automate-connection"; dataRetryAttr: "workbench-retry" | "design-retry" | "automate-retry" }): JSX.Element {
  const language = useLanguage()
  const workbench = useWorkspaceWorkbench()
  const t = language.t
  const connection = workbench.connection
  // V03 — delegate to the provider's single source of truth. The banner
  // no longer recomputes a phase locally; it renders the UI phase the
  // provider derives. This kills the audit's "Reconnecter" loop (a
  // failed → initializing → failed cycle was previously possible) and
  // gives `unsupported` its own non-retryable terminal state.
  const phase = workbench.uiPhase
  const canRetry = () => phase() === "failed"
  // V03 — `unsupported` has its own message: the bridge is not part of
  // this runtime (web Vite without a native injection). Inline string for
  // now; the proper translation key lands in V10 (visual contract) when
  // the goldens are approved.
  const phaseText = (): string => {
    switch (phase()) {
      case "ready": return t("workbench.connection.connected", { instanceId: connection()!.instanceId })
      case "connecting": return t("workbench.connection.connecting")
      case "retrying": return t("workbench.connection.connecting")
      case "failed": return t("workbench.connection.failed")
      case "unsupported": return "Disponible dans l'application desktop"
    }
  }
  // The lifecycle already captured why the bridge refused; until now the
  // banner replaced it with one fixed sentence, so the only actionable part
  // of the failure never reached the person able to act on it. The text is a
  // runtime message from the transport, not a translatable string — same
  // treatment as the manifest error rendered by the Design surface.
  const failureDetail = (): string | undefined => {
    const reason = workbench.detail()
    if (!reason) return undefined
    const message = reason.message
    return message.trim() || undefined
  }
  return (
    <>
      <p
        data-workbench-connection={props.dataAttr === "workbench-connection" ? phase() : undefined}
        data-design-connection={props.dataAttr === "design-connection" ? phase() : undefined}
        data-automate-connection={props.dataAttr === "automate-connection" ? phase() : undefined}
        class="text-12-regular text-text-weak"
      >
        {phaseText()}
      </p>
      <Show when={failureDetail()}>
        {(detail) => (
          <p
            data-workbench-connection-detail={props.dataAttr}
            class="text-12-regular text-text-danger"
            role="alert"
          >
            {detail()}
          </p>
        )}
      </Show>
      <Show when={canRetry()}>
        <button
          type="button"
          data-workbench-retry={props.dataRetryAttr === "workbench-retry" ? "" : undefined}
          data-design-retry={props.dataRetryAttr === "design-retry" ? "" : undefined}
          data-automate-retry={props.dataRetryAttr === "automate-retry" ? "" : undefined}
          class="rounded border border-border-base px-3 py-2 text-12-medium"
          aria-label={t("workbench.connection.retryHint")}
          onClick={() => workbench.retryConnection()}
        >
          {t("workbench.connection.retry")}
        </button>
      </Show>
    </>
  )
}
