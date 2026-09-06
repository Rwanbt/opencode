<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-023 — Network Egress / SSRF Authority (architectural impact)

> **Statut** : DECIDED
> **Date** : 2026-09-01
> **Source** : plan V2.3.1 §108-113, THREAT_MODEL §1.6 (TM-N-01..05).

## Status

DECIDED. ADR d'**impact architectural** (plan §197). Dépend d'ADR-000.

## Context

Plan V2.3.1 §108 : « Toute sortie réseau passe par une autorité
commune. »

Applicable (plan §108) : HTTP, OpenAPI, Connector, MCP, Code avec
network, Shell avec network, Browser, AI network tool.

Pipeline (plan §109) :

```text
NetworkRequestIntent
  -> Capability
  -> Network Policy Authority
  -> DNS resolution
  -> IP validation
  -> egress enforcement
  -> network executor
```

`NetworkRequestIntent` (plan §110) : `scheme`, `hostname`, `port`,
`DeploymentScope`, `destination capability`, `credential binding if
applicable`, `redirect policy`, `request class`.

Validation (plan §111) : IPv4, IPv6, IPv4-mapped IPv6, loopback,
private range, link-local, cloud metadata, DNS rebinding, redirect.

Redirect (plan §112) : chaque redirect est revalidé comme nouvelle
destination.

Network capability (plan §113) : resource-scoped
`network.request { schemes, hosts, ports }`, pas seulement boolean.

## Decision architecturale (M1, exécution après ADR-000)

1. **Création d'un Network Authority central**
   (`@unifia/network-authority/`, nouveau package). Il n'est pas une
   autorité durable d'exécution (plan §2), mais un point d'application
   unique de la policy réseau.

2. **Tous les executors network** (HTTP, MCP distant, Connector,
   Browser GA) passent par le Network Authority. Aucun chemin réseau
   direct (cf. plan §238 « network executor bypasses Network Authority
   » = NO-GO immédiat).

3. **L'IR cible (ADR-002) n'a que `tool.http`** dans ses 6 `node
   families`. MCP distant et Connector sont post-M3.

4. **Tests obligatoires** (plan §147) avant tout profile réseau GA :
   - localhost
   - 127.0.0.1
   - ::1
   - RFC1918
   - link local
   - metadata (169.254.169.254)
   - IPv6
   - mapped IPv6
   - redirect private
   - DNS rebinding
   - numeric IP
   - userinfo
   - IDN / punycode

5. **Gate** (plan §205) : `forbidden network connections = 0`.

## Consequences

- `@unifia/network-authority/` créé.
- `workbench-server` route les requêtes HTTP sortantes via le
  Network Authority.
- L'IR `tool.http` déclare sa `NetworkRequestIntent` à la compilation.
- ADR-002 (IR) doit supporter le `NetworkRequestIntent`.
- Les baselines SSRF sont obligatoires avant tout profile réseau GA.

## Liens

- plan V2.3.1 §108-113, §205
- THREAT_MODEL §1.6 (TM-N-01..05)
- ADR-000, ADR-002
- ADR-009 (policy)
- ADR-011 (MCP)
- ADR-012 (connector)
- ADR-013 (browser)
