# IMPORT-CANDIDATES.md

**Phase :** -1 (Audit comparatif)
**Statut :** `DRAFT` — raffinement requis en Phase 1 avec lecture de code réelle
**Date :** 2026-07-31


## Correctif M1 — règle de preuve

Les mentions UNVERIFIED, UNVERIFIED ou assumed ne sont pas des preuves. Les décisions historiques restent non exécutables tant que le dépôt, le commit, le chemin exact, la licence et le comportement n'ont pas été vérifiés. Inventaires vérifiés : OpenWork apps/server/ (171 chemins), OpenWork apps/desktop/electron/ (60), Open Cowork src/main/remote/ (16), src/main/sandbox/ (17), et src/main/skills/ + .claude/skills/ (143). OpenWork /ee reste EXCLUDE (1 067 chemins Fair Source). i18n utilisateur reste BLOCKED_MISSING_SOURCE.

## 1. Légende

| Verdict | Signification |
|---|---|
| `ADOPT` | Importer tel quel, après audit code |
| `ADAPT` | Importer et modifier pour conformité Unifia |
| `REWRITE` | Réécrire from scratch en suivant le pattern |
| `INSPIRER` | Ne pas importer, juste s'inspirer du design |
| `EXCLUDE` | Ne pas importer (licence, technique, ou stratégique) |
| `EXCLUDE_LICENCE` | Ne pas importer — licence amont l'interdit explicitement (extract / copy / derivative / distribute / sublicense / transfer / reverse-engineer). Aucun contournement n'est autorisé. |
| `BLOCKED_LICENCE` | Statut provisoire en attente de revue explicite (typiquement : licence ambiguë, NOTICE manquant, ou vendor non confirmé). Bloque tout import tant que la revue n'a pas tranché. |
| `DEFER` | Importer plus tard (Phase X+) |

## 2. Candidats à l'import — depuis OpenWork upstream

### OW-S1 — apps/server (serveur headless multi-workspace)
- **Source :** `https://github.com/different-ai/openwork@2c558bcff` (HEAD verrouillé)
- **Verdict :** `ADAPT`
- **Phase cible :** 5
- **Risque :** DOUBLON_FORT avec `packages/unifia/src/runtime/`
- **Adaptation requise :** Refactorer en `OpenCodeRuntimeAdapter` (Plan V3 §7.1). Préserver la multi-workspace (à conserver comme feature Unifia).
- **Justification :** OpenWork est identifié par Plan V3 §3.1 comme « donneur structurel principal ».
- **Critères de succès :** OpenCodeRuntimeAdapter passe la conformance suite Phase 1.

### OW-S2 — apps/desktop UI patterns (Trace Panel, Permission dialogs)
- **Source :** `https://github.com/different-ai/openwork@2c558bcff`
- **Verdict :** `INSPIRER`
- **Phase cible :** 7
- **Adaptation :** Réécrire en SolidJS (cohérence avec Shell Unifia) en suivant les patterns.
- **Justification :** Le fork Unifia utilise déjà SolidJS (`packages/app/`), pas React.

### OW-S3 — Capability discovery + manifest typé
- **Source :** `https://github.com/different-ai/openwork@2c558bcff`
- **Verdict :** `ADOPT`
- **Phase cible :** 4 (WorkspaceRuntime) + 5 (CapabilityRegistry)
- **Adaptation :** Le format manifest OpenWork sert d'inspiration pour `CapabilityDescriptor` (Plan V3 §7.3).
- **Critères :** Un capability pack OpenWork doit pouvoir être lu par Unifia sans modification.

### OW-S4 — Stats / télémétrie
- **Source :** `https://github.com/different-ai/openwork@2c558bcff`
- **Verdict :** `EXCLUDE` pour l'instant
- **Justification :** Télémétrie activée par défaut = fuite de données potentielle. À reconsidérer en Phase 17 (Release hardening) si tu veux une option opt-in.

### OW-S5 — Code Swift natif (iOS/macOS)
- **Source :** `https://github.com/different-ai/openwork@2c558bcff`
- **Verdict :** `DEFER` Phase 19+
- **Justification :** Tauri garde-fou pour Phase 0-18. Swift natif est post-production.

### OW-S6 — Code `ee/` (1 067 chemins)
- **Source :** `https://github.com/different-ai/openwork@2c558bcff`, branches `ee/*`
- **Verdict :** `EXCLUDE` (par défaut, par licence)
- **Justification :** Plan V3 §3.1 « OpenWork Den /ee → Exclure par défaut ». `ee/LICENSE` est Fair Source FSL-1.1-MIT, licence distincte vérifiée dans LICENSE-AUDIT-CORRECTION-2026-08-03.md.
- **Verrou :** Hook pre-commit + scan CI qui refuse tout chemin `**/ee/**` dans les imports.

## 3. Candidats à l'import — depuis Open Cowork upstream

### OCW-S1 — Skills bureautiques (DOCX/PPTX/XLSX/PDF)
- **Source :** `https://github.com/OpenCoworkAI/open-cowork@ec5bd27` (HEAD verrouillé)
- **Sous-ensemble :** 5 sous-skills (138 fichiers), voir détail licence dans `M1-PROVENANCE-DETAIL-2026-08-03.md` §3.

#### OCW-S1.a — `.claude/skills/docx/` (60 fichiers)
- **Verdict :** `EXCLUDE_LICENCE`
- **Justification :** `LICENSE.txt` au format Anthropic-restricted (© 2025 Anthropic, PBC). Clauses explicites : pas d'extraction, pas de reproduction, pas de travaux dérivés, pas de distribution / sous-licence / transfert, pas de rétro-ingénierie. Voir `M1-PROVENANCE-DETAIL-2026-08-03.md` §3.1 (texte verbatim).
- **Verrou :** Le registre `ProvenanceRecord` (C4) refuse tout chemin sous `.claude/skills/docx/` à l'enregistrement. Hook pre-commit + scan CI rejettent toute tentative d'ajout.
- **Pas de rewrite / inspire autorisé :** la licence interdit explicitement la copie ou la création de travaux dérivés, ce qui couvre l'inspiration matérialisée (recopie du code) et le rewrite structurel.

#### OCW-S1.b — `.claude/skills/pdf/` (11 fichiers)
- **Verdict :** `EXCLUDE_LICENCE` (mêmes clauses que OCW-S1.a, fichier `LICENSE.txt` textuellement identique).

#### OCW-S1.c — `.claude/skills/pptx/` (57 fichiers)
- **Verdict :** `EXCLUDE_LICENCE` (mêmes clauses que OCW-S1.a, fichier `LICENSE.txt` textuellement identique).

#### OCW-S1.d — `.claude/skills/xlsx/` (3 fichiers)
- **Verdict :** `EXCLUDE_LICENCE` (mêmes clauses que OCW-S1.a, fichier `LICENSE.txt` textuellement identique).

#### OCW-S1.e — `.claude/skills/skill-creator/` (7 fichiers)
- **Verdict :** `ADOPT` conditionnel — Apache License 2.0
- **Format :** `LICENSE.txt` au format Apache 2.0 complet (texte intégral lu en `M1-PROVENANCE-DETAIL-2026-08-03.md` §3.2).
- **Obligations à respecter :** §4(a) copie de la licence à chaque destinataire ; §4(b) mentions de modification sur les fichiers modifiés ; §4(c) préservation des mentions de copyright / brevet / marque / attribution dans toute œuvre dérivée distribuée ; §3 clause de rétorsion brevet.
- **Adaptation :** Convertir en Capability Pack `unifia.skill.creator` (Plan V3 §3.2). Le pack distribué doit inclure le texte de la licence Apache 2.0 et la notice d'attribution.
- **Critères de succès :** Le pack est chargeable comme Capability Pack sans modification du core, et la suite de conformité Apache (licence + attribution + §3) passe.
- **Statut détaillé :** `REVIEW_PER_COMPONENT` — la décision `ADOPT` est subordonnée à la revue par fichier (cf. `P3-CONTRACTS-DRAFT-2026-08-03.md` C4 et C5).

### OCW-S2 — Sandbox Python (scripts WSL2/Lima)
- **Source :** `https://github.com/OpenCoworkAI/open-cowork@ec5bd27`
- **Verdict :** `ADAPT`
- **Phase cible :** 8 (SandboxBroker) + 10 (Computer Use)
- **Adaptation :** Réécrire l'interface en `SandboxPort` (Plan V3 §7.5).
- **Critères :** SandboxBroker doit pouvoir exécuter les scripts Python d'Open Cowork derrière une policy.
- **Justification :** Plan V3 §3.2 « Sandbox WSL2/Lima → Porter après audit ».

### OCW-S3 — Computer use (Python scripts)
- **Source :** `https://github.com/OpenCoworkAI/open-cowork@ec5bd27`
- **Verdict :** `ADAPT` tardif
- **Phase cible :** 10
- **Adaptation :** Réécrire derrière `DesktopAutomationBroker` (Plan V3 §5). **NE PAS activer par défaut.**
- **Critères :** ApprovalBroker + screenshot redaction + allowlist d'applications obligatoires.
- **Justification :** Plan V3 §3.2 « Computer use → Porter tardivement, Broker dédié, permissions critiques ».

### OCW-S4 — Remote bridges Slack/Feishu
- **Source :** `https://github.com/OpenCoworkAI/open-cowork@ec5bd27`
- **Verdict :** `ADOPT` après Phase 3
- **Phase cible :** 9
- **Adaptation :** Convertir en Capability Packs remote (Slack + Feishu). Derrière `RemoteRuntime` (Plan V3 §5).
- **Critères :** RemoteTransportPort + ApprovalBroker + AuditRuntime obligatoires.
- **Justification :** Plan V3 §3.2 « Slack/Feishu remote control → Porter, RemoteTransport plugins ».

### OCW-S5 — Trace Panel
- **Source :** `https://github.com/OpenCoworkAI/open-cowork@ec5bd27`
- **Verdict :** `INSPIRER`
- **Phase cible :** 7 (Shell Unifia)
- **Adaptation :** Réécrire en SolidJS, alimenté par l'EventLog Unifia (Plan V3 §3.2).
- **Justification :** Plan V3 §3.2 « Trace Panel → Inspirer/porter, Alimenté par l'EventLog Unifia ».

### OCW-S6 — Permission dialogs
- **Source :** `https://github.com/OpenCoworkAI/open-cowork@ec5bd27`
- **Verdict :** `INSPIRER`
- **Phase cible :** 3 (Security foundation)
- **Adaptation :** Réécrire derrière ApprovalBroker unique.

### OCW-S7 — MCP transports
- **Source :** `https://github.com/OpenCoworkAI/open-cowork@ec5bd27`
- **Verdict :** `REWRITE`
- **Phase cible :** 2 (Contrats)
- **Justification :** Plan V3 §3.2 « MCP transports → Comparer, Ne garder qu'une implémentation canonique ». Ne pas importer, juste comparer.

### OCW-S8 — Traduction i18n utilisateur (overlay)
- **Source :** snapshot utilisateur (NON dans mon env)
- **Verdict :** `BLOCKED_MISSING_SOURCE` (cf. carte `P-1-I18N-USER-SOURCE`)
- **Phase cible :** 7 (Shell Unifia)
- **Adaptation :** Mapping des clés Open Cowork → clés Unifia. Préservation intégrale des traductions.
- **Justification :** exigence utilisateur (cf. message du 2026-07-31).

## 4. Récapitulatif par verdict

| Verdict | OpenWork | Open Cowork | Total |
|---|---|---|---:|
| `ADOPT` | 1 (manifest) | 1 (skill-creator, conditionnel Apache-2.0) + 1 (remote, OCW-S4) = 2 | 3 |
| `ADAPT` | 1 (server) | 2 (sandbox, computer use) | 3 |
| `REWRITE` | 0 | 1 (MCP) | 1 |
| `INSPIRER` | 1 (UI) | 2 (Trace, Permission) | 3 |
| `EXCLUDE` | 1 (stats) | 0 | 1 |
| `EXCLUDE_LICENCE` | 1 (ee) | 4 (docx, pdf, pptx, xlsx) | 5 |
| `BLOCKED_LICENCE` | 0 | 0 | 0 |
| `DEFER` | 1 (Swift) | 0 | 1 |
| `BLOCKED` (source absente) | 0 | 1 (i18n user) | 1 |
| **Total** | **6** | **12** | **18** |

> **Note M1 — correction OCW-S1 :** la version antérieure de ce document attribuait `ADOPT` à l'ensemble OCW-S1 (78 fichiers XSD/TS). Le détail path-par-path dans `M1-PROVENANCE-DETAIL-2026-08-03.md` §3 a montré que 4 des 5 sous-skills sont couverts par une licence Anthropic-restricted, ce qui interdit extract / copy / derivative / distribute. Le verdict est donc `EXCLUDE_LICENCE` pour ces 4 sous-skills, et seul `skill-creator/` (Apache 2.0) demeure admissible. Le compteur d'`ADOPT` Open Cowork passe de 3 à 2, et le compteur d'`EXCLUDE_LICENCE` global passe de 1 à 5.

## 5. Imports interdits sans revue explicite

Tout import NON listé ci-dessus doit être considéré comme **interdit par défaut** et nécessite une revue utilisateur explicite + ADR.

Cette règle s'applique **a fortiori** aux chemins couverts par `EXCLUDE_LICENCE` : aucune revue, aucun ADR, aucune dérogation ne peut autoriser l'import — la licence amont l'interdit explicitement.

## 6. Conclusion

- **3 imports directs** (ADOPT) à planifier — 1 conditionnel (Apache 2.0) sur OCW-S1.e.
- **3 imports avec adaptation** (ADAPT) à fort coût.
- **3 inspirations** (INSPIRER) sans import de code.
- **1 exclusion stratégique** (stats) + **5 exclusions licence** (OpenWork `/ee` + 4 sous-skills Anthropic-restricted).
- **1 import utilisateur bloqué** (i18n).

L'ordre optimal d'import suit le Plan V3 : Phase 2 (contrats) → Phase 5 (OpenWork server) → Phase 6 (Open Cowork skills — uniquement `skill-creator` après revue Apache 2.0 par fichier) → Phase 8 (sandbox) → Phase 9 (remote) → Phase 10 (computer use).
