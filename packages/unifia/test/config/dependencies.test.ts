/* SPDX-License-Identifier: MIT */

import { expect, spyOn, test } from "bun:test"
import { Config } from "../../src/config/config"
import { pluginTarget } from "../../src/config/dependencies"
import { Npm } from "../../src/npm"
import { tmpdir } from "../fixture/fixture"

test("ConfigDependencies_PreviewBuild_UsesPluginReleaseTrain", () => {
  expect(pluginTarget("1.3.15")).toBe("^1.3.15")
  expect(pluginTarget("local")).toBe("*")
})

test("ConfigDependencies_InstallFailure_PropagatesWithoutRetry", async () => {
  await using tmp = await tmpdir()
  const install = spyOn(Npm, "install").mockRejectedValue(new Error("registry unavailable"))

  try {
    await expect(Config.installDependencies(tmp.path)).rejects.toThrow("registry unavailable")
    expect(install).toHaveBeenCalledTimes(1)
  } finally {
    install.mockRestore()
  }
})
