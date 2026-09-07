/* SPDX-License-Identifier: MIT */
import { afterEach, beforeEach, expect, test } from "bun:test"
import path from "path"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

beforeEach(async () => {
  await Config.invalidate(true)
})

afterEach(async () => {
  await Instance.disposeAll()
  await Config.invalidate(true)
})

test("preserves unknown root keys written by a newer config version", async () => {
  await using tmp = await tmpdir({
    init: async (directory) => {
      await Filesystem.write(
        path.join(directory, "unifia.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          model: "test/model",
          future_option: { enabled: true },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect((config as Record<string, unknown>).future_option).toEqual({ enabled: true })

      await Config.update(config)

      const writtenConfig = await Filesystem.readJson(path.join(tmp.path, "config.json"))
      expect(writtenConfig.future_option).toEqual({ enabled: true })
    },
  })
})
