/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * Local Integrations contracts (Plan V2.3.1 §207, ADR-005, ADR-007, ADR-024).
 *
 * Five connector shapes that the orchestrator uses to talk to
 * the outside world from a `local-single-node` profile. The
 * connector *contracts* are declared here; the connector SDK
 * (LI-05) provides the runtime classes that implement them. The
 * HTTP connector (LI-01) is a thin specialization of the M3
 * `EffectNodeConfigSchema` and reuses its `idempotency` field.
 *
 *   - LI-01 HTTP          : `HttpConnectorConfigSchema`
 *   - LI-02 OpenAPI       : `OpenApiConnectorConfigSchema`
 *   - LI-03 OAuth         : `OAuthConfigSchema`
 *   - LI-04 MCP           : `McpConnectorConfigSchema`
 *   - LI-05 Connector SDK : `ConnectorSdkInterfaceSchema`
 *
 * The LI-06 (Code/Shell) connector is RED and intentionally
 * omitted — it requires a dedicated security ADR.
 *
 * Cross-reference: this module is *contract-only*. Runtime
 * enforcement (network broker, secret broker, etc.) lives in
 * the connector SDK and waits on ADR-000 (substrate).
 */
import { z } from "zod"

/* ------------------------------------------------------------------ */
/* LI-01 — HTTP connector                                              */
/* ------------------------------------------------------------------ */

/**
 * Maximum characters in a single HTTP header *name*.
 * RFC 9110 §5.1 forbids colons and whitespace in field names and
 * recommends a sensible upper bound; we cap at 256 chars.
 */
export const HTTP_HEADER_NAME_MAX_CHARS = 256

/**
 * Maximum characters in a single HTTP header *value*.
 * Most servers cap header lines around 4-8 KB; 4 KB is safe.
 */
export const HTTP_HEADER_VALUE_MAX_CHARS = 4096

/**
 * Maximum HTTP request body size (10 MB). Bodies larger than
 * this should stream or be split — the connector refuses them.
 */
export const HTTP_BODY_MAX_BYTES = 10 * 1024 * 1024

/** HTTP methods supported by the connector. */
export const HttpMethodSchema = z.enum([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
])
export type HttpMethod = z.infer<typeof HttpMethodSchema>

/** A single HTTP header (name + value). */
export const HttpHeaderSchema = z.object({
  name: z.string().min(1).max(HTTP_HEADER_NAME_MAX_CHARS),
  value: z.string().min(1).max(HTTP_HEADER_VALUE_MAX_CHARS),
})
export type HttpHeader = z.infer<typeof HttpHeaderSchema>

/**
 * HTTP connector configuration. The `idempotencyKey` field is
 * the *connector-level* key; it is later bound to M3-03's
 * `EffectNodeConfig.idempotency` class (NONE / PROVIDER / USER /
 * BUSINESS) when the node is materialized.
 */
export const HttpConnectorConfigSchema = z.object({
  method: HttpMethodSchema,
  url: z.string().url(),
  headers: z.array(HttpHeaderSchema).readonly().optional(),
  body: z.string().max(HTTP_BODY_MAX_BYTES).optional(),
  /** Timeout in milliseconds. */
  timeoutMs: z.number().int().positive().max(600_000).default(30_000),
  /**
   * Idempotency key — reuses M3-03's `EffectNodeConfig.idempotency`
   * concept. The runtime will reject retries if the connector-level
   * `idempotency` class is NONE.
   */
  idempotencyKey: z.string().min(1).max(256).optional(),
})
export type HttpConnectorConfig = z.infer<typeof HttpConnectorConfigSchema>

/** Trust-boundary helper: parse an opaque `config` against the HTTP schema. */
export function parseHttpConnectorConfig(input: unknown): HttpConnectorConfig {
  return HttpConnectorConfigSchema.parse(input)
}

/* ------------------------------------------------------------------ */
/* LI-02 — OpenAPI connector                                           */
/* ------------------------------------------------------------------ */

/** Maximum size of a fetched OpenAPI spec (5 MB). */
export const OPENAPI_SPEC_MAX_BYTES = 5 * 1024 * 1024

/**
 * OpenAPI 3.x connector configuration. The connector resolves the
 * spec at runtime, locates the named operation, and emits the
 * corresponding HTTP request through the LI-01 HTTP connector.
 */
export const OpenApiConnectorConfigSchema = z.object({
  /** URL or relative path to the OpenAPI 3.x spec. */
  spec: z.string().min(1),
  /** Operation ID within the spec, e.g. `listUsers`. */
  operationId: z.string().min(1).max(256),
  /** Base URL override (defaults to the spec's `servers[0].url`). */
  baseUrl: z.string().url().optional(),
  /**
   * Auth overrides layered on top of the spec's security schemes.
   * `kind: "none"` is the default; the others carry the necessary
   * references to the secret broker.
   */
  auth: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("none") }),
    z.object({
      kind: z.literal("apiKey"),
      headerName: z.string().min(1),
      keyRef: z.string().min(1),
    }),
    z.object({ kind: z.literal("bearer"), tokenRef: z.string().min(1) }),
    z.object({ kind: z.literal("oauth2"), configRef: z.string().min(1) }),
  ]),
})
export type OpenApiConnectorConfig = z.infer<typeof OpenApiConnectorConfigSchema>

/* ------------------------------------------------------------------ */
/* LI-03 — OAuth configuration                                         */
/* ------------------------------------------------------------------ */

/** Maximum length of an OAuth token endpoint URL (1024 chars). */
export const OAUTH_TOKEN_URL_MAX_CHARS = 1024

/** Maximum number of OAuth scopes per connector config. */
export const OAUTH_SCOPES_MAX = 64

/** Maximum length of an OAuth client ID (256 chars). */
export const OAUTH_CLIENT_ID_MAX_CHARS = 256

/** OAuth 2.0 flows supported by the connector. */
export const OAuthFlowSchema = z.enum([
  "authorization_code",
  "client_credentials",
  "password",
  "implicit",
])
export type OAuthFlow = z.infer<typeof OAuthFlowSchema>

/**
 * OAuth 2.0 configuration. The connector handles only the
 * *configuration* (which flow, which client, which endpoint) —
 * the actual token acquisition is delegated to the secret broker
 * and to the OAuth runtime. The `redirectUri` refinement enforces
 * the OAuth 2.0 RFC 6749 §4.1 rule that authorization_code and
 * implicit flows MUST have a redirect URI.
 */
export const OAuthConfigSchema = z
  .object({
    flow: OAuthFlowSchema,
    clientId: z.string().min(1).max(OAUTH_CLIENT_ID_MAX_CHARS),
    /** Reference to the client secret in the secret broker. */
    clientSecretRef: z.string().min(1).max(256),
    tokenEndpoint: z.string().url().max(OAUTH_TOKEN_URL_MAX_CHARS),
    scopes: z.array(z.string().min(1)).max(OAUTH_SCOPES_MAX).readonly().optional(),
    /** Redirect URI required for `authorization_code` and `implicit`. */
    redirectUri: z.string().url().optional(),
    /** PKCE for `authorization_code` (recommended). */
    pkce: z.boolean().default(true),
  })
  .refine(
    (cfg) => {
      if (cfg.flow === "authorization_code" || cfg.flow === "implicit") {
        return typeof cfg.redirectUri === "string" && cfg.redirectUri.length > 0
      }
      return true
    },
    {
      message: "oauth: redirectUri is required for authorization_code and implicit flows",
    },
  )
export type OAuthConfig = z.infer<typeof OAuthConfigSchema>

/** Trust-boundary helper: parse an opaque OAuth config. */
export function parseOAuthConfig(input: unknown): OAuthConfig {
  return OAuthConfigSchema.parse(input)
}

/* ------------------------------------------------------------------ */
/* LI-04 — MCP connector                                               */
/* ------------------------------------------------------------------ */

/** Maximum length of an MCP server URL (1024 chars). */
export const MCP_SERVER_URL_MAX_CHARS = 1024

/** MCP capabilities the connector subscribes to. */
export const McpCapabilitySchema = z.enum([
  "tools",
  "resources",
  "prompts",
  "logging",
  "sampling",
])
export type McpCapability = z.infer<typeof McpCapabilitySchema>

/**
 * Model Context Protocol (MCP) connector configuration. The
 * connector speaks the MCP wire protocol against the configured
 * `serverUrl` over the selected `transport` and subscribes to the
 * declared `capabilities`. The auth token, when present, is
 * fetched from the secret broker (LI-03 / ADR-010).
 */
export const McpConnectorConfigSchema = z.object({
  serverUrl: z.string().url().max(MCP_SERVER_URL_MAX_CHARS),
  capabilities: z.array(McpCapabilitySchema).min(1).readonly(),
  /** Per-server transport. Default `stdio` for local, `http` for remote. */
  transport: z.enum(["stdio", "http", "websocket"]).default("stdio"),
  /** Reference to the auth token in the secret broker (for remote MCP). */
  authTokenRef: z.string().min(1).max(256).optional(),
})
export type McpConnectorConfig = z.infer<typeof McpConnectorConfigSchema>

/* ------------------------------------------------------------------ */
/* LI-05 — Connector SDK interface                                     */
/* ------------------------------------------------------------------ */

/** Semver pattern (X.Y.Z, no pre-release, no build metadata). */
export const CONNECTOR_SDK_VERSION_PATTERN = /^\d+\.\d+\.\d+$/

/**
 * Connector SDK interface contract. Each connector registers
 * with the orchestrator by declaring its name, the semver of
 * the SDK it targets, the `configSchemaRef` pointing at the
 * configuration validator (LI-01..04), and the capabilities it
 * exposes at registration time.
 */
export const ConnectorSdkInterfaceSchema = z.object({
  version: z.string().regex(CONNECTOR_SDK_VERSION_PATTERN, "sdk: version must be semver"),
  name: z.string().min(1).max(128),
  /**
   * The configuration schema is the schema of the connector's
   * `connect(config)` argument. Storing the reference (not the
   * schema itself) keeps the IR serializable.
   */
  configSchemaRef: z.string().min(1),
  /** Capabilities the connector declares at registration time. */
  capabilities: z.array(z.string()).readonly(),
})
export type ConnectorSdkInterface = z.infer<typeof ConnectorSdkInterfaceSchema>

/** Trust-boundary helper: parse an opaque SDK interface declaration. */
export function parseConnectorSdkInterface(input: unknown): ConnectorSdkInterface {
  return ConnectorSdkInterfaceSchema.parse(input)
}
