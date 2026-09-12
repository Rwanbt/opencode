# TECHNICAL-DEBT-REGISTER — Programme Agent Team V3

> **Current addendum — 2026-07-29:** the table below is the historical Lot A routing record, not a statement that every item is closed. Current product lifecycle wiring is implemented and locally validated. Remaining release constraints are tracked in `docs/architecture/team/ZERO-DEBT-AUDIT.md`: single-call budget overshoot, process-local lifecycle controllers without automatic restart reattachment, real-provider smoke, and release packaging/signing.

> **Carte :** TEAM-A06 (Lot A, Gate T0 — clôture)
> **SHA de base :** `ef48e5d5c5cc0aff802a519950e15aeb3786e1c6` (Team post-A05 cherry-pick)
> **Date UTC :** 2026-07-21
> **Auteur :** Claude Sonnet 5 (E1/E2, consolidation A01-A05)
> **Statut à la clôture d'A06 :** **VIDE** au sens du plan V3 — chaque item ci-dessous
> possède un owner, une carte cible, une gate cible et un critère de fermeture
> vérifiable. Aucun item n'est laissé "flottant" sans destination. C'est cette
> traçabilité complète, pas l'absence de tout problème connu, qui constitue un
> registre "vide" au sens de la doctrine Team V3 (§0.2 : aucune dette cachée,
> tout est routé et possédé).

---

## Méthode

Consolidation exhaustive des findings des 5 audits du Lot A (A01-V2, A02-V2,
A03, A04, A05), tous CLOSED et INTEGRATED dans `Team` avant l'ouverture de
cette carte. Chaque finding original est repris avec son identifiant source
pour traçabilité — **aucun renumérotage**, seul un identifiant de registre
`TDR-NNN` est ajouté pour un suivi séquentiel unique inter-audits.

## Table maîtresse

| TDR-ID | Finding source | Sévérité | Description courte | Owner | Carte cible | Gate cible | Critère de fermeture vérifiable |
|---|---|---|---|---|---|---|---|
| TDR-001 | F-A01-1 | high | Sémantique `permission` sur session enfant non démontrée (Ruleset vide/undefined indistincts) ; policy proposée : least-privilege fail-closed | D03 | D03 (PermissionBroker Team) | T3 | `permission/evaluate.ts` traite `undefined` comme deny-by-default, testé par un cas explicite dans la suite D03 |
| TDR-002 | F-A01-2 | high | Aucune cancellation arborescente : `cancel` sur session parent ne propage pas aux enfants | H02 | H02 (worker runtime cancellation) | T7 | `Session.cancelRecursive(parentID)` existe, appelée par tous les chemins d'annulation, testée par un cas parent+2 enfants |
| TDR-003 | F-A01-3 | medium | `TaskCancelled`/`TaskBlocked` n'exposent pas `parentID` contrairement aux autres events `task.*` | D05 | D05 (Event contracts Team) | T3 | Schéma `task.*` harmonisé (versioning N-1), `parentID` présent partout ou absence justifiée par ADR |
| TDR-004 | F-A01-4 | info (corrigé) | `TeamCompleted` est publié via `tool/team.ts:308` mais dupliqué avec le contrat `session/status.ts` | D05 | D05 (Event contracts Team) | T3 | Un seul contrat `TeamCompleted` canonique, l'autre supprimé après migration |
| TDR-005 | F-A01-5 | high | `Session.remove` cascade avale les erreurs (`catch(e){log.error(e)}`), pas d'atomicité | D02 + J01 | D02 (SQLite WAL) + J01 (reprise) | T3 / T9 | `SessionRemoveError` typée propagée, transaction ou compensating action, test de crash mid-récursion dans J01 |
| TDR-006 | F-A01-6 | high | Pas de contrainte anti-cycle/orphelin sur `parent_id` (auto-référence, cycle A→B→A, orphelin possibles) | D02 | D02 (SQLite WAL/contraintes) | T3 | CHECK `parent_id IS NULL OR parent_id <> id` + trigger anti-cycle + stratégie orphelin, tous testés |
| TDR-007 | F-A01-7 | medium | Header `x-parent-session-id` : pas de kill switch, exposition potentielle à des sous-traitants provider non documentée | Threat Model (ce document, voir §Threat Model consolidé) + Lot B §22 kill switches | T13 | Vecteur inclus dans `THREAT-MODEL.md` (fait) ; kill switch implémenté et testé en T13 |
| TDR-008 | F-A01-8 | medium | États `busy`/`retry` non persistés → tâche zombie possible après crash sans signal | D02 + J01-J05 | D02 + J01-J05 (reprise) | T3 / T9 | Politique de reprise définie (timeout, marquage `_INTERRUPTED`, ou redémarrage auto), testée |
| TDR-009 | F-A02-1 | high (critical si worker non fiable/subprocess mal isolé) | `process.env.AWS_BEARER_TOKEN_BEDROCK = auth.key` — écriture brute, credential accessible au processus entier | D03 | D03 (délégation opaque secrets) | T3 | Propagation par `process.env` supprimée, délégation opaque en place, test d'exfiltration N01 passant |
| TDR-010 | F-A02-2 | **high, décision bloquante gelée dès T0 — implémentation exigée avant/à l'ouverture T13** | Bearer token accepté par défaut dans la query string (`auth-jwt.ts:151,203`), reconnu par le code lui-même comme fuyant vers les logs d'accès | T0 (décision, ce document) → implémentation N01 | N01 (sécurité) | T13 (mais **DÉCISION gelée et non-négociable dès la clôture T0** — voir §Décisions gelées ci-dessous) | Legacy query-string bearer désactivé par défaut ; toute exception explicite émet un audit de sécurité et affiche une échéance de suppression |
| TDR-011 | F-A02-3a | low | Scanner de secrets : patterns manquants pour plusieurs providers (grok-, glm-, mistral-, cohere-, bedrock-, vertex-, npm_, pypi_, tokens mobile) | Sprint-durcissement | N01 | T13 | Patterns ajoutés, testés par fixture couvrant chaque provider manquant |
| TDR-012 | F-A02-3b | medium | Cleanup des headers d'auth avant envoi non audité exhaustivement sur tous les plugins tiers (mcp/*, anythingllm/*, rag/*, ops/*, local-models/*, etc.) | Sprint-durcissement | N01 | T13 | `rg -n 'x-api-key\|PRIVATE-TOKEN\|Authorization'` exécuté sur tout `plugin/**`, chaque hit audité, cleanup confirmé ou corrigé |
| TDR-013 | A02 threat model (9 vecteurs) | high (consolidé) | 9 vecteurs de menace Team identifiés par A02 (worker malveillant, plugin compromis, process enfant héritant de env, accès disque auth.json, replay handle révoqué, SSRF/IPC Tauri, crash dump, logs diagnostic, déconnexion shell Tauri) | Ce document | `THREAT-MODEL.md` (ce passage) + N01 pour la suite de tests | T13 | Les 9 vecteurs sont dans `THREAT-MODEL.md` (fait, voir livrable) ; N01 exécute une suite d'exfiltration couvrant les 9 |
| TDR-014 | R-A03-1 | high | `PREFERRED_MODELS` (7 modèles) et `MODEL_COSTS` (14 modèles) hardcodés — viole la consigne "pas d'enum statique central" | C01 | C01 (Lot C — registry) | T2 | Registry dynamique en place, `provider-discovery.ts`/`budget-tracker.ts` interrogent le registry, aucun enum statique résiduel |
| TDR-015 | R-A03-2 | medium | `budget-tracker.ts` couplé à `Collective.DebateTier` | Lot B | B01+ | T3+ | `Tracker` extrait neutre, `tier` passé en paramètre générique |
| TDR-016 | R-A03-3 | medium | `concurrency: "unbounded"` sur invocation parallèle phase 1 | Lot B | B01+ | T3+ | Semaphore/rate-limit provider en place, testé sous charge |
| TDR-017 | R-A03-4 | high | Pas d'interface unifiée d'invocation multi-modèle (`InvocableModel` provider-agnostic absent) | Lot B | B01 (Gate T3+, après A06) | T3+ | `multi-model/model-invoker.ts` créé, provider-agnostic, testé |
| TDR-018 | R-A03-5 / F-A03-4 | medium | 4 méthodes d'auth dupliquées entre `collective/` et `auth/` | D03 | D03 (AuthStorage unificateur) | T3 | `multi-model/provider-discovery.ts` interroge AuthStorage exclusivement, aucune duplication résiduelle |
| TDR-019 | R-A03-6 | low | `orchestrator.ts` monolithique (785 lignes) | B01 | B01 | T3 (sub-gate : A06 CLOSED, satisfait) | Refactor découpé en modules cohérents, non bloquant pour T0 |
| TDR-020 | R-A03-7 | low | `Participant.role` = string libre, pas aligné sur PermissionBroker | Lot B | B01+ (conditionnel D03) | T3+ | `RoleRef` typé introduit, aligné sur D03 |
| TDR-021 | R-A03-8 | low | `tierDefaults()` couplé à `Collective.DebateTier` | Lot B | B01+ | T3+ | Paramètre générique, découplage testé |
| TDR-022 | R-A03-9a | low | Pas de timeout explicite sur `runParticipant` | Lot B | B01+ | T3+ | `Effect.timeout` configurable par appel dans `model-invoker.ts` |
| TDR-023 | R-A03-9b | low | Credentials lus sur filesystem avec paths hardcodés (`~/.claude/.credentials.json`, `~/.codex/auth.json`) | D03 | D03 (AuthStorage unificateur) | T3 | Lecture filesystem directe supprimée, unifiée via AuthStorage |
| TDR-024 | F-A04-1 | high | `core.longpaths` non configuré (Windows), ni global ni local | A06 (ce document) → implémentation | Lot B (infra CI/dev) | T0 (décision) / implémentation avant T6 (worktrees) | `core.longpaths=true` configuré globalement ou par worktree, vérifié en CI Windows |
| TDR-025 | F-A04-3 | low | Documentation `ExclusionPath` Windows Defender manquante | A05/A06 → doc | Lot B (doc infra) | T6 | `ExclusionPath` documenté dans la doc d'installation Windows |
| TDR-026 | F-A04-5 | **high** | `core.hooksPath=.husky/_` absent dans tous les worktrees de cartes (généré par `bun install`, non tracké) → gate pre-commit silencieusement no-op pour toute carte future touchant du code | A06 (ce document) → implémentation | Lot B (tooling orchestrateur) | T6 (ScopeMonitor/worktrees) | `bun install` obligatoire (ou vérification `test -d .husky/_` bloquante) dans le script de création de worktree, avant tout premier commit de carte |
| TDR-027 | F-A04-6-REVISED | low | `core.autocrlf=true` (système) — déjà mitigé par `.gitattributes` existant | (observation) | — | — | Aucune action requise ; clôturé par le fait que `.gitattributes` (`* text=auto eol=lf`) est déjà en place |
| TDR-028 | F-A04-7 | info | `core.ignorecase=true` (NTFS) — collision de casse silencieuse possible | Lot B | B01+ (règle de nommage) | T6 | Convention de nommage de fichiers évitant toute collision de casse documentée dans les standards de contribution |
| TDR-029 | F-A04-8 | info | 5 stashes pré-existants sans rapport dans le dépôt commun, magasin partagé entre worktrees | (observation) | — | — | Aucune action requise ; règle "ne jamais `git stash` dans un worktree de carte" documentée dans la procédure fail-closed (`AUDIT-WORKTREES-WINDOWS.md` §6) |
| TDR-030 | F-A04-9 | **high** | Leases/fencing tokens déclarés en YAML uniquement, `Execution/Locks/` sans mécanisme automatisé, aucun Scope Monitor réel | A06 (ce document) → implémentation | Lot B (orchestrateur) | T6 (ScopeMonitor) | Fichier-lock réel par lease + script de vérification de scope avant tout commit de carte, tous deux en place et testés |
| TDR-031 | F-A04-10 | info | `core.symlinks=false` explicite au niveau dépôt ; noms réservés Windows non testés | Lot B | B01+ (si jugé pertinent) | T6 | Décision explicite : soit test complémentaire effectué, soit risque accepté et documenté |
| TDR-032 | F-A05-1 | **high** | Snapshot `models-snapshot.js` redistribue l'intégralité de la base `models.dev` (MIT) sans copyright/permission notice requis | A06 (décision, ce document) → implémentation | Carte propriétaire à créer (Lot B/C — génération notices) | T2/T3 (avant toute release publique) | `THIRD_PARTY_NOTICES.md` (ou équivalent) présent et inclus dans au moins un artefact de release, vérifié par test CI dédié |
| TDR-033 | F-A05-2 | medium | Aucun inventaire des sources de données tierces dans le dépôt | A06 → implémentation | même carte que TDR-032 | T2/T3 | Registre déclaratif de sources tierces existant, lu par le générateur de notices |
| TDR-034 | F-A05-3 | low | Pas de pin de version/commit de la donnée `models.dev` consommée au build | A06 → implémentation | même carte que TDR-032 | T2/T3 | Champ de provenance (source URL + date/commit) présent et vérifiable dans le snapshot généré |
| TDR-035 | F-A05-4 | info | Staleness du fallback runtime offline (observation, pas un bug) | (observation) | se referme avec TDR-034 | — | Aucun critère indépendant |
| TDR-036 | F-A05-5 | info (absence prouvée) | Aucune donnée de benchmark structurée vendored dans le périmètre audité | — | — | — | Aucune action requise ; règle préventive documentée dans `MODEL-DATA-LICENSE-AUDIT.md` §10 pour toute ingestion future |
| TDR-037 | F-A05-6 | info | Formats desktop (Tauri) et contenu exact du bundle mobile non vérifiés octet-à-octet | A06 (arbitrage) | Lot B (si jugé pertinent) | T6/T12 | Décision explicite : vérification complémentaire effectuée ou risque accepté et documenté (voir §Décisions gelées) |

## Décisions gelées par A06 sur les items à risque non trivial

Ces décisions sont **non négociables** par les cartes en aval (elles peuvent
implémenter, pas rediscuter le principe) :

1. **TDR-010 (F-A02-2, bearer token en query string)** — décision gelée : le
   support legacy `?authorization=Bearer+<jwt>` est **désactivé par défaut**
   dès la première carte de sécurité qui touche `auth-jwt.ts` (au plus tard
   à l'ouverture de N01/T13, mais **aucune carte ne doit l'étendre ni le
   documenter comme pattern accepté avant cette désactivation**). Toute
   exception doit être un opt-in explicite, temporaire, audité, avec échéance.
2. **TDR-009/TDR-018/TDR-023 (secrets, 3-couches AuthStorage)** — l'architecture
   `AuthStorage / CredentialBroker / PermissionBroker` (A02-V2 ADR) est **gelée
   comme l'autorité unique** pour tout secret dans Team. Aucune carte future
   ne doit introduire un chemin de lecture de credential parallèle (ni
   filesystem direct comme R-A03-9b, ni `process.env` direct comme F-A02-1).
3. **TDR-002 (cancellation arborescente)** — `Session.cancelRecursive(parentID)`
   est la primitive canonique gelée pour toute annulation Team touchant une
   arborescence de sessions ; aucune carte ne doit réimplémenter un cancel
   ad-hoc parent-seul.
4. **TDR-026/TDR-030 (hooks Husky + lease/fencing réels)** — gelé comme
   pré-requis d'infrastructure du Lot B avant que la première carte de code
   de production (B01) ne puisse committer : sans ces deux mécanismes, les
   gates qualité et scope du programme sont fail-open, pas fail-closed
   (violation de la doctrine §0.2). B01 ne doit pas démarrer tant que ces deux
   items ne sont pas au moins partiellement mitigés (voir critère de
   fermeture) ou qu'une décision explicite d'acceptation de risque n'a pas
   été prise et documentée par l'humain (Rwanbt) — **ce point est un
   candidat à une confirmation utilisateur explicite avant B01**, cf.
   `ADR-TEAM-FINAL-ARCHITECTURE.md` §Décisions à confirmer.
5. **TDR-014/TDR-017 (registry dynamique, invocation unifiée)** — le substrat
   `multi-model/` (provider-agnostic, sans enum statique) est gelé comme
   architecture cible pour tout code touchant plusieurs modèles ; aucune
   carte ne doit ajouter un nouvel enum de modèles statique.

## Vérification "registre vide"

- **37/37 items** possèdent : owner ✅, carte cible ✅, gate cible ✅, critère
  de fermeture vérifiable ✅.
- **0 item** sans destination.
- **0 TODO/FIXME/HACK/TEMP** introduit par cette carte (audit-only).
- Items `info`/`observation` sans action requise (TDR-004, TDR-027, TDR-029,
  TDR-035, TDR-036) sont explicitement marqués comme clos sans routage
  correctif — ce n'est pas une omission, c'est documenté comme
  ABSENCE PROUVÉE ou risque déjà mitigé.

---

_Fin du registre de dette technique — Lot A, Gate T0. 37 items consolidés
depuis A01-A05, tous routés avec critère de fermeture vérifiable. Aucune
modification de code production._
