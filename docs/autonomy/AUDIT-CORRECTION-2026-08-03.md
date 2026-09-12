# Correction d’audit — reprise autonome Unifia

**Carte :** `M1-AUDIT-CORRECTION-20260803`  
**Statut :** `STRUCTURAL_CORRECTION_COMPLETE`  
**Date :** 2026-08-03

## Preuves vérifiées

| Élément | Preuve | Décision actuelle |
|---|---|---|
| OpenWork | bare clone `openwork.git`, HEAD `2c558bcffb5b686148c30bbf3dd2af7ade99492a` | audit structurel corrigé |
| Chemins interdits OpenWork | `git ls-tree -r --name-only HEAD` → 1067 chemins `/ee/` ou équivalents | `EXCLUDE`, aucun import |
| Open Cowork | bare clone `open-cowork.git`, HEAD `ec5bd270861fd4531bda44554766b8b5bd009242` | candidat à l’audit de licence et portabilité |
| Overlay i18n utilisateur | chemin déclaré `/opt/data/projets/open-cowork-main/.i18n-work/` absent de l’espace Windows | `BLOCKED_MISSING_SOURCE` |
| Code importé | `import_log` du lock : aucun import | aucun portage autorisé par cette carte |

## Gate de sortie

Le gate structurel est satisfait par la correction des artefacts versionnés. Le gate de provenance reste ouvert jusqu’à la revue des licences par chemin et le gate i18n reste `BLOCKED_MISSING_SOURCE`.