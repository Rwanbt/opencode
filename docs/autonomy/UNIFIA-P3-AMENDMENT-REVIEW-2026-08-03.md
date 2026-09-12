# UNIFIA-P3-AMENDMENT-REVIEW-2026-08-03

**Reviewer:** Claude (read-only, Computer Use)
**Verdict:** `BLOCK` — blocage étroit, limité à des corrections documentaires.
**Commit examiné:** `b1049d4`

## Défauts à corriger avant `CONTRACTS_ACCEPTED`

1. **C6 — canonicalisation des parents (bloquant).** La rédaction et le test
   `C6-symlinked-parent-denied` supposent le parent existant le plus proche,
   alors que l'étape actuelle sélectionne le premier accumulateur. Exiger le
   *deepest existing accumulator* (dernier parent existant), puis résolution ou
   refus explicite de chaque symlink intermédiaire. Une traversée lexicale (`..`,
   segment absolu, UNC ou suffixe réécrit) doit produire `deny`, jamais une
   réécriture silencieuse vers une cible autorisée.

2. **C1/C2 — vocabulaire des capacités incomplet (bloquant).**
   `declaredEffects` ne couvre que 13 effets génériques et ne permet pas
   d'exprimer les 14 capacités du Plan V3, notamment `desktop.control`,
   `browser.cookies`, `package.install`, `artifact.create`, `artifact.export`,
   `terminal.run` et `network.request`. Ajouter une table normative complète
   capacité → effets déclarés, ainsi que les six combinaisons critiques du plan
   comme règles nommées testables.

## Corrections textuelles associées (même passe)

- C7 §9 et §13 : interdire la remise du code de pairing au demandeur non
  authentifié et ajouter les tests `C7-pairing-code-not-delivered-to-requester`
  et `C7-pairing-needs-oob-auth`.
- P3 §7 : aligner le diagramme sur les trois états
  `registered → approved → materialized`; `enabled` est un gate séparé et non un
  quatrième état.
- `IMPORT-CANDIDATES` §4 : corriger le récapitulatif OCW-S4 et le total des
  entrées ; conserver l'exclusion par licence des sous-skills restreints.
- `M1-PROVENANCE-DETAIL` §6 vs `M1-BEHAVIOR-EVIDENCE` §47 : corriger la
  divergence `ADOPT`/`REVIEW` sur `src/renderer/i18n/**`.
- Ajouter B6 (résolution `realpath` de la racine workspace) comme dette Phase 4
  explicitement suivie.

## Tests et gate

Le Lot 1 est démarrable immédiatement contre des doubles Unifia : 17 tests sur
C3, C4, C5 et C7. Le Lot 2 dépend de la correction C6 ; le Lot 3 dépend de la
correction C1/C2. Le runtime, tout import upstream et toute matérialisation
restent bloqués jusqu'à une nouvelle revue indépendante `PASS` et au passage du
gate `P3_CONTRACTS_DRAFT_FOR_REVIEW`.

