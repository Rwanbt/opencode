/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { WORK_VIEWS } from "./work-view"

describe("WORK_VIEWS — the fixed set mirrors the v110 mockup's viewDefs", () => {
  test("has exactly the six mockup views, in the mockup's own order", () => {
    expect(WORK_VIEWS).toEqual(["overview", "tasks", "board", "timeline", "activity", "runs"])
  })
})
