---
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Unifia contributors
unifia_schema: 1
unifia_id: "0190d2c0-7b00-7000-8000-000000000002"
unifia_type: "failure"
unifia_lifecycle: "active"
unifia_created_at: "2026-08-29T00:00:00Z"
unifia_updated_at: "2026-08-29T00:00:00Z"
unifia_project_ref: "unifia"
unifia_supersedes: []
unifia_restrictions:
  remote_model: allow
  local_model: allow
unifia_tags:
  - "build:desktop"
  - "ts:recompile"
---

# Failure: desktop sidecar stale after TypeScript edit

The Tauri desktop build does not recompile `unifia-cli.exe`
automatically. The app keeps running the previous version of the CLI
without any error.

Fix: run `bun run build --single --baseline` inside `packages/unifia`,
then copy the binary into the desktop `sidecars/` directory.

File: `packages/desktop/src-tauri/src/server.rs`.
