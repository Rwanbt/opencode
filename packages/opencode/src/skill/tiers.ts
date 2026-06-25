/**
 * Canonical skill tier definitions — single source of truth for deny patterns.
 *
 * WHY: opencode loads ~103 skills by default. Many are irrelevant to this user's
 * work (Azure, iOS, Entra, Foundry) or too heavy for certain contexts (web tools
 * on mobile, multi-phase planning on lean models). This module centralizes which
 * patterns belong to which tier so config files and mobile bootstrap stay in sync.
 *
 * Usage:
 *   - mobile-entry.ts imports TIERS to write first-boot config
 *   - ~/.config/opencode/opencode.jsonc mirrors NEVER + WEB (can't import TS)
 *   - agent "cloud-lean" uses WEB + HIGH as per-agent deny
 *   - templates/audio-repo.opencode.jsonc uses WEB as project deny
 *
 * Adding a new skill to exclude: add it here, then sync the JSONC configs.
 */

// Domaines jamais utilisés par l'utilisateur — retirés de tous les profils.
// Azure (23), iOS (5), Entra (2), Foundry (6), divers (3) = 39 skills.
export const NEVER: Readonly<Record<string, "deny">> = {
  "azure-*": "deny",
  "ios-*": "deny",
  "entra-*": "deny",
  "airunway*": "deny",
  "appinsights*": "deny",
  "hackernews*": "deny",
  "microsoft-foundry": "deny",
  "deploy-model": "deny",
  "capacity": "deny",
  "customize": "deny",
  "preset": "deny",
  "finetuning": "deny",
}

// Skills web/design — lourds, conçus pour sites live. Inutiles en mobile/remote
// ou sur du dev C++/Rust audio. 21 skills.
export const WEB: Readonly<Record<string, "deny">> = {
  "browse": "deny",
  "qa": "deny",
  "qa-only": "deny",
  "canary": "deny",
  "scrape": "deny",
  "skillify": "deny",
  "setup-browser-cookies": "deny",
  "open-gstack-browser": "deny",
  "pair-agent": "deny",
  "connect-chrome": "deny",
  "design-*": "deny",
  "plan-design-review": "deny",
  "devex-review": "deny",
  "plan-devex-review": "deny",
  "landing-report": "deny",
  "land-and-deploy": "deny",
  "setup-deploy": "deny",
  "benchmark": "deny",
  "benchmark-models": "deny",
  "setup-gbrain": "deny",
  "sync-gbrain": "deny",
}

// Workflows multi-phases — requirent fort raisonnement, trop lourds pour mobile/lean.
// 9 skills.
export const HIGH: Readonly<Record<string, "deny">> = {
  "office-hours": "deny",
  "plan-ceo-review": "deny",
  "plan-eng-review": "deny",
  "autoplan": "deny",
  "cso": "deny",
  "retro": "deny",
  "plan-tune": "deny",
  "remote-control": "deny",
}

// mobile = config first-boot = NEVER + WEB + HIGH (profil lean par défaut).
export const MOBILE_DEFAULT: Readonly<Record<string, "deny">> = {
  ...NEVER,
  ...WEB,
  ...HIGH,
}

// cloud-lean agent = WEB + HIGH (hérite automatiquement du NEVER global via config).
export const CLOUD_LEAN: Readonly<Record<string, "deny">> = {
  ...WEB,
  ...HIGH,
}
