<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# M0 BLOCKED — Methodology Gaps — UNIFIA AUTOMATE V2.3.1

> Source normative : `docs/adr/ADR-000-DURABLE-EXECUTION-SUBSTRATE-M0-FROZEN.md`
> §13 (power-loss methodology) + §43 (seuls vrais blockers) + §15
> (real multi-process).

Ce document recense les **methodology gaps** qui empêchent la
qualification complète en M0, et **ce qui est requis pour les
débloquer**. Un `BLOCKED` en M0 n'est PAS un `FAIL` : c'est un
signal que la machine / l'environnement ne fournit pas ce qu'il faut
pour mesurer la propriété.

## 1. FC-13 / FC-13-CTRL — Power-loss / Storage fault

### Statut M0

**NOT VALID** (per pack gelé §12-§13).

### Pourquoi bloqué

Le harness host n'a **aucune** des méthodologies valides pour
mesurer une vraie power-loss :

| Méthode | Disponible ? | Notes |
|---|---|---|
| `kill -9` (process kill) | oui | ne teste PAS la power-loss ; teste le process crash (FC-14) |
| `taskkill /F` | oui | idem |
| `process.kill()` | oui | idem |
| Abrupt VM power-off | NON | pas d'hyperviseur, pas de VM contrôlable |
| Faulting block device | NON | pas d'infra fault-injection |
| Storage fault injection | NON | pas de layer fault-injection reproductible |

`kill -9` et `process.kill()` ne sont **pas** un test power-loss : ils
prouvent que le process peut être tué brutalement, pas que la
durabilité au power-loss tient. Le harness refuse de transformer
ce résultat en PASS.

### Ce qu'il faut pour débloquer

1. **VM control** : libvirt/VMware/Hyper-V + un script de power-cycle
   brutal (ACPI off, reboot)
2. **OU fault-injection layer** : `scsi_debug`, `fault-inject` (Linux),
   `fltmc` (Windows)
3. **OU reproducible filesystem fault** : `dm-thin` + `dmsetup`
   suspend + resume, ou équivalent

Une fois la méthodologie disponible, FC-13-CTRL doit détecter la
perte sur une configuration **volontairement non durable**, sinon
`FC-13 = NOT_VALID`. Aucune exemption n'est acceptable.

### Action

`M0_EXPECTED_NA_*.json` déclare FC-13 et FC-13-CTRL en N/A avec
justification (ce fichier). `M0_RESULTS_*.json` ne contient PAS
FC-13 (le runner ne le lance pas dans la P0 default set).

## 2. DBOS_GO_SQLITE — Exécution absente

### Statut M0

**NOT EXECUTED** (Go toolchain absent, SQLite CLI absent).

### Pourquoi bloqué

`packages/automate-m0-harness/src/qualification/adapters/dbos-go.ts`
est un STUB : chaque méthode throw `BlockedExecution`. La raison
directe est que la machine hôte n'a ni `go` ni `sqlite3` CLI.

Vérifications hôte (2026-09-03 21:18 CEST) :

```powershell
PS> (Get-Command go -ErrorAction SilentlyContinue) -eq $null
True
PS> (Get-Command sqlite3 -ErrorAction SilentlyContinue) -eq $null
True
PS> Test-Path D:\App\Go
False
```

### Ce qu'il faut pour débloquer

1. **Installer Go ≥ 1.22** (https://go.dev/dl/) — pas de droits admin
   requis (Go peut s'installer dans le user profile)
2. **Ajouter Go au PATH** de la session
3. **Pin DBOS Go version** (recommandé : 1.0+ stable) et ajouter au
   `go.mod`
4. **Implémenter le binaire Go** du contrat
   (équivalent des tables SQLite du candidat Native)
5. **Implémenter le HTTP/REST IPC** (cf. `DBOS_GO_IPC_SKETCH`)
6. **Re-run le qualification runner** avec `DBOSGoCandidate` non-stub

Le code TypeScript du harness est inchangé : seul le binaire Go est
remplacé.

### Action

`M0_EXPECTED_NA_DBOS_GO.json` (à produire) déclarera toutes les
P0 FC comme N/A avec justification. Aucune comparaison
empirique possible tant que Go n'est pas installé.

## 3. FC-14 / FC-25 — Real multi-process

### Statut M0

`FC-14` : **PASS en in-process** (deuxième connexion à la même
fichier SQLite pendant que le candidat tient le writer lock).
`FC-25` : **BLOCKED** (zombie owner entre deux OS processes).

### Pourquoi partiellement bloqué

Le M0 simule multi-process en ouvrant **deux connexions à la même
fichier SQLite** dans le même process OS. Cela prouve que WAL +
busy_timeout=5000 permettent la concurrence read/write. **Mais**
ce n'est pas une preuve de :

- Vrai file locking cross-process
- Vrai process fencing
- Stale owner detection (zombie)

### Ce qu'il faut pour débloquer

1. **Lancer deux vrais OS processes** (Bun ou Node) qui partagent
   le même store SQLite
2. Vérifier que :
   - Un seul des deux devient `authority`
   - Ou les deux sont coordonnés (DBOS Conductor, etc.)
   - Jamais deux authorities indépendantes pour le même `WorkflowRun`

### Action

Le test FC-14 multi-process réel est à planifier en `WINDOWS_PREFLIGHT.md`
étape "second process". FC-25 multi-process zombie owner idem.

## 4. P1 matrix (FC-01..FC-30) — non lancée

### Statut M0

P0 seulement (FC-31A, FC-31B, FC-04, FC-14, FC-25, FC-32).

### Pourquoi non lancée

Le runner est conçu pour P0 discriminants (per pack gelé §23 :
"Implémente juste assez pour lancer rapidement"). La full
matrix (FC-01..FC-30) est l'étape suivante.

### Ce qu'il faut pour débloquer

1. Étendre `runner.ts` avec les méthodes `runFC01`..`runFC30`
2. Chaque FC : oracle commun + cas de test spécifiques
3. Documentation des invariants mesurés

### Action

P1 matrix à lancer en prochaine session, après confirmation que
les P0 sont solides.

## 5. Résumé

| Methodology gap | Impact | Action pour débloquer |
|---|---|---|
| Power-loss / storage fault | FC-13, FC-13-CTRL NOT_VALID | VM control OU fault-injection |
| Go toolchain absent | DBOS Go NOT EXECUTED | Installer Go ≥ 1.22 |
| Real multi-process | FC-14 PARTIAL, FC-25 BLOCKED | Lancer 2 OS processes |
| Full matrix non lancée | P1+ FCs non mesurés | Étendre runner |

**Aucune** de ces limitations ne constitue un argument pour
court-circuiter la décision finale. Elles sont reportées ici pour
transparence ; la sélection A/B/C reste en attente de preuves
complètes.

## 6. Source

- `docs/adr/ADR-000-DURABLE-EXECUTION-SUBSTRATE-M0-FROZEN.md` §12, §13, §15, §43
- `docs/automation-v2/m0/M0_RESULTS_UNIFIA_NATIVE.json`
- `docs/automation-v2/m0/M0_EXPECTED_NA_UNIFIA_NATIVE.json`
- `packages/automate-m0-harness/src/qualification/adapters/dbos-go.ts` (STUB)
- `packages/automate-m0-harness/src/qualification/runner.ts`
