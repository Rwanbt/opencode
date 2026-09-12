<!-- SPDX-License-Identifier: MIT -->

---
project: unifia
type: roadmap
tags: [work-design, desktop, tauri, modes, bridge]
summary: "Diagnostic et correction de la navigation UI Work/Design/Automate sans fallback ni contrat Workbench inventé."
created: 2026-08-14
updated: 2026-08-14
related: [[work_design/DECISIONS|Work/Design decisions]], [[work_design/MANUAL-VERIFICATION|Manual verification]], [[docs/adr/0033-automate-v0-read-only-surface|Automate v0 ADR]]
---

# Work/Design UI repair — 2026-08-14

## Baseline

- Worktree : `D:\App\OpenCode\opencode-work-design`
- Branche : `work-design`
- HEAD initial : `745aa86b82`
- Merge-base `work-design`/`dev` : `91daa35a26a8e44d7f35b539c91030ec1e230c54`
- Dirty state initial : `mode.test.ts`, `mode.tsx`, `mode-directory.ts` uniquement
- Références : `opencode-unifia-rebrand` est une snapshot sans dépôt Git exploitable ; `unifia-execution-clean` est sur `a37f5115d`.

## P0 conclusions

- Les contrats headless `workbench-shell` (`modes.ts`, `shell.ts`, `shell.test.ts`) sont byte-identiques dans les trois arbres comparables.
- Le dépôt actif possède des contrats supplémentaires déjà implémentés : client typed, routes, manifest G6, serveur, artefacts, Design System et opérations.
- `ModeProvider` était global dans `app.tsx` mais dépendait de `useParams()` alors que `:dir` est fourni par `DirectoryLayout`. La résolution a été déplacée vers le premier segment de `useLocation().pathname`, puis décodée une seule fois.
- Le changement de mode conserve désormais l’override `?session=`.
- Le clic UI direct n’a pas été automatisé dans cette session ; il reste `MANUAL_VERIFICATION_REQUIRED` dans MV-06.

## Changements réalisés

- `packages/app/src/context/mode-directory.ts` : extraction du segment route, décodage et conservation contrôlée de `session`.
- `packages/app/src/context/mode.tsx` : suppression de la dépendance à `useParams()` hors route.
- `packages/app/src/context/mode.test.ts` : régressions route/workspace/session.
- `packages/app/src/pages/workbench-mode.tsx` : état bridge borné avec erreur/retry, données réelles Work (`documents`, `artifacts`, `files`), export réel du premier artefact, manifest/catalogues Design réels, et Automate v0 en lecture seule de `.unifia/workflows`.
- `ModeProvider` owns one workspace-scoped Workbench connection consumed by Work, Design and Automate; switching surfaces no longer creates three independent connections.
- `docs/adr/0033-automate-v0-read-only-surface.md` : contrat Automate v0 sans API workflow inventée.

## Evidence

- App typecheck : PASS.
- App suite : 707 tests PASS.
- Workbench shell canonical script : PASS (`122/122`, client `27/27`, bridge `5/5`, connection `2/2`, routes `11/11`, DesignSystem `6/6`).
- Workbench server canonical script : PASS (handshake `5/5`, server `72/72`, bootstrap `40/40`, topology `5/5`, Vitest `4/4`).
- App production build : PASS.
- Tauri `bun run tauri build --no-bundle` : PASS, `Unifia.exe` produit le 2026-08-14 à 17:07:55.
- Hash binaire : `3C4EE538DA6DCF35E79C41574EB81016176506485ED95F99655208C974BFBC25`.
- Processus fraîchement lancé : `Unifia` répondant et `unifia-cli` répondant.

## Restant ouvert

- MV-01/MV-02 : traces bridge natif, rotation et révocation.
- MV-06 : clic réel Code/Work/Design/Automate, deep links, deux workspaces et réouverture.
- MV-07/MV-08 : cycle de vie desktop et single-writer cross-process.
- MV-09 : CSP extraite du bundle et essais interactifs URL.
- L’export Work est branché sur le contrat réel, mais doit être exercé avec un workspace contenant un artefact et l’approbation/capability attendue.
- Automate ne permet volontairement aucune exécution tant qu’un contrat typed de catalogue/exécution workflow n’est pas ajouté au serveur.
