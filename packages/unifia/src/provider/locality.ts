/* SPDX-License-Identifier: MIT */
/**
 * Whether a provider runs on this machine.
 *
 * One authoritative answer, because two subsystems now depend on it for
 * different reasons and must not drift apart: the tool registry uses it to
 * decide that a local model gets the reduced tool set, and the knowledge
 * egress guard uses it to decide whether serving a note counts as leaving
 * the machine (ADR-KNOW-0006 §2). A provider considered local by one and
 * remote by the other would send a note to a destination the policy was
 * never asked about.
 */

import type { ProviderID } from "./schema"
import type { DestinationKind } from "@unifia/contracts/knowledge"

/** The one provider whose inference happens in-process. */
export const LOCAL_PROVIDER_ID = "local-llm" as ProviderID

export function isLocalProvider(providerID: ProviderID | string): boolean {
  return providerID === LOCAL_PROVIDER_ID
}

/**
 * The egress destination kind for a provider.
 *
 * Anything not known to be local counts as remote, so an unrecognised
 * provider fails closed rather than being served under local rules.
 */
export function destinationKindOf(providerID: ProviderID | string): DestinationKind {
  return isLocalProvider(providerID) ? "local" : "remote"
}
