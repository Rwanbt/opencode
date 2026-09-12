<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# M0 BASELINE — vérifiée, pas supposée

> Étape **I0** de l'ordre d'implémentation ADR-000 §85.
> Produit en exécution de la directive §4 : *« Ne jamais supposer que le SHA
> historique est encore le bon point de départ. »*
> Date : 2026-09-02

---

## 1. État mesuré

| Champ | Valeur |
|---|---|
| Repository | `https://github.com/Rwanbt/unifia.git` (`Rwanbt/unifia`) |
| Worktree | `D:\App\unifia\.worktrees\rev3m-20260901\design` |
| Branche courante | `agent/automate-v2-baseline-20260901` |
| HEAD | `50660047d776db976ebd5701fbf4f9bfe6eff6d1` |
| Tree hash | `016e10477d324ceb076ba06e8c9ea31382f82edd` |
| Working tree | **clean** — `git status --porcelain` → 0 entrée |
| Date | 2026-09-02 |

Commandes de reproduction :

```bash
git remote get-url origin
git branch --show-current
git rev-parse HEAD
git rev-parse HEAD^{tree}
git status --porcelain | wc -l
```

---

## 2. Écart avec la baseline historique du pack — le point que §4 impose de vérifier

ADR-000 §4 donne comme baseline publique historique :

```text
Branch:  work-design
Commit:  1bbbe6a614d90f1208e834767a2e28184cf0253c
```

**Ce n'est pas le point de départ courant.** Mesuré :

| Question §4 | Réponse mesurée |
|---|---|
| Le SHA historique existe-t-il ? | **Oui** — `git rev-parse` le résout |
| Est-il un ancêtre de HEAD ? | **Oui** — `git merge-base --is-ancestor` vrai |
| Distance | **105 commits** entre `1bbbe6a6` et HEAD |
| Branche | HEAD n'est **pas** sur `work-design` (qui existe, locale et remote) |
| Travail Automate ultérieur intégré ? | **Oui, massivement** — voir §3 |

Conclusion : la baseline historique est **entièrement contenue** dans l'état
courant, mais l'état courant porte 105 commits de plus. Travailler depuis
`1bbbe6a6` reviendrait à jeter ce travail ; travailler depuis HEAD est
correct **à condition** de traiter le finding F-M0-01 ci-dessous.

---

## 3. Packages touchés ou créés depuis la baseline historique

`git diff --name-only 1bbbe6a6..HEAD -- packages/` → 13 packages :

```text
app                artifact-store     capability-runtime
contracts          digest-runtime     mcp-transport
mobile             observability      secret-broker
unifia             workbench-server   workbench-shell
workflow-runtime
```

53 packages au total dans le monorepo.

### Packages pertinents pour M0

| Package | Rôle vis-à-vis de M0 | Créé par |
|---|---|---|
| `packages/workflow-runtime` | **Runtime historique** — le sujet de §5 | pré-existant |
| `packages/contracts` | Contrats V2.3.1 (workflow-ir, digest, scope, workflow-run…) | cartes M1/M2 |
| `packages/digest-runtime` | Canonicalisation JCS-v1 + SHA-256 | carte M1-01 |
| `packages/secret-broker` | AEAD, AAD par domaine, revocation | cartes M1-07 |
| `packages/artifact-store` | Enforcement artifact | carte M1-06 |
| `packages/capability-runtime` | Enforcer de capabilities | carte M1-08 |
| `packages/observability` | Logger zero-alloc + canary secret | carte M1-12 |

---

## 4. Runtime historique — §5 revalidé, ligne à ligne

§5 décrit le runtime historique. Vérification faite sur le fichier réel.

| Affirmation §5 | Mesuré | Verdict |
|---|---|---|
| `packages/workflow-runtime` est le runtime historique | présent, 3 fichiers TS | **CONFIRMÉ** |
| Sequential checkpointed step runner | `resume()` boucle sur `steps[nextStep]`, `save()` après chaque step | **CONFIRMÉ** |
| `WorkflowDefinition { id, version, workspaceId, steps[] }` | signature exacte | **CONFIRMÉ** |
| `WorkflowState { workflowId, definition, status, nextStep, outputs, error? }` | signature exacte | **CONFIRMÉ** |
| Store fichier `.unifia/workflows/<workflowId>.json` | `resolve(root, ".unifia", "workflows")` + `${id}.json` | **CONFIRMÉ** |
| Pattern `temporary file → rename` | `writeFile(tmp, {flag:"wx"})` puis `rename` | **CONFIRMÉ** |

Taille : `src/index.ts` = **37 lignes** au SHA historique, **45** aujourd'hui.
Le delta de 8 lignes est le re-export `DurableHistoryAuthority` posé par la
carte M1-09. Le corps du runner est **inchangé**.

> Note de mesure : une précédente baseline annonçait « 91 lignes ». Le
> fichier en compte 45 (style à lignes très longues). L'écart est un artefact
> de comptage, pas une modification du runtime.

Le fichier `src/adapter.ts` (215 lignes, carte M1-09) contient **une
interface `DurableHistoryAuthority` et zéro implémentation** — il ne
contredit pas §5.

---

## 5. Findings de baseline

### F-M0-01 — HIGH — du code M1 a été implémenté avant la ratification d'ADR-000

ADR-000 §82 range parmi les **interdictions absolues** :

```text
M1 implementation before ADR-000 final ratification
```

Or les 105 commits intégrés contiennent des **implémentations** de cartes
M1, pas seulement des contrats :

| Carte | Livrable | Nature |
|---|---|---|
| M1-01 | `packages/digest-runtime` | runtime de canonicalisation |
| M1-06 | `packages/artifact-store` | enforcement |
| M1-07 | `packages/secret-broker` | broker AEAD |
| M1-08 | `packages/capability-runtime` | enforcer en production |
| M1-12 | `packages/observability` | logger zero-alloc |

Les cartes M1-02/03/04/05 (spikes) et les 7 cartes M2 (schémas Zod +
tests) sont des **contrats et des spikes** — couverts par §193 du plan
maître (« throwaway spike, contract experiment, ADR evidence code »). Les
cinq lignes ci-dessus, elles, sont des packages de production.

**Ce n'est pas un blocage de M0.** Aucun de ces packages n'est une
`DurableWorkflowAuthority` et aucun ne préempte le choix de substrate. Mais
le statut `M1 = NO-GO` du pack gelé est en tension avec leur existence, et
la question « faut-il les geler, les reverter, ou les requalifier comme
pré-M1 ? » appartient au décideur, pas à l'agent.

**Traitement retenu pour M0** : ces packages sont considérés comme
**hors périmètre M0** et ne seront ni étendus, ni consommés par le harness,
sauf nécessité explicitement justifiée et documentée. Le harness M0 est
substrate-neutral (§48) et ne doit pas hériter d'un choix M1.

### F-M0-02 — HIGH — Go n'est pas installé sur cette machine

```bash
$ go version
bash: line 1: go: command not found
$ bun --version
1.3.14
```

Le candidat **B — `DBOS_GO_SQLITE`** exige une toolchain Go. Elle est
absente. Ce n'est pas bloquant avant l'étape **I10** de §85 (les étapes I0
à I9 couvrent le harness partagé et le candidat Native), mais ce l'est à
partir de I10.

**Traitement** : l'installation d'une toolchain Go est une modification
système. Elle sera soulevée au moment d'atteindre I10, avec la version
exacte requise par la version DBOS retenue, plutôt que devinée maintenant.
Aucun test DBOS ne sera déclaré `NOT_APPLICABLE` pour cette raison — §47
interdit le N/A post-hoc, et une toolchain manquante est un `BLOCKED`
(§46), pas un `NOT_APPLICABLE`.

### F-M0-03 — INFO — la topologie de packages M0 doit être décidée, pas devinée

§48 propose `packages/automate-m0-contract` et
`packages/automate-m0-harness`, tout en interdisant d'« inventer un package
si une topology plus cohérente existe déjà ».

État mesuré : `packages/contracts` existe et porte déjà des contrats
V2.3.1, mais ce sont les contrats **WorkflowIR** de M1/M2 — or §17 précise
que « le contrat M0 n'est pas encore le WorkflowIR complet », et §48 exige
un harness **sans couplage à un candidat**.

**Décision I1** : créer les deux packages dédiés proposés par §48. Motif :
le contrat M0 est substrate-neutral et jetable après ratification, alors
que `packages/contracts` est un package de production consommé par 12
autres packages. Les mélanger coupleraient le harness de qualification à
la production, ce que §48 interdit. Cette décision est réversible : les
deux packages sont nouveaux et supprimables d'un `git revert`.

---

### F-M0-04 — MEDIUM — biome fonctionne sur liste blanche : un package neuf n'est pas linté

`biome.json` ne lint pas l'arborescence ; il énumère explicitement des
chemins dans `files.includes`. Un package créé sans y être ajouté est
**silencieusement ignoré** — `bunx biome check packages/automate-m0-contract`
répondait d'abord `Checked 0 files`, avec `These paths were provided but
ignored`.

Conséquence : le hook `pre-commit`, qui lance `biome check --changed`,
n'aurait rien vu passer. C'est la même classe de trou que celui déjà
enregistré sur `packages/app/e2e`.

**Corrigé** : `packages/automate-m0-contract/**/*.ts` ajouté à
`files.includes`. Vérifié — `Checked 4 files`.

Le trou générique subsiste pour le prochain package et n'est pas traité
ici : le corriger demanderait de passer biome d'une liste blanche à une
liste noire sur 53 packages, ce qui dépasse le périmètre M0.

### F-M0-05 — MEDIUM — `packages/contracts` ne typecheck pas ses tests

`packages/contracts/tsconfig.json` porte `"include": ["src/**/*.ts"]`. Ses
27 fichiers de test ne passent donc **jamais** par `tsc`. C'est ce qui
explique qu'ils importent `../src/workflow-ir.ts` sans déclencher le
`TS5097` que le même import a produit ici.

Le package M0 est configuré autrement — `include` couvre `src` **et**
`test`, avec `allowImportingTsExtensions` — de sorte que ses tests sont
réellement typechecked. Signalé sans être corrigé chez `contracts` :
activer le typecheck sur 27 fichiers de test hors périmètre M0 est un
chantier à part, et F-M0-01 recommande déjà de ne pas étendre ce package.

## 6. Toolchain mesurée

| Outil | Version | Statut M0 |
|---|---|---|
| Bun | `1.3.14` | disponible |
| Go | absent | **F-M0-02** |
| Node | via Bun | — |
| Plateforme | Windows 11 Pro 10.0.26100 | cible du preflight §62 |

---

## 7. Ce que cette baseline n'établit pas

- **Aucune propriété du runtime historique n'est qualifiée ici.** §5 est
  revalidé sur sa *description*, pas sur son comportement. Le runtime
  historique n'est d'ailleurs pas un candidat M0.
- **Aucun candidat n'est présélectionné** (§1, §65). Native et DBOS-Go
  entrent à armes égales.
- **La topologie Native n'est pas choisie** — c'est `NATIVE_TOPOLOGY.md`
  (§67), à produire avant tout codage substantiel du candidat A.

---

## 8. Liens

- `docs/adr/ADR-000-DURABLE-EXECUTION-SUBSTRATE-M0-FROZEN.md` — contrat d'implémentation canonique
- ADR-000 §4 (baseline), §5 (faits repository), §48 (harness), §75 (artefacts), §85 (ordre)
