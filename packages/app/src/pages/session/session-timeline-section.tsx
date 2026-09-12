/* SPDX-License-Identifier: MIT */

/**
 * Vague 3 of P1-5 split (ADR-037): STAGED.
 *
 * The MessageTimeline JSX block in `session.tsx` carries ~15 strongly-
 * typed callbacks (UserActions, scroll state machines, history window
 * accessors). Wrapping it through an `unknown`-typed facade loses the
 * type safety without buying enough structural separation to be
 * worth the change — the orchestrator would still own the callback
 * closures, the wrapper would just add an indirection.
 *
 * Vague 3 stays PROPOSED. The next viable extraction here requires
 * either:
 *   a) exporting the MessageTimeline prop interface from
 *      message-timeline.tsx and re-importing it for strong typing,
 *   b) hoisting the MessageTimeline JSX into a function-component
 *      defined inside session.tsx (saves the inline JSX lines but
 *      keeps the orchestrator long).
 *
 * Either way the change is in the order of 30-50 LOC saved from
 * session.tsx; the real budget win is Vague 5 (layout.tsx split,
 * 700+ LOC saved) and Vague 4 (composer + sidebar section).
 */
export const SESSION_TIMELINE_SECTION_STAGED = true
