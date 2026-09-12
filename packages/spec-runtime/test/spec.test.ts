/* SPDX-License-Identifier: MIT */
import {
  SpecValidationError,
  injectedRules,
  parseSpec,
  resolveDesignTokens,
  resolveEffectiveCapabilities,
  reviewToArtifactInput,
  type Spec,
} from "../src/index.js"

let checks = 0
const check = (condition: boolean, message: string): void => {
  checks += 1
  if (!condition) throw new Error(message)
}
const refuses = (run: () => unknown, message: string): void => {
  checks += 1
  try {
    run()
  } catch (error) {
    if (error instanceof SpecValidationError) return
    throw new Error(`${message} (threw ${String(error)})`)
  }
  throw new Error(`${message} (was accepted)`)
}

const valid = {
  id: "quarterly-report",
  version: "1.2.0",
  target: "work",
  title: "Quarterly report generation",
  capabilities: ["workspace.read", "artifact.create"],
  rules: [
    { id: "cite-sources", statement: "Every figure must cite the file it came from." },
    { id: "no-invention", statement: "Never invent a number that is not in the source data." },
  ],
  tokens: { colors: { primary: "#1a2b3c" }, spacing: { gutter: 16 }, typography: { body: "Inter" } },
}

// --- Parsing ------------------------------------------------------------------
const spec = parseSpec(JSON.stringify(valid))
check(spec.id === "quarterly-report" && spec.target === "work", "a valid spec did not parse")
check(spec.capabilities.length === 2 && spec.rules.length === 2, "a valid spec lost its capabilities or rules")
check(parseSpec(valid as unknown).id === spec.id, "parsing an already-decoded object failed")

refuses(() => parseSpec("{not json"), "invalid JSON was accepted")
refuses(() => parseSpec(JSON.stringify({ ...valid, id: "Bad_Id" })), "a non-kebab id was accepted")
refuses(() => parseSpec(JSON.stringify({ ...valid, version: "1.2" })), "a non-semver version was accepted")
refuses(() => parseSpec(JSON.stringify({ ...valid, target: "kernel" })), "an unknown target was accepted")
refuses(() => parseSpec(JSON.stringify({ ...valid, title: "   " })), "a blank title was accepted")
refuses(() => parseSpec(JSON.stringify({ ...valid, capabilities: ["Workspace.Read"] })), "a malformed capability was accepted")
refuses(() => parseSpec(JSON.stringify({ ...valid, rules: [{ id: "a", statement: "x" }] })), "a too-short rule id was accepted")
refuses(() => parseSpec(JSON.stringify({ ...valid, rules: [{ id: "empty-rule", statement: "  " }] })), "an empty rule statement was accepted")
refuses(() => parseSpec(JSON.stringify({ ...valid, rules: [{ id: "dup", statement: "a" }, { id: "dup", statement: "b" }] })), "duplicate rule ids were accepted")
refuses(() => parseSpec(JSON.stringify({ ...valid, tokens: { colors: { primary: "red" } } })), "a non-hex colour token was accepted")
refuses(() => parseSpec(JSON.stringify({ ...valid, tokens: { spacing: { gutter: -4 } } })), "a negative spacing token was accepted")
refuses(() => parseSpec(JSON.stringify({ ...valid, tokens: { colors: { "evil</style>": "#000000" } } })), "an injectable token name was accepted")
check(parseSpec(JSON.stringify({ ...valid, capabilities: ["workspace.read", "workspace.read"] })).capabilities.length === 1, "duplicate capabilities were not collapsed")

// --- The invariant: a spec cannot widen workspace permissions ------------------
const grant = ["workspace.read", "workspace.write"]
const greedy = parseSpec(JSON.stringify({ ...valid, capabilities: ["workspace.read", "secret.read", "terminal.run", "desktop.control"] }))
const audited: Array<{ capability: string; decision: string }> = []
const resolution = resolveEffectiveCapabilities(greedy, grant, { record: (_id, capability, decision) => audited.push({ capability, decision }) })

check(resolution.granted.length === 1 && resolution.granted[0] === "workspace.read", `resolution granted ${resolution.granted.join(",")}`)
check(resolution.granted.every((capability) => grant.includes(capability)), "the resolution granted a capability outside the workspace grant")
check(resolution.denied.includes("secret.read") && resolution.denied.includes("terminal.run") && resolution.denied.includes("desktop.control"), "denied capabilities were not reported")
check(audited.filter((entry) => entry.decision === "deny").length === 3, "denials were not audited")
check(audited.filter((entry) => entry.decision === "allow").length === 1, "the granted capability was not audited")

// A spec asking for nothing gets nothing; an empty grant grants nothing.
check(resolveEffectiveCapabilities(parseSpec(JSON.stringify({ ...valid, capabilities: [] })), grant).granted.length === 0, "an empty spec was given capabilities")
check(resolveEffectiveCapabilities(greedy, []).granted.length === 0, "an empty workspace grant still yielded capabilities")

// The workspace grant is never mutated by resolution.
const mutableGrant = new Set(["workspace.read"])
resolveEffectiveCapabilities(greedy, mutableGrant)
check(mutableGrant.size === 1, "resolution mutated the workspace grant")

// --- Rule injection carries provenance ----------------------------------------
const injected = injectedRules(spec)
check(injected.length === 2, "rule injection lost a rule")
check(injected.every((rule) => rule.specId === "quarterly-report" && rule.specVersion === "1.2.0"), "an injected rule lost its provenance")
check(injected[0].statement === valid.rules[0].statement, "an injected rule statement was altered")

// --- Design tokens ------------------------------------------------------------
const tokens = resolveDesignTokens(spec)
check(tokens["color.primary"] === "#1a2b3c", "colour token was not flattened")
check(tokens["spacing.gutter"] === "16", "spacing token was not flattened as a string")
check(tokens["typography.body"] === "Inter", "typography token was not flattened")
check(Object.keys(resolveDesignTokens({ ...spec, tokens: undefined } as Spec)).length === 0, "a spec without tokens produced tokens")

// The two halves meet: a spec's tokens reach an actual document part. Before
// this, resolveDesignTokens was imported by nothing except this file.
const { applyDesignTokens } = await import("@unifia/document-packs")
const { docxWorker, readStoredZip } = await import("@unifia/document-packs")
const styled = applyDesignTokens(await docxWorker("body"), resolveDesignTokens(spec))
const stylesPart = readStoredZip(styled.input.content as Uint8Array).find((entry) => entry.name === "word/styles.xml")
check(stylesPart !== undefined, "a spec's design tokens produced no styles part")
check(styled.applied.length > 0, "a spec's design tokens were all reported as ignored")

// --- Reviews become artefacts --------------------------------------------------
const review = reviewToArtifactInput({ specId: "quarterly-report", reviewer: "erwan", verdict: "changes-requested", findings: ["Contrast is below AA on the summary card."] })
check(review.kind === "text" && review.filename === "review-quarterly-report.md", "the review artefact has the wrong identity")
check(String(review.content).includes("changes-requested"), "the review artefact lost its verdict")
check(review.metadata?.specId === "quarterly-report", "the review artefact lost its spec provenance")
refuses(() => reviewToArtifactInput({ specId: "../escape", reviewer: "x", verdict: "approved", findings: [] }), "a review with a traversal spec id was accepted")

console.log(`SpecRuntime: ${checks}/${checks} passed`)
