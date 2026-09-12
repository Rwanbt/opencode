<!-- SPDX-License-Identifier: MIT -->

---
id: 1039
title: Artifact manifest — what the renderer reads about the artifact
status: ACCEPTED
date: 2026-08-17
supersedes: null
related: [1035, 1036, 1037, 1038, 0004]
---

# ADR-1039: Artifact manifest — what the renderer reads about the artifact

## Context

The Design mode renders artifacts produced by an agent. The renderer
needs to know four things about an artifact before it can pick a
renderer: what *kind* of artifact it is (a full HTML page, a deck, a
React component), which *renderer* to instantiate, which *entry* file
inside the artifact bundle to load, and which *exports* the artifact
declares so a downstream consumer can pick a specific one.

These four pieces of metadata are not derived from the artifact's bytes
alone — the same bytes can legitimately be a "deck" (slide-shaped) or
a "html" (page-shaped) depending on the agent's intent. They are
declared by the agent at creation time and persisted with the artifact
so the renderer is deterministic across reads.

Open Design keeps a manifest in a sidecar JSON file next to the
artifact on disk. That works for a flat, file-system-driven store. It
does not work here: `ArtifactStore` (the `packages/artifact-runtime`
port, ADR-0004) is the single source of truth for an artifact's
identity, lineage, versions, provenance, and bytes. Adding a
sidecar file introduces a second storage location that can drift
from the store, and the parity mandate is to keep `ArtifactStore`
authoritative. The manifest lives in the store's existing
`metadata` field, serialised as a single JSON-encoded string, so the
storage surface is unchanged.

## Decision

### 1. Fields

Every artifact carries a manifest with exactly these fields:

| Field | Type | Value | Notes |
|---|---|---|---|
| `manifestVersion` | integer | `1` | The version of *this manifest format*, not the artifact's `version`. Bumping the manifest format is an avenant to this ADR. |
| `kind` | string, closed enum | one of the values in §2 | The artifact's content kind — what the agent meant the artifact to be. |
| `renderer` | string, closed enum | one of the values in §3 | The renderer to instantiate. The pair `(kind, renderer)` is validated against the matrix in §3.5. |
| `entry` | string | relative path inside the artifact bundle | The file the renderer mounts first. For `kind: "html"`, this is the HTML file. For `kind: "react-component"`, the entry module path. Must point to a file that exists in the bundle; a path that resolves to nothing is a manifest error. |
| `exports` | array of `{ name: string, path: string, kind: string }` | at least one entry | The exports an agent has chosen to surface. `name` is a free-form identifier the user sees in the artifact picker; `path` is a bundle-relative file path; `kind` is one of the §2 values and lets the picker filter by content kind. |

All five fields are required. A manifest missing any field is a
manifest error and is refused at read time, never silently filled
in.

### 2. Closed `kind` values

The `kind` field accepts exactly these values, and no others:

- `html` — a self-contained HTML page. The renderer wraps it in the
  artifact iframe (ADR-1035) with the iframe CSP (ADR-1036).
- `deck` — a multi-slide presentation. Renderer `deck-html` is the
  only renderer for this kind in v1; the deck format itself is HTML
  + CSS that the deck renderer interprets.
- `react-component` — a single React component module. The renderer
  imports it and mounts it into a fixture host page inside the
  artifact iframe, with the same CSP backstop.
- `markdown-document` — a long-form Markdown document. The renderer
  applies a sanitiser that strips raw HTML before passing the
  Markdown to a renderer, then mounts the result in the iframe.
- `svg` — a single SVG asset, treated as static media.
- `image` — a raster image (PNG, JPEG, WebP, GIF, AVIF).
- `video` — a video file (MP4, WebM, MOV).
- `audio` — an audio file (MP3, WAV, OGG, FLAC).

These values are **closed**. Adding a new value is an avenant to
this ADR; the renderer matrix in §3.5 grows in the same change.

### 3. Closed `renderer` values

The `renderer` field accepts exactly these values:

- `html` — the iframe-based renderer for `kind: "html"`.
- `deck-html` — the deck renderer for `kind: "deck"`. The deck
  format is HTML + CSS; the renderer interprets the deck manifest
  conventions inside the iframe.
- `react-component` — the React component renderer for
  `kind: "react-component"`.
- `markdown` — the Markdown renderer for `kind: "markdown-document"`.
  Always sanitised; never trusts raw HTML inside the Markdown
  source.
- `svg` — the static SVG renderer for `kind: "svg"`. The SVG is
  inlined into a fixture host page; `<script>` inside the SVG is
  removed before the SVG is mounted.
- `media` — the generic media renderer for `kind: "image"`,
  `"video"`, `"audio"`. The artifact is mounted via the
  appropriate HTML media element inside the iframe.

### 3.5. `kind` × `renderer` matrix

The pair `(kind, renderer)` must be one of:

| `kind` | Valid `renderer` values |
|---|---|
| `html` | `html` |
| `deck` | `deck-html` |
| `react-component` | `react-component` |
| `markdown-document` | `markdown` |
| `svg` | `svg` |
| `image` | `media` |
| `video` | `media` |
| `audio` | `media` |

Any other pair is a manifest error and is refused. There is no
fallback path — a `kind: "pdf"` with `renderer: "html"` is a bug
to surface, not silently coerced to `media`.

### 4. Storage

The manifest is stored as a single JSON-encoded string in
`ArtifactStore`'s existing `metadata` field, under the key
`unifia.manifest.v1`. Reading a manifest is:

```ts
const raw = version.metadata["unifia.manifest.v1"]
if (typeof raw !== "string") throw new ManifestError("absent")
const parsed = JSON.parse(raw) as unknown
const manifest = parseManifest(parsed)  // throws ManifestError on shape failure
```

`ArtifactStore` is not changed. The new key is the only addition.
No sidecar file. No second store. The `ArtifactStore` lineage,
versioning, and provenance are unchanged. This is a deliberate
divergence from Open Design, which keeps a sidecar `.design.json`
next to the artifact; the divergence is documented in §6 of this
ADR and is the explicit choice the parity program makes.

### 5. Migration policy

`manifestVersion` is an integer and is matched exactly:

- `manifestVersion === 1`: parsed against the v1 schema.
- Any other integer value, any string, a missing field, or a
  field of the wrong type: the manifest is **refused**. The
  artifact is still readable as bytes, but the renderer
  refuses to mount it; the user sees the inert text fallback
  for that artifact and a non-silent error in the workbench
  trace ("manifest version X is not supported; this workbench
  speaks version 1").
- No version inference, no "fall back to a sensible default",
  no compatibility shim. A future v2 manifest format is an
  avenant to this ADR and lands as a separate key
  (`unifia.manifest.v2`) read after v1 is not present; the v1
  read path is not modified.

The same "refused, never guessed" rule applies to the `kind`
and `renderer` enums: a kind or renderer outside the closed
list is a manifest error, not a coercion.

## Alternatives rejected

- **Open Design's sidecar `.design.json` file**: rejected. The
  parity program explicitly keeps `ArtifactStore` authoritative
  (runbook §2, "Lineage"). A sidecar file is a second store by
  any reasonable definition: it can be deleted, moved, edited
  independently of the artifact, and the two can drift. The
  metadata-key approach carries the same information in the
  same record as the bytes and is impossible to desync.
- **Encode the manifest as the artifact's bytes prefix (e.g.
  JSON header before the HTML body)**: rejected. The manifest
  is meant to be inspectable by the picker and the trace
  without parsing the bytes. The metadata field is the right
  place.
- **Add new `kind` values lazily as they come up in agent
  output**: rejected. The closed list is the point: the
  renderer matrix in §3.5 is the contract between the agent
  and the workbench, and ad-hoc additions silently add
  renderers that the workbench does not have. The closed
  list with explicit avenants keeps the matrix auditable.
- **Let the renderer fall back when the matrix is violated**
  (e.g. `kind: "pdf"` with `renderer: "html"` mounts as a
  plain HTML viewer of the bytes): rejected. The matrix
  violation is a bug; the right behaviour is to surface it
  so it gets fixed, not to paper over it.

## Consequences

- Every artifact in the Design mode has a v1 manifest. The
  manifest is stored on the artifact's metadata, parsed
  exactly once at mount, and validated against the closed
  enums in §2 and §3.
- A v1 schema bump is impossible by accident — the manifest
  is read by an exact-`manifestVersion` match, and an
  unknown version is refused, not coerced.
- A new renderable content kind is a deliberate change:
  adding `kind: "pdf"` requires a §3.5 update *and* a
  `renderer: "pdf"` entry, *and* the renderer
  implementation, all in one card.
- The divergence from Open Design's sidecar file is explicit
  and documented. If a future parity need requires reading
  Open-Design-imported sidecar manifests, a separate ADR
  handles the translation; this ADR does not.

## Rollback

Removing this ADR deletes the manifest contract. Renderers
fall back to "no manifest, render as inert text"; the iframe
introduced in ADR-1035 still mounts but with empty content.
`ArtifactStore` is unchanged and remains the source of truth
for the bytes. The closed enums in §2 and §3 are no longer
enforced; the picker shows the artifact without a kind or
renderer label.

## Implementation references

- `packages/artifact-runtime/src/manifest.ts` (P13) — the
  `parseManifest` function and the `ManifestError` class.
  Both are pure functions; the module has no I/O and is
  testable in isolation.
- `packages/artifact-runtime/src/index.ts` (P13) — the read
  path that calls `parseManifest` after reading the
  version's metadata. The read is unchanged in shape
  (still goes through the existing
  `getVersion(artifactId, version)` API).
- `packages/artifact-render/src/renderer-matrix.ts` (P13) —
  the kind × renderer matrix from §3.5, exported as a
  TypeScript const that fails closed at compile time when
  a new `kind` is added without its renderer entry.
- `packages/artifact-render/src/preview-frame.tsx` (P11) —
  the iframe mount that consumes the parsed manifest.
- `docs/adr/1035-untrusted-artifact-rendering.md` — the
  sandboxed iframe that hosts the rendered artifact.
- `docs/adr/1036-csp-artifact-frame.md` — the CSP that
  protects the iframe, applied to every kind that ends up
  in the iframe (i.e. everything except `image`, `video`,
  and `audio` which the `media` renderer handles with
  their own media element policies).
- `docs/adr/1037-artifact-bridge-protocol.md` — the
  `unifia:`-prefixed message contract the picker and
  snapshot bridges use to talk to the iframe; the manifest
  is the input that lets the renderer know which kinds of
  bridges to install.
- `docs/adr/1038-design-capabilities.md` — the
  `artifact.preview` and `artifact.render` capabilities
  that the renderer relies on to fetch the bytes.
