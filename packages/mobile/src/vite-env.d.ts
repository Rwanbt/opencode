/* SPDX-License-Identifier: MIT */

// Mobile is a Vite app (vite.config.ts) but never declared Vite's ambient
// types, so asset imports resolved at build time had no declaration at
// typecheck time. Importing `@unifia/ui/logo` — which imports the brand SVGs —
// surfaced it as TS2307 on files outside this package.
//
// Referenced here rather than added to `types` in tsconfig.json: setting that
// field would replace the default "every @types package" behaviour, silently
// dropping the ambient types this package currently gets for free. This is also
// the pattern packages/app already uses (src/sst-env.d.ts).
/// <reference types="vite/client" />
