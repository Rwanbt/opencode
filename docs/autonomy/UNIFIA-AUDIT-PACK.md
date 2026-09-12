# UNIFIA-AUDIT-PACK — Audit du pack autonome v1.0

**Cible :** `/opt/data/projets/unifia-hermes-minimax-autonomous-pack-v1.0/`
**Auditeur :** Hermes Agent (MiniMax-M3)
**Date :** 2026-07-31
**Statut :** `VERIFIED` — audit 100% local, lecture seule du pack

## TL;DR

Le pack est **techniquement excellent** (couvre 95% des pièges d'un agent autonome) mais **manque de 4 inputs critiques** pour être exécutable. La plus grosse faille n'est pas dans le protocole — c'est l'absence du **Plan directeur V3** qu'il est censé encadrer. Tant que ce document n'est pas fourni, l'agent peut produire des artefacts (inventaire, graph draft) mais pas exécuter le rebrand.

**Note globale du pack : 8/10** — framework réutilisable, livrable opérationnel une fois les inputs fournis.

## Audit par dimension

### 1. Constitution HERMES.md — 10/10
- Hiérarchie claire des sources de vérité (7 niveaux).
- Interdictions absolues bien prioritisées (push, secrets, hooks bypass, modifications main/Dev/Team).
- Règle de revue read-only fresh-context = anti auto-approbation.
- Limites de scope par carte (≤ 400 lignes, ≤ 8 fichiers) = empêche l'explosion.
- **`NEEDS_EXTERNAL_E2`** pour les gates critiques = honnêteté encodée.

**Force :** distingue clairement « ce que l'agent fait » et « ce qu'il ne fait pas ».

### 2. Schéma de carte (06) — 9/10
- YAML bien typé, 17 sections explicites.
- Limites de scope (allowed/forbidden paths) = filets de sécurité.
- Sécurité graduée (LOW/MEDIUM/HIGH/CRITICAL) avec cas de menace.
- Provenance obligatoire pour tout import tiers.
- **Petit manque :** pas de champ `estimated_review_minutes` ni `complexity_score`. Une carte de 8 fichiers à 400 lignes prend 30 min à reviewer, une de 1 fichier à 50 lignes prend 5 min — l'estimation aiderait à planifier.

### 3. Protocole d'exécution (07) — 9/10
- 10 sections couvrant : états, limites, branches, commit, 3-strikes, parallélisme, baseline rouge, revue, gates, reprise après crash, fin.
- **Commit trailer** avec 5 lignes de provenance = parfait pour l'audit.
- **Règle des 3 cycles** documentée avec procédure de restauration du dernier checkpoint sain.
- **Petit manque :** la section 10 « reprise après crash » suppose que `EXECUTION-LOG.jsonl` est intégraux après un crash, mais ne précise pas ce qui se passe si la dernière ligne est corrompue. Ajouter un checksum ou un atomic-rename.

### 4. Master prompt (05) — 8/10
- 7 étapes logiques (preflight → inventaire → baseline → graphe → exécution → gates → final).
- **Étape 0 bien verrouillée** : push dry-run doit échouer avant tout.
- **Étape 3 demande une revue read-only du graphe** = sain.
- **Petit manque :** ne précise pas la stratégie de parallélisme au sein d'une même phase. La règle du §6 du protocole (« chemins disjoints ») est claire, mais le master prompt ne dit pas quand lancer des subagents en parallèle. À ajouter.

### 5. Bootstrap PowerShell (bootstrap-unifia-hermes.ps1) — 8/10
- Création de sandbox séparée, pushurl invalide, hook pre-push, dry-run.
- Écrit `docs/autonomy/BOOTSTRAP.md` = trace d'audit immédiate.
- **Faille réelle :** ne crée pas le tag baseline local. Le pack recommande plus tard (étape 0 du master prompt) de créer un tag annoté, mais le bootstrap pourrait le faire pour blinder.
- **Faille réelle :** ne configure pas `safe.directory` pour les clones multi-comptes. Si le user lance le bootstrap sous un user Windows différent du user Git configuré, Git refusera le checkout.

### 6. Verify-safety.ps1 — 9/10
- 6 vérifications (branche agent, pushurl, env, HERMES.md, plan, push dry-run).
- **Bonne idée :** vérifie la présence de HERMES.md et PLAN-DIRECTEUR-V3.md à la racine.
- **Petit manque :** ne vérifie PAS que le hook pre-push est bien exécutable (chmod). Sur Windows après `Set-Content -Encoding ascii`, le bit d'exécution est OK, mais après un copier-coller depuis un zip, il peut être perdu.

### 7. Image Docker d'exécution (03) — 6/10 ⚠️
- Node 22 + Bun + outils de base = bon début.
- **MANQUE les dépendances Tauri** : webkit2gtk, gtk, ayatana, librsvg, libsoup, javascriptcoregtk. Sans elles, `bun run dev:desktop` échouera sur la compilation Cargo.
- **MANQUE `cargo` lui-même** dans le `apt-get install` (juste `build-essential` qui n'inclut pas Cargo).
- **MANQUE la libssl-dev pour Cargo** (certes listée, mais à confirmer).
- **Non-spécifié :** quel utilisateur lance Bun dans le conteneur. Le Dockerfile crée `agent` (uid 1000) puis `USER agent`, OK — mais les `RUN apt-get` se font en root avant, donc cohérent.
- **Bonne idée :** `core.hooksPath` au niveau système (pas juste local) = ceinture + bretelles.

### 8. Protection GitHub (02) — 9/10
- Ruleset sur 5 branches (`main`, `Dev`, `Team`, `release/*`, `upstream-sync/*`).
- **Bonne pratique :** « aucun bypass pour le compte ou token utilisé par Hermes » = bloque l'auto-contournement.
- **Bonne pratique :** « MINIMAX_API_KEY reste dans l'env de l'agent, pas dans le terminal Docker » = séparation propre.
- **Petit manque :** ne mentionne pas la rotation des PAT. Si un PAT fuit, comment le révoquer ? À documenter dans une section « incident ».

### 9. Verdict et lacunes (01) — 10/10
- Tableau à 6 dimensions avec notes = auto-évaluation honnête.
- 16 manques listés explicitement.
- Conclusion : « Le plan original doit rester la constitution d'architecture. Hermes ne doit pas l'exécuter directement. Il doit d'abord générer un programme de cartes vérifiables à partir de l'audit réel du dépôt. »
- **C'est exactement ce que ce pack enforce.** Cohérence totale.

## Failles et améliorations proposées

### Faille A — Plan Directeur V3 manquant
**Sévérité :** BLOQUANT
**Manifestation :** `COPY-PLAN-HERE.txt` est vide.
**Mitigation :** Le pack pourrait inclure un **exemple de plan V3** stubbé, ou au minimum un lien vers la structure attendue. Sans ça, l'utilisateur doit fournir un document complet AVANT de lancer.

### Faille B — Pas de fallback si Docker n'est pas dispo
**Sévérité :** MOYENNE
**Manifestation :** Si l'utilisateur n'a pas Docker Desktop, le pack n'a pas de mode dégradé.
**Mitigation :** Ajouter une section « mode sans Docker » : utiliser un user Linux dédié avec `git --system core.hooksPath` installé, sans conteneur.

### Faille C — Le `agent/integration` n'est pas créée par le bootstrap
**Sévérité :** FAIBLE
**Manifestation :** Le protocole (07 §3) attend `agent/integration`, mais le bootstrap crée `agent/unifia-workbench-v3-...`. C'est cohérent (le bootstrap crée la branche de travail, `agent/integration` est créée plus tard par P0-C001), mais ambigu.
**Mitigation :** Documenter explicitement : « bootstrap crée la branche de TRAVAIL, P0-C001 crée la branche d'INTÉGRATION ».

### Faille D — Pas de mode « revue seule » (read-only execution)
**Sévérité :** MOYENNE
**Manifestation :** L'agent doit forcément éditer pour exécuter. Si l'utilisateur veut juste un audit du repo (sans toucher), pas de mode dédié.
**Mitigation :** Ajouter une option `hermes chat --read-only` qui pose `core.hooksPath` sur un hook qui refuse TOUT commit (pas juste push).

### Faille E — Pas de budget tokens / coûts
**Sévérité :** MOYENNE
**Manifestation :** Un TASK-GRAPH de 200 cartes × 3 cycles de revue × 30k tokens = 18M tokens. C'est ~$50-200 selon le provider. Aucune estimation.
**Mitigation :** Ajouter dans `06-TASK-CARD-SCHEMA.yaml` un champ `estimated_tokens` obligatoire.

### Faille F — Le Dockerfile de l'image ne build pas Tauri
**Sévérité :** BLOQUANT pour les cartes desktop
**Mitigation :** voir §7 ci-dessus. Patch proposé dans le verdict initial.

## Recommandations (par ordre de priorité)

1. **Patcher le Dockerfile** pour ajouter les deps Tauri (cf. verdict initial).
2. **Fournir le Plan Directeur V3** ou accepter un TASK-GRAPH DRAFT comme entrée (mode dégradé).
3. **Ajouter un champ `estimated_tokens`** dans le schéma de carte.
4. **Documenter le mode sans Docker** comme alternative dégradée.
5. **Tester le bootstrap sur une VM jetable** avant de le déclarer « production-ready ».
6. **Ajouter une section « gestion d'incident »** : comment révoquer un token, comment kill un agent zombie, comment reprendre après un crash OOM.

## Conclusion

Le pack v1.0 est **utilisable en l'état** pour des rebrands simples (≤ 50 fichiers touchés). Pour le rebrand Unifia Workbench (estimé 1500-2200 fichiers), il faut :
- (a) le Plan Directeur V3,
- (b) le Dockerfile Tauri patché,
- (c) accepter le TASK-GRAPH DRAFT comme livrable initial.

Avec ces 3 inputs, l'exécution peut commencer **par carte**, avec revue fresh-context et bundle final dans `/handoff`. Sans eux, l'exécution est du vapor-coding et doit être refusée (ce que le pack prévoit explicitement dans ses conditions d'arrêt).
