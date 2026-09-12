#!/usr/bin/env bun
/* SPDX-License-Identifier: MIT */
import { stageSidecar } from "./utils"

// Entry point for the `prepackage` hook. Deliberately does nothing else: the
// version bump and icon copy live in `prepare.ts`, and `Script.version` carries
// the branch name on a feature branch — writing that into package.json produces
// an invalid semver that electron-builder rejects. Packaging must not depend on
// it just to get a sidecar.
await stageSidecar()
