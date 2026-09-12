# THREAT-MODEL — Programme Agent Team V3

> **Carte :** TEAM-A06 (Lot A, Gate T0 — clôture)
> **SHA de base :** `ef48e5d5c5cc0aff802a519950e15aeb3786e1c6`
> **Date UTC :** 2026-07-21
> **Auteur :** Claude Sonnet 5 (consolidation A01-A05)
> **Méthode :** consolidation des vecteurs identifiés par les audits A01-A05,
> pas une nouvelle analyse STRIDE de zéro — chaque vecteur cite son audit
> source. Référence croisée avec `TECHNICAL-DEBT-REGISTER.md` (TDR-IDs).

---

## 1. Vecteurs identifiés par A02 (surface secrets/auth) — 9 vecteurs, repris intégralement

| ID | Vecteur | Surface | Impact Team | TDR ref |
|---|---|---|---|---|
| TM-01 | Worker malveillant (modèle compromis) | Tous les worker runtimes | Exfiltration de credentials, prompt injection | TDR-009, TDR-013 |
| TM-02 | Plugin compromis (`plugin/codex.ts`, `plugin/github-copilot/copilot.ts`) | Chaque plugin | Exfiltration via header Authorization | TDR-012 |
| TM-03 | Process enfant héritant de `process.env` | Tous les subprocess | Cas concret confirmé : F-A02-1 (`process.env.AWS_BEARER_TOKEN_BEDROCK = auth.key`) | TDR-009 |
| TM-04 | Attaquant same-UID avec accès disque | `auth.json` plaintext (FileStorage par défaut) | Exfiltration totale si FileStorage reste le défaut en production | TDR-009, TDR-018 |
| TM-05 | Replay d'un handle révoqué | Futur `CredentialHandle` | Réutilisation de credentials révoqués si la révocation n'est pas vérifiée à chaque usage | TDR-009 (architecture AuthStorage) |
| TM-06 | SSRF/IPC pivot vers shell Tauri | `OPENCODE_KEYCHAIN_URL` | Pivot via `KeychainStorage` non câblé | TDR-009 |
| TM-07 | Crash dump incluant `process.env`/`auth.json` | Observability/crash-reporter | Exfiltration post-mortem via rapport de crash | TDR-009 |
| TM-08 | Logs de diagnostic | Diagnostic bundle | Fuite de secrets via logs si le cleanup headers (F-A02-3b) est incomplet | TDR-012 |
| TM-09 | Déconnexion du shell Tauri pendant une opération | KeychainStorage | Perte d'IPC, état partiel, comportement non défini | TDR-009 |

**Mitigation architecturale commune (gelée, cf. TECHNICAL-DEBT-REGISTER.md
§Décisions gelées #2) :** la décomposition `AuthStorage / CredentialBroker /
PermissionBroker` est l'autorité unique pour tout secret. TM-01 à TM-09 sont
tous, à des degrés divers, des variantes d'un même problème racine : un
credential accessible en clair par un chemin non contrôlé (env, disque,
crash dump, logs) plutôt que par une délégation opaque avec révocation
vérifiable.

## 2. Vecteur A01 — confidentialité du header `x-parent-session-id`

| ID | Vecteur | Surface | Impact Team | TDR ref |
|---|---|---|---|---|
| TM-10 | Corrélation cross-session via header HTTP provider | `session/llm.ts:664`, tout provider recevant le header | `SessionID` est opaque (non-PII direct) mais corrélable ; exposition possible à des sous-traitants du provider (sous-processeurs) sans notice ni kill switch actuel | TDR-007 |

**Action gelée :** kill switch à introduire (plan §22, kill switches
permanents) avant que ce header ne soit envoyé par défaut à un provider
tiers en contexte Team multi-agent (le risque de corrélation augmente avec
le nombre de sessions enfants simultanées, caractéristique du programme
Team).

## 3. Vecteurs A04 — intégrité de la chaîne d'orchestration Git/worktrees

| ID | Vecteur | Surface | Impact Team | TDR ref |
|---|---|---|---|---|
| TM-11 | Gate qualité (biome/shellcheck) silencieusement no-op | Tout worktree de carte sans `bun install` exécuté | Un commit de carte touchant du code de production pourrait passer sans lint/typecheck, sans qu'aucune alerte ne soit émise | TDR-026 |
| TM-12 | Lease/fencing token non appliqué mécaniquement | Tout le cycle de vie multi-agent (claim → discover → commit) | Deux exécuteurs pourraient réclamer le même worktree, ou committer hors du `allowed_files` déclaré, sans détection automatique | TDR-030 |
| TM-13 | `core.longpaths` non configuré | Worktrees profonds (node_modules, .git/objects) sur Windows | Échecs de build/checkout imprévisibles selon la longueur de chemin, spécifique à la machine hôte | TDR-024 |
| TM-14 | `core.ignorecase=true` (NTFS) | Toute création de fichier dans un worktree de carte | Collision silencieuse entre deux fichiers ne différant que par la casse | TDR-028 |

**Constat transversal (nouveau, identifié en A06, pas dans A04) :** TM-11 et
TM-12 partagent une même racine — le programme Team V3 repose actuellement
sur la **discipline documentaire** des exécuteurs (respect du YAML de carte)
plutôt que sur une **application mécanique**. C'est acceptable en Gate T0
(cartes d'audit read-only, risque contenu), mais devient un point de
vigilance critique dès que le Lot B introduit des cartes qui modifient du
code de production réel avec des enjeux de sécurité (ex. D03, N01). Voir
décision gelée #4 dans `TECHNICAL-DEBT-REGISTER.md`.

## 4. Vecteur A05 — conformité de redistribution de données tierces

| ID | Vecteur | Surface | Impact Team | TDR ref |
|---|---|---|---|---|
| TM-15 | Redistribution de données tierces sans notice de licence | Tous les artefacts de release (binaire, archives, npm, mobile) | Non-conformité à la licence MIT de `models.dev` ; risque juridique faible mais réel, risque réputationnel si relevé par un tiers avant correction | TDR-032, TDR-033 |
| TM-16 | Absence de traçabilité de version de données embarquées | Tous les artefacts de release | Impossible de répondre avec certitude, pour une release donnée, à "quelles données exactes ce binaire contient-il" — pertinent en cas d'erreur de pricing signalée | TDR-034 |

## 5. Threat model transversal — surface d'attaque multi-agent (analyse A06, nouvelle)

Au-delà de la simple consolidation des vecteurs déjà identifiés par audit,
A06 identifie un axe transversal qui n'appartient à aucun audit individuel
mais émerge de leur combinaison :

**TM-17 (nouveau, A06) — Composition des vecteurs credential + cancellation.**
Un worker malveillant ou compromis (TM-01) qui exfiltre un credential
(TM-03/TM-04) via une session enfant, si cette session enfant échappe à la
cancellation arborescente (TDR-002, actuellement absente) parce que son
parent est annulé mais elle continue de tourner, dispose d'une fenêtre de
temps prolongée pour l'exfiltration après que l'orchestrateur croit
l'opération arrêtée. C'est une **composition de deux findings déjà connus**
(F-A01-2 et F-A02-1) dont l'effet combiné est plus grave que la somme de
leurs effets isolés.

- **Sévérité de la composition :** high.
- **Owner :** D03 + H02 (les deux cartes qui ferment TDR-002 et TDR-009
  doivent être livrées avant que Team n'exécute un worker non fiable en
  production — ceci est une **précondition inter-cartes**, pas seulement
  deux items indépendants).
- **Critère de fermeture :** un test d'intégration N01 doit couvrir
  explicitement le scénario "annulation parent + session enfant en cours
  d'exfiltration" et démontrer que l'enfant est effectivement arrêté avant
  toute fenêtre d'exploitation prolongée.

## 6. Hors périmètre de ce threat model

- Vecteurs internes aux providers tiers (OpenAI, Anthropic, etc.) — hors du
  contrôle d'OpenCode, mentionnés seulement où ils intersectent avec le
  code de Team (ex. TM-01, TM-10).
- Vecteurs génériques de sécurité npm/supply-chain (couverts par
  `cargo audit`/`osv-scanner` équivalents npm, hors scope du Lot A).
- Analyse de performance/DoS (hors scope explicite des audits A01-A05).

---

_Fin du threat model consolidé — 17 vecteurs (9 A02 + 1 A01 + 4 A04 + 2 A05
+ 1 transversal nouveau A06), tous tracés vers `TECHNICAL-DEBT-REGISTER.md`._
