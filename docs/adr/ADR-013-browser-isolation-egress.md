<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-013 — Browser Isolation / Egress Integration

> **Statut** : DECIDED
> **Date** : 2026-09-01
> **Source** : plan V2.3.1 §143-151, ADR-023, ADR-024, ADR-009.

## Status

DECIDED 2026-09-01. Dépend d'ADR-023 (Network Authority), ADR-024
(extension). Couvre le Browser Track (post-M3). Implémentation
browser différée à post-M3 ; pour la première certification, pas de
browser GA. Décision tranchée sur la base de
`AUTOMATE_TRUST_PATH §D.1`.

## Context

Plan V2.3.1 §143 : `browser.host-assisted` et `browser.isolated`.

§144 (high assurance) :

```text
Kernel
-> capability
-> Browser Worker
-> isolated process/container/VM
-> Network Authority + OS enforcement
-> Internet
```

§145 : `BrowserContext` est **defense-in-depth**, pas boundary réseau.

§146 : contrôler ou désactiver HTTP, HTTPS, WebSocket, DNS, IPv4, IPv6,
redirect, QUIC, HTTP3, WebRTC, DoH, service workers, prefetch,
external protocols.

§147 : tests SSRF (cf. ADR-023).

§148 : secret browser — le secret peut exister seulement dans
Secret Broker, trusted Browser boundary, authorized destination.

§149 : auth interaction — `inject -> submit -> scrub model-visible
surfaces -> observe`.

§150 : prompt injection — web content = `untrusted_external`.

§151 : observation binding — `observationId, pageId, origin, URL,
stateDigest`. Mismatch = `STALE_OBSERVATION`.

## Decision

### Profils

- `browser.host-assisted` : app allowlist, window identity, foreground
  validation, restricted actions, strong approvals. **Best-effort**.
- `browser.isolated` : dedicated OS session / VM, network isolation,
  filesystem boundary, application allowlist, process identity,
  restricted system surfaces.

### High assurance (plan §144)

```text
Kernel
  -> Capability (workflow.run + browser.navigate)
  -> Browser Worker (subprocess Playwright)
  -> Network Authority (ADR-023) + OS enforcement (container, VM)
  -> Internet
```

### Channels (plan §146)

| Channel | Default | Override |
|---|---|---|
| HTTP/HTTPS | allow | configurable par `NetworkPolicy` |
| WebSocket | allow | configurable |
| DNS | via Network Authority | deny (DoH) possible |
| IPv4/IPv6 | allow | configurable |
| redirect | revalidé par Network Authority | refuse si privé |
| QUIC / HTTP3 | configurable | default deny |
| WebRTC | deny (default) | opt-in rare |
| DoH | configurable | default OS resolver |
| service workers | configurable | default deny |
| prefetch | deny (default) | opt-in |
| external protocols | deny (default) | — |

### Secret scrub (plan §148)

Avant toute surface model-visible (DOM, accessibility, screenshot) :

```text
@Secret surfaces interdites:
  history, logs, traces, LLM, model-visible DOM, model-visible
  accessibility, model-visible screenshot, artifacts, debugger,
  audit export

@Before sending to LLM:
  1. Extract DOM text
  2. Filter against SecretPattern (regex on known secret shapes)
  3. Filter against Taint (taint: secret, auth_session, PII, etc.)
  4. Send filtered text to LLM
```

### Prompt injection (plan §150)

- Web content = `untrusted_external` taint (plan §121).
- Le runtime **bloque** les actions interdites proposées par le LLM.
- Mesure : `forbidden side effects = 0`.

### Observation binding (plan §151)

```ts
type Observation = {
  observationId: string;
  pageId: string;
  origin: string;
  url: string;
  stateDigest: DigestEnvelope<"browser-state">;
};

// Si pageId ou stateDigest change entre deux observations:
// STALE_OBSERVATION -> invalidate la séquence
```

## Consequences

- `@unifia/browser-runtime/` (présent) étendu avec isolation + Network
  Authority bridge.
- `@unifia/computer-use-safety/` (présent) intègre les tests du plan
  §227.
- `BrowserConfig` type dans `contracts/browser.ts` (étendu).

## Security impact

- TM-N-01..05 : addressés par ADR-023 + ADR-013.
- TM-AG-02 (forbidden side effect) : addressé par §150.
- TM-DF-02 (DOM → LLM) : addressé par §148.

## Liens

- plan V2.3.1 §143-151, §227
- THREAT_MODEL §1.6
- ADR-009, ADR-014, ADR-023, ADR-024
