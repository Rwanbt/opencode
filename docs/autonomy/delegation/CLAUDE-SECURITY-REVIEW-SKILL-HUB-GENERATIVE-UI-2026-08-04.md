<!-- SPDX-License-Identifier: MIT -->
---
project: opencode
type: reference
tags: [unifia, delegation, claude, security-review]
summary: "Carte Claude pour revoir indépendamment les contrats de sécurité Skill Hub et Generative UI avant intégration."
created: 2026-08-04
updated: 2026-08-04
related: [[OpenCode/Handoff-Hermes-Unifia-2026-08-03]], [[OpenCode/Plan-directeur-V3-Unifia-WorkBench-OpenWork-OpenCowork]]
---

# Carte Claude — revue indépendante sécurité

Revue en lecture seule du dépôt `D:\App\OpenCode\unifia-execution-clean`, sans modifier ni commiter.

Périmètre :
- `packages/skill-hub/src/index.ts`
- `packages/skill-hub/test/test.ts`
- `packages/contracts/src/generative-ui.ts`
- `packages/contracts/test/generative-ui.test.ts`
- `packages/workbench-server/src/index.ts` si l’intégration est présente
- `docs/autonomy/reports/GATE-C-STATUS-2026-08-03.md`

Questions obligatoires :
1. Le payload de signature Skill Hub est-il canonique et sans ambiguïté ?
2. Les niveaux `verified`/`official` peuvent-ils être contournés ?
3. Une route ou un renderer permet-il une exécution arbitraire, HTML, `javascript:` ou action non allowlistée ?
4. L’install/update peut-il exécuter un script ou franchir le workspace scope ?
5. Quels tests manquent avant d’ouvrir Gate C ?

Format de sortie :
- `PASS`, `FAIL` ou `NEEDS_EXTERNAL_E2` par question.
- Pour chaque finding : sévérité, fichier:ligne, scénario reproductible, correctif recommandé.
- Aucun changement de code, aucun secret, aucun push.

STOP : ne pas conclure « production-ready » ; Gate C reste NO-GO sans audit externe et sans preuves complètes.
