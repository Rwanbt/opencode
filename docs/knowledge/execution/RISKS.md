<!-- SPDX-License-Identifier: MIT -->
# RISKS — Sovereign Knowledge Core V1

> Registre des risques actifs. Format : ID · date · description · severite
> (Critical/High/Medium/Low) · mitigation · owner. Append-only.

---

## R-0001 — Scope >> budget d'une seule session

- **Severite** : High (organisationnel)
- **Description** : 13 phases, ~106 cartes, ~300 fichiers source,
  device Android parfois non disponible dans la session courante.
  Tout passage "PASS" sans preuve viole le runbook.
- **Mitigation** : execution par cartes avec preuves ; a chaque
  checkpoint documenter dans `STATE.md` la prochaine carte ; pas
  de "PASS hypothetique".
- **Owner** : orchestrateur session.
- **Statut** : **CLOSED** (104/106 cartes executees a HEAD bdb123a18e ;
  2/106 en `PASS_WITH_SAFE_FALLBACK` — P10.2 et P10.3).

## R-0002 — Bun version drift (1.3.14 vs 1.3.11 declare)

- **Severite** : Low
- **Description** : le repo epingle bun@1.3.11 dans `bun.lock` ; la
  machine installe 1.3.14. Le risque est mineur tant que `bun.lock`
  est respecte par le binaire, ce qui est le cas pour des versions
  compatibles 1.3.x.
- **Mitigation** : garder `bun.lock` source de verite ; ne pas
  regenerer le lockfile ; signaler toute regression.
- **Owner** : session.
- **Statut** : **OPEN** (mineur, en attente de clarification upstream).

## R-0003 — Pas de device Android (partiellement leve)

- **Severite** : Medium
- **Description** : Phase 10 (Android) requiert un device. Sans
  device, certains gates (P10.2 chaine reelle) restent
  `PASS_WITH_SAFE_FALLBACK`.
- **Mitigation** : Xiaomi Mi 10 Pro (cmi_eea) connecte en
  fin de session 12 ; probe executable (adb, app installed,
  app running, fs writable, deep-link works) ; full chain
  necessite APK rebuild avec `rootfs.tgz` integre
  (`bun --cwd packages/mobile build:android`, 30-60 min).
- **Owner** : operateur.
- **Statut** : **OPEN** (en attente de decision operateur pour
  rebuild APK).

## R-0004 — Pas de modele d'embedding telecharge

- **Severite** : Medium
- **Description** : Phase 5 (semantique) requiert un modele ONNX
  telechargeable. Sans telechargement autorise, capability =
  `disabled`.
- **Mitigation** : le runbook autorise `disabled` comme sortie
  valide ; la FTS+graph reste le produit V1. P5.5 utilise un
  fake embed deterministe (4-dim, byte-mixed) pour les tests.
  Documenter la desactivation dans `STATE.md` et `DECISIONS.md`.
- **Owner** : session.
- **Statut** : **OPEN** (V1 delivre, extension V1.1 si necessaire).

## R-0005 — Reseau potentiellement instable

- **Severite** : Low
- **Description** : operations `git fetch origin dev`, `cargo fetch`,
  `bun install` peuvent echouer. Une erreur reseau n'est pas un PASS.
- **Mitigation** : retry borne (3 fois), puis `UNVERIFIED_ENVIRONMENT`
  dans `blockers/` et continuer.
- **Owner** : session.
- **Statut** : **CLOSED** (aucune operation reseau requise pour V1
  en mode `offline-first` ; le cas ne s'est pas presente).

## R-0006 — Perimetre knowledge/ croise des packages existants

- **Severite** : High (architecture)
- **Description** : `packages/memory-governance/`, `packages/memory-runtime/`,
  ADR 0018 (memory system) pre-existent. Le plan prevoit un namespace
  `knowledge/` qui peut entrer en conflit.
- **Mitigation** : Phase 0 inventaire l'existant ; ADR de coexistence ;
  contrats `@unifia/contracts/knowledge/` ajoutes sans casser les
  exports actuels ; tests de non-regression sur les packages existants.
- **Owner** : session.
- **Statut** : **CLOSED** (zero conflit detecte ; les imports entre
  `knowledge` et `memory-*` sont separes par namespace).

## R-0007 — 50 ADR pre-existants non lus exhaustivement

- **Severite** : Medium
- **Description** : `docs/adr/0001..1032` existe. Tous ne sont pas
  lus dans cette session. Risque de reinventer une decision deja
  actee.
- **Mitigation** : Phase 0.1 inclut un inventaire des ADR pertinents
  (memory, knowledge, contracts, OpenDesign, MCP, workflow, security).
- **Owner** : session.
- **Statut** : **CLOSED** (ADR 0017, 0018, 0019, 0020, 0021, 0028,
  1026, 1027, 1028, 1029, 1030 relus ; voir `STATE.md` P0.1).

## R-0008 — BruteForceIndex O(n) par query

- **Severite** : Low (performance)
- **Description** : `BruteForceIndex` est O(n) par query. Si un
  vault depasse 50k notes, le defer-ANN (ADR-KNOW-0008 §3) sera
  declenche.
- **Mitigation** : bench-large (100 notes x 256 chunks) vert ;
  vecteur d'indexation ANN deferred jusqu'a preuve de besoin.
- **Owner** : session.
- **Statut** : **OPEN** (a surveiller au-dela de 50k notes).

## R-0009 — `mavis-trash` policy Windows-specifique

- **Severite** : Low
- **Description** : `mavis-trash` (recoverable delete) est
  Windows-specifique ; portabilite macOS/Linux repose sur
  PowerShell-Core UTF-8 detection.
- **Mitigation** : cf. gotcha 2026-08-24 memory tail ; alternative
  est `os.remove` / `shutil.rmtree` Python.
- **Owner** : session.
- **Statut** : **OPEN** (mineur, documente).

## R-0010 — TypeScript `useDefineForClassFields` shadow edge cases

- **Severite** : Low
- **Description** : field prive et method public de meme nom sous
  ce mode strict peuvent shadow (cf. P11 events/bus). Tests ne
  couvrent pas systematiquement ce cas.
- **Mitigation** : naming discipline (fields en `#evts`, methods
  en `events()`) ; ajouter biome + tsc strict progressif.
- **Owner** : session.
- **Statut** : **OPEN** (documente en MEMORY, a surveiller).

## R-0011 — Frontier review non declenchee

- **Severite** : Medium
- **Description** : packet pret (`FRONTIER-REVIEW-PACKET.md`,
  14 318 bytes) mais aucun modele frontier externe n'a ete
  sollicite. Risque : decisions architecturales non challengees.
- **Mitigation** : presenter le packet a Claude Opus / GPT-5 /
  Gemini 2.x Pro ; integrer le feedback dans V1.1 ou V2.
- **Owner** : operateur.
- **Statut** : **OPEN** (en attente de presentation externe).

## R-0012 — Parties d'ADR-KNOW-0006 non implémentées

**Sévérité** : haute (sécurité, latente)
**Statut** : **CLOS** le 2026-08-31 — 2 items implémentés, 2 arbitrés hors V1
**Ouvert le** : 2026-08-29, après la contre-revue frontier

La contre-revue a établi que le mécanisme central d'ADR-KNOW-0006 n'était pas
implémenté, et qu'aucun risque ne le suivait — c'était le plus grand écart de
périmètre V1 et le seul absent du registre.

La remédiation a livré les règles 1, 2 et 4 (restrictions portables
exprimables et appliquées, UNCLASSIFIED refusé vers l'externe, override qui ne
peut que restreindre). **Restent non implémentées** :

- **§3 `DeclassificationGrant`** — aucun mécanisme one-shot lié au hash, à la
  destination et à un TTL. Conséquence : rien ne peut légitimement élargir un
  `deny` en V1, ce qui est fail-closed mais bloque le cas d'usage documenté
  du partage explicite consenti.
- **§3 héritage** — `mostRestrictive()` existe et est testé, mais aucun
  pipeline de transformation (résumé, traduction, re-chunking, embedding) ne
  l'appelle. Il n'y a pas encore de transformation en V1, donc rien n'est
  actuellement mal classé ; le jour où une arrive, elle doit passer par là.
- ~~**§6 audit `egress.decision`**~~ — **CLOS le 2026-08-30.**
  `policy/audit.ts` construit l'entrée (hash, destination qualifiée
  local/remote, décision, raison, version du guard, horodatage) et
  `InMemoryEgressAudit` l'émet sur le `DomainBus`. Le routeur et la façade
  l'appellent pour **chaque** décision, allow comme deny — une trace qui ne
  garderait que les refus ne dirait pas ce qui est réellement sorti.
  `decideEgress` reste pure : une fonction de décision qui journalise ne peut
  pas être testée sans sink. Le sink est câblé au point de composition et non
  laissé optionnel, faute de quoi il serait « déclaré et jamais présent »,
  exactement ce qui a produit ce défaut.
  **Reste** : la trace vit le temps de la composition ; la persister dans le
  control log Class C est la seconde moitié du §6.
- **Guard côté Rust** — ADR-KNOW-0006 annonce
  `crates/unifia-knowledge-core/src/port/transport.rs`. Ce module n'existe
  pas ; le crate n'a pas de répertoire `port/`.

**Pourquoi ce n'est pas une fuite aujourd'hui** : le sous-système ne contient
aucun code réseau. Le risque se matérialise au premier appel provider ajouté.

**Levée** : implémenter §3 et §6, ou amender à nouveau l'ADR pour les retirer
explicitement de V1.

### Réconciliation du 2026-08-31 — les quatre items sont résolus

La liste ci-dessus était **périmée** : elle décrivait comme ouverts des items
fermés le 2026-08-30, et reproduisait deux erreurs d'étiquetage. Elle est
laissée en l'état — l'historique du finding fait partie du dossier — et
remplacée par ceci :

| Item de la liste | État au 2026-08-31 | Preuve |
|---|---|---|
| §3 `DeclassificationGrant` | **implémenté** le 2026-08-30 | `packages/unifia/src/knowledge/policy/grant.ts` (5 470 o) ; 10 tests §3 dans `test/knowledge/policy/control-log.test.ts` |
| §6 audit `egress.decision` | **clos** — les deux moitiés | `policy/audit.ts` (émission) et `policy/control-log.ts` (persistance, câblée par défaut dans `compose`) |
| Guard côté Rust | **hors V1**, arbitré | ADR-KNOW-0006 §8 ; aucun chemin de données knowledge en Rust (voir R-0015 et R-0024) |
| Héritage des restrictions | **hors V1**, arbitré | ADR-KNOW-0006 §8 ; réentrée au premier pipeline de transformation |

**Deux erreurs d'étiquetage à ne pas propager.** Le troisième point de la
liste est intitulé « §3 héritage » : l'héritage est la **règle 4** de la
§Décision, la règle 3 étant la déclassification one-shot. Et le premier point
laisse croire que `DeclassificationGrant` est encore absent alors qu'il a été
livré le lendemain de l'ouverture du risque.

R-0012 est donc **clos**, non pas parce que sa liste a cessé d'être citée,
mais parce que chacun de ses quatre items porte une implémentation ou une
décision écrite.

## R-0013 — Aucun chemin d'écriture, aucun daemon MCP

**Sévérité** : moyenne (fonctionnelle, pas sécuritaire)
**Statut** : **CLOS** le 2026-08-30 (cartes C25 et C26)
**Ouvert le** : 2026-08-30, après la contre-revue production-readiness

Deux surfaces sont durcies mais non déployées :

- **Écriture Class A** — aucune implémentation de `MutationWriter` n'existe.
  `knowledge_propose` refuse par construction, honnêtement, mais V1 ne peut
  rien mémoriser. Une couche mémoire en lecture seule est utile ; elle n'est
  pas complète.
- **Transport MCP** — `composeMcpServer()` produit un serveur authentifié,
  scopé et borné, et `mcp-token session` le démontre de bout en bout. Rien ne
  l'expose cependant sur un transport, et le registre de tokens vit dans la
  mémoire du serveur : sans daemon, un token ne survit pas à son processus.

Les deux vont ensemble pour un usage réel : un serveur MCP sans écriture ne
peut pas servir `knowledge_propose`, et un writer sans daemon n'est
atteignable que depuis le processus qui le compose.

**Clôture** :

- **Écriture** — `VaultMutationWriter` écrit Class A pour de vrai : intent
  validé, confinement par chemins réels partagé avec le lecteur, refus des
  credentials, CAS sur le hash observé, WAL persistant avant que le fichier
  ne devienne visible, écriture atomique. `delete` reste refusé
  (ADR-KNOW-0009). Les écritures sont désactivées par défaut :
  `composeKnowledgeService({ writable: true })`.
- **Transport MCP** — `serveMcp()` sert les six capacités en JSON-RPC 2.0 sur
  un transport injecté, en réutilisant `@unifia/mcp-transport` plutôt qu'une
  seconde implémentation. `unifia knowledge mcp serve <workspace>` tient le
  registre pour la durée du processus : un token émis au démarrage reste
  valide, et une révocation prend effet immédiatement.

Vérifié de bout en bout : `propose` → fichier sur disque → entrée WAL →
retrouvé par `search` ; et une requête JSON-RPC sur stdin retourne les 11
notes du vault réel.

**Reste hors périmètre V1** : aucune persistance du registre de tokens entre
deux daemons (un redémarrage invalide les tokens en cours), et `knowledge_propose`
n'est pas accordé au token de session — l'écriture passe par la façade, pas
par MCP.

## R-0014 — Durabilité du chemin d'écriture

**Sévérité** : haute (intégrité des données)
**Statut** : **CLOS** le 2026-08-30 (carte C31)

Le writer écrivait un temporaire, appendait une ligne WAL et renommait —
aucun des trois n'était flushé, rien ne sérialisait deux writers, et rien ne
réconciliait un crash. Une coupure pouvait laisser une entrée WAL sans
fichier, un fichier sans entrée, ou deux processus réutilisant un même numéro
de séquence.

**Invariant de commit implémenté** (`mutation/durability.ts`) :

1. le temporaire est écrit **et fsyncé** ;
2. la ligne WAL est appendée **et fsyncée** — c'est le point de commit ;
3. le rename rend visible (atomique NTFS et POSIX) ;
4. le répertoire est fsyncé là où la plateforme le permet.

L'asymétrie est délibérée : avant l'étape 2, rien ne s'est produit et le
temporaire est jeté ; après, la recovery termine le rename. Il est toujours
sûr de rejouer un rename, jamais d'inventer une entrée WAL.

Un `WriteLock` en `O_EXCL` sérialise le commit entre processus, avec
récupération d'un verrou abandonné par un processus mort (seuil 30 s). La
séquence est dérivée de la dernière entrée durable, pas d'un comptage de
lignes — sinon une ligne tronquée décalerait tous les numéros suivants.

**Bug trouvé par la crash-matrix elle-même** : après une ligne tronquée sans
`
` final, l'append suivant se concaténait à elle et corrompait aussi la
nouvelle entrée. `appendLineDurable` insère désormais un séparateur.

**Couverture** : 15 tests, dont crash avant temporaire, après temporaire avant
WAL, après WAL avant rename, après rename (idempotence), ligne WAL tronquée,
temporaire orphelin, recovery à l'ouverture, verrou tenu, verrou périmé
récupéré, et deux writers concurrents sans collision de séquence.

**Reste hors périmètre V1** : la persistance du control log Class C
(ADR-KNOW-0006 §6, seconde moitié) — la trace d'egress vit le temps de la
composition.

## R-0015 — Quatre non-implémentés sortis du périmètre sans clôture

**Sévérité** : haute (traçabilité) — les items eux-mêmes sont moyens à hauts
**Statut** : **CLOS** le 2026-08-31 — 2 items implémentés, 2 arbitrés hors V1
**Ouvert le** : 2026-08-30, après les six revues du FINAL-REPORT

L'addendum 1 nommait cinq éléments non implémentés. L'addendum 2 les
reconduisait explicitement. Les addenda 3 et 4 les ont abandonnés sans les
fermer ni les lister hors périmètre. Seul `egress.decision` a été clos
(R-0012 §6). Les quatre autres ont disparu du rapport tout en restant vrais
dans le code.

C'est un défaut de traçabilité avant d'être un défaut technique : **un
finding ne doit jamais disparaître parce qu'un addendum ne le mentionne
plus.** L'affirmation « toutes les cartes connues sont fermées » de
l'addendum 4 était fausse au sens strict.

Vérifié au 2026-08-30 :

| Item | État mesuré | Conséquence |
|---|---|---|
| `DeclassificationGrant` (ADR-KNOW-0006 §3) | absent | rien ne peut élargir un `deny` — fail-closed, mais le partage consenti documenté par l'ADR est impossible |
| Guard d'egress côté Rust | `crates/.../port/` n'existe pas | la parité TS/Rust annoncée par l'ADR n'existe pas |
| Héritage des restrictions | `mostRestrictive()` a **0 consommateur** | aucune transformation n'hérite encore ; le jour où une arrive, elle doit passer par là |
| Persistance Class B / ControlStore | in-memory côté Rust | rien ne survit au processus |

**Aveu de méthode** : `decideEgressBatch` a été supprimé dans la même session
au motif qu'il n'avait aucun consommateur, tandis que `mostRestrictive` était
conservé pour la même raison. Deux poids, deux mesures. `mostRestrictive` est
gardé délibérément — il implémente la règle §3 et sera l'unique point
d'héritage — mais ce choix devait être écrit, pas tacite.

### Traitement au 2026-08-30

| Item | Traitement | Preuve |
|---|---|---|
| `DeclassificationGrant` | **implémenté** — `policy/grant.ts`, consulté par `clearForEgress` après un `deny` uniquement | `test/knowledge/policy/control-log.test.ts` (10 tests §3) |
| Log de contrôle Class C persisté | **implémenté** — `policy/control-log.ts`, câblé par défaut dans `compose` | 15 tests, dont « le sink disparaît, la trace répond encore » |
| Guard d'egress Rust | **reste ouvert** | aucun consommateur de production dans le crate ; en écrire un second serait du code mort dupliqué, pas de la parité |
| Héritage `mostRestrictive` | **reste ouvert** | aucun pipeline de transformation n'existe ; le point d'accroche est identifié et gardé |

Les deux items clos l'ont été ensemble parce qu'ils **n'en font qu'un** :
ADR-KNOW-0006 §6 place la trace d'egress « dans le control event log
(Class C) ». Persister l'une ferme l'autre. Et le grant est le seul mécanisme
qui *élargit* un refus — il n'était pas implémentable de manière défendable
tant que la trace ne survivait pas au processus qui l'avait accordé.

**Coût mesuré, assumé explicitement** : un `fsync` par décision coûte
**10,85 ms** sur la machine de développement, et `backlinks()` prend une
décision par note — onze secondes de journalisation sur mille notes. Le log
groupe donc ses écritures et perd, au pire, les entrées depuis le dernier
flush. Le daemon MCP flush **avant** d'émettre sa réponse : un contenu qui ne
peut pas être tracé n'est pas servi.

**Levée du reliquat** : implémenter les deux items restants, ou les amender
explicitement hors de V1 dans ADR-KNOW-0006. Pas de troisième voie.

### Arbitrage du 2026-08-31 — la seconde voie a été prise

**ADR-KNOW-0006 §8** (amendement du 2026-08-31) sort explicitement les deux
items du périmètre V1, avec les raisons et des conditions de réentrée
observables. Le reliquat est donc clos par une **décision écrite**, pas par
disparition.

Le motif retenu jusqu'ici — « le crate n'a aucun consommateur de production »
— a été jugé trop faible pour porter une décision : c'est mot pour mot le
raisonnement qui, appliqué au TypeScript sans le vérifier, a produit R-0019.
Il a donc été remesuré des deux côtés avant d'arbitrer.

| Vérification | Commande | Résultat |
|---|---|---|
| Le crate est-il livré ? | `grep -c unifia-knowledge-core` sur les `Cargo.lock` | desktop **0**, mobile **0** |
| Le desktop le déclare-t-il ? | `grep -n "path *=" packages/desktop/src-tauri/Cargo.toml` | kokoro-shared, supervisor, keyring-shim — pas lui |
| Une CI le construit-elle ? | `git grep -n knowledge-core -- .github` | aucun résultat |
| Un pont natif l'atteint-il ? | `git grep -n NativeKnowledgePort` | interface de contrats seule, aucune implémentation runtime |
| Le guard TS est-il, lui, vivant ? | `git grep -n clearForEgress -- packages/` | `context/router.ts:267`, `facade/service.ts:183` — sous `src/`, donc dans le bundle |
| Le Rust livré touche-t-il au knowledge ? | `grep -rniE "knowledge\|egress" packages/*/src-tauri/src` | aucune occurrence fonctionnelle |

Le constat est plus net que « pas de consommateur » : **il n'existe aucun
chemin de données knowledge en Rust**. Une parité suppose deux côtés ; il n'y
en a qu'un.

Le « deux poids, deux mesures » relevé plus haut est tranché par un critère
désormais écrit dans l'ADR : *un symbole sans consommateur se supprime quand
il duplique un chemin existant, et se conserve quand il est l'unique
implémentation d'une règle de l'ADR.* `decideEgressBatch` doublait
`decideEgress` ; `mostRestrictive()` est le seul endroit où la règle 4 existe
en code.

**Trouvé en arbitrant** : le crate entier n'est livré dans aucun binaire —
suivi séparément en **R-0024**, parce que c'est un fait sur le produit, pas
sur l'egress.

## R-0018 — L'échelle du retrieval : mesurée, et elle a une falaise

**Sévérité** : haute (revendication produit)
**Statut** : **ARBITRÉ** le 2026-08-31 — mesure rejouée, ADR-KNOW-0010 écrit ;
la falaise elle-même reste à lever
**Ouvert le** : 2026-08-30

Chaque version du rapport portait la même phrase : « scan lexical borné
validé sur **11 notes**, aucune revendication au-delà ». Une réserve répétée
assez souvent finit par se lire comme une mesure. Ce n'en était pas une.

### Mesure

`bun bench/knowledge-scale.ts` depuis `packages/unifia/`, machine de
développement, deadline 2 s :

| notes | `list()` | search (60 s) | par note | @2 s | items | tronqué | espaces réellement ouverts |
|---|---|---|---|---|---|---|---|
| 100 | 206 ms | 315 ms | 3,15 ms | 364 ms | 8 | non | personal, project |
| 250 | 387 ms | 884 ms | 3,54 ms | 866 ms | 8 | non | personal, project |
| 500 | 706 ms | 1 677 ms | 3,35 ms | 1 640 ms | 8 | non | personal, project |
| 1 000 | 1 437 ms | 3 321 ms | 3,32 ms | 2 062 ms | 8 | **oui** | personal seul |
| 2 000 | 3 011 ms | 6 928 ms | 3,46 ms | 2 002 ms | **0** | **oui** | **aucun** |

Le coût est **linéaire et stable à ~3,3 ms par note** — V1 n'a pas d'index
FTS, `search` lit chaque note et score le corps. Deux seuils en découlent :

- **~1 000 notes** : le deadline de 2 s commence à tronquer ; le second
  espace n'est plus atteint.
- **~2 000 notes** : `list()` seul dépasse le budget. La recherche renvoie
  **zéro résultat** sans avoir lu une seule note.

Le plafond contractuel de `deadlineMs` est **60 s**, donc au-delà d'environ
18 000 notes aucun deadline légal ne permet un scan complet.

### Le défaut trouvé en mesurant

`ContextDiagnostics.sourcesQueried` rapportait les espaces **demandés**, pas
ceux réellement parcourus. Une recherche qui n'avait rien lu revenait donc
avec `candidates: []` depuis un espace jamais ouvert — indiscernable de
« cet espace ne contient aucune correspondance ». Même classe de défaut que
`status.vector` rapportant un drapeau de configuration au lieu d'un fait.

**Corrigé** : le router ne compte un espace comme interrogé qu'après un
`list()` abouti. À 2 000 notes la réponse dit maintenant `sourcesQueried: []`,
`truncated: true`, et `excluded` nomme l'espace abandonné.

Épinglé par `test/knowledge/context/scale.test.ts`, qui force le deadline au
lieu de construire un gros vault : le comportement doit tenir sur n'importe
quelle machine, la vitesse non.

### Ce qui n'est pas corrigé

La falaise elle-même. La lever demande un index (FTS5 ou équivalent) ou un
`list()` incrémental qui rende un corpus partiel plutôt que rien — les deux
sont des changements de conception, pas des correctifs. **Le périmètre
honnête de V1 est donc : vault de l'ordre du millier de notes.**

**Levée** : index de recherche persistant, ou `list()` streamé.

### Re-mesure du 2026-08-31 — reproduite, avec une variance qui compte

La mesure a été rejouée avant d'arbitrer, `cd packages/unifia && bun
bench/knowledge-scale.ts`, **quatre passes** sur la même machine et la même
session.

| notes | ms/note P1 | ms/note P2 | ms/note P3 | items @2 s (P1 / P2 / P3) | espaces ouverts @2 s (P2) |
|---|---|---|---|---|---|
| 100 | 1,21 | 3,55 | 3,53 | 8 / 8 / 8 | personal, project |
| 250 | 1,27 | 3,15 | 3,14 | 8 / 8 / 8 | personal, project |
| 500 | 1,29 | 3,37 | **4,59** | 8 / 8 / 8 (P3 **tronqué**) | personal, project |
| 1 000 | 1,27 | 3,20 | 3,08 | 8 / 8 / 8 (P2, P3 tronqués) | personal seul |
| 2 000 | 1,64 | 3,23 | 3,21 | 8 / **0** / **0** | **aucun** |

Quatrième passe, au-delà du plafond mesuré jusqu'ici :

| notes | `list()` | search (60 s) | ms/note | items @2 s | espaces ouverts |
|---|---|---|---|---|---|
| 3 000 | 4 708 ms | 9 736 ms | 3,25 | **0** | aucun |
| 4 000 | 3 391 ms | 11 170 ms | 2,79 | **0** | aucun |
| 6 000 | 7 727 ms | 18 316 ms | 3,05 | **0** | aucun |

**Le chiffre documenté tient** : les passes 2, 3 et 4 reproduisent les
~3,3 ms/note et les deux seuils, à ~1 000 puis ~2 000 notes.

**Ce que la re-mesure ajoute**, et qui ne figurait pas : la première passe a
tourné à **1,2–1,6 ms/note**, soit 2,5 fois plus vite, sur la même machine et
le même corpus. La position de la falaise n'est donc pas une propriété du
vault mais du cache et de la charge de la machine : la troncature commence à
**500 notes** en passe 3 et seulement à **2 000** en passe 1. Toute borne
citée en nombre de notes doit se lire comme une plage, pas comme un seuil.

### Le mécanisme, vérifié dans le code

Deux faits lus, qui expliquent la forme de la courbe et déterminent le
correctif :

- **`list()` n'est pas un listing.** `source/vault.ts:161` lit et parse
  **chaque** note (`fsp.readFile` + `parseDocument`) pour n'en retenir que
  quatre champs, puis le routeur rappelle `source.read()` note par note
  (`context/router.ts:181`). Le corpus est donc **lu et parsé deux fois par
  recherche**.
- **Le deadline ne coupe rien.** `context/deadline.ts` le dit lui-même :
  « `KnowledgeSource` has no cancellation in its contract, so a call that
  overruns cannot be stopped ». `withDeadline` cesse d'attendre ; le `list()`
  abandonné continue de parcourir tout le vault en arrière-plan. À 6 000
  notes, la réponse revient à 2 s et la machine travaille encore 7,7 s.

C'est pourquoi la levée est un **changement de contrat** (une source qui rend
au fil de l'eau et qu'on peut arrêter), pas un réglage de deadline.

**Arbitrage** : ADR-KNOW-0010 (2026-08-31).

## R-0019 — Le Sovereign Knowledge Core n'était pas dans le produit

**Sévérité** : critique (la fonctionnalité n'existait pas pour l'utilisateur)
**Statut** : **CLOS** le 2026-08-30 — commit `d4538c07fb`
**Ouvert le** : 2026-08-30, en vérifiant le build Tauri

Le build desktop réussissait et **ne contenait pas la fonctionnalité**. Recherche
de chaînes dans le sidecar compilé de 185 Mo :

| Chaîne | Avant | Après |
|---|---|---|
| `control-log.jsonl` | **0** | 1 |
| `unifia_restrictions` | **0** | 12 |
| `egress.decision` | **0** | 2 |
| `knowledge_search` | **0** | 8 |
| `declassification grant` | **0** | 3 |
| *contrôle* : `unifia` | 607 | 607 |

Les 49 occurrences de « knowledge » étaient des types MIME, des chaînes HTTP/2,
des noms de licences et le nom de la branche dans la version.

### Cause

`script/build.ts` ne compile **qu'un** point d'entrée, `src/index.ts`. Le CLI
knowledge vivait dans `bin/unifia-knowledge.ts`, qui n'est pas ce point
d'entrée, n'est pas déclaré dans `package.json` `bin`, et n'était importé par
rien. Tout `src/knowledge/` était donc mort pour le bundler.

### Pourquoi rien ne l'a vu

883 tests verts, quatre contre-revues, six revues du rapport. **Toutes
demandaient si le code était correct ; aucune ne demandait s'il était
branché.** Chaque test important ses modules directement, un import prouve que
le code compile, pas que l'entrypoint l'atteint.

Aggravant : biome ne linte que `src/**`, donc ce code n'avait **jamais été
linté** — 119 imports morts, quatre symboles dupliqués, 13 déclarations dans un
`switch`. L'isolement se voyait dans l'outillage et personne n'a lu le signal.

### Correctif

`bin/knowledge/` → `src/cli/knowledge/` (`git mv`), `main()` → `runKnowledgeCli(argv)`
exportée, sous-commande `unifia knowledge` enregistrée sur l'arbre yargs. Le
handler lit `process.argv` brut : yargs avalait `--workspace` avant le
dispatcher, et les commandes tournaient silencieusement sur le mauvais vault.

**Vérifié dans l'artefact reconstruit**, pas seulement en test : le binaire
compilé exécute `knowledge search` et écrit `.unifia/control-log.jsonl`.

### Garde-fou

`test/knowledge/e2e/cli-process.test.ts` — 13 tests qui **lancent un vrai
processus** contre un vrai vault. C'est la catégorie qui manquait : l'ancien
« e2e » appelait le router en mémoire avec une source synthétique.

## R-0020 — Le build desktop ne tient pas dans la mémoire de cette machine

**Sévérité** : moyenne (environnement, pas code)
**Statut** : **OUVERT — contourné, documenté, instrumenté** le 2026-08-31
**Ouvert le** : 2026-08-30

`rustc` est tué en compilant `unifia_lib` : `0xc000012d`
(STATUS_COMMITMENT_LIMIT) puis `0xc0000409` avec `rustc-LLVM ERROR: out of
memory`. Les messages « only metadata stub found for `alloc` /
`compiler_builtins` » sont un **symptôme** — les `.rlib` tronqués que laissent
les rustc tués — et non une toolchain corrompue.

Mesuré : 15,7 Go de RAM, limite de commit 31,7 Go dont ~27 Go pris par des
applications tierces ; page file de 16 Go sur un `C:` à 8 Go libres, donc
incapable de grandir. `cargo` utilise déjà `codegen-units = 16` (défaut) : le
seul levier restant serait `opt-level`, ce qui changerait le binaire livré.

**Contournement** : `CARGO_BUILD_JOBS=1`. Réussit de façon intermittente selon
ce que les autres applications occupent — trois tentatives ont été
nécessaires pour produire `Unifia Dev_1.3.15_x64-setup.exe` le 2026-08-30.
Le build finit par passer ; il n'est pas fiable.

**Levée** : libérer de la place sur `C:` pour que le page file grandisse, ou
fermer des applications pendant un build à froid.

### Traitement du 2026-08-31 — procédure et garde-fou

Le risque est environnemental : rien dans le dépôt ne peut lui rendre de la
mémoire, et la consigne était explicite — ne tuer aucun processus tiers, ne
modifier aucun réglage système. Ce qui restait faisable a été fait :

- **`docs/BUILD-DESKTOP.md`** — la procédure de build fiable, y compris la
  raison pour laquelle il faut construire le sidecar explicitement (voir
  ci-dessous) et la commande qui vérifie l'artefact plutôt que l'arbre.
- **`scripts/build-desktop.mjs`** — préflight mémoire, câblé sur
  `bun run preflight:build` et `bun run build:desktop` (racine). Il **mesure
  et refuse**, il ne tue rien et ne change aucun réglage.

Le préflight lit le **commit disponible**, pas la RAM libre : c'est le
compteur contre lequel `STATUS_COMMITMENT_LIMIT` est levé, et il s'épuise
alors que la mémoire physique paraît encore confortable. Mesure du
2026-08-31, `node scripts/build-desktop.mjs --check-only`, sortie observée :

```
  physical      2.04 GB free of 15.71 GB
  commit        5.59 GB free of 31.71 GB
  cargo jobs    1
build-desktop: 5.59 GB of commit headroom, against 6 GB needed for 1 job(s).
exit=1
```

Le garde-fou refuse donc **aujourd'hui**, sur la machine et dans l'état exact
qui produisait les kills : c'est la démonstration qu'il se déclenche là où il
doit, et non un seuil décoratif.

**Ce que ça ne corrige pas.** Le seuil (6 Go de commit par job, plancher à
6 Go) est une heuristique calée sur l'échec observé — les kills sont survenus
vers 4,7 Go de commit libre à un job — **pas** une frontière de succès
mesurée. Un préflight vert veut dire « pas manifestement condamné », pas
« passera ». Le risque reste donc ouvert : il se lève en libérant de la place
sur `C:` pour que le page file grandisse, ou en libérant du commit avant un
build à froid.

**Trouvé en documentant** : `packages/desktop/scripts/copy-sidecar.ts:35`
avertit et sort en `0` quand aucun sidecar frais n'existe, et le troisième
candidat de la liste est la copie déjà mise en scène. Un build desktop peut
donc réussir en embarquant un sidecar périmé — la même famille que R-0019 et
R-0022, cette fois au niveau du packaging. C'est pourquoi la construction du
sidecar est une **étape** de la procédure et pas un détail d'implémentation.

## R-0021 — Aucun fuzzing malgré un dossier `fuzz/` vide

**Sévérité** : moyenne (robustesse au bord)
**Statut** : **CLOS** le 2026-08-30 — commit `fc89f58378`

`test/knowledge/fuzz/` existait, vide, alors que la méthode impose de fuzzer
tout parseur de données externes. Les notes Class A sont les données les plus
externes du système : des fichiers que l'utilisateur édite dans Obsidian,
synchronise, résout en conflit git, et tronque en saturant son disque.

L'invariant testé n'est pas « ça parse tout » mais **« une entrée malformée
échoue proprement »** : toute erreur est un `KnowledgeFailure` typé, jamais un
`TypeError` brut, jamais un blocage, et une note empoisonnée ne change pas la
lecture de la suivante. ~8 000 cas graînés — mutation, soupe d'octets, chaque
offset de troncature, répétitions pathologiques. La graine rend tout échec
reproductible plutôt que capricieux.

**Trouvé par le fuzzer** : `[[[c]]]` produisait la cible `[c`, le regex
excluant `]` d'une cible mais pas `[`. Aucun locator ne peut valoir `[c`, donc
c'était une arête définitivement cassée que `broken-links` rapportait comme un
vrai constat — et aucune des quatre syntaxes documentées par le module ne peut
produire ça. Corrigé.
## R-0022 — Le core était atteignable en ligne de commande, pas par l'agent

**Sévérité** : critique (la fonctionnalité n'existait pas pour l'utilisateur)
**Statut** : **CLOS** le 2026-08-31 — commits `77299c56fd`, `61c0ddcc42`

R-0019 a mis le core dans le binaire. Il restait joignable par **un humain
tapant une commande**, et par personne d'autre. Trois absences, chacune
vérifiée avant correction :

| Absence | Constat |
|---|---|
| Aucun outil knowledge/memory | `src/tool/registry.ts` : 20 outils, aucun |
| Aucun consommateur de `ContextPack` | 0 hors `src/knowledge/` |
| `writable: true` passé nulle part | 0 occurrence — l'écriture Class A n'était jamais activée |

Un moteur de récupération sans appelant n'est pas une mémoire, et un writer
que rien n'active ne peut rien enregistrer. La distinction avec R-0019 est
exacte : R-0019 portait sur le bundler, celui-ci sur le câblage applicatif.
Les deux ont la même forme — *correct mais débranché* — et aucune revue de
code ne les voit, parce que toutes demandent si le code est juste.

**Correctif** : `memory_search` / `memory_read` / `memory_write` enregistrés
sur le registre ; `recallMemoryContext` appelé au début de chaque tour dans
`session/prompt.ts` ; `knowledge/app/memory.ts` comme seul point qui résout
le vault et compose le service, avec `writable: true` sur le chemin d'écriture.

**Garde-fou** : `test/knowledge/cli/reachable.test.ts` échoue si l'une des
trois absences revient, et `test/tool/memory.test.ts` pilote les outils par
`ToolRegistry` et `execute` plutôt qu'en important le service — un import
prouve que le module compile, pas que quelque chose l'appelle.

**Vérifié dans le sidecar reconstruit** : `memory_search` 22, `memory_write`
26, `.unifia/memory` 4, `remote_recall` 12 occurrences, toutes à zéro avant.

## R-0023 — Un réglage d'egress gravé dans le vault à sa création

**Sévérité** : moyenne (décision irréversible sans édition manuelle)
**Statut** : **CLOS** le 2026-08-31 — commit `77299c56fd`, découvert par un test

La première version de `openMemory` écrivait `memory.remote_recall` dans le
`.unifia/policy.json` du vault au moment de le créer. Le fichier de politique
étant l'autorité, changer le réglage ensuite **ne faisait plus rien, en
silence** : l'utilisateur pouvait prendre la décision exactement une fois.

C'est la même famille de défaut que R-0019 et R-0022 — un réglage qui a l'air
de fonctionner et n'a aucun effet — trouvée cette fois par deux tests écrits
avant d'avoir remarqué le problème.

**Correctif** : les deux fichiers répondent à deux questions distinctes. Le
`policy.json` du vault dit ce que *ce vault* autorise ; la config applicative
dit si *cette application* envoie la mémoire à un modèle distant. Le réglage
voyage désormais comme `operatorEgress` à chaque ouverture. La politique du
vault reste la plus forte — un vault partagé qui a dit non continue de dire
non — et la restriction propre à la note gouverne par-dessus les deux.

## R-0016 — Statut des probes Android non ré-arbitré après C24

**Sévérité** : moyenne (intégrité de preuve)
**Statut** : OUVERT

Le run device `3b58248c0f` a enregistré `PASS_WITH_SAFE_FALLBACK` sur Xiaomi
Mi 10 Pro. La carte C24 a ensuite établi que `runProbes` transformait une
`ProbeEvidence` vide en `PASS`. **Ce run n'a jamais été rejoué depuis.**

Le rapport dit tour à tour : device run non exécuté, artefacts présents,
`PASS_WITH_SAFE_FALLBACK`, puis « pas de device Android », puis Android hors
champ. Ces cinq états ne peuvent pas être vrais ensemble.

**Position retenue** : le run antérieur à C24 est considéré **invalidé**, car
il a été produit par le harness qui fabriquait des `PASS`. Le statut Android
est `NOT_EXECUTED_EXTERNAL_BOUNDARY` jusqu'à un run rejoué fournissant une
`ProbeEvidence` complète (commande, device id, horodatage valide, sortie).

**Levée** : rebrancher le device et rejouer
`bun test test/knowledge/mobile` avec evidence du harness.

### Tentative du 2026-08-31 — le device est là, la procédure de levée est fausse

Un device **était** branché. Ce qui suit est ce qui a été exécuté et observé,
et pourquoi le statut ne bouge pas.

```
$ adb devices -l
b7163823   device product:cmi_eea model:Mi_10_Pro device:cmi transport_id:1

$ adb -s b7163823 shell pm list packages | grep unifia
package:ai.unifia.mobile

$ cd packages/unifia && bun test test/knowledge/mobile
6 pass, 0 fail, 10 expect() calls — 1 fichier, 4,56 s
```

Le device est connecté, l'application est installée, et le test passe. **Rien
de tout cela n'est une preuve d'exécution sur le device.**

`src/knowledge/mobile/android-runtime.ts` **n'a aucun import** : les deux
occurrences d'`adb` dans le fichier sont des commentaires. Le module est une
fonction pure qui résout un catalogue de sondes contre l'`evidence` qu'on lui
tend, et le test lui tend un `WITH_DEVICE` fabriqué et une `ProbeEvidence`
littérale. Ce test rend exactement le même résultat câble débranché. Le
module se décrit lui-même comme « the typed surface that the device tests
will populate » — et **rien ne le peuple** : `runProbes` n'a que deux
appelants, tous deux des tests.

La correction apportée par C24 est donc intacte et bien vérifiée — une
evidence vide ne devient plus un `PASS` — mais elle a été vérifiée par des
tests unitaires, ce qu'elle doit être. Le chaînon manquant est ailleurs.

**La procédure de levée écrite ci-dessus est inexécutable.** Rejouer
`bun test test/knowledge/mobile` avec un device branché ne produit aucune
`ProbeEvidence` réelle, parce qu'aucun harness ne l'émet. Croire l'inverse
aurait fermé R-0016 avec une commande verte et zéro contact avec l'appareil :
la forme exacte du défaut que C24 a corrigé, un cran plus haut.

**Statut inchangé** : `NOT_EXECUTED_EXTERNAL_BOUNDARY`.

**Levée corrigée** : écrire le harness qui manque — un exécutable qui lance
réellement les dix sondes via `adb` sur le device, capture pour chacune la
commande, le `deviceId`, l'horodatage et la sortie, et passe le tableau
`ProbeEvidence` à `runProbes`. Tant que ce harness n'existe pas, aucun device
branché ne peut lever ce risque, et le brancher n'y change rien.

## R-0017 — Périmètre V1 : pas d'effacement, pas d'export, pas de rétention

**Sévérité** : haute (promesse produit)
**Statut** : **CLOS** le 2026-08-30 — décision propriétaire prise et implémentée

**Décision** : « on doit pouvoir tout éditer et supprimer comme dans
Obsidian ». L'édition existait déjà (`update`). La **suppression est
implémentée** (carte C33) avec la sémantique par défaut d'Obsidian : la note
quitte son locator, part en `.unifia/trash/`, l'opération est écrite au WAL
et reste **restaurable** par son `auditId`. ADR-KNOW-0009 amendé en
conséquence — ce que P10 interdit est une opération destructive *silencieuse*,
pas le droit de l'utilisateur à retirer une note.

Vérifié de bout en bout : créer → éditer → supprimer (absente du disque et
des listings) → restaurer, avec un WAL portant `create, update, delete,
restore`.

**Complété le même jour** :

- **Vidage de la corbeille** (C33b) — `emptyTrash({ confirm: true })`. La
  confirmation est un paramètre *requis* : personne ne vide la corbeille en
  passant un objet d'options auquel il n'a pas réfléchi. Le purge est écrit
  au WAL avant de détruire — une effacement sans trace serait l'opération
  destructive silencieuse que P10 interdit, un cran plus bas. Purge sélective
  par `auditId` ou par âge.
- **Export utilisateur** (C34) — `exportVault()` copie le vault hors de
  lui-même et écrit un manifeste avec un hash par note, vérifiable ensuite
  sans le vault d'origine. **L'audience est explicite** : `owner` exporte
  tout, `third-party` respecte `exportable` et déclare ce qu'il a retenu.
  `exportable` gouverne un tiers qui reçoit le contenu, pas le propriétaire
  qui prend une copie de ses propres données ; conditionner son export à ce
  drapeau transformerait une garantie de souveraineté en verrou sur ses
  données.
- **TTL et rétention** (C35) — `retentionReport()` signale les `candidate`
  au-delà des 30 jours annoncés par ADR-KNOW-0009 §1 et les entrées de
  corbeille purgeables. **Le module rapporte, il n'agit pas** : l'ADR rejette
  un « lifecycle implicite basé sur timestamp » comme trop magique et sans
  traçabilité. Le système remarque ; l'opérateur décide.

L'utilisateur peut désormais voir, éditer, supprimer et exporter ses données.

Le périmètre initial du Sovereign Knowledge Core mentionnait notamment le
droit de voir, éditer, **supprimer** et **exporter** ses données, un `forget`,
un TTL et une politique de rétention. Aucun n'est implémenté :

- `delete` est **refusé par construction** (ADR-KNOW-0009 rejette la
  suppression physique) ; `archive`, `move` et `supersede` ne constituent pas
  un droit effectif à l'effacement ;
- aucun export utilisateur ;
- aucun TTL ni rétention — y compris le TTL de 30 jours des `candidate` que
  l'ADR-KNOW-0009 §1 annonce.

Pour un produit dont la promesse est la souveraineté, l'absence de droit à
l'effacement n'est pas un détail de périmètre.

**Décision requise** : soit ces éléments entrent en V1, soit V1 est
explicitement requalifiée « fondation lexicale en lecture seule » et la
promesse produit est réécrite en conséquence. Le rapport ne peut pas parler
de « Sovereign Knowledge Core V1 » sans que ce choix soit tranché et écrit.

## R-0024 — Le crate Rust `unifia-knowledge-core` n'est livré nulle part

**Sévérité** : moyenne (traçabilité et périmètre, pas sécurité)
**Statut** : OUVERT — constaté, non corrigé
**Ouvert le** : 2026-08-31, en arbitrant R-0015

`crates/unifia-knowledge-core/` compile, passe ses tests et **n'entre dans le
graphe de dépendances d'aucun binaire livré**. Mesuré :

| Preuve | Résultat observé |
|---|---|
| `grep -c unifia-knowledge-core packages/desktop/src-tauri/Cargo.lock` | **0** |
| `grep -c unifia-knowledge-core packages/mobile/src-tauri/Cargo.lock` | **0** |
| `grep -n "path *=" packages/desktop/src-tauri/Cargo.toml` | kokoro-shared, supervisor, keyring-shim |
| `grep -n "path *=" packages/mobile/src-tauri/Cargo.toml` | kokoro-shared |
| `ls Cargo.toml` (racine) | absent — aucun workspace ne l'agrège |
| `git grep -n knowledge-core -- .github` | aucun résultat |

Un `Cargo.lock` est le graphe **résolu** : zéro occurrence n'est pas un indice,
c'est la preuve que le crate n'est pas dans la construction.

C'est la troisième occurrence de la même forme — *correct, testé, débranché* —
après R-0019 (le core absent du bundle TypeScript) et R-0022 (le core
inatteignable par l'agent). La différence est qu'ici **rien ne manque à
l'utilisateur** : le produit fonctionne entièrement en TypeScript, et les huit
modules Rust (`hash`, `path`, `error`, `wal`, `watcher`, `classb`,
`control_store`) ne dupliquent aucune fonctionnalité livrée — ils
l'anticipent. Le coût n'est pas fonctionnel, il est de lisibilité : quatre
ADR (0004, 0005, 0006, 0007) et la carte des modules décrivent ce crate comme
un composant du produit, ce qu'il n'est pas.

**Pourquoi ce n'est pas classé haut** : aucun chemin de données ne le traverse,
donc aucune garantie ne repose sur lui. Le risque est qu'une revue future lise
ces ADR et conclue que le durcissement Rust est en place.

**Levée** — deux voies, exclusives :

1. **Le brancher** : déclarer le crate en dépendance d'un binaire livré et
   faire passer un flux réel par lui. C'est le seul cas où ADR-KNOW-0006 §8
   rouvre la question du guard Rust.
2. **Le déclarer prospectif** : marquer le crate et les ADR qui le citent
   comme « socle préparé, non livré en V1 », pour qu'aucune lecture ne le
   compte comme une défense active.

Tant que l'une des deux n'est pas faite, la documentation décrit un composant
livré qui ne l'est pas. Suivi conjoint : R-0015 (arbitrage), ADR-KNOW-0006 §8.

## R-0025 — Sur Android, le sidecar ne sort pas : aucun tour d'agent possible

**Sévérité** : haute (fonctionnelle sur mobile) — hors périmètre du knowledge core
**Statut** : OUVERT — cause isolée, mécanisme non identifié
**Ouvert le** : 2026-08-31

`POST /session/:id/prompt` échoue sur appareil avec un 500
`The socket connection was closed unexpectedly`, à **~15,2 s constant**, pour
**tous** les providers — MiniMax, GitHub Copilot, OpenAI et `local-llm`. Aucun
tour d'agent n'est donc possible sur Android.

### Ce que le log DEBUG montre

```
service=lsp    https://registry.npmjs.org/pyright          ECONNREFUSED
service=config https://registry.npmjs.org/@unifia%2fplugin ECONNREFUSED
[...] failed to fetch copilot models
```

Le sidecar ne joint **rien**, ni distant ni local. Au même instant, depuis le
même runtime :

| Test | Résultat |
|---|---|
| `curl --noproxy "*" https://registry.npmjs.org/` | **200** |
| `curl -x http://127.0.0.1:41185 https://registry.npmjs.org/` | **200** |
| port du proxy CONNECT | **ouvert** |
| `HTTP_PROXY` du sidecar vs proxy vivant | **identiques** |

Réseau, proxy, port et configuration sont sains. **C'est le client HTTP de Bun
qui échoue**, uniformément. Le 15,2 s est son abandon après retries.

### Antériorité prouvée — ce n'est pas une régression de cette branche

Test A/B sur le même appareil :

| Build | Origine | Résultat |
|---|---|---|
| 2026-08-31 | `feat/sovereign-knowledge-core` | `http=500 t=15.20s` |
| **2026-08-17** | branche `work-design` | **`http=500 t=15.24s`** |

Trois vérifications le confirment :

- `git diff origin/dev HEAD -- packages/mobile` → **vide**. Aucune ligne de
  runtime mobile, de proxy ou de réseau n'a changé sur cette branche.
- `git diff --stat origin/dev HEAD -- packages/unifia/src` → **+17 499 / −7**.
  Sept suppressions au total, aucune dans le transport.
- CRC identiques entre les deux APK sur `libbun_exec.so` (`4a8b7824`),
  `libmusl_linker.so`, `libresolv_override.so`, `librust_pty.so` et
  `rootfs.tgz` (`beaa00e7`).

### Ce que ça bloque, et ce que ça ne bloque pas

Le knowledge core est **vérifié sur appareil** indépendamment : outils
`memory_*` enregistrés dans le registre en exécution, note Class A écrite et
relue par sha256 calculé par le téléphone, egress fail-closed. Ce risque bloque
uniquement les sondes qui exigent un tour d'agent — `context-router`,
`fts.search`, `graph.backlinks` — qui restent `NOT_EXECUTED` dans
`bun run probe:android`.

**Levée** : identifier pourquoi Bun échoue là où `curl` passe. Neuf hypothèses
ont été testées et réfutées par la mesure — proxy, `loaded`, timeout provider,
petit modèle, tunnel adb, port périmé, seccomp, shim DNS, sous-système LSP. Le
journal complet, avec les commandes et les sorties observées, est dans
`ANDROID-TRANSPORT-INVESTIGATION.md` ; il existe pour que personne ne les
rejoue.

Avec `lsp: false`, le bruit disparaît et il reste **quinze secondes de silence
complet** entre le début du prompt et l'erreur : une seule opération silencieuse
les consomme. La prochaine étape est d'ajouter `BUN_CONFIG_VERBOSE_FETCH` à
l'environnement du sidecar (`runtime/server.rs:301-327`, une ligne) pour que
chaque requête dise son URL.

## R-0026 — Un retour arrière de version brique l'application

**Sévérité** : moyenne (compatibilité descendante)
**Statut** : OUVERT — constaté en testant A/B
**Ouvert le** : 2026-08-31

En réinstallant l'APK du 2026-08-17 par-dessus celui du 31, le sidecar refuse de
démarrer :

```
ConfigInvalidError  path: .../.config/unifia/unifia.jsonc
```

La configuration contenait `memory.remote_recall`, clé introduite par la branche
`feat/sovereign-knowledge-core`. Le schéma de configuration étant `.strict()`,
la version antérieure rejette la clé et **meurt au démarrage** — serveur jamais
joignable, aucun message exploitable côté interface. Le seul remède a été
d'éditer le fichier via `run-as`.

Une clé de configuration écrite par une version rend donc l'application
inutilisable pour quiconque revient en arrière. C'est indépendant du knowledge
core : n'importe quelle clé future produira le même effet.

**Levée** : tolérer les clés inconnues au lieu de refuser le document
(`.strict()` → passthrough avec avertissement), ou versionner la configuration
avec une migration descendante. La première voie est la moins coûteuse et suffit
à empêcher le brickage.
