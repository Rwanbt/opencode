---
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Unifia contributors
unifia_schema: 1
unifia_id: "0190d2c0-7b00-7000-8000-00000000000b"
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
  - "device:adreno-6xx"
  - "quant:k-quants"
---

# Failure: K-quants crash on Adreno 6xx OpenCL

Running Q4_K_M or Q5_K_M models on the Adreno 6xx GPU through OpenCL
crashes llama-server with exit 134 (`SET_ROWS`).

Fix: route K-quants to CPU. OpenCL is reserved for Q4_0 / Q8_0 on
Adreno 730+ (SM8450+).

File: `packages/mobile/src/model-catalog.ts`.
