import { describe, expect, test, beforeEach } from "bun:test"
import type { FileContent } from "../../types/sdk-shim"
import {
  approxBytes,
  evictContentLru,
  resetFileContentLru,
  setFileContentBytes,
  removeFileContentBytes,
  touchFileContent,
  getFileContentBytesTotal,
  getFileContentEntryCount,
  hasFileContent,
} from "./content-cache"

// The cache is module-level state — isolate every test.
beforeEach(() => resetFileContentLru())

function content(part: Partial<FileContent> = {}): FileContent {
  return { content: "", ...part } as FileContent
}

describe("approxBytes", () => {
  test("doubles the raw content length", () => {
    expect(approxBytes(content({ content: "hello" }))).toBe(10)
  })

  test("adds the diff length", () => {
    expect(approxBytes(content({ content: "ab", diff: "xyz" }))).toBe((2 + 3) * 2)
  })

  test("adds patch hunk line lengths", () => {
    const c = content({
      content: "a",
      patch: { hunks: [{ lines: ["xx", "yyy"] }] } as unknown as FileContent["patch"],
    })
    // (1 content + 0 diff + (2 + 3) patch) * 2
    expect(approxBytes(c)).toBe((1 + 5) * 2)
  })
})

describe("byte/entry bookkeeping", () => {
  test("set tracks total bytes and entry count", () => {
    setFileContentBytes("a", 100)
    setFileContentBytes("b", 50)
    expect(getFileContentEntryCount()).toBe(2)
    expect(getFileContentBytesTotal()).toBe(150)
    expect(hasFileContent("a")).toBe(true)
    expect(hasFileContent("z")).toBe(false)
  })

  test("re-setting a path replaces its byte contribution", () => {
    setFileContentBytes("a", 100)
    setFileContentBytes("a", 30)
    expect(getFileContentEntryCount()).toBe(1)
    expect(getFileContentBytesTotal()).toBe(30)
  })

  test("remove decrements total and count", () => {
    setFileContentBytes("a", 100)
    setFileContentBytes("b", 50)
    removeFileContentBytes("a")
    expect(getFileContentEntryCount()).toBe(1)
    expect(getFileContentBytesTotal()).toBe(50)
    expect(hasFileContent("a")).toBe(false)
  })

  test("remove of an unknown path is a no-op", () => {
    setFileContentBytes("a", 100)
    removeFileContentBytes("missing")
    expect(getFileContentBytesTotal()).toBe(100)
  })

  test("touch with explicit bytes updates the total", () => {
    setFileContentBytes("a", 100)
    touchFileContent("a", 250)
    expect(getFileContentBytesTotal()).toBe(250)
  })

  test("reset clears everything", () => {
    setFileContentBytes("a", 100)
    resetFileContentLru()
    expect(getFileContentEntryCount()).toBe(0)
    expect(getFileContentBytesTotal()).toBe(0)
  })
})

describe("evictContentLru", () => {
  test("evicts the oldest entries once the count cap is exceeded", () => {
    for (let i = 0; i < 41; i++) setFileContentBytes(`p${i}`, 10)
    const evicted: string[] = []
    evictContentLru(undefined, (path) => evicted.push(path))

    expect(getFileContentEntryCount()).toBe(40)
    expect(evicted).toEqual(["p0"]) // oldest inserted goes first
    expect(hasFileContent("p0")).toBe(false)
    expect(hasFileContent("p40")).toBe(true)
  })

  test("evicts on the byte cap even with a single entry", () => {
    setFileContentBytes("big", 21 * 1024 * 1024)
    const evicted: string[] = []
    evictContentLru(undefined, (path) => evicted.push(path))

    expect(evicted).toEqual(["big"])
    expect(getFileContentEntryCount()).toBe(0)
  })

  test("never evicts paths in the keep set", () => {
    for (let i = 0; i < 41; i++) setFileContentBytes(`p${i}`, 10)
    const evicted: string[] = []
    // Keep the oldest entry; eviction must skip it and drop the next one.
    evictContentLru(new Set(["p0"]), (path) => evicted.push(path))

    expect(hasFileContent("p0")).toBe(true)
    expect(evicted).toEqual(["p1"])
    expect(getFileContentEntryCount()).toBe(40)
  })

  test("stops without evicting when everything fits", () => {
    setFileContentBytes("a", 10)
    const evicted: string[] = []
    evictContentLru(undefined, (path) => evicted.push(path))
    expect(evicted).toEqual([])
    expect(getFileContentEntryCount()).toBe(1)
  })
})
