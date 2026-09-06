/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

/**
 * Post-M3 Round 1 — Local Integrations contracts (Plan V2.3.1 §207,
 * ADR-005, ADR-007, ADR-024).
 *
 * Five GREEN cards (LI-01..LI-05) — 25 tests total (5 per card).
 * LI-06 (Code/Shell) is RED and intentionally skipped (it needs a
 * dedicated security ADR).
 *
 * Locked invariants (regression net):
 *   LI-01 HTTP
 *     (1) Minimal GET parses with the documented defaults.
 *     (2) Full POST parses with headers, body, timeout, idempotencyKey.
 *     (3) Non-URL `url` is rejected.
 *     (4) Body > 10 MB is rejected.
 *     (5) `timeoutMs` ≤ 0 or non-integer is rejected.
 *
 *   LI-02 OpenAPI
 *     (6) Minimal spec + operationId + auth=none parses.
 *     (7) apiKey auth requires headerName + keyRef.
 *     (8) `baseUrl` override is accepted when present.
 *     (9) Empty `operationId` is rejected.
 *    (10) Round-trip: parse → JSON → re-parse is equal.
 *
 *   LI-03 OAuth
 *    (11) `client_credentials` parses without `redirectUri`.
 *    (12) `authorization_code` without `redirectUri` is rejected.
 *    (13) `authorization_code` with `redirectUri` is accepted.
 *    (14) `scopes` > 64 is rejected.
 *    (15) Non-URL `tokenEndpoint` is rejected.
 *
 *   LI-04 MCP
 *    (16) Minimal stdio config with 1 capability and default transport.
 *    (17) `transport: "http"` + `authTokenRef` parses.
 *    (18) Empty `capabilities` array is rejected.
 *    (19) Non-URL `serverUrl` is rejected.
 *    (20) All five capabilities accepted in one config.
 *
 *   LI-05 Connector SDK
 *    (21) Minimal semver version + name + capabilities parses.
 *    (22) Non-semver version is rejected.
 *    (23) Empty name is rejected.
 *    (24) Round-trip: parse → JSON → re-parse is equal.
 *    (25) HTTP round-trip (`parseHttpConnectorConfig`).
 */
import { describe, expect, test } from "bun:test"
import {
  HttpConnectorConfigSchema,
  parseHttpConnectorConfig,
  OpenApiConnectorConfigSchema,
  OAuthConfigSchema,
  parseOAuthConfig,
  McpConnectorConfigSchema,
  ConnectorSdkInterfaceSchema,
  HTTP_BODY_MAX_BYTES,
  OAUTH_SCOPES_MAX,
  CONNECTOR_SDK_VERSION_PATTERN,
  type HttpConnectorConfig,
  type OpenApiConnectorConfig,
  type OAuthConfig,
  type ConnectorSdkInterface,
} from "../src/integrations.ts"

/* ------------------------------------------------------------------ */
/* LI-01 — HTTP connector                                              */
/* ------------------------------------------------------------------ */

describe("LI-01 HttpConnectorConfig — happy path (1, 2)", () => {
  test("(1) HttpConnectorConfig_ParsesMinimalGET — method/url only, defaults applied", () => {
    const parsed = HttpConnectorConfigSchema.parse({
      method: "GET",
      url: "https://api.example.com/users",
    })
    expect(parsed.method).toBe("GET")
    expect(parsed.url).toBe("https://api.example.com/users")
    expect(parsed.timeoutMs).toBe(30_000) // default
    expect(parsed.headers).toBeUndefined()
    expect(parsed.body).toBeUndefined()
    expect(parsed.idempotencyKey).toBeUndefined()
  })

  test("(2) HttpConnectorConfig_ParsesFullPOST — headers, body, timeout, idempotencyKey", () => {
    const parsed = HttpConnectorConfigSchema.parse({
      method: "POST",
      url: "https://api.example.com/orders",
      headers: [
        { name: "X-Trace-Id", value: "trace-abc-123" },
        { name: "Content-Type", value: "application/json" },
      ],
      body: '{"sku":"ABC-1","qty":3}',
      timeoutMs: 5_000,
      idempotencyKey: "order-create-2026-09-02-001",
    })
    expect(parsed.method).toBe("POST")
    expect(parsed.headers).toHaveLength(2)
    expect(parsed.headers?.[0]?.name).toBe("X-Trace-Id")
    expect(parsed.body).toBe('{"sku":"ABC-1","qty":3}')
    expect(parsed.timeoutMs).toBe(5_000)
    expect(parsed.idempotencyKey).toBe("order-create-2026-09-02-001")
  })
})

describe("LI-01 HttpConnectorConfig — rejections (3, 4, 5)", () => {
  test("(3) HttpConnectorConfig_RejectsBadURL — non-URL string is rejected", () => {
    expect(() =>
      HttpConnectorConfigSchema.parse({ method: "GET", url: "not-a-url" }),
    ).toThrow()
  })

  test("(4) HttpConnectorConfig_RejectsTooLargeBody — body > 10 MB is rejected", () => {
    const tooBig = "x".repeat(HTTP_BODY_MAX_BYTES + 1)
    expect(() =>
      HttpConnectorConfigSchema.parse({
        method: "POST",
        url: "https://api.example.com/big",
        body: tooBig,
      }),
    ).toThrow()
  })

  test("(5) HttpConnectorConfig_RejectsNegativeTimeout — timeoutMs: -1 is rejected", () => {
    expect(() =>
      HttpConnectorConfigSchema.parse({
        method: "GET",
        url: "https://api.example.com/x",
        timeoutMs: -1,
      }),
    ).toThrow()
  })
})

/* ------------------------------------------------------------------ */
/* LI-02 — OpenAPI connector                                           */
/* ------------------------------------------------------------------ */

describe("LI-02 OpenApiConnectorConfig — happy path (6, 7, 8)", () => {
  test("(6) OpenApiConnectorConfig_ParsesMinimal — spec + operationId + auth=none", () => {
    const parsed = OpenApiConnectorConfigSchema.parse({
      spec: "https://api.example.com/openapi.json",
      operationId: "listUsers",
      auth: { kind: "none" },
    })
    expect(parsed.spec).toBe("https://api.example.com/openapi.json")
    expect(parsed.operationId).toBe("listUsers")
    expect(parsed.auth.kind).toBe("none")
    expect(parsed.baseUrl).toBeUndefined()
  })

  test("(7) OpenApiConnectorConfig_ParsesApiKeyAuth — apiKey requires headerName + keyRef", () => {
    const parsed = OpenApiConnectorConfigSchema.parse({
      spec: "./specs/billing.yaml",
      operationId: "createInvoice",
      auth: { kind: "apiKey", headerName: "X-Api-Key", keyRef: "secret:billing.apiKey" },
    })
    if (parsed.auth.kind !== "apiKey") throw new Error("discriminator should be apiKey")
    expect(parsed.auth.headerName).toBe("X-Api-Key")
    expect(parsed.auth.keyRef).toBe("secret:billing.apiKey")
  })

  test("(8) OpenApiConnectorConfig_AcceptsBaseUrlOverride — baseUrl is parsed when present", () => {
    const parsed = OpenApiConnectorConfigSchema.parse({
      spec: "https://api.example.com/openapi.json",
      operationId: "listUsers",
      baseUrl: "https://eu.api.example.com",
      auth: { kind: "bearer", tokenRef: "secret:eu.token" },
    })
    expect(parsed.baseUrl).toBe("https://eu.api.example.com")
    if (parsed.auth.kind !== "bearer") throw new Error("discriminator should be bearer")
    expect(parsed.auth.tokenRef).toBe("secret:eu.token")
  })
})

describe("LI-02 OpenApiConnectorConfig — rejections and round-trip (9, 10)", () => {
  test("(9) OpenApiConnectorConfig_RejectsEmptyOperationId — operationId: '' is rejected", () => {
    expect(() =>
      OpenApiConnectorConfigSchema.parse({
        spec: "https://api.example.com/openapi.json",
        operationId: "",
        auth: { kind: "none" },
      }),
    ).toThrow()
  })

  test("(10) parseOpenApiConnectorConfig_RoundTripsValid — JSON round-trip preserves value", () => {
    const original: OpenApiConnectorConfig = {
      spec: "https://api.example.com/openapi.json",
      operationId: "deleteUser",
      baseUrl: "https://api.staging.example.com",
      auth: { kind: "oauth2", configRef: "secret:oauth.staging" },
    }
    const json = JSON.stringify(original)
    const reparsed = OpenApiConnectorConfigSchema.parse(JSON.parse(json))
    expect(reparsed).toEqual(original)
    if (reparsed.auth.kind !== "oauth2") throw new Error("discriminator should be oauth2")
    expect(reparsed.auth.configRef).toBe("secret:oauth.staging")
  })
})

/* ------------------------------------------------------------------ */
/* LI-03 — OAuth configuration                                         */
/* ------------------------------------------------------------------ */

describe("LI-03 OAuthConfig — happy path (11, 13)", () => {
  test("(11) OAuthConfig_ParsesClientCredentials — minimal, no redirectUri", () => {
    const parsed = OAuthConfigSchema.parse({
      flow: "client_credentials",
      clientId: "svc-billing",
      clientSecretRef: "secret:billing.clientSecret",
      tokenEndpoint: "https://auth.example.com/oauth/token",
    })
    expect(parsed.flow).toBe("client_credentials")
    expect(parsed.clientId).toBe("svc-billing")
    expect(parsed.clientSecretRef).toBe("secret:billing.clientSecret")
    expect(parsed.tokenEndpoint).toBe("https://auth.example.com/oauth/token")
    expect(parsed.redirectUri).toBeUndefined()
    expect(parsed.pkce).toBe(true) // default
    expect(parsed.scopes).toBeUndefined()
  })

  test("(13) OAuthConfig_ParsesAuthorizationCode_WithRedirectUri — accepted with PKCE", () => {
    const parsed = OAuthConfigSchema.parse({
      flow: "authorization_code",
      clientId: "web-app",
      clientSecretRef: "secret:web.clientSecret",
      tokenEndpoint: "https://auth.example.com/oauth/token",
      scopes: ["read:users", "write:users"],
      redirectUri: "https://app.example.com/oauth/callback",
      pkce: true,
    })
    expect(parsed.flow).toBe("authorization_code")
    expect(parsed.redirectUri).toBe("https://app.example.com/oauth/callback")
    expect(parsed.scopes).toEqual(["read:users", "write:users"])
    expect(parsed.pkce).toBe(true)
  })
})

describe("LI-03 OAuthConfig — refine + rejections (12, 14, 15)", () => {
  test("(12) OAuthConfig_ParsesAuthorizationCode_RequiresRedirectUri — refine rejects missing", () => {
    expect(() =>
      OAuthConfigSchema.parse({
        flow: "authorization_code",
        clientId: "web-app",
        clientSecretRef: "secret:web.clientSecret",
        tokenEndpoint: "https://auth.example.com/oauth/token",
      }),
    ).toThrow(/redirectUri/)
  })

  test("(14) OAuthConfig_RejectsTooManyScopes — > OAUTH_SCOPES_MAX scopes is rejected", () => {
    const tooMany = Array.from({ length: OAUTH_SCOPES_MAX + 1 }, (_, i) => `scope:${i}`)
    expect(() =>
      OAuthConfigSchema.parse({
        flow: "client_credentials",
        clientId: "svc-billing",
        clientSecretRef: "secret:billing.clientSecret",
        tokenEndpoint: "https://auth.example.com/oauth/token",
        scopes: tooMany,
      }),
    ).toThrow()
  })

  test("(15) OAuthConfig_RejectsBadTokenEndpoint — non-URL tokenEndpoint is rejected", () => {
    expect(() =>
      OAuthConfigSchema.parse({
        flow: "client_credentials",
        clientId: "svc-billing",
        clientSecretRef: "secret:billing.clientSecret",
        tokenEndpoint: "not-a-url",
      }),
    ).toThrow()
  })
})

/* ------------------------------------------------------------------ */
/* LI-04 — MCP connector                                               */
/* ------------------------------------------------------------------ */

describe("LI-04 McpConnectorConfig — happy path (16, 17, 20)", () => {
  test("(16) McpConnectorConfig_ParsesMinimalStdio — serverUrl + 1 capability + default transport", () => {
    const parsed = McpConnectorConfigSchema.parse({
      serverUrl: "stdio://local-mcp",
      capabilities: ["tools"],
    })
    expect(parsed.serverUrl).toBe("stdio://local-mcp")
    expect(parsed.capabilities).toEqual(["tools"])
    expect(parsed.transport).toBe("stdio") // default
    expect(parsed.authTokenRef).toBeUndefined()
  })

  test("(17) McpConnectorConfig_ParsesHttpTransport — http transport + authTokenRef", () => {
    const parsed = McpConnectorConfigSchema.parse({
      serverUrl: "https://mcp.example.com",
      capabilities: ["tools", "resources"],
      transport: "http",
      authTokenRef: "secret:mcp.remoteToken",
    })
    expect(parsed.transport).toBe("http")
    expect(parsed.authTokenRef).toBe("secret:mcp.remoteToken")
    expect(parsed.capabilities).toHaveLength(2)
  })

  test("(20) McpConnectorConfig_AcceptsAllFiveCapabilities — tools/resources/prompts/logging/sampling", () => {
    const parsed = McpConnectorConfigSchema.parse({
      serverUrl: "https://mcp.example.com",
      capabilities: ["tools", "resources", "prompts", "logging", "sampling"],
    })
    expect(parsed.capabilities).toEqual([
      "tools",
      "resources",
      "prompts",
      "logging",
      "sampling",
    ])
  })
})

describe("LI-04 McpConnectorConfig — rejections (18, 19)", () => {
  test("(18) McpConnectorConfig_RejectsEmptyCapabilities — capabilities: [] is rejected", () => {
    expect(() =>
      McpConnectorConfigSchema.parse({
        serverUrl: "stdio://local-mcp",
        capabilities: [],
      }),
    ).toThrow()
  })

  test("(19) McpConnectorConfig_RejectsBadServerUrl — non-URL serverUrl is rejected", () => {
    expect(() =>
      McpConnectorConfigSchema.parse({
        serverUrl: "not-a-url",
        capabilities: ["tools"],
      }),
    ).toThrow()
  })
})

/* ------------------------------------------------------------------ */
/* LI-05 — Connector SDK interface                                     */
/* ------------------------------------------------------------------ */

describe("LI-05 ConnectorSdkInterface — happy path (21, 24)", () => {
  test("(21) ConnectorSdkInterface_ParsesMinimal — semver version + name + capabilities", () => {
    const parsed = ConnectorSdkInterfaceSchema.parse({
      version: "1.0.0",
      name: "http-connector",
      configSchemaRef: "ref:integrations.HttpConnectorConfigSchema",
      capabilities: ["http:GET", "http:POST"],
    })
    expect(parsed.version).toBe("1.0.0")
    expect(parsed.name).toBe("http-connector")
    expect(parsed.configSchemaRef).toBe("ref:integrations.HttpConnectorConfigSchema")
    expect(parsed.capabilities).toEqual(["http:GET", "http:POST"])
  })

  test("(24) ConnectorSdkInterface_RoundTripsValid — JSON round-trip preserves value", () => {
    const original: ConnectorSdkInterface = {
      version: "2.3.7",
      name: "mcp-connector",
      configSchemaRef: "ref:integrations.McpConnectorConfigSchema",
      capabilities: ["mcp:tools", "mcp:resources"],
    }
    const json = JSON.stringify(original)
    const reparsed = ConnectorSdkInterfaceSchema.parse(JSON.parse(json))
    expect(reparsed).toEqual(original)
  })
})

describe("LI-05 ConnectorSdkInterface — rejections (22, 23)", () => {
  test("(22) ConnectorSdkInterface_RejectsBadVersion — non-semver version is rejected", () => {
    expect(() =>
      ConnectorSdkInterfaceSchema.parse({
        version: "1.0", // missing patch
        name: "x",
        configSchemaRef: "ref:x",
        capabilities: [],
      }),
    ).toThrow(/semver/)

    // Sanity: the regex pattern is anchored.
    expect(CONNECTOR_SDK_VERSION_PATTERN.test("1.0.0")).toBe(true)
    expect(CONNECTOR_SDK_VERSION_PATTERN.test("v1.0.0")).toBe(false)
    expect(CONNECTOR_SDK_VERSION_PATTERN.test("1.0")).toBe(false)
  })

  test("(23) ConnectorSdkInterface_RejectsEmptyName — name: '' is rejected", () => {
    expect(() =>
      ConnectorSdkInterfaceSchema.parse({
        version: "1.0.0",
        name: "",
        configSchemaRef: "ref:x",
        capabilities: [],
      }),
    ).toThrow()
  })
})

/* ------------------------------------------------------------------ */
/* Cross-card — helpers (25)                                            */
/* ------------------------------------------------------------------ */

describe("parseHttpConnectorConfig — helper (25)", () => {
  test("(25) parseHttpConnectorConfig_RoundTripsValid — round-trip + thin-wrapper contract", () => {
    const original: HttpConnectorConfig = {
      method: "PUT",
      url: "https://api.example.com/users/u-1",
      headers: [{ name: "Authorization", value: "Bearer t" }],
      body: '{"name":"Ada"}',
      timeoutMs: 10_000,
      idempotencyKey: "user-update-001",
    }
    const json = JSON.stringify(original)
    const reparsed = parseHttpConnectorConfig(JSON.parse(json))
    expect(reparsed).toEqual(original)

    // Thin wrapper contract: the helper throws on invalid input.
    expect(() => parseHttpConnectorConfig({ method: "GET", url: "nope" })).toThrow()

    // OAuthConfig helper sanity (bonus — same throw-on-failure contract).
    // Note: `pkce` defaults to `true` for client_credentials, so the
    // round-trip must include the explicit default to compare equal.
    const oauth: OAuthConfig = {
      flow: "client_credentials",
      clientId: "svc",
      clientSecretRef: "secret:svc",
      tokenEndpoint: "https://auth.example.com/oauth/token",
      pkce: true,
    }
    expect(parseOAuthConfig(JSON.parse(JSON.stringify(oauth)))).toEqual(oauth)
  })
})
