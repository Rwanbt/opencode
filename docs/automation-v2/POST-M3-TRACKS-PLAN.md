<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# POST-M3 TRACKS IMPLEMENTATION PLAN — UNIFIA AUTOMATE

> **Statut** : DRAFT (planning only — no code, no commit)
> **Phase** : Post-M3 (livrable §202-206 du plan V2.3.1)
> **Date** : 2026-09-02
> **Auteur** : Mavis root session `mvs_56ff19232dc5452082047fce8c11b9c4`
> **Source canonique** :
> [`docs/automation-v2/EXECUTION_STATUS.md`](./EXECUTION_STATUS.md),
> [`docs/automation-v2/M3-IMPLEMENTATION-PLAN.md`](./M3-IMPLEMENTATION-PLAN.md),
> [`docs/automation-v2/M2-IMPLEMENTATION-PLAN.md`](./M2-IMPLEMENTATION-PLAN.md),
> [`docs/automation-v2/IMPLEMENTATION_CARD_INDEX.md`](./IMPLEMENTATION_CARD_INDEX.md),
> plan V2.3.1 (vault) §202-206 (tracks parallèles + Security Core + External Ingress + Network + Connector/MCP + Local Integrations).

---

## 0. Reader's map

| Section | Contenu |
|---|---|
| §1 | Pré-requis et état au 2026-09-02 (post-M3) |
| §2 | 5 tracks principaux + 4 tracks spécialisés (50+ cartes) |
| §3 | Mapping carte → ADR / fichiers / acceptance |
| §4 | Statut GREEN/RED par carte |
| §5 | DAG d'implémentation (rounds) |
| §6 | Critères de sortie Post-M3 |
| §7 | Risques |
| §8 | Suite immédiate (rounds agents) |

---

## 1. Pré-requis et état au 2026-09-02

**M2 + M3 COMPLET** (85 commits, 0 push) :
- M2 : 6/6 cartes GREEN + M2-TEST (graph property, 46/46 mutation-testé)
- M3 : 7/7 cartes GREEN + M3-TEST (crash matrix, 10 positions) — sauf 3 RED runtime-only (M3-08/09/10 impl)
- 538/0 tests V2 (397 contracts + 141 m0-contract)
- 25/26 ADR DECIDED (ADR-000 toujours CHANGES_REQUIRED)

**ADR DECIDED disponibles** : ADR-001 (canonical), 002 (IR), 003 (expression), 004 (history), 005 (artifact), 007 (side-effect retry), 008 (scheduler), 009 (policy), 010 (secret), 011 (MCP compat), 012 (connector), 013 (browser isolation), 014 (computer-use), 015 (git db), 016 (history retention), 017 (legacy migration), 018 (rolling upgrade), 019 (untrusted shell), 020 (ownership), 021 (repo topology), 022 (timer), 023 (network egress), 024 (extension runtime), 026 (typed digest envelope).

**ADR encore PROPOSED** : ADR-001 (canonical serialization) — peut être contournée avec `EffectIdDeriver` port.

**ADR bloqué** : ADR-000 (substrate).

---

## 2. Les 50+ cartes Post-M3

### 2.1 Vue d'ensemble (7 tracks principaux)

| # | Track | Items | ADR principal | Statut |
|---|---|---|---|---|
| 1 | Security Core | 8 | ADR-008 (scheduler), ADR-009 (policy), ADR-010 (secret), ADR-022 (timer) | 4 GREEN + 4 partiels |
| 2 | External Ingress | 3 | ADR-008 | 3 GREEN |
| 3 | Network | 7 | ADR-023 | 7 GREEN |
| 4 | Connector/MCP | 7 | ADR-011, ADR-012, ADR-024 | 4 GREEN + 3 partiels |
| 5 | Local Integrations | 6 | ADR-005, ADR-007, ADR-024 | 4 GREEN + 2 partiels |
| 6 | Distributed Server | 11 | ADR-008, ADR-009 | 4 GREEN + 7 partiels |
| 7 | Browser + AI Compiler + Enterprise + UX + Desktop | 9+ | ADR-013, ADR-014, ADR-019 | 5 GREEN + 4 partiels |
| **Total** | **51+** | | | |

### 2.2 Detail carte par carte

#### SECURITY CORE (§203, 8 items)

| ID | Carte | Statut | Livrable |
|---|---|---|---|
| SC-01 | Capability Authority | **GREEN** (partiel) | `CapabilityAuthority` (déjà M1-08 capability enforcer) — étendre avec `subject`, `action`, `resource` discriminants |
| SC-02 | Policy | **GREEN** (partiel) | `Policy` ADR-009 (existe partiellement) — formaliser `Rule { when, then, else }` |
| SC-03 | Approval | **GREEN** | `ApprovalBinding` (nouveau) — `requiredApprovals: int ≥ 1`, `approvers: [string]` |
| SC-04 | tenant enforcement | **GREEN** (partiel) | `TenantContext` (existe via OwnershipScope) — étendre avec `tenantId` requis |
| SC-05 | taint runtime | **GREEN** | `TaintTracker` — `markTainted(input)`, `isTainted(output)`, propagation rules |
| SC-06 | Secret Broker | **DONE** (M1-07 + M1-08) | déjà implémenté, juste spec d'API publique |
| SC-07 | Key Authority integration | **GREEN** | `KeyAuthority` interface (Key Authority ADR-015) — dérive de `keyAuthorityId` |
| SC-08 | worker/service identities | **GREEN** | `Identity` branded (M0 I2 ids.ts) — formaliser `WorkerId`, `ServiceId` |

#### EXTERNAL INGRESS (§204, 3 items)

| ID | Carte | Statut | Livrable |
|---|---|---|---|
| EI-01 | webhooks | **GREEN** | `WebhookTrigger` (extends `TriggerDefinitionSchema` M1) — `url`, `secret`, `authMethod: enum[hmac, basic, none]` |
| EI-02 | external events | **GREEN** | `EventTrigger` — `eventType`, `source: enum[stripe, github, slack, custom]`, `filter?` |
| EI-03 | polling triggers | **GREEN** | `PollingTrigger` — `interval`, `endpoint`, `lastPolledAt?`, `etag?` |

#### NETWORK (§205, 7 items, gate `forbidden_network_connections = 0`)

| ID | Carte | Statut | Livrable |
|---|---|---|---|
| NW-01 | Network Authority | **GREEN** | `NetworkAuthority` interface — `allow(host|ip|domain, port)`, `deny(...)`, `resolve(host)` |
| NW-02 | DNS validation | **GREEN** | `DnsResolver` interface — `resolve(host): string[]` (returns IPs) |
| NW-03 | IP enforcement | **GREEN** | `IpEnforcer` — `isAllowed(ip: string): boolean` against allowlist |
| NW-04 | redirect validation | **GREEN** | `RedirectValidator` — `validate(from, to): boolean`, refuse cross-origin redirects |
| NW-05 | SSRF protection | **GREEN** | `SsrfProtector` — `isPrivateIp(ip): boolean`, refuse loopback/private/multicast |
| NW-06 | resource capabilities | **GREEN** | `NetworkCapabilities` — `outbound: bool`, `inbound: bool`, `allowedProtocols: [tcp/udp/http/https]` |
| NW-07 | profile-specific enforcement | **GREEN** | `ProfileNetworkPolicy` — `local-single-node` (loopback only), `server-single-node` (allowlist) |

#### CONNECTOR / MCP (§206, 7 items, 5 gates)

| ID | Carte | Statut | Livrable |
|---|---|---|---|
| CO-01 | extension worker isolation | **GREEN** (partiel) | `ExtensionWorker` (ADR-024) — déjà spec, formaliser isolation scope |
| CO-02 | clean env | **GREEN** | `CleanEnv` — `subprocess.spawn(cmd, env: {})` filtered to only safe vars |
| CO-03 | Secret broker (extension) | **DONE** (M1-07) | extension consumes `@unifia/secret-broker` |
| CO-04 | network broker | **GREEN** | `NetworkBroker` (extension side) — uses NW-01..07 |
| CO-05 | filesystem broker | **GREEN** | `FilesystemBroker` — `allow(path)`, `read(path)`, `write(path, data)`, scoped to extension workspace |
| CO-06 | resource limits | **GREEN** (partiel) | `ResourceLimits` — `cpuMs`, `memoryMb`, `networkBytes`, `diskBytes` |
| CO-07 | local MCP isolation | **GREEN** | `McpIsolation` — MCP server scoped to extension identity |

#### LOCAL INTEGRATIONS (§207, 6 items)

| ID | Carte | Statut | Livrable |
|---|---|---|---|
| LI-01 | HTTP | **GREEN** (partiel) | `HttpConnector` (M2 implicit) — formaliser `method`, `url`, `headers`, `body`, `idempotencyKey` |
| LI-02 | OpenAPI | **GREEN** | `OpenApiConnector` — `spec: string (URL or path)`, `operationId`, `auth: AuthConfig` |
| LI-03 | OAuth | **GREEN** | `OAuthConfig` — `flow: enum[authorization_code, client_credentials]`, `scopes`, `tokenEndpoint` |
| LI-04 | MCP | **GREEN** (partiel) | `McpConnector` (CO-07 related) — `serverUrl`, `capabilities: [tools, resources, prompts]` |
| LI-05 | Connector SDK | **GREEN** | `ConnectorSDK` interface — `connect(config): Connector`, `dispose()` |
| LI-06 | Code/Shell (if certified) | **RED** | nécessite ADR séparé (security review) — pas en GREEN |

#### DISTRIBUTED SERVER (§208-209, 11 items)

| ID | Carte | Statut | Livrable |
|---|---|---|---|
| DS-01 | worker registry | **GREEN** (partiel) | `WorkerRegistry` (M1-08 capability worker) — étendre avec `register`, `deregister`, `heartbeat` |
| DS-02 | leases | **GREEN** | `Lease` — `id`, `holder`, `expiresAt`, `fencingToken` |
| DS-03 | fencing | **GREEN** | `FencingToken` — monotonically increasing counter, `isValid(prev): boolean` |
| DS-04 | queues | **GREEN** | `WorkQueue` — `enqueue(item)`, `dequeue(worker)`, `ack(item)`, `nack(item)` |
| DS-05 | fair scheduling | **GREEN** | `FairScheduler` — `nextWorker(): WorkerId` round-robin / priority-based |
| DS-06 | resource quotas | **GREEN** (partiel) | `Quota` — `cpuMsPerHour`, `memoryMbPeak`, `networkBytesPerDay` (CO-06 reuse) |
| DS-07 | global rate limiting | **GREEN** | `RateLimiter` — `acquire(token): boolean`, `available(): int` |
| DS-08 | budgets | **GREEN** | `Budget` — `monthlySpend: number`, `remainingSpend: number` |
| DS-09 | HA | **RED** (architecture choice) | `HaConfig` — `replicationFactor: int`, `leaderElection: enum[raft, simple]` |
| DS-10 | rolling upgrade | **RED** | `UpgradeStrategy` — `canaryPercent: int`, `rollbackOnErrorRate: float` |
| DS-11 | cluster recovery | **RED** | `RecoveryPolicy` — `replayFromHistory: bool`, `maxRecoveryMs: int` |

#### BROWSER (§218, 2 items)

| ID | Carte | Statut | Livrable |
|---|---|---|---|
| BR-01 | browser isolation (ADR-013) | **GREEN** | `BrowserIsolation` — `csp: string`, `iframeSandbox: enum[allow-same-origin, allow-scripts]` |
| BR-02 | egress control | **GREEN** | `BrowserEgressPolicy` — `allowedOrigins: [string]`, `blockThirdPartyCookies: bool` |

#### AI COMPILER (§222, 2 items)

| ID | Carte | Statut | Livrable |
|---|---|---|---|
| AI-01 | prompt → IR | **GREEN** | `AiCompiler` interface — `compile(prompt: string): Promise<WorkflowIR>` (impl LLM-based) |
| AI-02 | IR validation | **GREEN** | `IrValidator` — `validate(ir: WorkflowIR): ValidationResult` (uses M3-04 retry context) |

#### ENTERPRISE (§226, 3 items)

| ID | Carte | Statut | Livrable |
|---|---|---|---|
| EN-01 | SSO | **GREEN** | `SsoConfig` — `provider: enum[okta, azure-ad, google-workspace]`, `metadataUrl` |
| EN-02 | audit log | **GREEN** | `AuditLog` — `entries: [AuditEntry]`, retention policy |
| EN-03 | compliance | **GREEN** | `ComplianceConfig` — `frameworks: enum[soc2, hipaa, gdpr]`, controls |

#### UX (§230, 1 item)

| ID | Carte | Statut | Livrable |
|---|---|---|---|
| UX-01 | workflow editor | **GREEN** | `WorkflowEditor` interface — `nodes`, `edges`, `dragDrop`, `validation` (uses M2 graph validators) |

#### DESKTOP (§234, 1 item)

| ID | Carte | Statut | Livrable |
|---|---|---|---|
| DK-01 | Tauri host | **RED** | `TauriHost` — `window`, `menu`, `tray`, `notifications` (per-OS, no ADR yet) |

---

## 3. Mapping carte → ADR / fichiers / acceptance

Pour chaque carte GREEN, le pattern est :
- Nouveau fichier `packages/contracts/src/<track>.ts` (≤300 LOC)
- Test file `packages/contracts/test/<track>.test.ts` (≤400 LOC)
- 8-12 tests verts minimum

Pour les cartes "partiel" (DONE en M1), juste étendre/refactorer.

Pour les cartes RED, **NE PAS** coder — laisser en RED dans EXEC_STATUS, bloquer sur ADR ou design choice.

---

## 4. Statut GREEN/RED par carte

**Total : 51+ cartes**
- **GREEN** (à faire maintenant) : ~38 (Security Core 4/8 + External Ingress 3/3 + Network 7/7 + Connector 4/7 + Local Integrations 4/6 + Distributed Server 4/11 + Browser 2/2 + AI Compiler 2/2 + Enterprise 3/3 + UX 1/1)
- **Partiel DONE** (extension/refactor) : ~9
- **RED** (bloqué) : ~4 (Code/Shell, HA, rolling upgrade, cluster recovery, Tauri host)

---

## 5. DAG d'implémentation (rounds)

### Round 1 (3 workers en parallèle) — 13 cartes
- W1 : Security Core (SC-01..05 + SC-07..08) = 7 cartes
- W2 : External Ingress (EI-01..03) + Network (NW-01..07) = 10 cartes (en 1 commit unifié pour le même fichier)
- W3 : Local Integrations (LI-01..05) = 5 cartes

### Round 2 (3 workers en parallèle) — 11 cartes
- W4 : Connector (CO-01..07) = 7 cartes
- W5 : Distributed Server (DS-01..08) = 8 cartes (sans DS-09/10/11 RED)
- W6 : Browser (BR-01..02) + AI Compiler (AI-01..02) + Enterprise (EN-01..03) + UX (UX-01) = 8 cartes

### Round 3 (post-M3 FINAL CHECK)
- Update EXEC_STATUS
- Save vault session
- Update gate list
- Decide on certifications

---

## 6. Critères de sortie Post-M3

| Critère | Cible | Mesure |
|---|---|---|
| 38/38 GREEN cartes livrées | commits + `bun test` | passes |
| 0 régression | 538 tests verts (avant Post-M3) | `bun test` |
| 0 nouveau typecheck warning | 43/43 packages clean | `bun run typecheck` |
| 0 modif kernel `workflow-runtime` | `git diff packages/workflow-runtime` = 0 | diff |
| Pas de push / PR / merge / tag | 0 of each | git log + remotes |

---

## 7. Risques

| ID | Risque | Cible | Mitigation |
|---|---|---|---|
| PostM3-R01 | Scope trop large (51+ cartes) | drift | rounds de 3-4 workers, pas plus |
| PostM3-R02 | Overlap avec M0 contract (Identity, EffectKey) | régression | cross-ref explicite dans briefs |
| PostM3-R03 | ADRs manquants (EN-01 SSO, EN-03 compliance) | décision bloquée | skeletons contracts only, ADR deferred |
| PostM3-R04 | Tests flaky sur property tests | faux positifs | property tests avec seed fixe, 3 runs |

---

## 8. Suite immédiate (rounds agents)

### 8.1 Round 1 — 3 workers en parallèle (13 cartes)

| Worker | Cartes | Fichiers cible | Acceptance |
|---|---|---|---|
| W1 | Security Core (SC-01..05, 07, 08) | `packages/contracts/src/security-core.ts` (nouveau) + `test/security-core.test.ts` | 50+ tests verts |
| W2 | External Ingress + Network (13 cartes) | `packages/contracts/src/{ingress,network}.ts` (2 nouveaux) + tests | 40+ tests verts |
| W3 | Local Integrations (LI-01..05) | `packages/contracts/src/integrations.ts` (nouveau) + test | 30+ tests verts |

### 8.2 Round 2 — 3 workers en parallèle

- W4 : Connector / MCP Track (CO-01..07)
- W5 : Distributed Server (DS-01..08)
- W6 : Browser + AI Compiler + Enterprise + UX (BR + AI + EN + UX)

### 8.3 Round 3 — finalisation

- EXEC_STATUS update
- Vault save
- Certification prep

---

## 9. Liens canoniques

- Plan V2.3.1 §202-206 (tracks) : lignes 4735-4900
- ADR-008 (scheduler) : `docs/adr/ADR-008-scheduler-worker-time-authority.md`
- ADR-009 (policy) : `docs/adr/ADR-009-policy-authority.md`
- ADR-010 (secret) : `docs/adr/ADR-010-secret-credential-key-model.md`
- ADR-022 (timer) : `docs/adr/ADR-022-timer-timeout-cancellation.md`
- ADR-023 (network) : `docs/adr/ADR-023-network-egress-ssrf-authority.md`
- ADR-024 (extension) : `docs/adr/ADR-024-extension-runtime-trust-isolation.md`
- ADR-013 (browser) : `docs/adr/ADR-013-browser-isolation-egress.md`
- M1-07 SecretBroker : `packages/secret-broker/` (DONE)
- M1-08 capability enforcer : `packages/capability-runtime/` (DONE)
- M3 contrats : `packages/contracts/src/{workflow-ir,timeout,cancellation}.ts`
- EXEC_STATUS : `docs/automation-v2/EXECUTION_STATUS.md` (M3-IMPLEMENTATION-COMPLETE)

---

*Fin du plan Post-M3. 51+ cartes en 2 rounds (R1 = 13 cartes, R2 = 23 cartes, R3 = finalisation).*
