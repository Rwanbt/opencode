// Upstream's deployment path: it provisions Cloudflare hostnames, a Stripe
// webhook and PlanetScale branches under domains upstream owns (opencode.ai,
// opncd.ai) in upstream's Cloudflare zone. This fork owns no domain, so a
// deploy from here can only fail or mutate infrastructure that is not ours.
// Same gate, and same reason, as script/publish.ts.
//
// G9 decision (2026-08-11): the fork ships no website and claims no domain.
// Its canonical location is https://github.com/Rwanbt/unifia. The production
// domain below is upstream's real one — reachable only under this opt-in — so
// that no Unifia domain is ever fabricated in source.
if (!process.env["UNIFIA_ALLOW_UPSTREAM_DEPLOY"]) {
  throw new Error(
    "infra/ is upstream's deployment path and targets domains this fork does not own. " +
      "Unifia publishes no site; its canonical location is https://github.com/Rwanbt/unifia.",
  )
}

export const domain = (() => {
  if ($app.stage === "production") return "opencode.ai"
  if ($app.stage === "dev") return "dev.opencode.ai"
  return `${$app.stage}.dev.opencode.ai`
})()

export const zoneID = "430ba34c138cfb5360826c4909f99be8"

new cloudflare.RegionalHostname("RegionalHostname", {
  hostname: domain,
  regionKey: "us",
  zoneId: zoneID,
})

export const shortDomain = (() => {
  if ($app.stage === "production") return "opncd.ai"
  if ($app.stage === "dev") return "dev.opncd.ai"
  return `${$app.stage}.dev.opncd.ai`
})()
