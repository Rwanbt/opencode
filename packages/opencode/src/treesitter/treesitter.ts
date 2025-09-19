import { lazy } from "../util/lazy"

export namespace TreeSitter {
  const Parser = lazy(async () => {
    try {
      return NativeParser()
    } catch (e) {
      return WasmParser()
    }
  })

  const NativeParser = lazy(async () => {
    const { default: Parser } = await import("tree-sitter")
    return Parser
  })

  const WasmParser = lazy(async () => {
    const { default: Parser } = await import("web-tree-sitter")
    const { default: treeWasm } = await import("web-tree-sitter/tree-sitter.wasm" as string, {
      with: { type: "wasm" },
    })
    await Parser.init({
      locateFile() {
        return treeWasm
      },
    })
    return Parser
  })

  export async function parser() {
    const p = await Parser()
    const result = new p()
    return result
  }

  const Languages: Record<string, { native: () => any; wasm: () => any }> = {
    bash: {
      native: () => import("tree-sitter-bash"),
      wasm: () =>
        import("tree-sitter-bash/tree-sitter-bash.wasm" as string, {
          with: { type: "wasm" },
        }),
    },
    typescript: {
      native: () => import("tree-sitter-typescript"),
      wasm: () =>
        import("tree-sitter-typescript/tree-sitter-typescript.wasm" as string, {
          with: { type: "wasm" },
        }),
    },
  }

  const Extensions = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "typescript",
    ".jsx": "typescript",
    ".sh": "bash",
  }

  export async function language(extension: keyof typeof Extensions) {
    const language = Extensions[extension]
    if (!language) return undefined
    const { native, wasm } = Languages[language]
    try {
      const { language } = await native()
      return language
    } catch (e) {
      const { default: mod } = await wasm()
      const language = await WasmParser().then((p) => p.Language.load(mod))
      return language
    }
  }
}
