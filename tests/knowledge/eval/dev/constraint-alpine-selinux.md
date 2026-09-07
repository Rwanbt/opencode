---
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Unifia contributors
unifia_schema: 1
unifia_id: "0190d2c0-7b00-7000-8000-000000000005"
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
  - "device:android"
  - "selinux"
  - "link"
---

# Constraint: SELinux blocks `link()` on Android `app_data_file`

When extracting the Alpine rootfs inside the Android build pipeline,
`tar` aborts because SELinux denies the `link()` syscall on
`app_data_file`.

Fix: run `fix_hardlinks.py` via WSL before invoking Gradle.
