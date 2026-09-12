---
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Unifia contributors
unifia_schema: 1
unifia_id: "0190d2c0-7b00-7000-9000-00000000000b"
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
  - "gpu:adreno-6xx"
  - "quant:k"
---

# Holdout failure: K-family quantisation crashes mid-tier Adreno

Quantised models in the K family (Q4_K_M, Q5_K_M) crash the inference
server when executed through OpenCL on Adreno 6xx GPUs.

Resolution: keep the K family on CPU. Reserve OpenCL for Q4_0 and
Q8_0 on Adreno 730 and newer only.

File: `packages/mobile/src/model-catalog.ts`.
