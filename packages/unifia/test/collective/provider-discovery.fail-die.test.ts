/**
 * provider-discovery.fail-die.test.ts — TEAM-B02-FIX
 *
 * Targeted regression gate for the corrective fix applied to
 * src/collective/provider-discovery.ts (discover()). Prior to this fix,
 * the adapter round-tripped the substrate's Effect through
 * `Effect.runPromise` and re-wrapped the resulting Promise with
 * `Effect.promise` — which by contract treats ANY rejection as an
 * unrecoverable defect (Die), not a typed Fail. That silently broke the
 * typed error channel declared at collective/orchestrator.ts:49
 * (`InstanceType<typeof ProviderDiscovery.InsufficientProvidersError>` is
 * listed as part of Effect's recoverable `E` channel).
 *
 * This file proves — at the Cause level, not just "the promise
 * rejected" (a Die also rejects the promise) — that `discover()` now
 * FAILS with InsufficientProvidersError instead of dying, and that the
 * success path is unaffected.
 *
 * The explicit-participant path is used deliberately: it short-circuits
 * before touching Provider.list()/Auth.all(), so these assertions need
 * no module mocking and stay focused purely on the Fail-vs-Die property
 * of discover()'s error channel (not on the discovery cascade itself,
 * which is already covered by test/collective/provider-discovery.test.ts
 * and test/multi-model/provider-discovery.integration.test.ts).
 */

import { Cause, Effect } from "effect"
import { describe, expect, test } from "bun:test"
import { ProviderDiscovery } from "../../src/collective/provider-discovery"

describe("ProviderDiscovery.discover() — InsufficientProvidersError is a Fail, not a Die", () => {
  test("fewer than 2 distinct participants: Effect FAILS (Cause.hasFails=true, Cause.hasDies=false)", async () => {
    const exit = await Effect.runPromiseExit(
      ProviderDiscovery.discover([{ providerID: "provider-a", modelID: "model-a" }]),
    )

    expect(exit._tag).toBe("Failure")
    if (exit._tag !== "Failure") return

    // The core property under test: a genuine typed Fail, not a defect.
    // A Die would also produce exit._tag === "Failure" and would also
    // make a plain `.rejects` assertion pass — only Cause-level
    // inspection distinguishes the two, which is why this is asserted
    // directly against Cause.hasFails/hasDies rather than inferred from
    // promise-rejection shape.
    expect(Cause.hasFails(exit.cause)).toBe(true)
    expect(Cause.hasDies(exit.cause)).toBe(false)

    const error = Cause.squash(exit.cause) as InstanceType<typeof ProviderDiscovery.InsufficientProvidersError>
    expect(error).toBeInstanceOf(ProviderDiscovery.InsufficientProvidersError)
    expect(error.data).toEqual({ available: 1, required: 2 })
  })

  test("a genuine Fail is recoverable via Effect.catch (a Die would crash the recovery instead)", async () => {
    const recovered = await Effect.runPromise(
      ProviderDiscovery.discover([{ providerID: "provider-a", modelID: "model-a" }]).pipe(
        Effect.catch(() => Effect.succeed("recovered" as const)),
      ),
    )
    expect(recovered).toBe("recovered")
  })

  test("dedup to < 2 unique participants also fails as a recoverable Fail, not a Die", async () => {
    const exit = await Effect.runPromiseExit(
      ProviderDiscovery.discover([
        { providerID: "provider-a", modelID: "model-a" },
        { providerID: "provider-a", modelID: "model-a", role: "duplicate" },
      ]),
    )

    expect(exit._tag).toBe("Failure")
    if (exit._tag !== "Failure") return
    expect(Cause.hasFails(exit.cause)).toBe(true)
    expect(Cause.hasDies(exit.cause)).toBe(false)

    const error = Cause.squash(exit.cause) as InstanceType<typeof ProviderDiscovery.InsufficientProvidersError>
    expect(error.data).toEqual({ available: 1, required: 2 })
  })

  test("success path is unchanged: >= 2 distinct participants resolve with no failure", async () => {
    const exit = await Effect.runPromiseExit(
      ProviderDiscovery.discover([
        { providerID: "provider-a", modelID: "model-a" },
        { providerID: "provider-b", modelID: "model-b" },
      ]),
    )

    expect(exit._tag).toBe("Success")
    if (exit._tag !== "Success") return
    expect(exit.value.providers).toHaveLength(2)
    expect(exit.value.providers.map((p) => `${p.providerID}/${p.modelID}`).sort()).toEqual([
      "provider-a/model-a",
      "provider-b/model-b",
    ])
    expect(exit.value.ghostWarnings).toEqual([])
  })
})
