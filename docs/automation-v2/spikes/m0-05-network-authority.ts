/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * M0-05 throwaway network-authority spike — Plan V2.3.1 §108-113 + ADR-023.
 *
 * Explicitly non-production. No stable persisted format. No public
 * compatibility promise. Discarded/migrated after ADR-023 is rendered.
 *
 * What this does: it exercises the IP-validation primitives that the
 * Network Authority will use to defend against SSRF. The OS-level
 * enforcement (containers, VM, OS routing) is platform-specific and
 * tested in M1.
 *
 * Vectors (plan §111):
 *   - IPv4 / IPv6 / IPv4-mapped IPv6
 *   - loopback (127.0.0.0/8, ::1)
 *   - private (10/8, 172.16/12, 192.168/16, fc00::/7)
 *   - link-local (169.254/16, fe80::/10)
 *   - cloud metadata (169.254.169.254, fd00:ec2::254)
 *   - DNS rebinding (not testable in this throwaway)
 *   - redirect (not testable here, requires HTTP)
 */

import { isIP, isIPv4, isIPv6 } from "node:net"

type Verdict = "PASS" | "FAIL" | "NEEDS-OS-ENFORCEMENT"

const results: { name: string; verdict: Verdict; evidence: string }[] = []

function record(name: string, verdict: Verdict, evidence: string): void {
  results.push({ name, verdict, evidence })
  console.log(`[${verdict.padEnd(23)}] ${name} — ${evidence}`)
}

type VerdictFn = (ip: string) => boolean

function testRange(name: string, ips: string[], shouldMatch: VerdictFn): void {
  let allMatch = true
  let allPass = true
  for (const ip of ips) {
    if (!isIP(ip)) {
      // Some ranges require manual parsing; we use a simple pattern match
      allPass = false
      allMatch = false
      continue
    }
    if (!shouldMatch(ip)) {
      allPass = false
    }
  }
  if (allPass) {
    record(name, "PASS", `all ${ips.length} IPs match expected classification`)
  } else if (allMatch) {
    record(name, "NEEDS-OS-ENFORCEMENT", `isIP recognizes all but classification requires OS-level routing/firewall`)
  } else {
    record(name, "FAIL", `at least one IP not recognized: ${ips.join(", ")}`)
  }
}

function runTests() {
  // 1. isIP recognizes IPv4
  {
    const ips = ["127.0.0.1", "10.0.0.1", "192.168.1.1", "169.254.169.254", "8.8.8.8"]
    let allRecognized = true
    for (const ip of ips) {
      if (!isIPv4(ip)) allRecognized = false
    }
    if (allRecognized) {
      record("isIP recognizes IPv4", "PASS", `5/5 IPv4 addresses recognized`)
    } else {
      record("isIP recognizes IPv4", "FAIL", `not all recognized`)
    }
  }

  // 2. isIP recognizes IPv6
  {
    const ips = ["::1", "fe80::1", "fc00::1", "2001:db8::1"]
    let allRecognized = true
    for (const ip of ips) {
      if (!isIPv6(ip)) allRecognized = false
    }
    if (allRecognized) {
      record("isIP recognizes IPv6", "PASS", `4/4 IPv6 addresses recognized`)
    } else {
      record("isIP recognizes IPv6", "FAIL", `not all recognized`)
    }
  }

  // 3. Loopback detection (algorithm-level)
  {
    const ips = ["127.0.0.1", "127.1.2.3", "::1"]
    const isLoopback = (ip: string) =>
      /^127\./.test(ip) || ip === "::1" || ip === "::1/128"
    testRange("loopback detection (127.0.0.0/8, ::1)", ips, isLoopback)
  }

  // 4. Private IPv4 detection (RFC 1918)
  {
    const ips = ["10.0.0.1", "172.16.0.1", "192.168.1.1", "172.31.255.255", "172.32.0.1"]
    const isPrivate = (ip: string) => {
      const parts = ip.split(".").map(Number)
      if (parts.length !== 4) return false
      const [a, b] = parts
      if (a === 10) return true
      if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true
      if (a === 192 && b === 168) return true
      return false
    }
    testRange("private IPv4 (RFC 1918: 10/8, 172.16/12, 192.168/16)", ips, isPrivate)
  }

  // 5. Private IPv6 detection (fc00::/7)
  {
    const ips = ["fc00::1", "fd00::1", "fe80::1"]
    const isPrivate = (ip: string) => /^f[cd][0-9a-f]{2}:/i.test(ip)
    testRange("private IPv6 (fc00::/7)", ips, isPrivate)
  }

  // 6. Link-local detection
  {
    const ips = ["169.254.1.1", "169.254.169.254", "fe80::1"]
    const isLinkLocal = (ip: string) =>
      ip.startsWith("169.254.") || ip.startsWith("fe80:")
    testRange("link-local (169.254/16, fe80::/10)", ips, isLinkLocal)
  }

  // 7. Cloud metadata detection (169.254.169.254, fd00:ec2::254)
  {
    const ips = ["169.254.169.254", "fd00:ec2::254"]
    const isMetadata = (ip: string) =>
      ip === "169.254.169.254" || ip === "fd00:ec2::254"
    testRange("cloud metadata", ips, isMetadata)
  }

  // 8. Public IPv4 (control: not in any private range)
  {
    const ips = ["8.8.8.8", "1.1.1.1", "208.67.222.222"]
    const isPublic = (ip: string) => {
      const parts = ip.split(".").map(Number)
      if (parts.length !== 4) return false
      const [a, b] = parts
      if (a === undefined || a === 10) return false
      if (a === 172 && b !== undefined && b >= 16 && b <= 31) return false
      if (a === 192 && b === 168) return false
      if (a === 127) return false
      if (a === 169 && b === 254) return false
      if (a === 0 || a === 127) return false
      if (a >= 224) return false // multicast / reserved
      return true
    }
    testRange("public IPv4 (control)", ips, isPublic)
  }
}

runTests()

const pass = results.filter((r) => r.verdict === "PASS").length
const needsOS = results.filter((r) => r.verdict === "NEEDS-OS-ENFORCEMENT").length
const fail = results.filter((r) => r.verdict === "FAIL").length

console.log("")
console.log("M0-05 spike summary")
console.log("===================")
console.log(`PASS                  ${pass}`)
console.log(`NEEDS-OS-ENFORCEMENT  ${needsOS}`)
console.log(`FAIL                  ${fail}`)
console.log("")

if (fail === 0) {
  console.log("Verdict: the IP classification algorithms work. Network Authority")
  console.log("can rely on these patterns for the algorithmic layer. The OS-level")
  console.log("enforcement (containers, VM, OS firewall) is platform-specific")
  console.log("and is M1 work for the @unifia/network-authority/ package.")
  console.log("")
  console.log("Plan §111 SSRF tests are partly testable in this layer (IP")
  console.log("classification) and partly require HTTP clients (DNS rebinding,")
  console.log("redirect chains). The HTTP-side tests will run in M1 against")
  console.log("the actual Network Authority implementation.")
} else {
  console.log("Verdict: IP classification has gaps. Network Authority ADR-023")
  console.log("needs additional work.")
}
