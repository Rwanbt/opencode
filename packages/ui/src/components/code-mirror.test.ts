import { describe, expect, test } from "bun:test"
import { javascriptLanguage } from "@codemirror/lang-javascript"
import { highlightTree, classHighlighter } from "@lezer/highlight"

const css = await Bun.file(new URL("./code-mirror.css", import.meta.url)).text()

describe("CodeMirror CSP-safe highlighting", () => {
  test("emits literal token classes instead of runtime style rules", () => {
    const tokens = new Set<string>()
    const tree = javascriptLanguage.parser.parse("const answer = 42 // note")

    highlightTree(tree, classHighlighter, (_from, _to, classes) => {
      for (const token of classes.split(" ")) tokens.add(token)
    })

    expect(tokens).toEqual(new Set(["tok-keyword", "tok-variableName", "tok-definition", "tok-operator", "tok-number", "tok-comment"]))
  })

  test("statically styles every token class used by the sample", () => {
    for (const token of ["tok-keyword", "tok-variableName", "tok-operator", "tok-number", "tok-comment", "tok-heading"]) {
      expect(css).toContain(`.cm-opencode .${token}`)
    }
  })
})