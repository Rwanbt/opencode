import { registerCustomTheme, type ThemeRegistrationResolved } from "@pierre/diffs"

// WHY this lives here (not just in context/marked.tsx, where it originated):
// the Shiki worker pool used for the read-only file viewer (worker.ts in this
// same directory) resolves themes by NAME on the main thread before handing
// them to the worker — it never falls back to a default if "OpenCode" isn't
// registered yet. The registration used to be a side effect of importing
// context/marked.tsx (markdown rendering), which isn't guaranteed to have
// run before the file viewer's worker pool initializes — e.g. opening a file
// before any assistant message has rendered. That left every file-viewer
// syntax-highlighting span uncolored (present and correctly tokenized, but a
// single uniform foreground) — confirmed live via DevTools: 530 spans, empty
// class list, identical computed color across keywords/strings/identifiers.
// Calling this from worker.ts too guarantees registration happens before the
// pool ever needs it, regardless of whether markdown has rendered.
export function registerOpenCodeTheme() {
  registerCustomTheme("OpenCode", () => {
    return Promise.resolve({
      name: "OpenCode",
      colors: {
        "editor.background": "var(--color-background-stronger)",
        "editor.foreground": "var(--text-base)",
        "gitDecoration.addedResourceForeground": "var(--syntax-diff-add)",
        "gitDecoration.deletedResourceForeground": "var(--syntax-diff-delete)",
      },
      tokenColors: [
        {
          scope: ["comment", "punctuation.definition.comment", "string.comment"],
          settings: {
            foreground: "var(--syntax-comment)",
          },
        },
        {
          scope: ["entity.other.attribute-name"],
          settings: {
            foreground: "var(--syntax-property)", // maybe attribute
          },
        },
        {
          scope: ["constant", "entity.name.constant", "variable.other.constant", "variable.language", "entity"],
          settings: {
            foreground: "var(--syntax-constant)",
          },
        },
        {
          scope: ["entity.name", "meta.export.default", "meta.definition.variable"],
          settings: {
            foreground: "var(--syntax-type)",
          },
        },
        {
          scope: ["meta.object.member"],
          settings: {
            foreground: "var(--syntax-primitive)",
          },
        },
        {
          scope: [
            "variable.parameter.function",
            "meta.jsx.children",
            "meta.block",
            "meta.tag.attributes",
            "entity.name.constant",
            "meta.embedded.expression",
            "meta.template.expression",
            "string.other.begin.yaml",
            "string.other.end.yaml",
          ],
          settings: {
            foreground: "var(--syntax-punctuation)",
          },
        },
        {
          scope: ["entity.name.function", "support.type.primitive"],
          settings: {
            foreground: "var(--syntax-primitive)",
          },
        },
        {
          scope: ["support.class.component"],
          settings: {
            foreground: "var(--syntax-type)",
          },
        },
        {
          scope: "keyword",
          settings: {
            foreground: "var(--syntax-keyword)",
          },
        },
        {
          scope: [
            "keyword.operator",
            "storage.type.function.arrow",
            "punctuation.separator.key-value.css",
            "entity.name.tag.yaml",
            "punctuation.separator.key-value.mapping.yaml",
          ],
          settings: {
            foreground: "var(--syntax-operator)",
          },
        },
        {
          scope: ["storage", "storage.type"],
          settings: {
            foreground: "var(--syntax-keyword)",
          },
        },
        {
          scope: ["storage.modifier.package", "storage.modifier.import", "storage.type.java"],
          settings: {
            foreground: "var(--syntax-primitive)",
          },
        },
        {
          scope: [
            "string",
            "punctuation.definition.string",
            "string punctuation.section.embedded source",
            "entity.name.tag",
          ],
          settings: {
            foreground: "var(--syntax-string)",
          },
        },
        {
          scope: "support",
          settings: {
            foreground: "var(--syntax-primitive)",
          },
        },
        {
          scope: ["support.type.object.module", "variable.other.object", "support.type.property-name.css"],
          settings: {
            foreground: "var(--syntax-object)",
          },
        },
        {
          scope: "meta.property-name",
          settings: {
            foreground: "var(--syntax-property)",
          },
        },
        {
          scope: "variable",
          settings: {
            foreground: "var(--syntax-variable)",
          },
        },
        {
          scope: "variable.other",
          settings: {
            foreground: "var(--syntax-variable)",
          },
        },
        {
          scope: [
            "invalid.broken",
            "invalid.illegal",
            "invalid.unimplemented",
            "invalid.deprecated",
            "message.error",
            "markup.deleted",
            "meta.diff.header.from-file",
            "punctuation.definition.deleted",
            "brackethighlighter.unmatched",
            "token.error-token",
          ],
          settings: {
            foreground: "var(--syntax-critical)",
          },
        },
        {
          scope: "carriage-return",
          settings: {
            foreground: "var(--syntax-keyword)",
          },
        },
        {
          scope: "string source",
          settings: {
            foreground: "var(--syntax-variable)",
          },
        },
        {
          scope: "string variable",
          settings: {
            foreground: "var(--syntax-constant)",
          },
        },
        {
          scope: [
            "source.regexp",
            "string.regexp",
            "string.regexp.character-class",
            "string.regexp constant.character.escape",
            "string.regexp source.ruby.embedded",
            "string.regexp string.regexp.arbitrary-repitition",
            "string.regexp constant.character.escape",
          ],
          settings: {
            foreground: "var(--syntax-regexp)",
          },
        },
        {
          scope: "support.constant",
          settings: {
            foreground: "var(--syntax-primitive)",
          },
        },
        {
          scope: "support.variable",
          settings: {
            foreground: "var(--syntax-variable)",
          },
        },
        {
          scope: "meta.module-reference",
          settings: {
            foreground: "var(--syntax-info)",
          },
        },
        {
          scope: "punctuation.definition.list.begin.markdown",
          settings: {
            foreground: "var(--syntax-punctuation)",
          },
        },
        {
          scope: ["markup.heading", "markup.heading entity.name"],
          settings: {
            fontStyle: "bold",
            foreground: "var(--syntax-info)",
          },
        },
        {
          scope: "markup.quote",
          settings: {
            foreground: "var(--syntax-info)",
          },
        },
        {
          scope: "markup.italic",
          settings: {
            fontStyle: "italic",
          },
        },
        {
          scope: "markup.bold",
          settings: {
            fontStyle: "bold",
            foreground: "var(--text-strong)",
          },
        },
        {
          scope: [
            "markup.raw",
            "markup.inserted",
            "meta.diff.header.to-file",
            "punctuation.definition.inserted",
            "markup.changed",
            "punctuation.definition.changed",
            "markup.ignored",
            "markup.untracked",
          ],
          settings: {
            foreground: "var(--text-base)",
          },
        },
        {
          scope: "meta.diff.range",
          settings: {
            fontStyle: "bold",
            foreground: "var(--syntax-unknown)",
          },
        },
        {
          scope: "meta.diff.header",
          settings: {
            foreground: "var(--syntax-unknown)",
          },
        },
        {
          scope: "meta.separator",
          settings: {
            fontStyle: "bold",
            foreground: "var(--syntax-unknown)",
          },
        },
        {
          scope: "meta.output",
          settings: {
            foreground: "var(--syntax-unknown)",
          },
        },
        {
          scope: "meta.export.default",
          settings: {
            foreground: "var(--syntax-unknown)",
          },
        },
        {
          scope: [
            "brackethighlighter.tag",
            "brackethighlighter.curly",
            "brackethighlighter.round",
            "brackethighlighter.square",
            "brackethighlighter.angle",
            "brackethighlighter.quote",
          ],
          settings: {
            foreground: "var(--syntax-unknown)",
          },
        },
        {
          scope: ["constant.other.reference.link", "string.other.link"],
          settings: {
            fontStyle: "underline",
            foreground: "var(--syntax-unknown)",
          },
        },
        {
          scope: "token.info-token",
          settings: {
            foreground: "var(--syntax-info)",
          },
        },
        {
          scope: "token.warn-token",
          settings: {
            foreground: "var(--syntax-warning)",
          },
        },
        {
          scope: "token.debug-token",
          settings: {
            foreground: "var(--syntax-info)",
          },
        },
      ],
      semanticTokenColors: {
        comment: "var(--syntax-comment)",
        string: "var(--syntax-string)",
        number: "var(--syntax-constant)",
        regexp: "var(--syntax-regexp)",
        keyword: "var(--syntax-keyword)",
        variable: "var(--syntax-variable)",
        parameter: "var(--syntax-variable)",
        property: "var(--syntax-property)",
        function: "var(--syntax-primitive)",
        method: "var(--syntax-primitive)",
        type: "var(--syntax-type)",
        class: "var(--syntax-type)",
        namespace: "var(--syntax-type)",
        enumMember: "var(--syntax-primitive)",
        "variable.constant": "var(--syntax-constant)",
        "variable.defaultLibrary": "var(--syntax-unknown)",
      },
    } as unknown as ThemeRegistrationResolved)
  })
}
