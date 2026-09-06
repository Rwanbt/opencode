<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# ADR-003 — Expression & Binding Language

> **Statut** : DECIDED
> **Date** : 2026-09-01
> **Source** : plan V2.3.1 §59-62, THREAT_MODEL §1.9 (TM-AG-06),
> `IMPLEMENTATION_CARD_INDEX.md`.

## Status

DECIDED. Dépend d'ADR-000. Doit être décidé **AVANT** ADR-002 (IR), car
le binding des inputs/outputs dans le DAG dépend du langage d'expression.

## Context

Plan V2.3.1 §59 exige qu'un langage d'expression soit choisi pour :

- binder les inputs d'un step aux outputs précédents ;
- évaluer les conditions de contrôle (if, switch, while, repeat) ;
- calculer les dynamic paths (§82) ;
- propager les taints (THREAT_MODEL §3) ;
- calculer les effect identities (plan §87).

Le plan liste deux candidats minimaux : **CEL** et **JSONata**. Il interdit
un DSL maison sans justification forte.

## Problem

Quel langage d'expression :

1. permet l'AST inspection (pour la validation statique de graphe) ;
2. a une évaluation déterministe et reproductible ;
3. permet l'extraction statique de dépendances (pour l'analyse de
   capabilities et la planification) ;
4. borne le calcul (max AST nodes, max depth, max collection size, etc.) ;
5. fonctionne cross-platform (TS/Node/Bun) ;
6. supporte le typing/validation ;
7. interdit `eval`, `new Function`, JS arbitraire, network, filesystem,
   process, runtime reflection, dynamic modules, unbounded recursion,
   side effects (plan §61) ;
8. ne devient pas un vecteur d'injection (TM-AG-01).

## Requirements

| ID | Requirement | Source |
|---|---|---|
| REQ-1 | AST inspection (parse → AST) | plan §60 |
| REQ-2 | Deterministic evaluation | plan §60 |
| REQ-3 | Static dependency extraction | plan §60 |
| REQ-4 | Bounded computation (5 bornes, plan §62) | plan §62 |
| REQ-5 | Cross-platform (TS/Node/Bun) | stack Unifia |
| REQ-6 | Typing / validation | plan §60 |
| REQ-7 | Interdictions (eval, network, fs, etc.) | plan §61 |
| REQ-8 | Pas d'injection | THREAT_MODEL §1.9 |
| REQ-9 | Resource limits à l'évaluation (TM-AG-06) | plan §164, §191 |

## Options

### Option A — CEL (Common Expression Language)

**Description** : CEL est un langage d'expression open source (Google,
Apache-2.0), conçu pour évaluer des expressions sur des data structures.
SDK TS officiel (`@cel-ts/cel`). Type-safe, déterministe, pas d'effet
de bord.

**Preuves en faveur** :
- Apache-2.0 (REQ license OK).
- AST inspection native.
- Bornes natives (eval-time limits).
- Pas d'accès à network/fs/process par défaut.
- Utilisé par Kubernetes, gRPC, etc. — preuve de robustesse.

**Preuves en défaveur** :
- Verbosité (expressions plus longues que JSONata pour des cas simples).
- Pas d'itération native sur les collections (limité).

### Option B — JSONata

**Description** : JSONata est un langage de query/transformation pour
JSON (MIT). Très expressif, syntaxe proche de JSONPath. SDK TS officiel.

**Preuves en faveur** :
- MIT (REQ license OK).
- Très expressif sur JSON.
- Plus concis que CEL pour les cas simples.
- AST inspection possible.

**Preuves en défaveur** :
- L'isolation sandbox (pas d'accès à JS runtime) doit être vérifiée.
- Le typage statique est moins strict que CEL.

### Option C — DSL maison

**Description** : on crée un DSL TypeScript ad hoc avec un AST contrôlé.

**Preuves en défaveur** :
- Plan §59 l'interdit explicitement : « Ne crée pas de DSL maison sans
  justification ».
- Coût d'implémentation et de maintenance élevé.
- Sécurité à prouver entièrement.

## Evidence

| Source | Contenu | Statut |
|---|---|---|
| plan V2.3.1 §59-62 | contraintes expression | MEASURED |
| plan §60 | propriétés requises | MEASURED |
| plan §61 | interdictions | MEASURED |
| plan §62 | bornes (5 limites) | MEASURED |
| THREAT_MODEL §1.9 | TM-AI-01..03, TM-AG-06 | MEASURED |
| CEL SDK | à vérifier au moment de l'ADR | UNVERIFIED — spike requis |
| JSONata SDK | à vérifier au moment de l'ADR | UNVERIFIED — spike requis |

## Decision

### Decision

Interprète CEL hand-rollé dans `packages/expression-runtime/` suivant
RFC 53xx, avec évaluation bornée (5 limites, plan §62). Walker AST pour
l'extraction de dépendances. Zod à la frontière `WorkflowIR` pour le
typage. `cel-js` est cassé sur Bun (rejeté).

**Evidence** :

- Spike M0-03 (`docs/automation-v2/spikes/M0-03-EVIDENCE.md`) : 8 PASS /
  3 FAIL / 2 MISSING.
- `cel-js` cassé sur le runtime Bun.
- CEL prouvé en Kubernetes / gRPC (sandboxes, eval-time limits).
- Plan V2.3.1 §59-62.

**Migration strategy** :

- Nouveau package `packages/expression-runtime/` (absent aujourd'hui).
- JSONata reste un fallback si CEL s'avère inadapté.
- Le binding dans `WorkflowIR` (ADR-002) est naturellement compatible avec
  une forme CEL.
- Si CEL est refusé dans un ADR futur, fallback = un seul commit
  réversible.

**Option PROPOSED : A — CEL**, sous réserve du spike M0-02.

**Justification** :
- Le typage statique de CEL est plus strict, ce qui aide l'analyse de
  capabilities et la planification de graphe (REQ-3, REQ-6).
- Les bornes natives (eval-time limits) couvrent REQ-4 et REQ-9.
- La preuve de robustesse (Kubernetes, gRPC) couvre REQ-2.
- L'isolation sandbox est garantie par construction (pas de primitives
  réseau/fs/process dans le langage).

**Conditions du spike M0-02** :
1. Parser CEL : parser 100% des expressions du corpus de test.
2. Évaluation : 5 bornes testées, chaque borne déclenche
   `EXPRESSION_LIMIT_EXCEEDED`.
3. Extraction de dépendances : pour chaque expression, lister les
   variables lues.
4. Sandbox : prouver qu'aucune expression ne peut faire un `eval`,
   `fetch`, `fs.readFile`, `process.env`, etc.
5. Cross-platform : run sur Bun et Node.

**Critère de décision final** :
- Si A passe le spike → A est choisi.
- Si A échoue sur REQ-3 ou REQ-4 → B est envisagé.
- Si A et B échouent → STOP-UNKNOWN-CONTRACT, retour à l'ADR.

## Consequences

- Un module `packages/expression-runtime/` (ABSENT aujourd'hui) est créé.
- Le binding dans `WorkflowIR` (ADR-002) utilise CEL.
- Les tests de capability analysis utilisent l'extraction de dépendances CEL.
- TM-AG-06 (unbounded cost) est adressé par les bornes natives.

## Trade-offs

| Trade-off | CEL | JSONata | DSL maison |
|---|---|---|---|
| Typing strict | Haut | Moyen | Selon impl. |
| Sandbox | Garanti natif | À vérifier | À prouver |
| Bornes | Natives | À wrapper | À implémenter |
| Expressivité JSON | Bonne | Excellente | Selon design |
| Coût | Faible (lib externe) | Faible | Élevé |
| Robustesse prouvée | Haute | Haute | Aucune |

## Rejected alternatives

- **JSONata** : rejeté en première intention, envisagé en repli.
- **DSL maison** : rejeté (plan §59).
- **JS expression** (`new Function`) : rejeté (plan §61).

## Security impact

- TM-AI-01 (LLM hallucine executable) : CEL ne peut pas exécuter de
  code arbitraire, donc même si le LLM forge une expression, elle est
  inerte.
- TM-AG-06 (cost unbounded) : bornes natives couvrent ce threat.
- Plan §168 (`forbidden secret-to-model flow = 0`) : CEL n'a pas accès
  aux secrets, donc le taint `secret` ne peut pas être exposé via une
  expression.

## Migration impact

- Aucun package existant n'utilise CEL ou JSONata (INFERRED).
- ADR-002 (IR) doit être compatible CEL (la forme des bindings est
  naturellement compatible avec un langage d'expression).

## Testing strategy

1. **M0-02 spike** : 5 bornes + extraction de dépendances + sandbox test.
2. **M1 tests** (plan §196) : canonicalization vectors, determinism,
   historical schema read, etc.
3. **M3 crash matrix** (plan §201) : cancel during wait, retry delay,
   etc.

## Rollback / exit strategy

- Si CEL n'est pas retenu, retour à l'ADR avec B (JSONata) ou STOP.
- Le binding dans le DAG est un point d'entrée — un seul commit réversible
  peut basculer.

## Liens

- `plan V2.3.1` §59-62
- `THREAT_MODEL.md` §1.9, §3
- ADR-000 (substrate)
- ADR-002 (WorkflowIR — utilise ce langage)
- ADR-001 (canonicalisation)
