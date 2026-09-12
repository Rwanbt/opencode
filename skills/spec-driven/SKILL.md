---
name: spec-driven
description: "Spec-driven development avec Unifia. Use when user wants to create spec from text, generate code from YAML, validate spec schema, sync code with spec, or design spec-driven architecture. Triggers: spec-driven, design spec, generate from spec, validate spec, sync code spec."
---

# Spec-Driven Development Skill

Skill pour générer du code spec-driven avec Unifia Workbench.

## Quand m'utiliser

Demande à l'agent :
- "Génère une spec pour..."
- "Code ce truc en spec-driven"
- "Valide cette spec"
- "Synchronise code et spec"
- "Diff cette spec avec la version précédente"

## Format de spec

Unifia utilise **YAML strict** avec JSON Schema :

```yaml
apiVersion: unifia.dev/spec/v1beta1
kind: Capability
metadata:
  id: unifia.document.docx
  name: DOCX Document
  version: 1.0.0
  description: Create, edit, and export DOCX documents
  author: Unifia
  license: MIT
  tags:
    - document
    - office
spec:
  type: document
  inputs:
    properties:
      title:
        type: string
      content:
        type: string
  outputs:
    properties:
      file:
        type: string
  implementation:
    type: shell
    command: |
      pandoc -o ${output.file} -t docx ${input.content}
```

## Procédure

### 1. Parser (text → spec)

```typescript
import { parseSpec } from "@unifia/spec"

const spec = await parseSpec(`
  Create a DOCX document from markdown.
  The document should have a title and contain markdown content.
  Export to files.
`)
```

### 2. Valider (spec → validated)

```typescript
import { validateSpec } from "@unifia/spec"

const result = await validateSpec(spec)
if (!result.valid) {
  console.error("Validation errors:", result.errors)
  process.exit(1)
}
```

### 3. Générer (spec → code)

```typescript
import { generateCode } from "@unifia/spec"

const code = await generateCode(spec, {
  target: "typescript",
  path: "packages/document-docx/src",
})
```

### 4. Diff (spec → diff)

```typescript
import { diffSpec } from "@unifia/spec"

const diff = await diffSpec(oldSpec, newSpec)
console.log("Changes:", diff)
```

### 5. Sync (spec ↔ code)

```typescript
import { syncSpec } from "@unifia/spec"

// Code → Spec (reverse-engineer)
const spec = await syncSpec.fromCode({
  path: "packages/document-docx/src/index.ts",
})

// Spec → Code (forward)
await syncSpec.toCode(spec, {
  path: "packages/document-docx/src",
})
```

## Validation rules

- `apiVersion` : doit être `unifia.dev/spec/v1beta1`
- `kind` : Capability, Integration, Workflow, etc.
- `metadata.id` : reverse-DNS, unique
- `metadata.version` : semver
- `metadata.license` : SPDX id
- `spec.inputs` : JSON Schema
- `spec.outputs` : JSON Schema
- `spec.implementation` : shell, http, ftp, code

## Common patterns

### Pattern 1: Document generator

```yaml
kind: Capability
metadata:
  id: unifia.document.{type}
  name: {TYPE} Document
spec:
  type: document
  inputs:
    title: string
    content: string  # markdown
  outputs:
    file: string  # path
  implementation:
    type: shell
    command: |
      pandoc -o ${output.file} -t {type} ${input.content}
```

### Pattern 2: API integration

```yaml
kind: Integration
metadata:
  id: unifia.integration.gh-issues
  name: GitHub Issues
spec:
  type: integration
  inputs:
    repo: string
    title: string
    body: string
  outputs:
    issue_number: number
  implementation:
    type: http
    url: https://api.github.com/repos/${input.repo}/issues
    method: POST
    auth: github
```

### Pattern 3: Workflow

```yaml
kind: Workflow
metadata:
  id: unifia.workflow.{name}
spec:
  type: workflow
  steps:
    - id: step1
      capability: unifia.command.bash
      inputs:
        command: npm test
    - id: step2
      capability: unifia.command.bash
      inputs:
        command: npm run build
      depends_on: [step1]
```

## Voir aussi

- [ADR-0017](docs/adr/0017-opendesign-integration.md) — OpenDesign design
- [P11-C1100 plan détaillé](docs/autonomy/plans/P11-C1100-spec-driven.md)
- [skill-hub-manifest.schema.json](capability-packs/skill-hub-manifest.schema.json)
- [unifia-rebrand SKILL](skills/unifia-rebrand/SKILL.md)
