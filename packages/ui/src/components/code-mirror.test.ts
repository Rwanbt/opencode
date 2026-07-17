import { describe, expect, test } from "bun:test"
import { javascriptLanguage } from "@codemirror/lang-javascript"
import { highlightTree, classHighlighter, tagHighlighter, tags } from "@lezer/highlight"

const css = await Bun.file(new URL("./code-mirror.css", import.meta.url)).text()

const functionHighlighter = tagHighlighter([
  { tag: tags.function(tags.variableName), class: "tok-function" },
  { tag: tags.function(tags.propertyName), class: "tok-function" },
])

function highlightAll(source: string) {
  const tokens = new Set<string>()
  const tree = javascriptLanguage.parser.parse(source)
  for (const highlighter of [classHighlighter, functionHighlighter]) {
    highlightTree(tree, highlighter, (_from, _to, classes) => {
      for (const token of classes.split(" ")) tokens.add(token)
    })
  }
  return tokens
}

describe("CodeMirror CSP-safe highlighting", () => {
  test("emits literal token classes instead of runtime style rules", () => {
    const tokens = highlightAll("const answer = 42 // note")

    expect(tokens).toEqual(new Set(["tok-keyword", "tok-variableName", "tok-definition", "tok-operator", "tok-number", "tok-comment"]))
  })

  test("statically styles every token class used by the sample", () => {
    for (const token of ["tok-keyword", "tok-variableName", "tok-operator", "tok-number", "tok-comment", "tok-heading"]) {
      expect(css).toContain(`.cm-opencode .${token}`)
    }
  })

  test("function calls and declarations get a distinct tok-function class, matching the read-only viewer's color", () => {
    const tokens = highlightAll("function greet(name) { return name }\ngreet(hello())\nobj.method()")

    expect(tokens.has("tok-function")).toBe(true)
    expect(css).toContain(".cm-opencode .tok-function")
  })
})