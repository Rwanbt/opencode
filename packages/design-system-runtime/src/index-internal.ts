/* SPDX-License-Identifier: MIT */

// Internal barrel to keep the public `index.ts` re-exports tidy. This file
// exists so that the public surface is a single list and the test file
// can import directly from the module under test.
//
// WHY no re-export of `./import-catalog.js` here: the importer walks the
// filesystem and lives behind the `@unifia/design-system-runtime/node`
// sub-export. Pulling it into the main barrel drags `node:fs/promises`
// into the web UI bundle and breaks `vite build` because the
// `__vite-browser-external` stub does not expose `readFile`.
export * from "./parse-design-md.js"
