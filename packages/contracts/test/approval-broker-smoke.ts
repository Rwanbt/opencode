/* SPDX-License-Identifier: MIT */
import { ApprovalBroker } from "../src/approval-broker.js"

let now = 1_000
const observed: string[] = []
const broker = new ApprovalBroker(() => now, (request, decision) => observed.push(`${request.id}:${decision.kind}:${request.status}`))
const request = broker.request("workspace.write", "ws-1/src/main.ts", 2_000)
if (broker.resolve(request.id, "allow", "user-1", "ws-1/src/main.ts").kind !== "allow") throw new Error("exact approval was denied")
if (!observed.includes("approval-1:allow:allow")) throw new Error("approval decision was not observed")
const cancelled = broker.request("workspace.write", "ws-1/other.ts", 2_000)
if (broker.cancel(cancelled.id).kind !== "deny" || broker.get(cancelled.id)?.status !== "cancelled") throw new Error("cancel was not effective")
const expired = broker.request("workspace.write", "ws-1/expired.ts", 2_000)
now = 2_000
if (broker.resolve(expired.id, "allow", "user-1").kind !== "deny") throw new Error("expired approval was allowed")
const scoped = broker.request("workspace.write", "ws-1/scoped.ts", 3_000)
if (broker.resolve(scoped.id, "allow", "user-1", "ws-1").kind !== "deny") throw new Error("widened grant was allowed")
const actor = broker.request("workspace.write", "ws-1/actor.ts", 3_000)
if (broker.resolve(actor.id, "allow", "").kind !== "deny") throw new Error("missing actor was allowed")
console.log("ApprovalBroker: 5/5 passed")