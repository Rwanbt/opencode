/* SPDX-License-Identifier: MIT */

export const PLUGIN_PACKAGE = "@unifia/plugin"

export function pluginTarget(version: string) {
  // Preview CLI identifiers are not npm versions; the author SDK follows its own SemVer contract.
  return version === "local" ? "*" : `^${version}`
}
