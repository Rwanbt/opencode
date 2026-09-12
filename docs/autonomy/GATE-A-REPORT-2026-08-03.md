<!-- SPDX-License-Identifier: MIT -->
# Gate A — Workbench headless stable — 2026-08-03

## Résultat

**NO-GO global, GO local sur la fondation isolée.** Les critères propres aux packages Unifia passent ; la gate globale reste bloquée par le typecheck amont complet déjà documenté et par les surfaces shell/remote/platform non encore livrées.

## Preuves GO

- Frozen install : 2504 installations / 2441 packages, aucun changement.
- P3 : 17/17, 6/6, 6/6, 8/8.
- ApprovalBroker : 5/5.
- Runtime adapters Fake/OpenCode/Unifia : 4/4 + adapter Unifia validé.
- WorkspaceRuntime : 12/12 ; Storage : 4/4 ; Queue : 4/4.
- WorkbenchServer : 15/15, dont reprise SSE par curseur.
- ArtifactStore : 5/5.
- DocumentPackRegistry : 6/6 ; PDF/DOCX/XLSX/PPTX golden et inspecteur ZIP.
- Provenance/licences et exclusion `packages/enterprise` / `packages/desktop-electron` conservées.

## NO-GO restant

- `bun turbo typecheck` de l’amont OpenCode conserve des erreurs préexistantes hors `src/unifia`.
- La conformance CI complète, le shell Unifia, les remote bridges et les plateformes V3 ne sont pas encore implémentés.
- Aucun second runtime n’est introduit par cette tranche, mais la preuve de non-duplication doit être complétée dans la gate globale.

## Décision de continuation

Poursuivre sur une branche d’exécution isolée ; ne pas promouvoir vers `main` et ne pas déclarer la release V3 tant que les NO-GO restent présents.