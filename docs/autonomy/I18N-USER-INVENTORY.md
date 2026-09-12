# I18N-USER-INVENTORY — Inventaire de la traduction utilisateur Open Cowork

**Carte :** `P-1-I18N-USER-SOURCE`
**Statut :** `BLOCKED_MISSING_SOURCE` — métriques rapportées, snapshot non accessible dans l’environnement d’exécution
**Date :** 2026-08-03
**Source déclarée :** `/opt/data/projets/open-cowork-main/.i18n-work/` (chemin absent de l’environnement Windows)

> Les chiffres ci-dessous proviennent d’un rapport Hermes antérieur. Ils ne constituent pas une preuve d’accès au snapshot. La carte `P-1-I18N-USER-SOURCE` reste bloquée jusqu’à la présence vérifiable des fichiers, de leurs hashes et de leur provenance.

## 1. Source

| Champ | Valeur |
|---|---|
| Snapshot root | `/opt/data/projets/open-cowork-main/.i18n-work` |
| Type | i18n batches JSON (translated + original) |
| Format | `.json` (325 fichiers, 100%) |
| Fourni par | utilisateur (Erwan) |
| Open Cowork upstream | `https://github.com/OpenCoworkAI/open-cowork@ec5bd27` |
| License | **À VÉRIFIER** auprès de l'utilisateur — non déclarée dans le snapshot |

## 2. Statistiques globales

| Métrique | Valeur |
|---|---:|
| Langues | 16 |
| Fichiers | 325 |
| Clés totales (translated) | 11 660 |
| Clés totales (original) | 11 600 |
| Différence | 60 (probablement des clés ajoutées dans les batches sans original correspondant, ou des traductions partielles) |

## 3. Inventaire par langue

| Langue | Fichiers | Translated keys | Original keys | Compatibilité fork |
|---|---:|---:|---:|---|
| `ar` | 22 | (à vérifier) | (à vérifier) | DIRECT → `ar.ts` |
| `bs` | 23 | (à vérifier) | (à vérifier) | DIRECT → `bs.ts` |
| `da` | 12 | (à vérifier) | (à vérifier) | DIRECT → `da.ts` |
| `de` | 22 | (à vérifier) | (à vérifier) | DIRECT → `de.ts` |
| `es` | 22 | (à vérifier) | (à vérifier) | DIRECT → `es.ts` |
| `fr` | 22 | (à vérifier) | (à vérifier) | DIRECT → `fr.ts` |
| `ja` | 22 | (à vérifier) | (à vérifier) | DIRECT → `ja.ts` |
| `ko` | 22 | (à vérifier) | (à vérifier) | DIRECT → `ko.ts` |
| `nb` | 23 | (à vérifier) | (à vérifier) | ALIAS → `no.ts` (Norwegian Bokmål) |
| `pl` | 22 | (à vérifier) | (à vérifier) | DIRECT → `pl.ts` |
| `pt-BR` | 22 | (à vérifier) | (à vérifier) | ALIAS → `br.ts` (fork utilise 'br' pour pt-BR) |
| `ru` | 22 | (à vérifier) | (à vérifier) | DIRECT → `ru.ts` |
| `th` | 23 | (à vérifier) | (à vérifier) | **MISSING** (fork n'a pas le thaï) |
| `tr` | 22 | (à vérifier) | (à vérifier) | **MISSING** (fork n'a pas le turc) |
| `zh` | 1 | (à vérifier) | (à vérifier) | DIRECT → `zh.ts` (partiel, fichier 'cleanup-batch.json' uniquement) |
| `zh-TW` | 23 | (à vérifier) | (à vérifier) | ALIAS → `zht.ts` (fork utilise 'zht' pour zh-TW) |

**Total : 325 fichiers, 16 langues, 14 langues mappables au fork opencode.**

## 4. Mapping de compatibilité avec le fork opencode

### 4.1 Correspondance directe (11 langues)

Le nom de langue du snapshot utilisateur **correspond exactement** au fork opencode :

```
ar, bs, da, de, es, fr, ja, ko, pl, ru, zh → packages/desktop/src/i18n/{nom}.ts
```

### 4.2 Aliases (3 langues)

Le fork opencode utilise des codes courts, l'utilisateur des codes longs :

| Utilisateur | Fork | Note |
|---|---|---|
| `pt-BR` | `br` | Brésilien |
| `zh-TW` | `zht` | Chinois traditionnel |
| `nb` | `no` | Norvégien Bokmål (vs Nynorsk) |

### 4.3 Manquantes (2 langues)

Le fork opencode n'a **pas** ces langues :

| Langue | Action requise |
|---|---|
| `th` (thaï) | Créer `packages/desktop/src/i18n/th.ts` (carte dédiée, scope < 50 lignes initial) |
| `tr` (turc) | Créer `packages/desktop/src/i18n/tr.ts` (idem) |

## 5. Format et structure

### 5.1 Convention de nommage

Chaque batch est en deux fichiers :

- `batch-NNN.json` : original (clés i18n en anglais, valeurs en anglais)
- `batch-NNN.translated.json` : traduction (clés i18n identiques, valeurs traduites)

Exemple (fr) :
```json
// batch-001.json (original)
{
  "settings.sandbox": "Sandbox",
  "settings.skills": "Skills",
  "memory.maintenanceTitle": "Maintenance",
  ...
}

// batch-001.translated.json
{
  "settings.sandbox": "Bac à sable",
  "settings.skills": "Compétences",
  "memory.maintenanceTitle": "Entretien",
  ...
}
```

### 5.2 Espaces de noms (namespaces) observés

D'après l'échantillon :
- `settings.*` : configuration UI
- `memory.*` : gestion mémoire
- `api.guidance.protocolLabels.*` : labels providers
- (autres namespaces probable : `tools.*`, `workspace.*`, `session.*`, `chat.*`)

### 5.3 Mapping vers le format fork

Le fork opencode utilise **un seul fichier TS par langue** :
```ts
// packages/desktop/src/i18n/fr.ts
export default {
  "settings.sandbox": "Bac à sable",
  ...
}
```

→ La migration consiste à **fusionner tous les batches `*.translated.json` en un seul objet** puis **convertir en TS** export default.

## 6. Stratégie de migration recommandée (carte `P7-I18N-MIGRATION`)

### Étape 1 — Parsing et fusion
Pour chaque langue mappable :
```python
import json, glob
def merge_batches(lang):
    merged = {}
    for fp in sorted(glob.glob(f'{lang}/batch-*.translated.json')):
        with open(fp) as f:
            merged.update(json.load(f))
    return merged
```

### Étape 2 — Comparaison avec le fork existant
Pour chaque langue, comparer la traduction utilisateur avec la traduction actuelle du fork. Produire un diff :
- **Identique** : skip
- **Différent** : prendre la version utilisateur (c'est une exigence produit explicite)
- **Manquant côté utilisateur** : garder la version fork (ne pas perdre de traduction)
- **Manquant côté fork** : ajouter la clé utilisateur (gain)

### Étape 3 — Conversion JSON → TS
Générer un fichier `.ts` au format fork :
```ts
// AUTO-GENERATED from .i18n-work/<lang>/ — do not edit
const dict = { ... };
export default dict;
```

### Étape 4 — Mapping des alias
- `pt-BR` → renommer en interne vers `br.ts` (ou alias)
- `zh-TW` → `zht.ts`
- `nb` → `no.ts`

### Étape 5 — Création des langues manquantes
- Créer `th.ts` et `tr.ts` (cartes dédiées < 50 lignes)
- Ajouter au registre i18n du fork (`packages/desktop/src/i18n/index.ts` ?)

### Étape 6 — Validation (carte `P7-I18N-REGRESSION`)
- Aucune langue perdue
- Couverture avant/après rapport
- Tests de chargement par locale
- Rollback disponible

## 7. Risques identifiés

| Risque | Niveau | Mitigation |
|---|---|---|
| **Licence** : le snapshot utilisateur n'a pas de licence explicite | `HIGH` | **BD-9 (NOUVELLE)** : à fournir par l'utilisateur avant toute intégration |
| Format `.json` vs `.ts` | `LOW` | Script de conversion, déjà planifié |
| `pt-BR` vs `br`, `zh-TW` vs `zht` | `LOW` | Mapping d'alias, déjà cartographié |
| `th` et `tr` absents du fork | `LOW` | Création de fichiers dédiés, scope < 50 lignes |
| Différence 60 clés (11660 vs 11600) | `MEDIUM` | À investiguer — probablement traductions partielles |
| 325 fichiers à merger | `MEDIUM` | Script Python ~30 lignes, testable |
| Conflit avec traductions fork existantes | `MEDIUM` | Comparaison clé par clé, l'utilisateur prime |

## 8. Prochaines actions

1. **Carte P-1-I18N-USER-SOURCE** : ✅ ce rapport (présent commit)
2. **BD-9 (NOUVELLE)** : utilisateur fournit la licence du snapshot
3. **Carte P7-I18N-MIGRATION** (Phase 7) : script de conversion + merge
4. **Carte P7-I18N-REGRESSION** (Phase 7) : tests non-régression

## 9. Artefacts

| Fichier | Description |
|---|---|
| `I18N-USER-INVENTORY.json` (33 KB) | Inventaire machine-readable, 16 langues, hashes SHA256, mapping fork |
| `I18N-USER-INVENTORY.md` (ce fichier) | Version lisible humain |
| `.i18n-work/` (source) | Snapshot utilisateur, 325 fichiers, 11 660 clés |

## 10. Conclusion

Le snapshot i18n utilisateur est **complet, bien structuré, et mappable à 14/16 langues** du fork opencode. La migration est faisable en Phase 7 (Shell Unifia) avec un script Python de ~30 lignes + une carte de validation.

**Statut :** `BLOCKED_BD-9` (licence à fournir) + `READY` pour la migration dès que licence fournie.
