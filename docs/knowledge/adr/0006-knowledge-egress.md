---
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Unifia contributors
id: KNOW-0006
title: Egress policy — default deny, UNCLASSIFIED = DENY EXTERNAL
status: ACCEPTED
date: 2026-08-29
sources:
  - plan gelé §35 (ContextRouter), §36 (ContextPack)
  - runbook V2 §8.6 (Policy et egress)
  - ADR 1026 (ExportProjection boundary)
  - ADR 1032 (Phase 3 content optin)
---

# ADR-KNOW-0006 — Egress policy

## Contexte

Sans politique d'egress explicite, un agent qui injecte le
résultat d'un retrieval dans le prompt d'un provider cloud envoie
tout : secrets, chemins absolus, fragments de mémoire privée.
La PC-03 (WebSocket auth en query param) et la PC-04
(`auth.json` plaintext) documentent des cas où cette absence de
politique a déjà coûté.

Le plan gelé §7 P5, P6, P7 énonce trois systèmes à ne pas
confondre : **Trust** (qui a écrit), **Authority** (qui peut
modifier), **Egress** (qui peut lire vers où).

## Décision

L'egress est régie par un `AgentDataFlowGuard` unique, appliqué
de manière homogène à toutes les sorties (TS `ContextPack`,
Rust `NativeKnowledgePort` response, MCP responses, shell
output, tool output, plugin output, read/grep/glob/edit/write
output).

Règles :

1. **Restrictions portables ne peuvent que restreindre.** Une
   note peut porter `unifia_restrictions.remote_model: deny` ;
   aucune action locale ne peut l'élargir. Une note peut
   porter `unifia_restrictions.local_model: allow` ; une action
   locale peut la réduire (par exemple un
   `egress_grants.local_model: deny` pour un fragment précis),
   jamais l'élargir sans `DeclassificationGrant` explicite.
2. **`UNCLASSIFIED`, provenance non résolue, fallback cloud =
   DENY EXTERNAL.** Une note sans
   `unifia_restrictions.remote_model` (ou avec valeur absente)
   est traitée comme `deny` pour l'egress vers un provider
   cloud. Le `DataFlowGuard` ne tolère pas l'ambiguïté.
3. **Déclassification one-shot**, liée au hash du contenu et à
   la destination exacte. Un
   `EgressGrant { hash, destination, expires_at }` n'est
   valide qu'une seule fois pour ce hash et cette destination.
4. **Héritage** : toute transformation (résumé, traduction,
   re-chunking, embedding) hérite de la restriction **la plus
   stricte** de ses sources. Un résumé d'une note
   `remote_model: deny` reste `remote_model: deny`, même si la
   note cible n'a pas de restriction explicite.
5. **Le shell, les plugins, MCP, read/grep/glob/edit/write et
   les outputs** sont tous soumis au même guard. Une note
   classifiée `secret` ne peut pas être écrite dans un fichier
   `~/.bash_history` ; une commande `cat ~/.ssh/id_rsa` ne
   peut pas apparaître dans un log de session exporté vers le
   cloud.
6. **Egress audit** : toute décision d'egress (allow ou deny)
   produit un événement `egress.decision` dans le control
   event log (Class C), avec : `hash`, `destination`,
   `decision`, `guard_version`, `timestamp`.

## Alternatives rejetées

- **Whitelist par provider** : trop rigide, ne capture pas la
  sémantique de la note.
- **Deny par défaut sans déclassification** : bloque les cas
  légitimes de partage (par exemple envoyer une décision
  publique vers un provider cloud avec consentement explicite).
- **Allow par défaut** : viole la PC-04 (`auth.json` plaintext).
- **Policy par note sans héritage** : une note transformée peut
  accidentellement être moins restreinte que ses sources.

## Conséquences

- `packages/unifia/src/knowledge/policy/dataflow-guard.ts` est
  l'implémentation de référence. Aucun autre module ne peut
  écrire un `ContextPack` sans passer par ce guard.
- `crates/unifia-knowledge-core/src/port/transport.rs`
  applique le même guard côté Rust avant sérialisation.
- `DeclassificationGrant` est un événement auditable, pas un
  flag persistant. Le grant est `consumed` après le premier
  egress réussi.
- `knowledge doctor` détecte les notes
  `unifia_restrictions.remote_model: allow` et propose une
  revue périodique (opt-in).
- L'invariant "tout egress est tracé" est testé par
  `E-07` du DoD (recovery + audit) et par les tests MCP
  `egress-denied`.

## Validation

- Phase 1.4 expose le Context Inspector avec les champs
  `decision`, `restriction`, `destination`, `hash`,
  `relevance`, `token cost`, `reason` (runbook §11 P1.4).
- Phase 6.2 publie les événements domain
  `egress.decision` sur le bus.
- Phase 8 (Git) scanne la plage sortante pour les
  restrictions, refusant tout push contenant un hash
  `remote_model: deny` sans `DeclassificationGrant`.

---

## Amendement 2026-08-29 — Représentation canonique des restrictions

**Statut de l'ADR révisé** : `ACCEPTED (PARTIALLY IMPLEMENTED)`.

### Ce qui a motivé l'amendement

La revue frontier et sa contre-revue ont établi que les restrictions
portables n'étaient pas implémentées, et que **trois orthographes
concurrentes** coexistaient dans la documentation :

| Source | Clé | Champs |
|---|---|---|
| ADR-KNOW-0002 / 0006 (cet ADR) | `unifia_restrictions` | `remote_model`, `local_model` |
| `PERMISSIONS.md` §4 | `portable_restrictions` | `remote_model`, `local_model`, `git_remote`, `external_editor`, `mcp` |
| `packages/contracts` | type `PortableRestrictions` | `remoteModel`, `localModel`, `embeddable`, `exportable` |

Aucune n'était lisible par le runtime : `NoteFrontmatterSchema` était
`.strict()` et ne déclarait aucune de ces clés, donc toute note en portant
une était **rejetée**.

### Décision

Une seule représentation, dans les deux directions :

- **En mémoire** : le type `PortableRestrictions` des contracts fait foi
  (camelCase, 4 champs : `remoteModel`, `localModel`, `embeddable`,
  `exportable`).
- **Sur disque** : une seule clé de frontmatter, `unifia_restrictions`, en
  snake_case comme toutes les autres clés `unifia_*`. Chaque champ est
  optionnel.
- La conversion passe par `portableRestrictionsFromFrontmatter()` et
  `portableRestrictionsToFrontmatter()`.

Défauts appliqués quand la clé est absente (`DEFAULT_PORTABLE_RESTRICTIONS`) :

```yaml
remote_model: deny      # UNCLASSIFIED ne sort pas (règle 2)
local_model:  allow     # le traitement local reste permis
embeddable:   allow
exportable:   deny
```

Un bloc **malformé** est refusé (`source_inconsistent`) plutôt que traité
comme « pas de restriction » : lire une erreur de saisie comme une
autorisation élargirait l'egress silencieusement.

`mostRestrictive()` implémente l'héritage de la règle 3 : la combinaison de
plusieurs sources retient chaque `deny`.

### Champs retirés

`git_remote`, `external_editor` et `mcp`, qui n'apparaissaient que dans
`PERMISSIONS.md`, ne font pas partie de V1. `git_remote` est couvert par le
scan de la plage sortante (Phase 8) et `mcp` par les capacités du token MCP.
Les réintroduire demandera un nouvel amendement, pas un quatrième format.

### Alternatives rejetées

- **Garder `portable_restrictions`** : incohérent avec le préfixe `unifia_*`
  du reste du frontmatter.
- **Frontmatter en camelCase** : aurait fait de `unifia_restrictions` la
  seule clé camelCase du document.
- **Bloc obligatoire** : aurait invalidé toutes les notes existantes ; les
  défauts fail-closed donnent la même garantie sans migration destructive.

### Ce qui reste non implémenté après cet amendement

- `DeclassificationGrant` (§3) — aucun mécanisme ne peut élargir un `deny`.
- L'événement d'audit `egress.decision` (§6) — `decideEgress` reste pure et
  aucun appelant ne l'émet.
- Le guard côté Rust — `crates/.../port/transport.rs` n'existe pas.

Suivi : R-0012.

---

## Amendement 2026-08-30 — §3 et §6 implémentés

Deux des trois items ci-dessus sont clos. Ils l'ont été **ensemble**, parce
que §6 place la trace d'egress « dans le control event log (Class C) » : le
grant est le seul mécanisme qui élargit un refus, et il n'était pas
défendable de l'ouvrir tant que la trace de son usage ne survivait pas au
processus qui l'avait accordé.

### §6 — le log de contrôle est persisté

`policy/control-log.ts` écrit `<workspace>/.unifia/control-log.jsonl`, câblé
par défaut dans le point de composition. Une entrée porte le **hash**, la
destination, la décision, la raison, la version du guard et l'horodatage —
jamais le corps, jamais un extrait, jamais un locator : un journal qui cite
ce qu'il a refusé de laisser sortir annule le refus. Les champs sont écrits
un à un plutôt que par étalement, pour qu'un champ ajouté plus tard à
`EgressAuditEntry` doive être examiné avant d'atteindre le disque.

**Le lot, et pourquoi.** Un `fsync` par décision coûte 10,85 ms sur la
machine de développement ; `backlinks()` prend une décision par note, soit
onze secondes de journalisation sur mille notes. Un audit aussi lent est un
audit qu'un opérateur désactive — ce qui est strictement pire qu'une fenêtre
bornée. Les entrées sont donc groupées et un `flush()` écrit le lot en un
seul ajout `fsync`é. **Le coût est explicite : un crash perd au plus les
entrées depuis le dernier flush.** Le daemon MCP flush *avant* d'émettre sa
réponse, ce qui borne la perte à une requête et rend la règle suivante vraie :
un contenu qui ne peut pas être tracé n'est pas servi.

### §3 — `DeclassificationGrant`

`policy/grant.ts`. Un grant est consulté par `clearForEgress` **uniquement
après un `deny`** : `decideEgress` reste pure et aucune de ses règles ne
s'élargit. Il est lié au **hash du contenu** (éditer la note invalide le
grant — un consentement ne couvre pas un texte que le donneur n'a pas vu), à
**une destination** (`provider:x` ≠ `provider:x:remote`), **limité dans le
temps** (5 min par défaut, 1 h au maximum) et **à usage unique** — consommé
par le premier egress qu'il autorise, pour qu'un acte de consentement ne
devienne pas une permission permanente. Un motif est obligatoire.

Les grants ne sont **pas persistés**, délibérément : un consentement qui
survit à un redémarrage est une permission permanente déguisée. Pour une
exception durable, l'utilisateur modifie les restrictions de la note — ce qui
est visible dans le vault et dans git.

### §7 — Le réglage applicatif (`operatorEgress`), ajouté le 2026-08-31

Deux fichiers répondent à deux questions différentes, et les confondre a
produit un défaut réel.

Le `.unifia/policy.json` d'un vault dit **ce que ce vault autorise**. Il
appartient au vault, voyage avec lui, et peut être partagé entre plusieurs
personnes et plusieurs applications.

La configuration de l'application (`memory.remote_recall`) dit **si cette
application envoie sa mémoire à un modèle distant**. C'est une propriété de
l'installation, pas du vault.

Écrire la seconde dans le premier au moment de créer le vault — ce que faisait
la première version — rendait le réglage irréversible en silence : le fichier
étant l'autorité, le modifier ensuite dans la config ne changeait plus rien
(R-0023).

`ComposeInput.operatorEgress` est donc un canal nommé, consulté **uniquement
là où le `policy.json` du vault est muet** :

1. entrée explicite du `policy.json` du vault — gagne toujours ;
2. sinon `operatorEgress` ;
3. sinon le défaut (`allow` en local, `policy.egress` sinon).

Ce n'est pas une porte pour que du code élargisse un refus : chaque entrée
vient d'un réglage que l'utilisateur a écrit, et la restriction portable de la
note gouverne toujours par-dessus (§1). Un vault partagé qui a déclaré `deny`
pour une destination continue de la refuser, quelle que soit l'application qui
le monte.

### Ce qui reste non implémenté

- Le guard côté Rust — le crate n'a aucun consommateur de production ; en
  écrire un second serait du code mort dupliqué, pas de la parité.
- L'héritage (§Règle 3) — `mostRestrictive()` reste sans consommateur car
  aucun pipeline de transformation n'existe encore.

Suivi : R-0015.

---

## Amendement 2026-08-31 — §8 : le guard Rust et l'héritage sortent de V1

Les deux items ci-dessus étaient décrits comme « non implémentés » sans
qu'aucune décision ne les couvre. C'est la situation exacte que R-0015
reproche aux addenda précédents : **un finding ne se ferme pas en
disparaissant**, et il ne reste pas ouvert indéfiniment non plus. Cet
amendement tranche, et l'ADR est la seule autorité sur ce qu'il annonçait.

### La mesure qui décide, et non le raisonnement qui l'a précédée

La formule retenue jusqu'ici — « le crate n'a aucun consommateur de
production » — est vraie mais trop faible pour porter une décision : c'est
littéralement le raisonnement qui, appliqué au TypeScript sans le vérifier, a
laissé le core hors du binaire pendant toute la vie de la branche (R-0019).
Il a donc été remesuré, des deux côtés.

**Côté Rust — le crate entier n'est dans le graphe de dépendances d'aucun
binaire livré** :

| Preuve | Commande | Résultat observé |
|---|---|---|
| Aucun manifeste de workspace | `ls Cargo.toml` (racine) | absent |
| Le binaire desktop ne le déclare pas | `grep -n "path *=" packages/desktop/src-tauri/Cargo.toml` | `unifia-kokoro-shared`, `unifia-supervisor`, `unifia-keyring-shim` — pas `unifia-knowledge-core` |
| Le binaire mobile ne le déclare pas | `grep -n "path *=" packages/mobile/src-tauri/Cargo.toml` | `unifia-kokoro-shared` seul |
| Il n'est dans aucun graphe résolu | `grep -c unifia-knowledge-core` sur les `Cargo.lock` livrés | desktop **0**, mobile **0** (son propre lock : 1) |
| Aucune CI ne le construit | `git grep -n knowledge-core -- .github` | aucun résultat |
| Aucun pont natif ne l'atteint | `git grep -n "NativeKnowledgePort"` | une **interface** dans `packages/contracts`, aucune implémentation runtime, aucun `bun:ffi`/`napi` côté knowledge |

**Côté TypeScript — le guard, lui, est bien sur le chemin vivant** :
`clearForEgress` est appelé par `src/knowledge/context/router.ts:267` et par
`src/knowledge/facade/service.ts:183`, tous deux sous `src/`, c'est-à-dire
dans l'arbre que le bundler atteint depuis la correction de R-0019. Et les
sources Rust des deux applications Tauri ne contiennent **aucun** traitement
de knowledge, d'egress ou de restrictions.

Le constat est donc plus net que « pas de consommateur » : **il n'y a pas de
chemin de données knowledge en Rust**. Il n'existe rien avec quoi une parité
pourrait être en parité.

### Décision

1. **Le guard d'egress côté Rust sort explicitement du périmètre V1.**
   Écrire `crates/unifia-knowledge-core/src/port/transport.rs` aujourd'hui
   produirait une seconde implémentation de la règle, dans un crate que rien
   ne compile, appliquée à un flux qui n'existe pas. Ce ne serait pas de la
   défense en profondeur : deux guards qui divergent silencieusement sont
   pires qu'un seul, et celui qui n'est jamais exécuté est celui qui diverge.
2. **L'héritage des restrictions (règle 4) sort explicitement du périmètre
   V1**, et `mostRestrictive()` est **conservé** dans
   `packages/contracts/src/knowledge/restrictions.ts:125`.

### Le critère qui sépare `mostRestrictive()` de `decideEgressBatch`

R-0015 relève à juste titre un « deux poids, deux mesures » : les deux
symboles étaient sans consommateur, l'un a été supprimé, l'autre gardé. Le
critère qui les sépare n'avait pas été écrit. Le voici :

> Un symbole sans consommateur se supprime quand il **duplique** un chemin
> existant, et se conserve quand il est l'**unique** implémentation d'une
> règle de l'ADR.

`decideEgressBatch` était une seconde manière de faire ce que `decideEgress`
faisait déjà : deux chemins pour une décision de sécurité, donc une
divergence en attente. `mostRestrictive()` est le seul endroit où la règle 4
existe en code ; le supprimer effacerait la règle du dépôt et laisserait la
prochaine transformation la réinventer sur place. Le coût de le garder est
une fonction pure testée ; le coût de l'avoir supprimé serait une
classification silencieusement élargie.

### Conditions de réentrée

Chacun revient dans le périmètre à une condition **observable**, pas à une
intention :

| Item | Revient quand |
|---|---|
| Guard Rust | `unifia-knowledge-core` apparaît comme dépendance dans le `Cargo.lock` d'un binaire livré **et** un flux de données knowledge traverse le Rust. La première condition seule ne suffit pas : un crate lié mais sans flux ne justifie toujours pas un second guard. |
| Héritage | Le premier pipeline de transformation (résumé, traduction, re-chunking, embedding) est introduit. Il **doit** passer par `mostRestrictive()` ; le livrer sans est un défaut de sécurité, pas une omission. |

### Corrections aux énoncés antérieurs de cet ADR

Deux phrases du corps initial affirment un état qui n'a jamais existé. Elles
ne sont pas réécrites — l'historique de la décision fait partie du dossier —
mais elles sont **remplacées** par ce qui suit :

- §Décision, « appliqué de manière homogène à toutes les sorties (TS
  `ContextPack`, **Rust `NativeKnowledgePort` response**, MCP responses…) » :
  en V1 le guard s'applique de manière homogène à toutes les sorties **du
  runtime TypeScript**. `NativeKnowledgePort` est une interface de contrats
  sans implémentation runtime ; elle ne produit aucune sortie à garder.
- §Conséquences, « `crates/unifia-knowledge-core/src/port/transport.rs`
  applique le même guard côté Rust avant sérialisation » : **ce fichier
  n'existe pas, et n'est pas prévu en V1.** L'énoncé était une intention
  rédigée au présent de l'indicatif, ce qu'un ADR ne doit pas faire.

### Correction de numérotation

L'amendement du 2026-08-29 écrit « `mostRestrictive()` implémente l'héritage
de la **règle 3** », et la section « ce qui reste non implémenté » du
2026-08-30 répète « L'héritage (§Règle 3) ». L'héritage est la **règle 4** de
la §Décision ; la règle 3 est la déclassification one-shot, qui est
implémentée depuis le 2026-08-30. Lire l'un pour l'autre suggérerait qu'un
item clos est ouvert.

### Ce que cet amendement ne prétend pas

Il ne rend pas le système plus sûr : il aligne l'ADR sur ce que le code fait
réellement. La garantie effective de V1 reste **un seul guard, en
TypeScript**, sur un sous-système qui ne contient aucun code réseau — et le
jour où un appel provider est ajouté, c'est ce guard-là qui devra tenir.

Suivi : R-0015 (arbitré), R-0024 (le crate Rust n'est livré nulle part).
