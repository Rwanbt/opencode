---
id: 0012
title: Provenance and /ee/ exclusion
status: PROPOSED
date: 2026-07-31
---

# ADR-0012: Provenance et exclusion /ee/

**Statut :** `PROPOSED`
**Date :** 2026-07-31
**Décideurs :** Erwan, Hermes Agent (MiniMax M3)
**Source :** `docs/autonomy/DO-NOT-IMPORT.md`, `docs/autonomy/UPSTREAM-PROVENANCE.md`

## Contexte

Unifia importe du code d'OpenWork (open-source) et Open Cowork (open-source). Une partie d'OpenWork est sous licence propriétaire (`/ee/`, "Den" = édition entreprise). Si on importe accidentellement du code `/ee/`, on :
- **Viole la licence** d'OpenWork
- **Expose Unifia** à des poursuites
- **Compromet** la licence MIT d'Unifia

## Décision

Adopter une **exclusion stricte et multi-couches** de `/ee/` :

```bash
# Whitelist explicite (NE JAMAIS importer)
FORBIDDEN_PATHS='^.*/ee/.*|^.*/\.ee/.*|^packages/enterprise/.*|^.*/commercial/.*|^.*/private/.*'
```

**3 couches de protection** :

### Couche 1 : Pre-commit hook
```bash
# .husky/pre-commit
STAGED=$(git diff --cached --name-only --diff-filter=ACM)
if echo "$STAGED" | grep -E "$FORBIDDEN_PATHS" >/dev/null 2>&1; then
  echo "ERROR: forbidden path detected. See docs/autonomy/DO-NOT-IMPORT.md" >&2
  exit 1
fi
```

### Couche 2 : Scan CI
```yaml
# .github/workflows/license-check.yml
- name: License / /ee/ scan
  run: |
    if git ls-tree -r HEAD | grep -E '/ee/' | grep -v 'docs/'; then
      echo "ERROR: /ee/ code committed"
      exit 1
    fi
```

### Couche 3 : Audit manuel
- Chaque PR doit être revu par un humain qui cherche `/ee/`
- `UPSTREAM-SOURCES.lock.json` documente les branches SHA importées (50+ branches OpenWork avec `ee/` identifiées)

**Provenance obligatoire** (Plan V3 §8.6) :

Tout fichier importé doit avoir dans son commit :
```
Unifia-Card: <CARD-ID>
Upstream-Repo: <url>
Upstream-Commit: <sha>
Upstream-Path: <path>
Upstream-License: <SPDX-id>
```

## Conséquences

### Positives
- ✅ **3 couches** = risque résiduel quasi-nul
- ✅ **Traçabilité** : chaque import est documenté
- ✅ **Conformité** : pas de violation de licence possible
- ✅ **Audit** : revue humaine + outils

### Négatives
- ❌ **Friction** : devs doivent déclarer la provenance (5 champs par commit)
- ❌ **Faux positifs** : certains fichiers peuvent contenir `ee/` dans leur nom sans être du code (ex: `meet.ee.js`)
- ❌ **Maintenance** : les hooks doivent être maintenus à jour

### Neutres
- L'exclusion est **stricte par défaut**, relâcher via ADR

## Alternatives considérées

### A. Pas d'exclusion (chaque PR revu manuellement)
- **Rejeté** : trop de risque, oubli facile

### B. Exclusion uniquement au niveau CI (pas de pre-commit)
- **Rejeté** : trop tard, le commit est déjà fait

### C. Exclusion par analyse statique de licence (scancode-toolkit)
- **À ajouter en Phase 1+** : scan automatique des licences SPDX

## Plan d'implémentation

- **Phase 0** : ✅ pre-commit hook actif (P1-C120)
- **Phase 1+** : ajouter scan CI `license-check.yml` (carte à créer)
- **Phase 1+** : ajouter scancode-toolkit en CI

## Liens

- `docs/autonomy/DO-NOT-IMPORT.md` — liste des interdictions
- `docs/autonomy/UPSTREAM-PROVENANCE.md` — chaîne de provenance
- `docs/autonomy/UPSTREAM-SOURCES.lock.json` — sources upstream verrouillées
- `docs/autonomy/ATTRIBUTION-TEMPLATE.md` — modèle d'en-tête SPDX
- `docs/autonomy/PHASE_MINUS_1/IMPORT-CANDIDATES.md` — candidats à l'import
- `docs/autonomy/PHASE_MINUS_1/DO-NOT-IMPORT.md` — interdictions détaillées