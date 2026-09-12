/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * Post-M3-R1 NW-01..07 — Network Authority contracts (Plan V2.3.1 §205,
 * ADR-023).
 *
 * The Network Authority is the trust boundary between the orchestrator
 * and the outside world. The gate for this track is
 * "forbidden network connections = 0" — i.e. nothing in the orchestrator
 * or its extensions may initiate a network connection that has not been
 * declared in a `NetworkCapabilities` record and validated by the
 * `NetworkAuthority`.
 *
 * The regression net is:
 *
 *   NW-01 Capabilities (4):
 *     (1) minimal valid (outbound only)
 *     (2) rejects empty protocols
 *     (3) rejects too many hosts (> NET_AUTHORITY_MAX_HOSTS)
 *     (4) accepts all 7 protocols
 *
 *   NW-02 DNS (3):
 *     (5) parses IPv4 addresses
 *     (6) parses IPv6 addresses
 *     (7) rejects bad IP format
 *
 *   NW-03 IP allowlist (2):
 *     (8) accepts CIDR
 *     (9) accepts host
 *
 *   NW-04 Redirect (3):
 *     (10) defaults (allowCrossOrigin: false, maxRedirects: 3)
 *     (11) allowCrossOrigin: true is accepted
 *     (12) rejects maxRedirects > 10
 *
 *   NW-05 SSRF (3):
 *     (13) defaults (all deny)
 *     (14) accepts custom denylist
 *     (15) SSRF_PRIVATE_RANGES contains loopback
 *
 *   NW-06 (skipped — capability reused, no new schema)
 *
 *   NW-07 Profile (5):
 *     (16) all 5 profiles parse
 *     (17) full ProfileNetworkPolicy round-trip
 *     (18) local-single-node minimal
 *     (19) distributed-server maximal
 *     (20) rejects bad profile
 *
 *   Cross-ref (5):
 *     (21) profile-specific allowlist matches capabilities
 *     (22) SSRF denies private ranges (default)
 *     (23) Redirect default allowDowngrade is false
 *     (24) parseProfileNetworkPolicy helper
 *     (25) parseNetworkCapabilities helper
 */
import { describe, expect, test } from "bun:test"
import {
  NetworkCapabilitiesSchema,
  DnsResolveResultSchema,
  IpAllowlistSchema,
  RedirectValidationSchema,
  SsrfPolicySchema,
  ProfileNetworkPolicySchema,
  NetworkProfileSchema,
  NetworkProtocolSchema,
  SSRF_PRIVATE_RANGES,
  parseNetworkCapabilities,
  parseProfileNetworkPolicy,
  NET_AUTHORITY_MAX_HOSTS,
  NET_AUTHORITY_MAX_CIDR,
  type NetworkCapabilities,
  type ProfileNetworkPolicy,
} from "../src/network.ts"

/* ================================================================== */
/* NW-01 Capabilities                                                   */
/* ================================================================== */

describe("NW-01 NetworkCapabilitiesSchema", () => {
  test("(1) MinimalValid — outbound: true with one https host parses", () => {
    const parsed = NetworkCapabilitiesSchema.parse({
      outbound: true,
      allowedProtocols: ["https"],
      allowedHosts: ["api.example.com"],
      allowedCidrs: [],
    })
    expect(parsed.outbound).toBe(true)
    expect(parsed.inbound).toBe(false)
    expect(parsed.allowedProtocols).toEqual(["https"])
    expect(parsed.allowedHosts).toEqual(["api.example.com"])
    expect(parsed.allowedCidrs).toEqual([])
    expect(parsed.portAllowlist).toBeUndefined()
  })

  test("(2) RejectsEmptyProtocols — allowedProtocols: [] is rejected (deny all)", () => {
    expect(() =>
      NetworkCapabilitiesSchema.parse({
        outbound: true,
        allowedProtocols: [],
        allowedHosts: ["x.example"],
        allowedCidrs: [],
      }),
    ).toThrow(/allowedProtocols/)
  })

  test("(3) RejectsTooManyHosts — > NET_AUTHORITY_MAX_HOSTS hosts is rejected", () => {
    const tooMany = Array.from({ length: NET_AUTHORITY_MAX_HOSTS + 1 }, (_, i) => `h${i}.example`)
    expect(() =>
      NetworkCapabilitiesSchema.parse({
        outbound: true,
        allowedProtocols: ["https"],
        allowedHosts: tooMany,
        allowedCidrs: [],
      }),
    ).toThrow(/allowedHosts/)
  })

  test("(3+) RejectsTooManyCidrs — > NET_AUTHORITY_MAX_CIDR CIDR ranges is rejected", () => {
    const tooMany = Array.from({ length: NET_AUTHORITY_MAX_CIDR + 1 }, (_, i) => `10.0.${i}.0/24`)
    expect(() =>
      NetworkCapabilitiesSchema.parse({
        outbound: true,
        allowedProtocols: ["tcp"],
        allowedHosts: ["x.example"],
        allowedCidrs: tooMany,
      }),
    ).toThrow(/allowedCidrs/)
  })

  test("(4) AllSevenProtocols — tcp, udp, http, https, ws, wss, grpc all accepted", () => {
    const all7: Array<NetworkCapabilities["allowedProtocols"][number]> = [
      "tcp",
      "udp",
      "http",
      "https",
      "ws",
      "wss",
      "grpc",
    ]
    const parsed = NetworkCapabilitiesSchema.parse({
      outbound: true,
      allowedProtocols: all7,
      allowedHosts: ["x.example"],
      allowedCidrs: [],
    })
    expect(parsed.allowedProtocols).toEqual(all7)
    expect(NetworkProtocolSchema.options).toHaveLength(7)
  })

  test("(4+) AcceptsValidCidrs — IPv4 + IPv6 CIDR ranges accepted", () => {
    const parsed = NetworkCapabilitiesSchema.parse({
      outbound: true,
      allowedProtocols: ["https"],
      allowedHosts: ["x.example"],
      allowedCidrs: ["10.0.0.0/8", "192.168.0.0/16", "fc00::/7"],
    })
    expect(parsed.allowedCidrs).toHaveLength(3)
  })

  test("(4++) RejectsInvalidCidr — '10.0.0.0/33' is rejected by regex", () => {
    expect(() =>
      NetworkCapabilitiesSchema.parse({
        outbound: true,
        allowedProtocols: ["https"],
        allowedHosts: ["x.example"],
        allowedCidrs: ["10.0.0.0/33"],
      }),
    ).toThrow(/allowedCidrs|CIDR/)
  })
})

/* ================================================================== */
/* NW-02 DNS validation                                                 */
/* ================================================================== */

describe("NW-02 DnsResolveResultSchema", () => {
  test("(5) ParsesIPv4 — addresses: ['192.0.2.1'] is accepted", () => {
    const parsed = DnsResolveResultSchema.parse({
      host: "x.example",
      addresses: ["192.0.2.1"],
      ttl: 300,
    })
    expect(parsed.addresses).toEqual(["192.0.2.1"])
    expect(parsed.ttl).toBe(300)
  })

  test("(6) ParsesIPv6 — addresses: ['2001:db8::1'] is accepted", () => {
    const parsed = DnsResolveResultSchema.parse({
      host: "x.example",
      addresses: ["2001:db8::1"],
    })
    expect(parsed.addresses).toEqual(["2001:db8::1"])
  })

  test("(7) RejectsBadIpFormat — 'not.an.ip' is rejected by regex", () => {
    expect(() =>
      DnsResolveResultSchema.parse({
        host: "x.example",
        addresses: ["not.an.ip"],
      }),
    ).toThrow(/addresses|IP/)
  })
})

/* ================================================================== */
/* NW-03 IP allowlist                                                   */
/* ================================================================== */

describe("NW-03 IpAllowlistSchema", () => {
  test("(8) AcceptsCidr — cidrs: ['10.0.0.0/8'] is accepted", () => {
    const parsed = IpAllowlistSchema.parse({
      cidrs: ["10.0.0.0/8"],
      hosts: [],
    })
    expect(parsed.cidrs).toEqual(["10.0.0.0/8"])
  })

  test("(9) AcceptsHost — hosts: ['api.example.com'] is accepted", () => {
    const parsed = IpAllowlistSchema.parse({
      cidrs: [],
      hosts: ["api.example.com"],
    })
    expect(parsed.hosts).toEqual(["api.example.com"])
  })
})

/* ================================================================== */
/* NW-04 Redirect validation                                            */
/* ================================================================== */

describe("NW-04 RedirectValidationSchema", () => {
  test("(10) Defaults — allowCrossOrigin: false, allowDowngrade: false, maxRedirects: 3", () => {
    const parsed = RedirectValidationSchema.parse({})
    expect(parsed.allowCrossOrigin).toBe(false)
    expect(parsed.allowDowngrade).toBe(false)
    expect(parsed.maxRedirects).toBe(3)
  })

  test("(11) AllowCrossOriginTrue — allowCrossOrigin: true is accepted", () => {
    const parsed = RedirectValidationSchema.parse({ allowCrossOrigin: true })
    expect(parsed.allowCrossOrigin).toBe(true)
  })

  test("(12) RejectsMaxRedirectsOver10 — maxRedirects: 11 is rejected", () => {
    expect(() => RedirectValidationSchema.parse({ maxRedirects: 11 })).toThrow(/maxRedirects/)
  })

  test("(12+) RejectsNegativeMaxRedirects — maxRedirects: -1 is rejected by .min(0)", () => {
    expect(() => RedirectValidationSchema.parse({ maxRedirects: -1 })).toThrow(/maxRedirects/)
  })
})

/* ================================================================== */
/* NW-05 SSRF protection                                                */
/* ================================================================== */

describe("NW-05 SsrfPolicySchema + SSRF_PRIVATE_RANGES", () => {
  test("(13) Defaults — denyPrivateRanges/denyMulticast/denyReserved all true", () => {
    const parsed = SsrfPolicySchema.parse({})
    expect(parsed.denyPrivateRanges).toBe(true)
    expect(parsed.denyMulticast).toBe(true)
    expect(parsed.denyReserved).toBe(true)
    expect(parsed.customDenylist).toBeUndefined()
  })

  test("(14) AcceptsCustomDenylist — customDenylist: ['203.0.113.0/24'] is accepted", () => {
    const parsed = SsrfPolicySchema.parse({
      customDenylist: ["203.0.113.0/24", "198.51.100.0/24"],
    })
    expect(parsed.customDenylist).toHaveLength(2)
  })

  test("(15) PrivateRangesContainsLoopback — '127.0.0.0/8' is in SSRF_PRIVATE_RANGES", () => {
    expect(SSRF_PRIVATE_RANGES).toContain("127.0.0.0/8")
    // Sanity: the table covers the IANA-registered IPv4 + IPv6 special-purpose ranges
    expect(SSRF_PRIVATE_RANGES.length).toBeGreaterThanOrEqual(10)
  })

  test("(15+) CanDisableDefaults — denyPrivateRanges: false is accepted (operator opt-out)", () => {
    const parsed = SsrfPolicySchema.parse({ denyPrivateRanges: false })
    expect(parsed.denyPrivateRanges).toBe(false)
    expect(parsed.denyMulticast).toBe(true)
    expect(parsed.denyReserved).toBe(true)
  })
})

/* ================================================================== */
/* NW-07 Profile                                                        */
/* ================================================================== */

describe("NW-07 ProfileNetworkPolicySchema + NetworkProfileSchema", () => {
  test("(16) AllFiveProfilesParse — local-single-node, server-single-node, distributed-server, browser-isolated, ai-compiler-isolated", () => {
    const profiles: Array<ProfileNetworkPolicy["profile"]> = [
      "local-single-node",
      "server-single-node",
      "distributed-server",
      "browser-isolated",
      "ai-compiler-isolated",
    ]
    for (const p of profiles) {
      const parsed = ProfileNetworkPolicySchema.parse({
        profile: p,
        capabilities: {
          outbound: false,
          allowedProtocols: ["tcp"],
          allowedHosts: ["x.example"],
          allowedCidrs: [],
        },
      })
      expect(parsed.profile).toBe(p)
    }
    expect(NetworkProfileSchema.options).toHaveLength(5)
  })

  test("(17) FullPolicyRoundTrip — parse → JSON → re-parse is equal (all fields populated)", () => {
    const original: ProfileNetworkPolicy = {
      profile: "server-single-node",
      capabilities: {
        outbound: true,
        inbound: false,
        allowedProtocols: ["https", "grpc"],
        allowedHosts: ["api.example.com", "grpc.example.com"],
        allowedCidrs: ["10.0.0.0/8"],
        portAllowlist: { https: [443], grpc: [443, 8443] },
      },
      ssrf: {
        denyPrivateRanges: true,
        denyMulticast: true,
        denyReserved: true,
        customDenylist: ["203.0.113.0/24"],
      },
      redirects: {
        allowCrossOrigin: false,
        allowDowngrade: false,
        maxRedirects: 5,
      },
    }
    const first = ProfileNetworkPolicySchema.parse(original)
    const roundTripped = ProfileNetworkPolicySchema.parse(JSON.parse(JSON.stringify(first)))
    expect(roundTripped).toEqual(first)
    expect(roundTripped.capabilities.portAllowlist).toEqual({ https: [443], grpc: [443, 8443] })
  })

  test("(18) LocalSingleNodeMinimal — profile + tiny capabilities parses, no ssrf/redirects", () => {
    const parsed = ProfileNetworkPolicySchema.parse({
      profile: "local-single-node",
      capabilities: {
        outbound: false,
        allowedProtocols: ["tcp"],
        allowedHosts: ["localhost"],
        allowedCidrs: ["127.0.0.0/8"],
      },
    })
    expect(parsed.profile).toBe("local-single-node")
    expect(parsed.ssrf).toBeUndefined()
    expect(parsed.redirects).toBeUndefined()
  })

  test("(19) DistributedServerMaximal — full capability surface, large allowlist, port allowlist", () => {
    const hosts = Array.from({ length: 10 }, (_, i) => `h${i}.example`)
    const parsed = ProfileNetworkPolicySchema.parse({
      profile: "distributed-server",
      capabilities: {
        outbound: true,
        inbound: true,
        allowedProtocols: ["tcp", "udp", "http", "https", "ws", "wss", "grpc"],
        allowedHosts: hosts,
        allowedCidrs: ["10.0.0.0/8", "192.168.0.0/16", "fc00::/7"],
        portAllowlist: { tcp: [80, 443, 8443], udp: [53] },
      },
    })
    expect(parsed.profile).toBe("distributed-server")
    expect(parsed.capabilities.allowedHosts).toHaveLength(10)
    expect(parsed.capabilities.portAllowlist?.tcp).toEqual([80, 443, 8443])
  })

  test("(20) RejectsBadProfile — profile: 'cloud-server' is not a valid profile", () => {
    expect(() =>
      ProfileNetworkPolicySchema.parse({
        profile: "cloud-server",
        capabilities: {
          outbound: true,
          allowedProtocols: ["https"],
          allowedHosts: ["x.example"],
          allowedCidrs: [],
        },
      }),
    ).toThrow(/profile/)
  })
})

/* ================================================================== */
/* Cross-ref                                                            */
/* ================================================================== */

describe("Cross-ref tests", () => {
  test("(21) ProfileSpecificAllowlistMatchesCapabilities — server profile's allowlist is what the capabilities declare", () => {
    const parsed = ProfileNetworkPolicySchema.parse({
      profile: "server-single-node",
      capabilities: {
        outbound: true,
        allowedProtocols: ["https"],
        allowedHosts: ["api.example.com"],
        allowedCidrs: ["10.0.0.0/8"],
      },
    })
    // The schema does not constrain capabilities per profile — the runtime does —
    // so the contract is "the declared allowlist IS the enforced one".
    expect(parsed.capabilities.allowedHosts).toEqual(["api.example.com"])
    expect(parsed.capabilities.allowedCidrs).toEqual(["10.0.0.0/8"])
  })

  test("(22) SsrfDeniesPrivateRangesByDefault — default policy covers all loopback/private ranges", () => {
    const policy = SsrfPolicySchema.parse({})
    expect(policy.denyPrivateRanges).toBe(true)
    // The 10 IANA-registered IPv4 + IPv6 special-purpose ranges are all in the table
    expect(SSRF_PRIVATE_RANGES).toContain("127.0.0.0/8") // IPv4 loopback
    expect(SSRF_PRIVATE_RANGES).toContain("10.0.0.0/8") // RFC 1918
    expect(SSRF_PRIVATE_RANGES).toContain("172.16.0.0/12") // RFC 1918
    expect(SSRF_PRIVATE_RANGES).toContain("192.168.0.0/16") // RFC 1918
    expect(SSRF_PRIVATE_RANGES).toContain("::1/128") // IPv6 loopback
    expect(SSRF_PRIVATE_RANGES).toContain("fc00::/7") // IPv6 ULA
  })

  test("(23) RedirectDefaultAllowDowngradeIsFalse — cleartext downgrade is denied by default", () => {
    const parsed = RedirectValidationSchema.parse({})
    expect(parsed.allowDowngrade).toBe(false)
  })

  test("(24) ParseProfileNetworkPolicyHelper — throws on invalid input", () => {
    expect(() => parseProfileNetworkPolicy({ profile: "unknown" })).toThrow()
    expect(() =>
      parseProfileNetworkPolicy({
        profile: "server-single-node",
        capabilities: {
          outbound: true,
          allowedProtocols: ["https"],
          allowedHosts: ["x.example"],
          allowedCidrs: [],
        },
      }),
    ).not.toThrow()
  })

  test("(25) ParseNetworkCapabilitiesHelper — throws on invalid input, succeeds on valid", () => {
    expect(() => parseNetworkCapabilities({ allowedProtocols: [] })).toThrow()
    const ok = parseNetworkCapabilities({
      outbound: true,
      allowedProtocols: ["https"],
      allowedHosts: ["x.example"],
      allowedCidrs: [],
    })
    expect(ok.outbound).toBe(true)
  })

  test("(25+) CapabilitiesDefaults — outbound/inbound default to false when omitted", () => {
    const parsed = NetworkCapabilitiesSchema.parse({
      allowedProtocols: ["https"],
      allowedHosts: ["x.example"],
      allowedCidrs: [],
    })
    expect(parsed.outbound).toBe(false)
    expect(parsed.inbound).toBe(false)
  })
})
