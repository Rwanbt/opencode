---
name: debate
description: "Collective Intelligence — Multi-model debate that surfaces blind spots. Runs N models in parallel on the same question, extracts atomic claims, identifies insights unique to single models, and produces a synthesis report."
---

# /debate — Collective Intelligence

Launch a multi-model debate to get diverse AI perspectives on a question.

## Usage

```
/debate <question>
```

## How it works

1. **Phase 1 — Diverge**: Multiple AI models independently answer the same question. Models never see each other's responses (anti-contamination).
2. **Phase 2 — Extract**: An extractor model identifies every atomic claim from all responses, then a verifier checks for missed insights (exhaustivity guarantee).
3. **Phase 4 — Synthesize**: A judge model (that did NOT participate in Phase 1) cross-validates all claims, identifies contradictions, and produces a structured report.

## Key concepts

- **Blind Spot**: An insight identified by only one model — the primary value of this process
- **Anti-contamination**: Models never see attributed responses from other models
- **Union of differences**: Every unique insight has value; this is NOT about consensus
- **Out-of-role insights**: Models can flag insights outside their assigned perspective

## Configuration

In `opencode.json` or via the debate config:

```json
{
  "collective": {
    "budget": {
      "maxTotalTokens": 500000,
      "maxCostUsd": 2.0
    }
  }
}
```

## Requirements

- At least 2 configured AI providers with valid credentials
- Provider discovery is automatic — the system probes configured providers

## Output

A structured report with:
- Synthesis integrating all perspectives
- Blind spots highlighted
- All claims categorized (factual, architectural, risk, opportunity, constraint, recommendation)
- Token usage and cost breakdown
