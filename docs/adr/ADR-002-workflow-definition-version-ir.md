<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-002 — Workflow Definition / Version / IR

> **Statut** : DECIDED
> **Date** : 2026-09-01
> **Source** : plan V2.3.1 §49-58, BASELINE.md §5.1,
> `IMPLEMENTATION_CARD_INDEX.md`.

## Status

DECIDED. Dépend d'ADR-003 (expression language). Doit être décidé avant
ADR-001 (canonicalisation) — la canonicalisation s'applique sur la forme
`WorkflowIR` rendue par cet ADR.

## Context

Plan V2.3.1 §49-58 fixe les entités du modèle de workflow :

```text
WorkflowDefinition   { id, ownershipScope, name, description, metadata }
WorkflowVersion      { id, definitionId, semanticVersion, schemaVersion,
                       canonicalDigest, ir, createdAt, createdBy,
                       publishedAt?, publishedBy? }
WorkflowDeployment   { deploymentId, workflowVersionId, deploymentScope,
                       desiredDigest, deployedDigest, executionProfile,
                       credentialBindings, policyBinding, triggerBindings }
```

Et la forme conceptuelle de `WorkflowIR` (plan §55) :

```text
WorkflowIR { triggers, inputSchema, outputSchema, nodes, edges,
             variables, concurrencyPolicy, failurePolicy,
             executionRequirements }
```

Plan §56 interdit un `WorkflowIR v0` jetable : « On peut implémenter
moins de node families au début. On ne crée pas un contrat jetable. »

## Problem

Quel contrat pour `WorkflowIR` :

1. permet le `DAG` (pas de cycles arbitraires) avec boucles bornées
   (`map`/`repeat`/`while` avec `maxIterations`, `maxDuration`, `maxCost`) ;
2. couvre les `node families` du plan §57 sans devenir un contrat
   inutilisable ;
3. est canonisable (sert d'entrée à ADR-001) ;
4. est validable statiquement (capability analysis, taint analysis, network
   policy, expression validation) ;
5. supporte la promotion (dev/staging/prod) sans muter l'identité ;
6. n'est pas un MVP jetable (plan §56).

## Requirements

| ID | Requirement | Source |
|---|---|---|
| REQ-1 | DAG, pas de cycles arbitraires | plan §58 |
| REQ-2 | Boucles bornées (`maxIterations`, `maxDuration`, `maxCost`) | plan §58 |
| REQ-3 | 30+ `node families` du plan §57 | plan §57 |
| REQ-4 | Canonicalisable | ADR-001 |
| REQ-5 | Validable statiquement (capability, taint, network) | plan §5, §121 |
| REQ-6 | Promotion sans muter identité | plan §48, §172-174 |
| REQ-7 | Pas de `WorkflowIR v0` jetable | plan §56 |
| REQ-8 | Bindings via CEL (ADR-003) | ADR-003 |
| REQ-9 | Concurrency policy, failure policy, execution requirements | plan §55 |

## Constraints

| ID | Constraint |
|---|---|
| C-1 | `WorkflowVersion` publiée = immuable (plan §46) |
| C-2 | Un seul `WorkflowIR` canonique côté UI (plan §55) |
| C-3 | Toute nouvelle `node family` est un commit séparé, pas un merge
       silencieux dans l'IR |
| C-4 | Le contrat est en `@unifia/contracts/src/workflow-ir.ts` (nouveau) |

## Options

### Option A — WorkflowIR minimal + 6 node families pour la cible première

**Description** : on commence par 6 `node families` (les 6 strictement
nécessaires pour `local-single-node` Automate Core) :
`trigger.manual / trigger.schedule / control.if / tool.http /
human.approval / wait`. Les autres (control.switch, control.parallel,
control.map, control.repeat, control.while, tool.mcp, tool.code.*,
tool.shell, browser.*, desktop.*) sont ajoutés dans des ADR
conditionnels en M2-M3.

**Preuves en faveur** :
- Cible première `Automate Core × local-single-node` ne requiert pas les
  autres node families.
- Plus simple à canoniser et valider.
- Évite un contrat inutilisable (plan §56).

**Preuves en défaveur** :
- Limite l'expressivité des workflows dès le départ.
- Risque d'avoir un IR qui doit être étendu plusieurs fois, ce qui
  contredit l'esprit du plan §56.

### Option B — WorkflowIR complet (tous les node families du plan §57)

**Description** : on implémente l'IR complet dès M1, en s'appuyant sur
des `node families` stub (qui lèvent `NOT_IMPLEMENTED` si utilisés).

**Preuves en défaveur** :
- Coût d'implémentation élevé.
- Stubs qui lèvent à l'exécution violent le principe « WorkflowVersion
  publiée = immuable » (un workflow publié avec un node stub échoue).
- Plan §56 ne demande pas cela.

### Option C — WorkflowIR minimal + 12 node families (couvre les 5 tracks post-M3)

**Description** : on commence par 12 `node families` couvrant un cas
d'usage étendu (HTTP, MCP, Connector, Code, Approval, Browser, etc.).

**Preuves en faveur** :
- Plus expressif que A.
- Évite des migrations de l'IR pendant M2-M3.

**Preuves en défaveur** :
- Coût d'implémentation plus élevé.
- Validation statique plus complexe.

## Evidence

| Source | Contenu | Statut |
|---|---|---|
| plan V2.3.1 §49-58 | modèle Workflow + IR + node families | MEASURED |
| plan §56 | interdiction IR jetable | MEASURED |
| plan §57 | 30+ node families | MEASURED |
| plan §172-174 | promotion + drift | MEASURED |
| `BASELINE.md §5.1` | état actuel de `workflow-runtime` | MEASURED |
| `AUTOMATE_TRUST_PATH.md` §A.1 | `WorkflowRuntime` non substrate | MEASURED |
| ADR-003 | langage d'expression CEL | MEASURED |

## Decision

### Decision

Cible première = `Automate Core × local-single-node`. 6 `node families`
seulement : `trigger.manual`, `trigger.schedule`, `control.if`, `tool.http`,
`human.approval`, `wait`. M2+ ajoute les familles additionnelles dans des
ADR dédiés (une par famille / groupe).

**Evidence** :

- `PACKAGE_MIGRATION_MAP` §1.3.
- `workflow-catalog/src/index.ts` (252 lignes) avec `StepDeclaration` qui
  enforce déjà 9 champs.
- Plan V2.3.1 §56 (contrat non jetable, « moins de familles » autorisé).

**Migration strategy** :

- `WorkflowRuntime` étendu pour exécuter uniquement les 6 familles.
- `automate-surface.tsx` parse le nouvel IR (validation actuelle
  superficielle).
- `parseSpec` étendu à l'IR.
- Toute nouvelle `node family` arrive dans un commit / ADR séparé.

**Option A — WorkflowIR minimal + 6 node families** pour la cible première.

**Justification** :
- La cible première `Automate Core × local-single-node` n'exige pas les
  autres node families.
- Le plan §56 autorise explicitement « moins de node families au début »
  tant que le contrat n'est pas jetable.
- Une fois les 6 familles validées en M1, on ajoute les familles M2-M3
  dans des ADR séparés.

**Les 6 node families de la cible première** :
1. `trigger.manual` — start par clic utilisateur.
2. `trigger.schedule` — start par cron.
3. `control.if` — branchement booléen.
4. `tool.http` — appel HTTP sortant.
5. `human.approval` — demande d'approbation.
6. `wait` — attente durable (timer, signal).

**Triggers et triggers runtime state** (plan §52-54) :
- `TriggerDefinition` : `triggerId, triggerType, semanticConfig, inputMapping`.
- `TriggerBinding` : `deploymentId, triggerDefinitionId, enabled,
  credentialRef?, endpointRef?, providerSubscriptionRef?, activationConfig`.
- `TriggerRuntimeState` : `nextSchedule, lastPollCursor, providerCheckpoint,
  lastAcceptedEvent, subscriptionHealth`. Mutable, séparé de la version.

**Bindings** : CEL (ADR-003).

**Schéma de validation** : Zod, dans `@unifia/contracts`.

**Effets non-implemented** : `tool.mcp, tool.connector, tool.code.*,
tool.shell, browser.*, desktop.*, data.sql, data.transform, ai.*,
workflow.call, control.parallel, control.merge, control.map,
control.repeat, control.while, control.switch, trigger.event,
trigger.webhook, tool.openapi`. Une carte d'extension M2+ ajoute chaque
famille avec sa capacité, sa capability, et son effet identity.

## Consequences

- `@unifia/contracts/src/workflow-ir.ts` (nouveau) — type Zod du
  `WorkflowIR`.
- `WorkflowRuntime` doit être étendu pour exécuter les 6 familles (et
  pas plus).
- `automate-surface.tsx` doit parser une `WorkflowIR` conforme — la
  validation actuelle est superficielle.
- `parseSpec` de `@unifia/spec-runtime` doit être étendu à l'IR.

## Trade-offs

| Trade-off | A | B | C |
|---|---|---|---|
| Expressivité M1 | Limitée | Maximale | Bonne |
| Coût M1 | Faible | Très élevé | Moyen |
| Compatibilité plan §56 | OK | Risque stub | OK |
| Migration M2+ | Extensions | Aucune | Peu |

## Rejected alternatives

- **B (complet)** : rejeté pour coût et stubs.
- **C (12 familles)** : rejeté pour coût, équivalence M2+ à A.
- **Pas d'ADR** : rejeté — sans contrat, l'IR reste implicite.

## Security impact

- TM-W-04 (boucle infinie) : adresse par REQ-2 (bornes obligatoires).
- TM-W-05 (mutation post-publication) : adresse par REQ-6 (immutabilité).
- TM-AI-03 (LLM skip approval) : adresse par le fait que l'IR déclare
  `human.approval` comme un node typé — la validation refuse un IR qui
  déclare un effet sans approval.

## Migration impact

- Le `WorkflowDefinition` actuel (`packages/workflow-runtime/src/index.ts`)
  est remplacé par le nouveau contrat.
- `automate-surface.tsx` est modifié pour parser le nouveau IR.
- `parseSpec` est étendu.

## Testing strategy

1. **M1 tests** (plan §196) :
   - canonicalization vectors (avec ADR-001)
   - determinism
   - scope isolation structural tests
   - historical schema read
2. **M2 tests** (plan §199) : graph property tests, fan-out/in, parallel
   race, bounded loops, dynamic identity, stable map keys.
3. **M3 tests** (plan §201) : crash matrix.

## Rollback / exit strategy

- Le contrat est versionné (`schemaVersion` dans `WorkflowVersion`).
- Une ancienne `WorkflowVersion` reste lisible après un changement de
  schéma (ADR-001 §66 « historical verification »).
- L'ajout d'une nouvelle `node family` est additif.

## Liens

- `plan V2.3.1` §49-58, §172-174
- `BASELINE.md` §5.1
- `AUTOMATE_TRUST_PATH.md` §A.1
- ADR-000 (substrate)
- ADR-001 (canonicalisation)
- ADR-003 (CEL)
- ADR-004 (history authority)
