# LOC Debt — Upstream Packages

Les fichiers suivants appartiennent aux packages upstream (`packages/opencode/`, `packages/ui/`, `packages/sdk/`, `packages/console/`) et dépassent 1500 LOC. Ils sont **hors scope** du gate LOC fork (scopé à `packages/app/`).

Référence : ADR-0003 (fork strategy).

## Liste connue (audit 2026-05-27)

| Fichier | LOC | Package | Note |
|---------|-----|---------|------|
| `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` | 2292 | TUI | Coordinator upstream |
| `packages/ui/src/components/message-part.tsx` | 2268 | UI | Rendu messages |
| `packages/opencode/src/session/prompt.ts` | 2085 | Core | Moteur prompt |
| `packages/opencode/src/lsp/server.ts` | 1958 | LSP | Serveur LSP |
| `packages/opencode/src/config/config.ts` | 1802 | Config | Config cascade |
| `packages/opencode/src/provider/sdk/copilot/responses/openai-responses-language-model.ts` | 1769 | Provider | |
| `packages/opencode/src/acp/agent.ts` | 1769 | Agent | |
| `packages/opencode/src/cli/cmd/github.ts` | 1647 | CLI | |
| `packages/opencode/src/provider/provider.ts` | 1618 | Provider | |

## Action

Ces fichiers seront traités dans le cadre d'une contribution upstream ou d'une session dédiée Track B.
