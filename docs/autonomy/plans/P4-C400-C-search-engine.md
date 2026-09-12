# P4-C400-C — Search engine (ripgrep)

**Statut :** `INTEGRATED` (design documenté)
**Date :** 2026-08-01
**Parent :** P4-C400 (Workspace runtime)

## Objectif

Implémenter un **moteur de recherche** rapide dans le workspace.

## Interface

```typescript
interface SearchEngine {
  text(input: TextSearchInput): Promise<TextSearchResult[]>
  regex(input: RegexSearchInput): Promise<TextSearchResult[]>
  fuzzy(input: FuzzySearchInput): Promise<FuzzyResult[]>
  files(input: FileSearchInput): Promise<string[]>
}

interface TextSearchInput {
  query: string
  paths?: string[]  // default: whole workspace
  caseSensitive?: boolean
  regex?: boolean
  maxResults?: number
  context?: number  // lines before/after
}

interface TextSearchResult {
  path: string
  lineNumber: number
  line: string
  matchStart: number
  matchEnd: number
  contextBefore?: string[]
  contextAfter?: string[]
}
```

## Backend

`ripgrep` (rg) via subprocess :
- Très rapide (multi-thread)
- Supporte regex PCRE2
- Respects .gitignore

## Fallback

Si rg n'est pas disponible :
- Node.js avec `fs.readFile` + regex
- Plus lent mais portable

## Sécurité

- `rg --max-columns=10000` (prevent ReDoS)
- `rg --max-count=10000` (prevent memory exhaustion)
- Timeout configurable (default 30s)

## Estimation

- Backend rg : ~200 LOC
- Fallback Node : ~200 LOC
- Tests : ~200 LOC
- **Total : ~600 LOC**

## Liens

- [P4-C400-A Workspace runtime core](plans/P4-C400-A-workspace-runtime.md)