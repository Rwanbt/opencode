const stage = process.env.SST_STAGE || "dev"

// Single source for every link the docs site renders: the 21 locales all read
// `config.github`, `config.console` and `config.email` rather than hardcoding a
// host, so this file is the only place the fork's link policy is expressed.
//
// Domain policy (decision 2026-08-11): the fork controls no domain, so anything
// the fork owns points at its repository. `unifia.ai` must never appear here —
// writing a domain nobody holds is worse than having none, because it presents
// dead links as official.
//
// What deliberately still points upstream: `console`, `email` and `discord`
// address opencode.ai's Zen console, anoma.ly's enterprise contact and
// upstream's Discord. Those are *their* services, described on pages that
// document them; redirecting them at this repository would replace a working
// instruction with a wrong one.
export default {
  // Canonical origin for sitemap and og:image. Until the fork actually deploys
  // the site there is no such origin, so it stays overridable and otherwise
  // names the repository. Consequence, accepted: `${url}/social-share.png`
  // does not resolve while undeployed — neither does the rest of the site.
  url: process.env.UNIFIA_SITE_URL || "https://github.com/Rwanbt/unifia",
  console: stage === "production" ? "https://opencode.ai/auth" : `https://${stage}.opencode.ai/auth`,
  email: "contact@anoma.ly",
  socialCard: "https://social-cards.sst.dev",
  github: "https://github.com/Rwanbt/unifia",
  discord: "https://opencode.ai/discord",
  headerLinks: [
    { name: "app.header.home", url: "/" },
    { name: "app.header.docs", url: "/docs/" },
  ],
}
