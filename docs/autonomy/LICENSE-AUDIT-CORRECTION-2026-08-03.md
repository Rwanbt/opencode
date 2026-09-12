# Audit de licences — reprise autonome Unifia

**Carte :** `M2-LICENSE-AUDIT-20260803`  
**Statut :** `STRUCTURAL_LICENSE_FACTS_VERIFIED`  
**Date :** 2026-08-03

## Résultats

| Source | Preuve | Décision |
|---|---|---|
| OpenWork root | `LICENSE` indique MIT hors `/ee/` et autres restrictions | exploitable uniquement hors chemins interdits, attribution requise |
| OpenWork `/ee` | `ee/LICENSE` indique FSL-1.1-MIT/Fair Source | `EXCLUDE`, aucun import ni adaptation dérivée |
| Open Cowork root | `LICENSE` indique MIT, Copyright OpenCoworkAI 2026 | candidat `ADOPT`/`ADAPT` après audit par composant |
| Open Cowork skills | notices `Apache-2.0` présentes dans `.claude/skills/skill-creator/LICENSE.txt` | attribution et mapping fichier par fichier obligatoires |

## Gate

Les faits de licence sont vérifiés dans les commits verrouillés. Le gate d’import reste fermé jusqu’à la matrice d’attribution par chemin et à l’audit des dépendances tierces. Aucun code n’a été importé.