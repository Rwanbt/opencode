<!-- SPDX-License-Identifier: MIT -->

# Green-tech measurement protocol (I10)

**Statut** : I10 READY_FOR_REVIEW (autorité opérateur).
**Date** : 2026-08-24.

## Protocole de mesure (même matériel/protocole avant/après)

Le plan P2-A exige qu'on mesure la consommation du sidecar en
« unités fonctionnelles » (par session, par message, par fichier
servi) plutôt qu'en valeurs absolues (Mo RSS, ms CPU). Une
régression qui ajoute 50 Mo RSS pour 10 sessions actives est
négligeable ; la même régression pour 1 session active est
catastrophique.

### Unité fonctionnelle de référence

**1 session active** = 1 session de conversation ouverte, 100
messages échangés, 50 fichiers listés via `listFiles`, 1 stream
SSE actif pendant 5 min.

| Métrique                        | Unité                | Baseline  | Cible  | Source                |
|---------------------------------|----------------------|-----------|--------|-----------------------|
| RSS au repos                    | Mo / session inactive | 35        | ≤ 35   | `process.memoryUsage().rss` |
| RSS en charge                   | Mo / session active  | 50        | ≤ 50   | idem                  |
| Heap alloué                     | Mo / session active  | 22        | ≤ 22   | `process.memoryUsage().heapUsed` |
| First prompt → first chunk      | ms / message         | 180       | ≤ 180  | `performance.now()` delta |
| listFiles                       | ms / 50 fichiers     | 12        | ≤ 12   | `performance.now()` delta |
| 100 events SSE → 1 fetch utile  | events / fetch       | 100       | 100    | E14 coalescing oracle |
| Idle CPU (rien à faire)         | % CPU                | 0.0       | ≤ 0.5  | `os.cpus()` × 1 s     |
| Idle network (caché)            | req / 30 s           | 0         | 0      | E14 defaults (staleTime: Infinity) |
| LSP warmup (1 workspace froid)  | ms                   | 800       | ≤ 800  | B11 strict oracle     |

### Protocole de mesure (à appliquer avant ET après chaque bundle)

```powershell
# 1. Clean state — kill any running sidecar
Get-Process unifia-desktop -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 5

# 2. Cold start (mesure l'unité fonctionnelle de référence)
$sw = [System.Diagnostics.Stopwatch]::StartNew()
Start-Process -FilePath "D:\App\unifia\unifia-work-design\packages\desktop\target\release\unifia-desktop.exe" -PassThru
# → wait for "canvas visible" event (operator's signal)
$sw.Stop()
$coldStartMs = $sw.ElapsedMilliseconds
# → attendu : ≤ 3000 ms (P0), ≤ 5000 ms (P2)

# 3. Boot baseline (sidecar au repos, 0 workspace)
$boot = (Get-Process unifia-desktop).WorkingSet64 / 1MB
# → attendu : 200-250 Mo

# 4. Idle baseline (1 workspace Work, mode inactif, 30 s d'attente)
# → attendu : 350-400 Mo

# 5. Charge (run e2e mode-performance.spec.ts × 3)
# → attendu : ≤ 450 Mo RSS

# 6. Plateau (30 min idle sans interaction)
# → attendu : delta vs charge < 10 Mo
```

### Reproductibilité

- **Même machine** : le build de référence est lié à un poste
  physique. Les CPU virtuels en CI produisent des chiffres 2-3×
  plus lents. La baseline canonique est mesurée sur le poste de
  l'opérateur (`D:\App\unifia` + 64 Go RAM + NVMe + GPU dédié).
- **Même build** : la baseline est capturée à un SHA précis,
  pas une branche. Le script `scripts/perf/capture-baseline.mjs`
  écrit le SHA dans le JSON pour rejouer la mesure.
- **Même protocole** : tout écart (kill manuel, GPU forcé, RAM
  rédu volontairement) annule la mesure.

### Sortie attendue

`docs/perf-baselines/baseline.json` (déjà produit par A00) :
```json
{
  "capturedAt": "2026-08-24T10:00:00Z",
  "commit": "be0d39e9f0ff9bbac2a218bcf3cc0a68df10efc7",
  "machine": "...",
  "metrics": { "rssBootMb": 220, "rssIdleMb": 380, "rssChargeMb": 440, ... }
}
```

### Conditions de ré-exécution

- À chaque release.
- À chaque bump d'une dépendance majeure (Bun, Tauri, Vite).
- Après chaque merge d'une carte H10-N (bundle warning fix).
- Après chaque merge d'une carte B/C/E (perf du sidecar).

### Limites

- La mesure est manuelle (HUMAN_RUNTIME). L'automatisation
  complète nécessiterait un runner Windows dans la CI GitHub
  Actions, hors scope du plan.
- Les chiffres ci-dessus sont des **cibles** ; les **valeurs
  réelles** seront mesurées par l'opérateur au prochain build
  de référence (post-programme).
