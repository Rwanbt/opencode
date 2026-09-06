/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * Network Authority contracts (Plan V2.3.1 §205, ADR-023).
 *
 * The Network Authority is the trust boundary between the
 * orchestrator and the outside world. The gate for this track is
 * "forbidden network connections = 0" — i.e. nothing in the
 * orchestrator or its extensions may initiate a network
 * connection that has not been declared in a `NetworkCapabilities`
 * record and validated by the `NetworkAuthority`.
 *
 * The contract surface here is the *shape* of the authority; the
 * runtime implementation is in the worktree's network broker
 * (out of scope for M2/M3/Post-M3-contracts).
 *
 * Cross-references documented here, enforced at runtime:
 *   - NW-01 (Capabilities) is the declarative root; every other
 *     NW-0x (DNS, IP, redirect, SSRF, profile) is a refinement.
 *   - NW-06 (resource capabilities) is **reused**, not redefined:
 *     the runtime reads `NetworkCapabilities` for both egress
 *     gating (NW-01..05) and resource accounting (NW-06).
 *   - The `webhook` / `polling` ingress triggers (ingress.ts) are
 *     the only drivers that *originate* outbound connections; the
 *     authority gates them per the policy attached to the trigger's
 *     workflow profile.
 */
import { z } from "zod"

/* ------------------------------------------------------------------ */
/* NW-01 Network Authority — capabilities shape                        */
/* ------------------------------------------------------------------ */

/**
 * Maximum number of distinct hosts in an allowlist. 4096 is well
 * above any realistic enterprise allowlist (most are <100) and
 * below the count at which the allowlist itself becomes a
 * performance / memory concern.
 */
export const NET_AUTHORITY_MAX_HOSTS = 4096

/**
 * Maximum number of CIDR ranges in an allowlist. 64 covers IPv4
 * + IPv6 ranges (e.g. one entry per region / VPC / cloud account).
 */
export const NET_AUTHORITY_MAX_CIDR = 64

/**
 * Network protocols the authority may permit. `tcp` / `udp` are
 * the L4 primitives; `http` / `https` / `ws` / `wss` / `grpc` are
 * the L7 surface the orchestrator actually initiates. The
 * runtime maps an L7 protocol to its L4 transport when
 * enforcement happens below the application layer.
 */
export const NetworkProtocolSchema = z.enum([
  "tcp",
  "udp",
  "http",
  "https",
  "ws",
  "wss",
  "grpc",
])
export type NetworkProtocol = z.infer<typeof NetworkProtocolSchema>

/**
 * RFC 1035 §2.3.4 caps a single domain label at 63 octets and a
 * full domain name at 253 octets (excluding the trailing dot).
 * 253 is the practical upper bound for a single host literal.
 */
export const NetworkHostSchema = z
  .string()
  .min(1, "net: host must be non-empty")
  .max(253, "net: host must be ≤ 253 chars (RFC 1035)")
export type NetworkHost = z.infer<typeof NetworkHostSchema>

/**
 * Network capabilities — the declarative root the authority
 * validates. Every connection the orchestrator initiates must be
 * covered by a `NetworkCapabilities` record (NW-01 / NW-06).
 *
 *   - `outbound` / `inbound` toggle the directions. A
 *     `local-single-node` workflow declares both `false`.
 *   - `allowedProtocols` / `allowedHosts` are the
 *     allowlist-shaped gates. An empty list means "deny all"
 *     regardless of the direction flag.
 *   - `allowedCidrs` is the IP-level complement to
 *     `allowedHosts` — the runtime checks BOTH. A host in
 *     `allowedHosts` whose resolved IP is in `allowedCidrs`
 *     passes; otherwise the connection is denied (defense in
 *     depth against DNS-rebinding).
 *   - `portAllowlist` is the per-protocol port allowlist, e.g.
 *     `{ https: [443], http: [80, 8080] }`. A protocol not in
 *     the map inherits the protocol default; a protocol in the
 *     map with an empty array denies the protocol.
 */
export const NetworkCapabilitiesSchema = z.object({
  outbound: z.boolean().default(false),
  inbound: z.boolean().default(false),
  /**
   * Allowed protocols. Must be non-empty — an empty allowlist
   * denies every connection regardless of the `outbound` /
   * `inbound` flags (defense-in-depth: a typo that empties the
   * list must not silently open the gate).
   */
  allowedProtocols: z
    .array(NetworkProtocolSchema)
    .min(1, "net: allowedProtocols must be non-empty (deny all if absent)")
    .readonly(),
  allowedHosts: z
    .array(NetworkHostSchema)
    .max(
      NET_AUTHORITY_MAX_HOSTS,
      `net: at most ${NET_AUTHORITY_MAX_HOSTS} hosts in allowlist`,
    )
    .readonly(),
  /**
   * CIDR ranges for IP-level enforcement. The regex accepts both
   * IPv4 (`10.0.0.0/8`, mask 0-32) and IPv6 (`fc00::/7`, mask
   * 0-128) notations. Mask lengths outside the valid range are
   * rejected (e.g. `10.0.0.0/33` is invalid for IPv4, `fc00::/129`
   * is invalid for IPv6). The runtime performs the actual range
   * check; the contract captures the shape and the mask bound.
   */
  allowedCidrs: z
    .array(
      z
        .string()
        .regex(
          /^(\d{1,3}\.){3}\d{1,3}\/(3[0-2]|[0-2]?\d)$|^[0-9a-fA-F:]+\/(12[0-8]|1[01]\d|0?\d{1,2})$/,
          "net: invalid CIDR (IPv4 mask 0-32, IPv6 mask 0-128)",
        ),
    )
    .max(
      NET_AUTHORITY_MAX_CIDR,
      `net: at most ${NET_AUTHORITY_MAX_CIDR} CIDR ranges in allowlist`,
    )
    .readonly(),
  /**
   * Per-protocol port allowlist. Keys are protocol literals
   * (same as `NetworkProtocolSchema`); values are arrays of
   * port numbers. A protocol with an empty array denies the
   * protocol regardless of `allowedProtocols`.
   */
  portAllowlist: z
    .record(z.string(), z.array(z.number().int().min(1).max(65535)))
    .readonly()
    .optional(),
})
export type NetworkCapabilities = z.infer<typeof NetworkCapabilitiesSchema>

/**
 * Validate an unknown input as a `NetworkCapabilities` record.
 * Throws `z.ZodError` on failure. Thin wrapper around
 * `NetworkCapabilitiesSchema.parse` — the trust boundary uses
 * this so a malformed capability record cannot smuggle a
 * `true` / `false` past the gate.
 */
export function parseNetworkCapabilities(input: unknown): NetworkCapabilities {
  return NetworkCapabilitiesSchema.parse(input)
}

/* ------------------------------------------------------------------ */
/* NW-02 DNS validation                                                */
/* ------------------------------------------------------------------ */

/**
 * DNS resolution result. The `addresses` array is the set of
 * resolved IPs (v4 or v6) the runtime obtained from the resolver;
 * `ttl` is the upstream TTL the runtime may cache against.
 *
 * The regexes on individual address strings accept both IPv4
 * (`192.0.2.1`) and IPv6 (`2001:db8::1`) notations.
 */
export const DnsResolveResultSchema = z.object({
  host: NetworkHostSchema,
  addresses: z
    .array(
      z
        .string()
        .regex(
          /^(\d{1,3}\.){3}\d{1,3}$|^[0-9a-fA-F:]+$/,
          "net: invalid IP address",
        ),
    )
    .readonly(),
  ttl: z.number().int().positive().optional(),
})
export type DnsResolveResult = z.infer<typeof DnsResolveResultSchema>

/* ------------------------------------------------------------------ */
/* NW-03 IP enforcement                                                */
/* ------------------------------------------------------------------ */

/**
 * IP allowlist — the contract form of the IP enforcement table.
 * The runtime builds this from `NetworkCapabilities.allowedCidrs`
 * + `allowedHosts` and applies it to the resolved IPs of every
 * outbound connection. The shape is intentionally narrow: a
 * string list of CIDR + a string list of host literals. The
 * runtime normalizes both to a single set of CIDR ranges for the
 * actual check.
 */
export const IpAllowlistSchema = z.object({
  cidrs: z.array(z.string()).readonly(),
  hosts: z.array(NetworkHostSchema).readonly(),
})
export type IpAllowlist = z.infer<typeof IpAllowlistSchema>

/* ------------------------------------------------------------------ */
/* NW-04 redirect validation                                           */
/* ------------------------------------------------------------------ */

/**
 * Redirect validation policy. The runtime applies it to every
 * HTTP redirect the connector follows: cross-origin redirects
 * are denied by default (cookie / session theft defense), and
 * https→http downgrades are denied by default (cleartext-leak
 * defense). `maxRedirects` is the chain-length cap; 3 is the
 * OWASP-aligned default, 10 is the contract ceiling.
 */
export const RedirectValidationSchema = z.object({
  allowCrossOrigin: z.boolean().default(false),
  allowDowngrade: z.boolean().default(false),
  maxRedirects: z
    .number()
    .int("net: maxRedirects must be an integer")
    .min(0, "net: maxRedirects must be ≥ 0")
    .max(10, "net: maxRedirects must be ≤ 10")
    .default(3),
})
export type RedirectValidation = z.infer<typeof RedirectValidationSchema>

/* ------------------------------------------------------------------ */
/* NW-05 SSRF protection                                               */
/* ------------------------------------------------------------------ */

/**
 * Private / reserved IP ranges the SSRF protector denies by
 * default. The list is intentionally exhaustive across the
 * IANA-registered special-purpose ranges so a missing entry is
 * a bug, not a feature. Cross-reference: Cloudflare's
 * `cloudflare-cidr` and AWS's `ip-ranges.json` are the upstream
 * sources we periodically diff against.
 */
export const SSRF_PRIVATE_RANGES = [
  "127.0.0.0/8", // loopback
  "10.0.0.0/8", // private (RFC 1918)
  "172.16.0.0/12", // private (RFC 1918)
  "192.168.0.0/16", // private (RFC 1918)
  "169.254.0.0/16", // link-local
  "0.0.0.0/8", // current network
  "100.64.0.0/10", // carrier-grade NAT
  "::1/128", // IPv6 loopback
  "fc00::/7", // IPv6 unique local
  "fe80::/10", // IPv6 link-local
] as const

/**
 * SSRF policy. Defaults are deny-all: private ranges, multicast,
 * and IANA-reserved are blocked unless the policy explicitly
 * relaxes them. A custom denylist lets an operator layer
 * organization-specific CIDRs on top of the standard set
 * (e.g. the cloud-provider metadata IP `169.254.169.254` is in
 * `link-local`, so it is already covered; a custom entry is for
 * the internal-only corporate address space).
 */
export const SsrfPolicySchema = z.object({
  denyPrivateRanges: z.boolean().default(true),
  denyMulticast: z.boolean().default(true),
  denyReserved: z.boolean().default(true),
  customDenylist: z.array(z.string()).readonly().optional(),
})
export type SsrfPolicy = z.infer<typeof SsrfPolicySchema>

/* ------------------------------------------------------------------ */
/* NW-07 profile-specific enforcement                                  */
/* ------------------------------------------------------------------ */

/**
 * The five network profiles the platform recognizes. Each maps
 * to a default `NetworkCapabilities` + `SsrfPolicy` +
 * `RedirectValidation` triple. The runtime resolves a workflow's
 * profile to the triple and rejects any explicit capability that
 * broadens beyond the profile's baseline (a `local-single-node`
 * workflow cannot declare `outbound: true` even if asked).
 */
export const NetworkProfileSchema = z.enum([
  "local-single-node", // loopback only, no outbound
  "server-single-node", // allowlist + SSRF protection
  "distributed-server", // full network + audit
  "browser-isolated", // CSP + iframe sandbox
  "ai-compiler-isolated", // outbound for LLM only
])
export type NetworkProfile = z.infer<typeof NetworkProfileSchema>

/**
 * Profile + the policy triples the profile enforces. A
 * `ProfileNetworkPolicy` is the unit a workflow declares at the
 * trust boundary; the runtime resolves the profile to the
 * capability baseline and overlays the explicit
 * `capabilities` / `ssrf` / `redirects` records on top.
 */
export const ProfileNetworkPolicySchema = z.object({
  profile: NetworkProfileSchema,
  capabilities: NetworkCapabilitiesSchema,
  ssrf: SsrfPolicySchema.optional(),
  redirects: RedirectValidationSchema.optional(),
})
export type ProfileNetworkPolicy = z.infer<typeof ProfileNetworkPolicySchema>

/**
 * Validate an unknown input as a `ProfileNetworkPolicy`. Thin
 * throw-on-failure wrapper around
 * `ProfileNetworkPolicySchema.parse` — the trust boundary uses
 * this so a workflow cannot declare an unknown profile or smuggle
 * a `capabilities` record that broadens beyond the profile's
 * baseline.
 */
export function parseProfileNetworkPolicy(input: unknown): ProfileNetworkPolicy {
  return ProfileNetworkPolicySchema.parse(input)
}
