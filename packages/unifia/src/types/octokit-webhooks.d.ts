/* SPDX-License-Identifier: MIT */
declare module "@octokit/webhooks-types" {
  export type IssueCommentEvent = import("../../../../node_modules/@octokit/webhooks-types/schema").IssueCommentEvent
  export type IssuesEvent = import("../../../../node_modules/@octokit/webhooks-types/schema").IssuesEvent
  export type PullRequestReviewCommentEvent = import("../../../../node_modules/@octokit/webhooks-types/schema").PullRequestReviewCommentEvent
  export type WorkflowDispatchEvent = import("../../../../node_modules/@octokit/webhooks-types/schema").WorkflowDispatchEvent
  export type WorkflowRunEvent = import("../../../../node_modules/@octokit/webhooks-types/schema").WorkflowRunEvent
  export type PullRequestEvent = import("../../../../node_modules/@octokit/webhooks-types/schema").PullRequestEvent
}
