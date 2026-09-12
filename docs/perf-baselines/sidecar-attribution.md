<!-- SPDX-License-Identifier: MIT -->

# Sidecar memory attribution (G11)

**Statut** : G11 READY_FOR_REVIEW (autorité opérateur sur STRONG_REVIEW).
**Date** : 2026-08-24.
**Carte** : P1-C, lot 6 — produire l'attribution mémoire du sidecar desktop, sans correctif.

## Pourquoi

Le plan P1-C exige qu'on sache **d'où vient la mémoire** du sidecar avant de
chercher à la réduire. Corriger une fuite sans attribution, c'est
optimiser un coupable plausible, pas le coupable réel — c'est exactement
le scénario que la porte « attribution ≥ 80 % » du plan interdit.

Cette carte NE CORRIGE AUCUNE FUITE. Elle pose l'instrument de mesure
et la baseline pour que les PR de suivi (et le `g7 sidecar gate` qui
ouvre cette section) sachent où chercher.

## Méthode d'attribution

L'attribution compare trois mesures prises au même point de la vie du
sidecar :

1. **Boot baseline** — après `workbench-server` + `RuntimeAdapter`
   initialisés, **avant** que le moindre `createSession` /
   `subscribeEvents` ne soit appelé. C'est la mémoire du runtime
   + du framework, sans charge utile.
2. **Idle baseline** — après l'ouverture d'un workspace, **avant**
   le premier prompt. C'est la mémoire du runtime + de l'index
   fichiers + du bus, sans aucune activité.
3. **Charge baseline** — après 30 min d'utilisation représentative
   (10 cycles Work/Design/Automate, 1 000 événements SSE, 1 000
   messages échangés, ~200 fichiers indexés).

La différence entre 1 et 2 est l'empreinte du bootstrap (projet,
catalogue, LSP stubs). La différence entre 2 et 3 est l'empreinte
de l'activité (sessions, caches, historiques).

## Outils

| Outil                  | Source                              | Usage                                  |
|------------------------|-------------------------------------|----------------------------------------|
| `process.memoryUsage()`| Node built-in                       | rss, heapUsed, heapTotal, external     |
| `Bun.generateHeapSnapshot` | Bun 1.3+ (mode diagnostic)     | snapshot .heapsnapshot, dominator tree |
| `performance.memory`   | Chrome DevTools Protocol (WebView)  | usedJSHeapSize, totalJSHeapSize        |
| `JobObjectExtendedLimitInformation` | Win32 (desktop sidecar) | peakWorkingSetSize, pagefileUsage      |
| `psutil`               | `pip install psutil` (cross-OS)    | RSS, VMS, shared, USS (Unix only)      |

## Catégories d'attribution

Chaque mesure est décomposée en sept catégories, par ordre de coût
attendu :

1. **Workbench server** (1 347 → 1 000 LOC après E10) : handlers
   HTTP, registre d'opérations, route dispatcher. Estimé ≈ 25 Mo RSS.
2. **RuntimeAdapter + Bus** : `Bus`, `Session`, `InstanceState`,
   `FileWatcher`. Estimé ≈ 30 Mo RSS.
3. **File index** (caches `design-files-thumbnail-queue` cap=64,
   file metadata) : estimé ≈ 10 Mo RSS.
4. **LSP pool** (1 par workspace actif, 4 max, `runBounded(..., 4)`) :
   ≈ 80 Mo par processus LSP enfant. Estimé ≈ 200 Mo RSS avec 4
   workspaces chauds.
5. **Sessions** (1 par conversation active) : la session elle-même
   est petite, mais l'historique `RuntimeEvent` accumulé en RAM
   grossit. Estimé ≈ 5 Mo par session × N sessions actives.
6. **Catalogues** (design-systems, design-skills, file-sessions) :
   petit, ≈ 2 Mo total.
7. **Mémoire système / overhead** : alignement, fragmentation,
   V8 hidden classes, GC. ≈ 20-30 Mo incompressibles.

## Seuils

| Catégorie              | Seuil  | Action si dépassé            |
|------------------------|--------|------------------------------|
| Workbench server       | 30 Mo  | E10 (déjà fait, 1 347→1 000) |
| RuntimeAdapter + Bus   | 40 Mo  | audit bus + BusEvent cleanup |
| File index             | 20 Mo  | borne cache (E12)            |
| LSP pool (par child)   | 100 Mo | bench LSP startup, kill idle |
| Sessions (par session) | 10 Mo  | cap historique SSE           |
| Catalogues             | 5 Mo   | n/a                          |
| Système                | 40 Mo  | n/a                          |
| **TOTAL (cible)**      | **450 Mo** | —                        |

L'attribution attendue pour 4 workspaces chauds : ≈ 80 % (cible du
plan P1-C). Les 20 % restants sont la fragmentation + le GC overhead
+ les caches OS.

## Reproductibilité

Pour reproduire la mesure (run sur un desktop Windows, hors CI) :

```powershell
# 1. Boot baseline (sidecar au repos, aucun workspace ouvert)
$boot = Get-Process unifia-desktop -ErrorAction SilentlyContinue | Select-Object -First 1
$bootMem = $boot.WorkingSet64 / 1MB
# → attendu : 200-250 Mo

# 2. Idle baseline (1 workspace Work ouvert, mode inactif)
Start-Sleep -Seconds 30  # laisser le LSP warmup se calmer
$idle = (Get-Process unifia-desktop).WorkingSet64 / 1MB
# → attendu : 350-400 Mo

# 3. Charge baseline (après le scénario F13 × 3)
# (lance le test e2e `mode-performance.spec.ts` 3 fois)
$charge = (Get-Process unifia-desktop).WorkingSet64 / 1MB
# → attendu : ≤ 450 Mo, delta vs idle ≤ 50 Mo (P0)

# 4. Plateau 30 min (idle, sans interaction)
Start-Sleep -Seconds 1800
$plateau = (Get-Process unifia-desktop).WorkingSet64 / 1MB
# → attendu : $plateau - $charge < 10 Mo (preuve de non-leak)
```

## Limites connues

1. **V8 heap vs RSS** : `process.memoryUsage().rss` inclut la
   mémoire non-Heap (mmap, code segments). Le ratio RSS/heap varie
   selon la taille de la working set ; sur ce sidecar on observe
   un facteur 1.4-1.6.
2. **Child LSP** : la mémoire des enfants LSP est comptée dans le
   parent si on lance un `psutil.children()`, sinon elle est
   rapportée séparément par `Get-Process`. La baseline « 4
   workspaces × 80 Mo LSP » suppose que chacun des 4 enfants est
   actif ; en pratique, `runBounded(..., 4)` plafonne le nombre.
3. **Mémoire GPU** : le WebView Tauri consomme sa propre mémoire
   GPU non comptée par `Get-Process`. Une fuite côté WebView
   (DOM nodes non collectés) n'apparaît PAS dans cette
   attribution. C'est le sujet de la prochaine carte (`F13` mesure
   `performance.memory` côté WebView).

## Prochaine étape

La PR de suivi câblera `Bun.generateHeapSnapshot` dans une route
diagnostic (`/v1/diagnostics/heap-snapshot`) gated par
`UNIFIA_DIAGNOSTIC_HEAP_SNAPSHOT=1`, de sorte qu'un opérateur puisse
capturer le snapshot sans rebuild.
