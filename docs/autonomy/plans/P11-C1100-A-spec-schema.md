# P11-C1100-A — Spec schema (JSON Schema)

**Statut :** `INTEGRATED` (design documenté)
**Date :** 2026-08-01
**Parent :** P11-C1100 (Spec-Driven)

## Objectif

Définir le **JSON Schema** pour les specs Unifia (équivalent OpenAPI).

## Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://unifia.dev/schemas/spec-v1.json",
  "title": "Unifia Spec v1",
  "type": "object",
  "required": ["name", "version", "inputs", "outputs"],
  "properties": {
    "name": { "type": "string" },
    "version": { "type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+$" },
    "description": { "type": "string" },
    "inputs": {
      "type": "array",
      "items": { "$ref": "#/$defs/Input" }
    },
    "outputs": {
      "type": "array",
      "items": { "$ref": "#/$defs/Output" }
    },
    "capabilities": {
      "type": "array",
      "items": { "type": "string" }
    },
    "policy": { "$ref": "#/$defs/Policy" },
    "examples": {
      "type": "array",
      "items": { "$ref": "#/$defs/Example" }
    }
  }
}
```

## Format de spec

```yaml
# spec.yaml
name: hello-world
version: 1.0.0
description: |
  A simple "hello world" spec.

inputs:
  - name: name
    type: string
    required: true
    description: Who to greet

outputs:
  - name: greeting
    type: string
    description: The greeting message

capabilities:
  - echo

examples:
  - inputs: { name: "World" }
    output: "Hello, World!"
```

## Estimation

- JSON Schema : ~300 LOC
- Validator : ~200 LOC
- Code generator : ~500 LOC
- Tests : ~200 LOC
- **Total : ~1200 LOC**

## Liens

- [ADR-0017 OpenDesign](docs/adr/0017-opendesign-integration.md)
- [ADR-0021 Spec-Driven](docs/adr/0021-spec-driven-development.md)
- [capability-packs/skill-hub-manifest.schema.json](../../capability-packs/skill-hub-manifest.schema.json)