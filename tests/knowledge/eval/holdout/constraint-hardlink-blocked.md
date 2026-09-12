---
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Unifia contributors
unifia_schema: 1
unifia_id: "0190d2c0-7b00-7000-9000-000000000005"
unifia_type: "constraint"
unifia_lifecycle: "active"
unifia_created_at: "2026-08-29T00:00:00Z"
unifia_updated_at: "2026-08-29T00:00:00Z"
unifia_project_ref: "unifia"
unifia_supersedes: []
unifia_restrictions:
  remote_model: allow
  local_model: allow
unifia_tags:
  - "android"
  - "hardlink"
---

# Holdout constraint: Android policy forbids hardlinks on app data

SELinux on Android blocks the `link()` syscall against
`app_data_file`. Tools that try to create hardlinks during an
extraction step will abort. Run the project fixup script in a
sandbox before invoking the Gradle task.
