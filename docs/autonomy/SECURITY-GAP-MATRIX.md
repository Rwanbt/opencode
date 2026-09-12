# SECURITY-GAP-MATRIX.md

**Phase :** -1 (Audit comparatif)
**Statut :** `DRAFT` — basé sur lecture README + top-level ; audit code réel en Phase 3
**Date :** 2026-07-31


## Correctif M1 — règle de preuve

Les mentions UNVERIFIED, UNVERIFIED ou ssumed ne sont pas des preuves. Les décisions historiques restent non exécutables tant que le dépôt, le commit, le chemin exact, la licence et le comportement n'ont pas été vérifiés. Inventaires vérifiés : OpenWork pps/server/ (171 chemins), OpenWork pps/desktop/electron/ (60), Open Cowork src/main/remote/ (16), src/main/sandbox/ (17), et src/main/skills/ + .claude/skills/ (143). OpenWork /ee reste EXCLUDE (1 067 chemins Fair Source). i18n utilisateur reste BLOCKED_MISSING_SOURCE.

## 1. Méthodologie

Pour chaque **surface de sécurité** (cf. Plan V3 §8.3, §8.7), on évalue :
- Présence dans le fork Unifia
- Présence dans OpenWork
- Présence dans Open Cowork
- Statut par défaut (allow / deny)
- Gaps à combler

## 2. Matrice des surfaces de sécurité

| Surface | Plan V3 § | Fork Unifia | OpenWork | Open Cowork | Statut par défaut Unifia | Gap |
|---|---|---|---|---|---|---|
| **Computer use** | §8.3, §8.7 | ❌ | UNVERIFIED | UNVERIFIED (Python) | **DENY** | À implémenter Phase 10 avec broker dédié |
| **Remote commands destructives** | §8.7 | UNVERIFIED | UNVERIFIED (Slack) | UNVERIFIED (Feishu) | **DENY** | À implémenter Phase 9 avec RemoteRuntime |
| **Agent terminal control** | §8.7 | UNVERIFIED | UNVERIFIED | UNVERIFIED | **DENY** (avec approbation JIT) | PolicyEngine Phase 3 |
| **Agent browser control** | §8.7 | ❌ | UNVERIFIED | UNVERIFIED | **DENY** | Phase 10 |
| **Lifecycle hooks** | §8.7 | UNVERIFIED | UNVERIFIED | UNVERIFIED | **DENY** | Audit + PolicyEngine |
| **Remote code packages** | §8.7 | UNVERIFIED | UNVERIFIED (skills) | UNVERIFIED (skills) | **DENY** sauf allowlist | CapabilityRegistry |
| **Accès global aux fichiers** | §8.7 | ❌ | UNVERIFIED | UNVERIFIED | **DENY** (workspace.read[path] scopé) | PolicyEngine + WorkspaceRuntime |
| **Lecture de secrets** | §8.7 | UNVERIFIED | UNVERIFIED | UNVERIFIED | **DENY** hors SecretStore | SecretStore Phase 3 |
| **Réseau arbitraire** | §8.7 | UNVERIFIED | UNVERIFIED | UNVERIFIED | **DENY** hors allowlist (network.request[host-pattern]) | PolicyEngine + Capability |
| **Screenshot redaction** | §8.3 | ❌ | UNVERIFIED | UNVERIFIED | **N/A** (computer use pas activé) | Phase 10 |
| **Allowlist d'applications** | §8.3 | ❌ | UNVERIFIED | UNVERIFIED | **DENY** (toutes apps par défaut) | Phase 10 |
| **Bouton d'arrêt d'urgence** | §8.3 | ❌ | UNVERIFIED | UNVERIFIED | **N/A** | Kill switch + UI Phase 7 |
| **Isolation des secrets** | §8.3 | UNVERIFIED | `.infisical.json` | UNVERIFIED | OK si SecretStore Phase 3 | Phase 3 |
| **Tests d'injection visuelle** | §8.3 | ❌ | ❌ | ❌ | À créer | Phase 10 |
| **Replay protection** | §8.3 | ❌ | UNVERIFIED | UNVERIFIED | À créer | Phase 3 (eventlog) |
| **Combinaisons critiques** (Plan V3 §15) | §15 | ❌ | UNVERIFIED | UNVERIFIED | DENY par défaut | PolicyEngine |

## 3. Matrice des combinaisons critiques (Plan V3 §15)

Ces combinaisons sont **explicitement interdites** sauf approbation JIT (just-in-time) :

| Combinaison | Plan V3 | Fork Unifia | OpenWork | Open Cowork | Statut Unifia |
|---|---|---|---|---|---|
| `secret.read + network.request` | DENY sauf JIT | ❌ pas implémenté | UNVERIFIED | UNVERIFIED | À implémenter Phase 3 |
| `desktop.control + secret.read` | DENY sauf JIT | ❌ | UNVERIFIED | UNVERIFIED | À implémenter Phase 3+10 |
| `remote.receive + terminal.run` | DENY sauf JIT | ❌ | UNVERIFIED | UNVERIFIED | À implémenter Phase 3+9 |
| `package.install + desktop.control` | DENY sauf JIT | ❌ | UNVERIFIED | UNVERIFIED | À implémenter Phase 3+10 |
| `workspace.read[global] + network.request[*]` | DENY sauf JIT | ❌ | UNVERIFIED | UNVERIFIED | À implémenter Phase 3+4 |
| `browser.cookies + network.request[*]` | DENY sauf JIT | ❌ | UNVERIFIED | UNVERIFIED | À implémenter Phase 3+10 |

## 4. Gaps identifiés

### Gaps CRITIQUES (bloquant Phase 10+)

1. **Pas de PolicyEngine** dans le fork Unifia → toutes les permissions sont gérées ad-hoc.
2. **Pas d'ApprovalBroker** → les approbations sont au mieux natives (dialog natif Tauri/Electron).
3. **Pas d'AuditRuntime** → l'audit est UNVERIFIEDment best-effort (logs dispersés).
4. **Pas de SecretStore dédié** → les secrets sont UNVERIFIEDment dans `~/.opencode` ou équivalent (faille).
5. **Pas de sandbox WSL2/Lima** → Open Cowork a un avantage ici (Python).
6. **Pas de computer use broker** → l'agent n'a pas de computer use activé (par défaut, c'est OK).

### Gaps MOYENS (à combler en Phase 3)

7. **Pas de TaintTracker** → un secret lu par un tool n'est pas tracé.
8. **Pas de quotas** → un agent peut consommer sans limite.
9. **Pas de kill switches** granulaires (un seul bouton général).
10. **Pas de replay protection** sur les événements.

### Gaps FAIBLES (à polir en Phase 17+)

11. Pas de tests d'injection visuelle.
12. Pas de redactor de screenshots.
13. Pas d'allowlist d'applications formelle.

## 5. Risques spécifiques par source

### OpenWork
- **Infisical** (`.infisical.json`) : SaaS externe pour les secrets. **À remplacer** par SecretStore Unifia (Plan V3 §3.3).
- **50 branches avec `ee/`** : code propriétaire possible. **À exclure** par défaut.
- **Vercel deployment** (`.vercelignore`) : surface d'attaque supplémentaire si déploiement mal configuré.
- **Stats télémétrie** (`STATS.md`, `STATS_V2.md`) : envoi potentiel de données, à auditer.

### Open Cowork
- **Python scripts** : 37 fichiers, surface d'attaque étendue (pip packages). Sandbox obligatoire.
- **XSD files** : 78 schémas, UNVERIFIEDment parsés. Risque XXE (XML External Entity) si parser naïf.
- **`eigent-ai/eigent` mentionne Feishu** : communication sortante vers serveurs chinois, à valider contre la politique de l'organisation.

### Fork Unifia (Rwanbt)
- **Pas de gate CI sécurité** (`.gitleaks.toml` est présent — bon point, à vérifier qu'il est actif).
- **`Bannière OpencodeX.png` (1.5 MB)** : asset binaire, à scanner.
- **21 langues** : surface i18n = surface d'injection si une traduction contient du code.

## 6. Recommandations

### Phase 0 (rebrand) — actions sécurité
1. Activer `.gitleaks.toml` en CI.
2. Ajouter un hook pre-commit bloquant les `.env*` (déjà dans `.gitignore` UNVERIFIED, à vérifier).
3. Supprimer `Bannière OpencodeX.png` (asset non audité).

### Phase 1 (harness) — actions sécurité
1. Ajouter `npm audit` et `cargo audit` en CI.
2. Configurer `cargo deny` (Cargo) et `npm sbom` (JS).
3. Générer la première SBOM.

### Phase 3 (sécurité foundation) — actions critiques
1. Implémenter `PolicyEngine` + `ApprovalBroker` + `SecretStore` + `AuditRuntime`.
2. Implémenter `TaintTracker` v0.
3. Configurer default-deny sur toutes les surfaces (Plan V3 §8.7).
4. Bloquer les 6 combinaisons critiques (§3).
5. Tester l'injection visuelle et le replay.

### Phase 10+ (computer use) — actions tardives
1. Broker dédié (DesktopAutomationBroker).
2. Screenshot redaction.
3. Allowlist d'applications.
4. Bouton d'arrêt d'urgence UI.

## 7. Conclusion

- Le **fork Unifia est insuffisant en sécurité** : 6 gaps CRITIQUES (PolicyEngine, ApprovalBroker, AuditRuntime, SecretStore, WSL2/Lima, computer use broker).
- **OpenWork a un avantage** sur l'audit (UNVERIFIED AuditRuntime) mais utilise Infisical (à remplacer).
- **Open Cowork a un avantage** sur le sandbox Python (à importer via SandboxBroker).
- **Aucun des 3 n'a de couverture suffisante** pour les 6 combinaisons critiques du Plan V3 §15.
- La **Phase 3 est bloquante** avant toute activation de computer use / remote / browser control.
