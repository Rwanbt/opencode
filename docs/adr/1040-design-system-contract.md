<!-- SPDX-License-Identifier: MIT -->

---
id: 1040
title: Design system contract — `.unifia/workspace.json` is the authority, `DESIGN.md` is the content
status: ACCEPTED
date: 2026-08-17
supersedes: null
related: [1038, 0010, 0028]
---

# ADR-1040: Design system contract — `.unifia/workspace.json` is the authority, `DESIGN.md` is the content

## Context

The Design mode lets a user pick a design system for a project. The
picker needs three pieces of information per catalog: an identifier
(referrable from other files), a human-readable label (shown in the
picker UI), and a `source` URI that resolves to the catalog's
content. The labels and identifiers are project-owned; the *content*
of a catalog — color tokens, typography, spacing, components — is
the part that comes from a design system author, often imported.

Two storage surfaces are in play today:

- `.unifia/workspace.json` (declared in
  `work_design/WORKSPACE-MANIFEST.md`, current `version: 1`),
  which is the workspace-owned file that already lists the
  catalogs. This is the *authority* for the picker.
- `DESIGN.md`, a Markdown file used by Open Design's catalog
  imports. The file is nine sections long, each section
  describing one slice of the design system. The file is the
  *content* of a catalog, not its identity.

These two surfaces have to be reconciled. The reconciliation is
the same shape as the reconciliation between `ArtifactStore` and
the manifest in ADR-1039: one authority owns the record, the
content lives where the source puts it, and a missing or
malformed record is refused, not guessed.

## Decision

### 1. `.unifia/workspace.json` is the workspace authority

The workspace-owned file `.unifia/workspace.json` declares the
catalogs available in the project. The format is the v1 schema
already specified in `work_design/WORKSPACE-MANIFEST.md`:

- `version: 1` is the only accepted version.
- `designSystems: Array<{ id, name, version, source, tokens }>`
  is the catalog list. `id` is unique within the manifest;
  `source` is a non-empty URI; the other fields are
  user-visible.
- Unknown `version` values are rejected; the server returns
  `404` to `/v1/design-systems` (existing behaviour, confirmed
  by this ADR — see §3 below).
- The server-side route `GET /v1/design-systems` (capability
  `workspace.read` today, see ADR-1038 §"Open question") is the
  read API; the picker consumes it.

This file is the *only* place where a catalog's identity
(`id`), label (`name`), version (`version`), and `source` are
declared. A design system imported from Open Design does not
get a global id; the project's workspace manifest chooses
the id, the name, the version, and the source, and the imported
content lives at the source.

### 2. `DESIGN.md` is the content format

A catalog's content, when the source is a file, is a
`DESIGN.md` Markdown file. The file is structured as nine
numbered sections. The mapping between the Unifia nine themes
and the Open Design nine sections is fixed and is the only
allowed interpretation:

| # | Unifia theme (spec) | Open Design section name (linear-app example) |
|---|---|---|
| 1 | Couleur | "Color Palette & Roles" (section 2) |
| 2 | Typographie | "Typography Rules" (section 3) |
| 3 | Espacement | derived from "Layout Principles" (section 5) — the spacing subsection |
| 4 | Mise en page | "Layout Principles" (section 5) |
| 5 | Composants | "Component Stylings" (section 4) |
| 6 | Mouvement | derived from "Depth & Elevation" (section 6) — the motion / shadow subsection |
| 7 | Voix | derived from "Agent Prompt Guide" (section 9) — the voice subsection |
| 8 | Marque | derived from "Visual Theme & Atmosphere" (section 1) — the brand subsection |
| 9 | Anti-patterns | "Do's and Don'ts" (section 7) |

The mapping is fixed; an Open Design section that does not map
cleanly to one of the nine Unifia themes is *not* silently
dropped. The import (handled in P21) emits a warning for each
unmapped section, and the warning is recorded in the workbench
trace. A Unifia theme that has no source in the imported file
is recorded as an empty section in the imported content;
nothing is invented.

The mapping is the *only* place where a Unifia-side meaning is
attached to an Open Design file. The picker and the agent
consume the Unifia-side themes; the import is the only
component that knows about the Open Design side.

### 3. Absent manifest — 404, no fallback

The existing rule from `work_design/WORKSPACE-MANIFEST.md` is
confirmed: if `.unifia/workspace.json` is missing, malformed,
declares an unknown `version`, or has duplicate catalog ids,
the server returns `404` from `/v1/design-systems`. The picker
shows an empty state ("no design systems declared in this
workspace") and a link to the workspace manifest reference.

There is no bundled fallback, no global default, no
"auto-bootstrap from the host platform" path. The "no global,
bundled, or inferred fallback" sentence in
`WORKSPACE-MANIFEST.md` is the rule; this ADR does not
reinterpret it.

### 4. Attribution: imported catalogs

A catalog whose content comes from an Open Design import
(handled in P21) is Apache-2.0 upstream. The import does not
happen by default: a catalog's `source` is whatever the
workspace manifest declares, and an import is an explicit
addition the user makes. When an import lands:

- An entry is added to `THIRD_PARTY_NOTICES.md` at the
  workspace root, listing the imported catalog's name,
  upstream URL, license (Apache-2.0), and a one-line summary
  of what was imported.
- The import preserves the upstream section names (the
  Open Design column in §2's table) and is annotated with
  the Unifia-side theme name. Both names are visible in the
  picker; the user sees what they imported, not an opaque
  rename.
- The P21 card is the work that implements the import; this
  ADR is the spec it implements against.

### 5. No second authority

The picker never reads from a place that is not
`.unifia/workspace.json`. The agent never reads from a place
that is not the catalog's `source`. The import path is the
only transformation, and it lands in the workspace manifest
under a new `id` chosen by the user (or by an opinionated
default if the user accepts it).

This is the same shape as ADR-1039: one authority for the
record (the workspace manifest for catalogs, the
`ArtifactStore` metadata for manifests), the content lives
at the source, and a missing record is refused.

## Alternatives rejected

- **Store the design-system content inside `.unifia/workspace.json`**
  (i.e. inline the tokens): rejected. The manifest is the
  *record* of what is available; the content is the part that
  gets big, gets edited independently, and gets imported.
  Inlining the content makes the manifest the bottleneck of
  every diff and conflates the two lifecycles.
- **Read `DESIGN.md` from a global, bundled path**: rejected.
  The existing rule ("no global, bundled, or inferred
  fallback") is in force. A global path is exactly the kind
  of silent fallback this ADR closes.
- **Adopt the Open Design section names as the Unifia section
  names**: rejected at the contract level, accepted at the
  import level. The Unifia themes ("Couleur", "Typographie",
  …) are the product-side vocabulary; the import (§2) is
  the bridge that maps one to the other. Letting the Open
  Design names be the canonical ones would couple the
  picker UI to a vocabulary the agent and the user do not
  own.
- **Warn-and-skip for unmapped Open Design sections**: rejected.
  Silently dropping a section is the same shape as silently
  filling in a missing field, and §3 of ADR-1039 already
  rejected that for manifests. The trace warning is the
  right grain: visible, attributable, fixable.

## Consequences

- The picker reads one file, the workspace manifest, and the
  picker UI is decoupled from the catalog's content format.
- A user who wants to use a design system that is not in
  the manifest declares it (or runs the P21 import).
- The Unifia-side theme vocabulary is stable; the Open
  Design-side section names can change upstream without
  breaking the picker.
- `THIRD_PARTY_NOTICES.md` is the only place an Apache-2.0
  attribution is recorded. The absence of a notice is the
  signal that an imported catalog is not yet present in
  the workspace.

## Rollback

Removing this ADR deletes the import path. The workspace
manifest continues to be authoritative; the
`DESIGN.md`-shaped content is no longer recognized. A
catalog whose `source` points at a `DESIGN.md` is still
readable as bytes, but the picker treats it as
"unrecognised content" and the user sees the raw Markdown.
The Unifia theme vocabulary is no longer the product-side
language; the picker reverts to displaying the file
content as-is.

## Implementation references

- `packages/contracts/src/workspace-manifest.ts` (P21) — the
  TypeScript type for `.unifia/workspace.json` v1, and the
  `migrateWorkspaceManifest` function that future-proofs
  the `version` field.
- `packages/workbench-server/src/design-systems.ts` (P21) —
  the server route that reads the manifest and returns the
  validated catalog list. The 404 path lives here.
- `packages/workbench-shell/src/design-system.ts` — the
  picker that consumes the validated catalog list and
  renders the rows; this ADR confirms its current shape
  (sort by `name` then `version`) is the contract.
- `packages/workbench-server/src/design-system-import.ts`
  (P21) — the Open Design import, the only place that
  knows the §2 mapping table.
- `THIRD_PARTY_NOTICES.md` (P21) — the Apache-2.0
  attribution file that an import appends to.
- `work_design/WORKSPACE-MANIFEST.md` — the pre-existing
  v1 schema that this ADR confirms and references; the
  file is not modified.
- `docs/adr/1038-design-capabilities.md` — the
  `designsystem.read` capability and the
  `workspace.read` alias this ADR inherits.
- `docs/adr/1039-artifact-manifest.md` — the
  artifact-side analogue: one authority for the record,
  the content at the source, refused-not-guessed.
