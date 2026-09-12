# Fork distribution and rebrand boundary

This repository currently uses **Unifia Fusion** as a working description. The final product name and public domain are intentionally not fixed yet.

Until the rebrand is complete, documentation must use these boundaries:

| Purpose | Temporary canonical location |
|---|---|
| Fork source and issues | <https://github.com/Rwanbt/unifia> |
| Fork releases and desktop/APK downloads | <https://github.com/Rwanbt/unifia/releases> |
| Fork CI | <https://github.com/Rwanbt/unifia/actions> |
| Upstream attribution only | <https://github.com/anomalyco/opencode> |
| Upstream-hosted services | <https://opencode.ai> |

## Distribution rules

- Never present `unifia.ai/install`, the upstream npm package, the upstream Homebrew formula, or the upstream release page as an installation path for this fork.
- Until fork-specific installers and package names exist, recommend a fork release artifact or a source checkout.
- Keep upstream links only where they are semantically upstream: attribution, protocol references, provider services, or compatibility documentation.
- When the public name is chosen, update this file first, then regenerate links in the root README, localized README files, package README files, SDK integrations, updater configuration, and release workflows.

Use **implemented**, **experimental**, or **planned** instead of claiming that every feature is production-ready. AnythingLLM integration, collaborative mode, some observability paths, and unsigned fork artifacts must remain clearly labelled until their release gates are green.

