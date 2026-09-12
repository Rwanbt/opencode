// =============================================================================
// components/team/collection-view.tsx — TEAM-M01
//
// The shared way a paginated Team or registry collection is rendered.
//
// Every label arrives as a prop. These are primitives used by the App, the
// desktop shell and mobile, and none of those surfaces agree on wording; a
// component that reached for a dictionary key here would be choosing the copy
// for screens it does not own. The cards that own the screens pass translated
// strings in (TEAM-M03, TEAM-M04), and TEAM-M05 audits them.
// =============================================================================

import { For, Match, Show, Switch, type JSX } from "solid-js"
import type { Page, Reachability } from "@/context/team"
import { isStale } from "@/context/team"

export interface CollectionLabels {
  /** Shown when the collection is genuinely empty and the server answered. */
  readonly empty: string
  /** Shown when nothing could be fetched and nothing is held. */
  readonly unreachable: string
  /** Shown above data kept from an earlier, successful read. */
  readonly stale: string
  /** The control that fetches the next page. */
  readonly more: string
}

export interface CollectionViewProps<T> {
  readonly page: Page<T>
  readonly reachability: Reachability
  readonly labels: CollectionLabels
  readonly onMore: () => void
  readonly children: (item: T) => JSX.Element
}

/**
 * Render a page, and say which of the three states it is in.
 *
 * The states are kept apart on purpose. "Nothing here", "we could not ask" and
 * "this is what we knew last time" look identical once they all collapse into
 * an empty list, and the user has no way to tell which one they are looking at.
 */
export function CollectionView<T>(props: CollectionViewProps<T>) {
  const count = () => props.page.items.length
  const stale = () => isStale(props.reachability, count())

  return (
    <div class="flex flex-col gap-2">
      <Show when={stale()}>
        <p role="status" class="text-11-regular text-text-weaker px-2">
          {props.labels.stale}
        </p>
      </Show>

      <Switch>
        <Match when={count() === 0 && props.reachability !== "ok"}>
          <p role="status" class="text-11-regular text-text-weak px-2 py-4 text-center">
            {props.labels.unreachable}
          </p>
        </Match>
        <Match when={count() === 0}>
          <p class="text-11-regular text-text-weaker px-2 py-4 text-center">{props.labels.empty}</p>
        </Match>
        <Match when={count() > 0}>
          <ul class="flex flex-col gap-px">
            <For each={props.page.items}>{(item) => <li>{props.children(item)}</li>}</For>
          </ul>
        </Match>
      </Switch>

      {/* Only rendered when the server said there is more. A button that is
          always present cannot distinguish "the end" from "not asked yet". */}
      <Show when={props.page.nextCursor !== null}>
        {/* min-h-11 is 44px, the smallest target a thumb hits reliably. The
            desktop look is unchanged; what changes is that on a phone this
            stops being a 20px strip between two rows of run ids. */}
        <button
          type="button"
          class="text-11-regular text-text-weak hover:text-text-base border border-border-weak-base rounded px-3 min-h-11 self-center"
          onClick={() => props.onMore()}
        >
          {props.labels.more}
        </button>
      </Show>
    </div>
  )
}
