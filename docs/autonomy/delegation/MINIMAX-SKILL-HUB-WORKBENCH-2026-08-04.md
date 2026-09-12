<!-- SPDX-License-Identifier: MIT -->
---
project: opencode
type: reference
tags: [unifia, delegation, minimax, skill-hub]
summary: "Carte MiniMax pour implémenter et tester l’intégration locale Skill Hub sans toucher aux dépôts sources protégés."
created: 2026-08-04
updated: 2026-08-04
related: [[OpenCode/Handoff-Hermes-Unifia-2026-08-03]], [[OpenCode/Plan-directeur-V3-Unifia-WorkBench-OpenWork-OpenCowork]]
---

# Carte MiniMax — Skill Hub Workbench

Tu es l’exécuteur à coût réduit. Travaille uniquement dans `D:\App\OpenCode\unifia-execution-clean`, branche `recovery/unifia-audit-correction-20260803`.

Objectif : intégrer `@unifia/skill-hub` au serveur Workbench avec des routes locales et des tests HTTP.

Autorisé :
- `packages/workbench-server/src/index.ts`
- `packages/workbench-server/test/server.test.ts`
- `packages/skill-hub/**`
- `docs/autonomy/**`

Interdit :
- `D:\App\OpenCode\opencode`, `D:\AI-Workspace`, les clones Hermes, tout `/ee`, tout push, toute publication, toute suppression.
- Ne pas installer de dépendance distante.

Exigences :
- Chaque route doit vérifier `workspaceId` et le bearer token.
- `search`, `install`, `update` doivent utiliser l’interface `SkillRegistry` injectée.
- L’installation ne doit jamais exécuter le contenu du skill.
- Ajouter des tests pour scope refusé, registre absent, recherche et install/update.
- Ne pas accepter une allowlist d’actions UI depuis le payload utilisateur.

Commandes de preuve :
- `bun run typecheck`
- `bun run --cwd packages/workbench-server test`
- `bun run --cwd packages/skill-hub typecheck`
- `bun run --cwd packages/skill-hub test`
- `git diff --check`

Checkpoint : fournir commit local, fichiers modifiés, sorties exactes et limites restantes. STOP immédiat en cas de conflit de branche, dépendance absente ou demande d’écriture hors périmètre.
