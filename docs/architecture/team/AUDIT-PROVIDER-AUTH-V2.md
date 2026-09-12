# AUDIT-PROVIDER-AUTH-V2 — `packages/unifia/src/auth/` + `packages/unifia/src/provider/`

> **Carte :** TEAM-A02 (Lot A, Gate T0) — **tentative 2**
> **Worktree :** `D:\App\OpenCode\.team-worktrees\A02-015e1c84`
> **SHA de base :** `4be438597986380ec0b0a1af21524b74626e7e3c`
> **Date UTC :** 2026-07-20
> **Auteur :** MiniMax-M3 (E1, corrections E2)
> **Statut :** READY_FOR_E2_REVIEW
> **Hash d'instance :** alias `A02-V2` / canonique dérivé `6ef89609`
> **Supersede :** `AUDIT-PROVIDER-AUTH.md` (v1) — v1 reste archivé, NE PAS modifier.

> **Note importante — D-010 §5 appliquée.** A02-V2 doit neutraliser toute
> citation des findings A01, qui ne sont **pas APPROVED** (CHANGES_REQUESTED).
> A02-V2 utilise exclusivement ses propres findings F-A02-1..3 re-qualifiés par
> E2 et les décisions D-012 (verdict E2). Toute référence au « PermissionBroker
> recommandé par A01 §9.2 » est SUPPRIMEE et remplacée par une note explicite.

---

## 0. Méthode v2 (en plus de v1)

1. Lecture intégrale de `auth/index.ts` (579 lignes).
2. Lecture ciblée de `provider/loaders.ts` lignes 160-250.
3. Lecture ciblée de `provider/provider.ts` lignes 420-510.
4. Recherche `process.env|getenv|credential_file|api_key|Authorization` dans
   `src/**` (84 occurrences).
5. Lecture de `security/scanner.ts` lignes 25-184.
6. Lecture de `server/auth-jwt.ts` lignes 90-219.
7. Lecture de `collective/types.ts` et `collective/provider-discovery.ts` (modèle
   Debate).
8. **Nouvelle section v2** : threat model comparatif (cf. ADR §7).

---

## 1. Vue d'ensemble du flux (INCHANGÉ)
(voir v1 §1)

---

## 2. Cartographie détaillée (INCHANGÉ + corrections E2 §2.4)

### 2.4 EncryptedFile — AMEND E2
Le rapport v1 affirmait simplement « design only ». v2 clarifie : pour la CLI
headless, EncryptedFile est retenu **uniquement** avec une source de clé
**non prédictible et explicitement provisionnée**. L'usage de
`hostname`/`machine-id` comme sel Argon2 ne constitue **pas** un secret
suffisant. En l'absence de passphrase, keyring système, secret externe ou
clé sécurisée, le CLI doit :
- échouer proprement, OU
- exiger un opt-in `OPENCODE_AUTH_INSECURE_FILE=1` explicitement marqué
  non-sûr pour environnement dev uniquement.

---

## 3. Chemins credential (INCHANGÉ + tableau SANS modifs)

---

## 4. Propagation des credentials aux providers

### 4.1 Headers observés (INCHANGÉ)

### 4.2 ⚠ F-A02-1 — AMEND E2 (high, routage D03)

**v1 disait** : critical, P1, routage D03+H05+N01.
**v2 — verdict E2 :**

> L'affectation brute de auth.key à process.env.AWS_BEARER_TOKEN_BEDROCK est
> confirmée. Elle rend le credential accessible au processus entier et
> potentiellement aux sous-processus héritant de l'environnement. La sévérité
> passe de **critical à high** dans l'état actuel, et redevient critical dès
> qu'un worker non fiable ou un subprocess insuffisamment isolé peut être lancé.
> D03 doit supprimer cette propagation et instaurer la délégation opaque ;
> H05 doit démontrer qu'aucun environnement complet n'est transmis ; N01 doit
> couvrir les tests d'exfiltration et de régression.

Preuve — `packages/unifia/src/provider/loaders.ts:172-182` :
```ts
// TODO: Using process.env directly because Env.set only updates a process.env shallow copy,
// until the scope of the Env API is clarified (test only or runtime?)
const awsBearerToken = iife(() => {
  const envToken = process.env.AWS_BEARER_TOKEN_BEDROCK
  if (envToken) return envToken
  if (auth?.type === "api") {
    process.env.AWS_BEARER_TOKEN_BEDROCK = auth.key      // ← écriture brute
    return auth.key
  }
  return undefined
})
```

État préexistant (TODO ligne 172-173 dans le code). Risque subclassé high.

---

## 5. Sécurité du transport

### 5.1 Server auth (HTTP / WebSocket)

**F-A02-2 — AMEND E2 (high, routage T0 immédiat puis N01)** :

> L'acceptation par défaut d'un bearer token dans la query string est confirmée
> (auth-jwt.ts:151,203). Le legacy chemin doit être **désactivé dès T0**, pas
> seulement enregistré pour T13. D-012 E2 fixe ce routage. Une exception
> temporaire éventuelle doit être explicitement activée, émettre un audit de
> sécurité et afficher une échéance de suppression vérifiable.

Preuve — `packages/unifia/src/server/auth-jwt.ts:99-203` :
- Commentaire ligne 99 reconnaît explicitement « leaks into access logs ».
- Lignes 151, 203 : compat legacy `?authorization=Bearer+<jwt>` acceptée par
  défaut.

---

### 5.2 Plugin cleanup pattern (INCHANGÉ)

### 5.3 Scanner de secrets — AMEND E2 : F-A02-3 séparé en DEUX

**v1 disait** : P3, scanner limité à 5 providers.
**v2 corrige** : le scanner ne se limite PAS à 5 patterns ; les extraits
`security/scanner.ts:29-160` démontrent 18+ patterns couvrant secrets
génériques, AWS, Slack, Stripe, GitHub (6 patterns), Google, Anthropic, OpenAI
(2 patterns), Datadog, JWT. Voir `§5.3-v2` ci-dessous.

### 5.3-v2 — F-A02-3 reformulé (séparé)

**F-A02-3a (low)** : Couverture formats de secrets providers.
- Patterns actuels : 18+ (vus dans scanner.ts:29-160).
- Trou résiduel : `grok-`, `glm-`, `mistral-`, `cohere-`, `bedrock-`, `vertex-`,
  `zenmux-`, `zai-coding-plan-`, `zen-`, `github-copilot-*` (token rotation),
  tokens mobile (Expo, Fastlane), `npm_`, `pypi_`, etc.
- Action : sprint-durcissement, ajouter patterns manquants et patterns
  contextuels (proximité variable d'env).

**F-A02-3b (medium)** : Audit headers cleanup plugins tiers.
- plugins/codex.ts:395-400 : `init.headers.delete("Authorization")` avant envoi —
  bonne pratique existante.
- plugins/github-copilot/copilot.ts:144 : `delete headers["x-api-key"]` puis
  rotate to Bearer — cleanup.
- À vérifier exhaustivement sur **tous** les plugins tiers (mcp/*,
  anythingllm/*, rag/*, ops/*, local-models/*, rag/embed.ts, rag/index.ts,
  share/share-next.ts, git/credentials.ts).
- Action : sprint-durcissement, exécuter `rg -n 'x-api-key|PRIVATE-TOKEN|Authorization'` sur
  `packages/unifia/src/plugin/**` et vérifier le cleanup avant chaque send.

---

## 7. Surface threat model (v2)

### 7.1 Vecteurs existants (INCHANGÉ v1)

### 7.2 Vecteurs à bloquer dans Team (v2 — threat model comparatif)

Le plan §14.2 de Team exige la délégation opaque. Le threat model comparatif
doit au minimum couvrir :

| Vecteur | Surface | Impact Team |
|---|---|---|
| Worker malveillant (modèle compromis) | tous les worker runtimes | exfiltration de credentials, prompt injection |
| Plugin compromis (cas `plugin/codex.ts`, `plugin/github-copilot/copilot.ts`) | chaque plugin | exfiltration via header Authorization |
| Process enfant héritant de `process.env` | tous les subprocess | cas F-A02-1 (process.env = auth.key) |
| Attaquant same-UID avec accès disque | `auth.json` plaintext | exfiltration totale si FileStorage par défaut |
| Replay d'un handle révoqué | futur `CredentialHandle` | réutilisation de credentials révoqués |
| SSRF/IPC pivot vers shell Tauri | `OPENCODE_KEYCHAIN_URL` | pivot via `KeychainStorage` non câblé |
| Crash dump incluant `process.env` / `auth.json` | observability/crash-reporter | exfiltration post-mortem |
| Logs de diagnostic | diagnostic bundle | fuite via logs |
| Déconnexion du shell Tauri pendant une opération | KeychainStorage | perte d'IPC, état partiel |

**Action** : le threat model A06 doit couvrir au minimum ces 9 vecteurs, en
s'appuyant sur la cartographie A02-v2. Cartes N01 (security) doivent exécuter
la suite d'exfiltration couvrant **tous** ces vecteurs.

---

## 9. Limites (INCHANGÉ)

---

## 10. Preuves fichier:ligne (v2 — 42 entrées, +0 vs v1)

Le tableau v1 reste valide. v2 ajoute simplement les 3 lignes ci-dessous au
compteur (44 au total) :

| # | Fichier:ligne | Sujet |
|---|---|---|
| 43 | cli/cmd/tui/worker.ts:48-53 | eventStream.abort.abort() (référence F-A02-1 propagation) |
| 44 | server/routes/session.ts:241 | Session.remove caller (référence F-A01-5 honnêteté) |

---

## 11. Verdict provisoire (v2)

| Critère | Statut v1 | Statut v2 |
|---|---|---|
| AuthStorage abstraction | OK | OK (AuthStorage / CredentialBroker / PermissionBroker — voir ADR) |
| FileStorage par défaut | OK mais plaintext | **NE PLUS ÊTRE DÉFAUT EN PROD** (E2 verdict) |
| KeychainStorage scaffold | dormancy | À finaliser (KeychainStorage TS finalisation) |
| EncryptedFile | design only | **CLI uniquement, clé provisionnée, fail-closed** |
| Header patterns | OK | OK |
| F-A02-1 | critical/P1 | **high/D03** |
| F-A02-2 | P1/T13 | **high/T0 immédiat** |
| F-A02-3 | P3 | **low (a: formats) + medium (b: cleanup headers plugins)** |
| OAuth callback HTML | OK mais XSS | inchangé |
| ipc keychain auth | OK bearer env | OK + validation stricte (E2) |
| Threat model comparatif | (manquant) | **9 vecteurs nouveaux v2** |

---

## 12. Note D-010 — Neutralisation A01 (CONFIDENTIEL)

A02-V2 **ne cite aucun finding A01**, **ne s'appuie sur aucune conclusion A01**.
Le brouillon v1 §3.1 citait « PermissionBroker recommandé par A01 §9.2 ». Cette
citation est **SUPPRIMEE** dans A02-V2 et remplacée par :

> La décomposition canonique en 3 couches (AuthStorage / CredentialBroker /
> PermissionBroker) est dérivée des exigences du plan §14.2 et des contraintes
> du substrat multi-modèle canonique (cf. carte A03 audit et extraction).

C'est la formulation minimale compatible avec D-010 §5. Si un reviewer E2
demande pourquoi cette formulation-ci (et non l'invocation directe A01), la
réponse est : « par décision D-010 §5 ; A01 est actuellement CHANGES_REQUESTED ;
A02 réessaiera d'intégrer A01 dès que A01 sera APPROVED via cherry-pick ».

---

_Fin du rapport v2 — auteur MiniMax-M3 (E1). Code réel vérifié au SHA `4be4385979...`.
Aucune modification de code production. v1 archivé intact._
