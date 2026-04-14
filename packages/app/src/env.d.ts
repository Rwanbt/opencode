import "solid-js"

interface ImportMetaEnv {
  readonly VITE_OPENCODE_SERVER_HOST: string
  readonly VITE_OPENCODE_SERVER_PORT: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module "solid-js" {
  namespace JSX {
    interface Directives {
      sortable: true
    }
  }
}

declare module "*.wasm?url" {
  const url: string
  export default url
}

declare module "ghostty-web/ghostty-vt.wasm?url" {
  const url: string
  export default url
}
