import * as DefsA from "./server-defs-a"
import * as DefsB from "./server-defs-b"
import * as DefsC from "./server-defs-c"
import type { Info as InfoType, Handle as HandleType } from "./server-shared"

// Registry of language-server definitions. The per-language Info objects
// live in ./server-defs-{a,b,c}.ts (split to stay under the size budget);
// they are re-bound here so LSPServer.<Name> and Object.values(LSPServer)
// (the enumeration in ./index.ts) keep working unchanged.
export namespace LSPServer {
  export type Info = InfoType
  export type Handle = HandleType

  export const Deno = DefsA.Deno
  export const Typescript = DefsA.Typescript
  export const Vue = DefsA.Vue
  export const ESLint = DefsA.ESLint
  export const Oxlint = DefsA.Oxlint
  export const Biome = DefsA.Biome
  export const Gopls = DefsA.Gopls
  export const Rubocop = DefsA.Rubocop
  export const Ty = DefsA.Ty
  export const Pyright = DefsA.Pyright
  export const ElixirLS = DefsA.ElixirLS
  export const Zls = DefsA.Zls
  export const CSharp = DefsB.CSharp
  export const FSharp = DefsB.FSharp
  export const SourceKit = DefsB.SourceKit
  export const RustAnalyzer = DefsB.RustAnalyzer
  export const Clangd = DefsB.Clangd
  export const Svelte = DefsB.Svelte
  export const Astro = DefsB.Astro
  export const JDTLS = DefsB.JDTLS
  export const KotlinLS = DefsB.KotlinLS
  export const YamlLS = DefsB.YamlLS
  export const LuaLS = DefsB.LuaLS
  export const PHPIntelephense = DefsC.PHPIntelephense
  export const Prisma = DefsC.Prisma
  export const Dart = DefsC.Dart
  export const Ocaml = DefsC.Ocaml
  export const BashLS = DefsC.BashLS
  export const TerraformLS = DefsC.TerraformLS
  export const TexLab = DefsC.TexLab
  export const DockerfileLS = DefsC.DockerfileLS
  export const Gleam = DefsC.Gleam
  export const Clojure = DefsC.Clojure
  export const Nixd = DefsC.Nixd
  export const Tinymist = DefsC.Tinymist
  export const HLS = DefsC.HLS
  export const JuliaLS = DefsC.JuliaLS
}
