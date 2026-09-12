/* SPDX-License-Identifier: MIT */
export type DesktopTarget = { appId: string; windowId?: string }
export class EmergencyStop {
  #stopped = false
  engage(): void { this.#stopped = true }
  reset(): void { this.#stopped = false }
  isStopped(): boolean { return this.#stopped }
}
export type DesktopDriver = { observe(target: DesktopTarget): Promise<unknown>; control(target: DesktopTarget, action: "keyboard" | "mouse", payload: unknown): Promise<void> }
export class DesktopAutomationBroker {
  readonly #driver: DesktopDriver
  readonly #allowedApps: readonly string[]
  readonly #stop: EmergencyStop
  readonly #switches: { isEngaged(surface: "computer-use"): boolean }
  constructor(driver: DesktopDriver, allowedApps: readonly string[], switches: { isEngaged(surface: "computer-use"): boolean } = { isEngaged: () => false }, stop: EmergencyStop = new EmergencyStop()) { this.#driver = driver; this.#allowedApps = allowedApps; this.#switches = switches; this.#stop = stop }
  #check(target: DesktopTarget): void { if (this.#stop.isStopped()) throw new Error("emergency stop is engaged"); if (!this.#allowedApps.includes(target.appId)) throw new Error("desktop app is not allowlisted"); if (this.#switches.isEngaged("computer-use")) throw new Error("computer use is disabled") }
  async observe(target: DesktopTarget): Promise<unknown> { this.#check(target); return this.#driver.observe({ ...target }) }
  async control(target: DesktopTarget, action: "keyboard" | "mouse", payload: unknown): Promise<void> { this.#check(target); await this.#driver.control({ ...target }, action, payload) }
}
