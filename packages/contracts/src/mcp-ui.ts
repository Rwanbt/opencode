/* SPDX-License-Identifier: MIT */
export type UiAction = { id: string; componentId: string; kind: "inspect" | "click" | "fill" | "select"; value?: string }
export type UiActionResult = { id: string; status: "accepted" | "pending-approval" | "denied"; output?: unknown; approvalId?: string }
export type UiApproval = { request(action: UiAction): { id: string } }
export type UiDriver = { inspect(componentId: string): Promise<unknown>; execute(action: UiAction): Promise<unknown> }
export class McpUiControlBroker {
  readonly #driver: UiDriver
  readonly #components: ReadonlySet<string>
  readonly #approval?: UiApproval
  readonly #switches: { isEngaged(surface: "mcp-ui-control"): boolean }
  constructor(driver: UiDriver, allowedComponents: readonly string[], approval?: UiApproval, switches: { isEngaged(surface: "mcp-ui-control"): boolean } = { isEngaged: () => false }) { this.#driver = driver; this.#components = new Set(allowedComponents); this.#approval = approval; this.#switches = switches }
  async execute(action: UiAction): Promise<UiActionResult> { if (this.#switches.isEngaged("mcp-ui-control")) return { id: action.id, status: "denied" }; if (!/^[A-Za-z0-9_-]+$/.test(action.id) || !this.#components.has(action.componentId)) return { id: action.id, status: "denied" }; if (action.kind !== "inspect" && !this.#approval) return { id: action.id, status: "denied" }; if (action.kind !== "inspect") { const approval = this.#approval!.request(action); return { id: action.id, status: "pending-approval", approvalId: approval.id } } const output = await this.#driver.inspect(action.componentId); return { id: action.id, status: "accepted", output } }
}
