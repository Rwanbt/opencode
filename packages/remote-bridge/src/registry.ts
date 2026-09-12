/* SPDX-License-Identifier: MIT */

/**
 * Per-transport enablement — Plan V3 §22 exit criterion
 * « Les transports peuvent être désactivés séparément ».
 *
 * `KillSwitchRegistry` only knows `all-remote`, which turns every bridge off at
 * once. That satisfies the panic case and nothing else: before this registry
 * both adapters read the same switch, so "disable Slack, keep Feishu" was not
 * expressible. The two controls are kept distinct on purpose — the global
 * switch is a kill switch and always wins, this one is routine configuration.
 */

import type { KillSwitchRegistry, RemoteProviderId } from "@unifia/contracts"

export type TransportState = "enabled" | "disabled" | "killed"

export class RemoteTransportRegistry {
  readonly #enabled = new Set<RemoteProviderId>()
  readonly #switches: KillSwitchRegistry

  constructor(switches: KillSwitchRegistry) {
    this.#switches = switches
  }

  /**
   * Transports start disabled: a bridge nobody turned on should not accept
   * traffic because its package happens to be installed.
   */
  enable(provider: RemoteProviderId): void {
    this.#enabled.add(provider)
  }

  disable(provider: RemoteProviderId): void {
    this.#enabled.delete(provider)
  }

  state(provider: RemoteProviderId): TransportState {
    if (this.#switches.isEngaged("all-remote")) return "killed"
    return this.#enabled.has(provider) ? "enabled" : "disabled"
  }

  isEnabled(provider: RemoteProviderId): boolean {
    return this.state(provider) === "enabled"
  }

  snapshot(): readonly RemoteProviderId[] {
    return [...this.#enabled].filter((provider) => this.isEnabled(provider))
  }
}
