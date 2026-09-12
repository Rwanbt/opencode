<!-- SPDX-License-Identifier: MIT -->

# Workspace manifest — Design System authority

The Work/Design Design System authority is the workspace-owned file
`.unifia/workspace.json`. There is no global, bundled, or inferred fallback.

The persisted format is versioned and currently accepts `version: 1`:

```json
{
  "version": 1,
  "designSystems": [
    {
      "id": "unifia-system",
      "name": "Unifia",
      "version": "1.0.0",
      "source": "workspace://unifia-system",
      "tokens": {
        "colors": { "primary": "#ffffff" },
        "spacing": { "gutter": 24 },
        "typography": { "body": "Inter" }
      }
    }
  ]
}
```

The manifest may declare multiple catalogs. Catalog IDs must be unique, every
catalog must carry a non-empty source, and unknown manifest versions are
rejected rather than silently interpreted. The server exposes the validated
catalogs through `GET /v1/design-systems?workspaceId=...`; a missing manifest
returns `404`.
