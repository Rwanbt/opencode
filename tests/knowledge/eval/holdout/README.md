<!--
SPDX-License-Identifier: MIT
Copyright (c) 2026 Unifia contributors
-->

# Golden Dataset — HOLDOUT

> Fixtures pour l'évaluation finale. **Aucune** de ces fixtures ne
> partage :
>
> - un `unifia_id` avec `dev/` ;
> - une **chaîne normalisée** de plus de 30 caractères avec une fixture
>   de `dev/`.

> Le holdout sert à mesurer la généralisation. Il n'est jamais
> utilisé pour régler des poids.

## Cas (mêmes thématiques, formulations et IDs distincts)

| Fichier | Type | Langue | Sujet (variante holdout) |
|---|---|---|---|
| `decision-bash-schema-patch.md` | decision | en | Patch schema bash tool — variante de formulation |
| `failure-cli-bundle-obsolete.md` | failure | en | CLI bundle obsolète sur device mobile — variante |
| `failure-gpu-quant-crash.md` | failure | en | Crash GPU sur quantisation spécifique |
| `constraint-cache-bounded.md` | constraint | en | Cache borné sans fuite long-terme |
| `constraint-hardlink-blocked.md` | constraint | en | Hardlink refusé par politique Android |
| `decision-token-budget.md` | decision | en | Budget tokens par type de modèle |
| `episodic-port-binding-race.md` | episodic | en | Race condition sur choix de port |
| `reference-decision-bash-fr-alt.md` | decision | fr | Décision FR (reformulation) |
| `semantic-fr-build-prereq.md` | semantic | fr | Prérequis build Android (FR) |
| `superseded-previous-budget.md` | superseded | en | Ancienne décision de budget (superseded) |
| `constraint-egress-deny-fr-alt.md` | constraint | fr | Egress deny pour credentials (reformulation) |

> Comme `dev/`, le contenu réel est créé dans cette session ; les
> fichiers présents sont des placeholders structurés.
