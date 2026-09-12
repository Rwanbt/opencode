/* SPDX-License-Identifier: MIT */

/**
 * The Unifia shell's modes and the Work V1 surface — Plan V3 §20.
 *
 * These lists exist as data rather than as headings in a document so that
 * "Work V1 is done" is a statement something can disagree with. §20 names
 * eleven functions; a shell that ships nine of them and a roadmap for the rest
 * reads identically in prose.
 */

/** The four destinations of the §20 navigation. */
export const SHELL_MODES = ["code", "work", "design", "automate"] as const
export type ShellMode = (typeof SHELL_MODES)[number]

/** The eleven Work V1 functions of §20. */
export const WORK_V1_FUNCTIONS = [
  "workspace-switcher",
  "session-chat",
  "files",
  "search",
  "artifacts",
  "documents",
  "trace",
  "approvals",
  "activity-log",
  "capability-picker",
  "export",
] as const
export type WorkFunction = (typeof WORK_V1_FUNCTIONS)[number]

/**
 * Functions that only read. The rest mutate, and the read-only projection §20
 * asks for on mobile is exactly this set — derived here rather than restated,
 * so the two cannot drift.
 */
export const READ_ONLY_FUNCTIONS: readonly WorkFunction[] = [
  "workspace-switcher",
  "session-chat",
  "files",
  "search",
  "artifacts",
  "documents",
  "trace",
  "activity-log",
]

export const isReadOnly = (fn: WorkFunction): boolean => READ_ONLY_FUNCTIONS.includes(fn)

/**
 * Actions whose effect cannot be undone by the shell, so §20's "les actions
 * destructives ont un preview" applies to them.
 */
export const DESTRUCTIVE_ACTIONS = ["artifact.delete", "artifact.overwrite", "session.delete", "workspace.delete", "export.publish"] as const
export type DestructiveAction = (typeof DESTRUCTIVE_ACTIONS)[number]

export const isDestructive = (action: string): action is DestructiveAction => (DESTRUCTIVE_ACTIONS as readonly string[]).includes(action)
