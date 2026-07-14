import { describe, expect, test } from "bun:test"
import type { Agent } from "../../types/sdk-shim"
import { normalizeAgentList, visibleAgents } from "./utils"

const agent = (name = "build") =>
  ({
    name,
    mode: "primary",
    permission: {},
    options: {},
  }) as unknown as Agent

describe("normalizeAgentList", () => {
  test("keeps array payloads", () => {
    expect(normalizeAgentList([agent("build"), agent("docs")])).toEqual([agent("build"), agent("docs")])
  })

  test("wraps a single agent payload", () => {
    expect(normalizeAgentList(agent("docs"))).toEqual([agent("docs")])
  })

  test("extracts agents from keyed objects", () => {
    expect(
      normalizeAgentList({
        build: agent("build"),
        docs: agent("docs"),
      }),
    ).toEqual([agent("build"), agent("docs")])
  })

  test("drops invalid payloads", () => {
    expect(normalizeAgentList({ name: "AbortError" })).toEqual([])
    expect(normalizeAgentList([{ name: "build" }, agent("docs")])).toEqual([agent("docs")])
  })
  test("filters app-hidden agents but keeps legacy fields visible by default", () => {
    expect(visibleAgents([agent("build"), { ...agent("auto"), app_hidden: true }, { ...agent("cloud-lean"), cli_hidden: true }, { ...agent("worker"), mode: "subagent" }])).toEqual([agent("build"), { ...agent("cloud-lean"), cli_hidden: true }])
  })

  test("orders primary agents for the app", () => {
    expect(visibleAgents([agent("auto"), agent("build"), agent("debate"), agent("plan"), agent("chat")]).map((item) => item.name)).toEqual([
      "chat",
      "plan",
      "debate",
      "build",
      "auto",
    ])
  })
})
