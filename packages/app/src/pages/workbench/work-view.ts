/* SPDX-License-Identifier: MIT */

// =============================================================================
// pages/workbench/work-view.ts — A5-03
//
// The Work surface's tab set, mirroring the v110 mockup's viewDefs
// (Overview/Tasks/Board/Timeline/Activity/Runs). Unlike Design's tab state
// (design-tabs.ts), this set is fixed and never opened/closed by the user —
// building the same open/close/activate machinery here would be an
// abstraction with no user action to drive it.
// =============================================================================

export type WorkView = "overview" | "tasks" | "board" | "timeline" | "activity" | "runs"

export const WORK_VIEWS: readonly WorkView[] = ["overview", "tasks", "board", "timeline", "activity", "runs"]
