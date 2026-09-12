// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
//
// Original work. No upstream derivation.

import os from "node:os"
import path from "node:path"
import { xdgCache, xdgConfig, xdgData, xdgState } from "xdg-basedir"

const app = "unifia"
const data = path.join(xdgData!, app)
const cache = path.join(xdgCache!, app)

export namespace Global {
  export const Path = {
    get home() {
      return process.env.UNIFIA_TEST_HOME || os.homedir()
    },
    data,
    bin: path.join(cache, "bin"),
    log: path.join(data, "log"),
    cache,
    config: path.join(xdgConfig!, app),
    state: path.join(xdgState!, app),
  }
}
