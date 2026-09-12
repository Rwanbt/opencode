/* SPDX-License-Identifier: MIT */
import { mkdir, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { chromium, type BrowserContext, type Page } from "playwright"
import type { BrowserDriver, BrowserProfile } from "@unifia/contracts"

export class PlaywrightBrowserDriver implements BrowserDriver {
  readonly #root: string
  readonly #contexts = new Map<string, BrowserContext>()
  readonly #pages = new Map<string, Page>()
  readonly #browserPromise = chromium.launch({ headless: true })
  constructor(rootDirectory: string) { this.#root = resolve(rootDirectory) }
  async #page(profile: BrowserProfile): Promise<Page> {
    const existing = this.#pages.get(profile.profileId)
    if (existing) return existing
    const browser = await this.#browserPromise
    const context = await browser.newContext({ storageState: undefined, acceptDownloads: true })
    this.#contexts.set(profile.profileId, context)
    const page = await context.newPage()
    this.#pages.set(profile.profileId, page)
    return page
  }
  async navigate(profile: BrowserProfile, url: string): Promise<void> { await (await this.#page(profile)).goto(url, { waitUntil: "domcontentloaded" }) }
  async snapshot(profile: BrowserProfile): Promise<unknown> { return (await this.#page(profile)).locator("body").ariaSnapshot() }
  async screenshot(profile: BrowserProfile): Promise<Uint8Array> { const page = await this.#page(profile)
    return page.screenshot({ type: "png", animations: "disabled", mask: profile.redactSelectors.map((selector) => page.locator(selector)), maskColor: "#000000" }) }
  async quarantineDownload(profile: BrowserProfile, filename: string, bytes: Uint8Array): Promise<string> {
    const directory = resolve(join(this.#root, profile.workspaceId, "downloads"))
    if (!directory.startsWith(this.#root + "\\") && directory !== this.#root) throw new Error("download directory escaped root")
    await mkdir(directory, { recursive: true })
    const target = join(directory, filename)
    await writeFile(target, bytes, { flag: "wx" })
    return target
  }
  async close(): Promise<void> { for (const context of this.#contexts.values()) await context.close(); const browser = await this.#browserPromise; await browser.close() }
}
