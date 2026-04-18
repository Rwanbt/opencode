/**
 * Minimal security-oriented ESLint config.
 *
 * Scope: forbid `innerHTML =` / JSX `innerHTML={...}` assignments outside the
 * handful of vetted call sites that use Shiki-rendered HTML or icon-lookup
 * SVG strings (all trust-bounded inputs).
 *
 * Status: the monorepo does not currently run ESLint in CI. This file exists
 * so a future `bun run lint` / editor integration picks up the rule, and as
 * living documentation of which `innerHTML` usages are auditor-approved.
 *
 * Vetted call sites (grep-friendly — do not remove without re-auditing):
 *   - packages/ui/src/components/markdown.tsx:95     // svg.innerHTML = <fixed icon path>
 *   - packages/ui/src/components/markdown.tsx:320    // container.innerHTML = "" (clear)
 *   - packages/ui/src/components/markdown.tsx:329    // temp.innerHTML = <Shiki-sanitized HTML>
 *   - packages/ui/src/pierre/file-find.ts:137        // el.innerHTML = "" (clear)
 *   - packages/ui/src/components/file.tsx:480        // viewer container reset
 *   - packages/app/src/components/file-tree.tsx:99   // drag image from DOM outerHTML
 *   - packages/app/src/components/prompt-input.tsx:487 // editorRef.innerHTML = "" (clear)
 *   - packages/web/src/components/share/content-bash.tsx:51-52  // Shiki-rendered HTML (SolidJS innerHTML={…})
 *
 * New usages must be justified in a PR-level review and allow-listed with an
 * inline `// eslint-disable-next-line no-restricted-syntax -- <reason>` comment.
 */
module.exports = {
  rules: {
    "no-restricted-syntax": [
      "error",
      {
        selector:
          "AssignmentExpression[left.type='MemberExpression'][left.property.name='innerHTML']",
        message:
          "Assigning to innerHTML can introduce XSS. Use textContent or sanitize via DOMPurify. If the input is provably safe (Shiki, icon lookup), add an `// eslint-disable-next-line no-restricted-syntax -- <reason>` comment with justification.",
      },
      {
        selector:
          "JSXAttribute[name.name='innerHTML']",
        message:
          "SolidJS innerHTML={…} bypasses escaping. Use textContent or sanitize via DOMPurify, or add an `// eslint-disable-next-line no-restricted-syntax -- <reason>` justification.",
      },
    ],
  },
}
