<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# M0 Durable Substrate Benchmark — UNIFIA AUTOMATE V2.3.1

> Source normative : `docs/adr/ADR-000-DURABLE-EXECUTION-SUBSTRATE-M0-FROZEN.md`
> §20 (output obligatoire) + §22 (final comparison dimensions).
> **Rafraîchi 2026-09-04** après la matrice P0 symétrique complète
> (commit source `8afeed2c94`, évidence `a1c3de202d`).
> L'ancienne version (DBOS "NOT EXECUTED") est historique et périmée.

## 1. Hard correctness — matrice P0 symétrique mesurée

Les deux finalistes ont exécuté le même oracle substrate-neutral sur le
même jeu de critères. Résultats canoniques (gen CURRENT, `a1c3de202d`) :

| FC | Description | UNIFIA_NATIVE | DBOS_GO_SQLITE |
|---|---|---|---|
| FC-31A | Canonical value round-trip (21 valeurs IEEE-754) | **PASS** 21/21 | **PASS** 21/21 |
| FC-31B | Host-integer vs host-float64 separation (20 vecteurs gelés, hôte réel) | **PASS** 20/20 | **PASS** 20/20 (hôte Go réel) |
| FC-04 | Provider réel séparé (processus OS, journal SQLite propre, HTTP) — vrai ACK perdu au transport | **PASS** | **PASS** |
| FC-14 | Course d'autorité, 2 VRAIS processus OS, un seul gagnant | **PASS** | **PASS** |
| FC-25 | Zombie owner réel : freeze barrier → takeover → rejets périmés | **PASS** | **PASS** |
| FC-32 | Replay conformance (T1/R1/O1 → crash → T2/R2/O2), classification mesurée | **PASS** — YES | **PASS** — YES (récupération DBOS réelle après SIGKILL mid-step) |
| FC-13 | Power-loss / storage fault | **BLOCKED** | **BLOCKED** |
| FC-13-CTRL | Power-loss negative control | **BLOCKED** | **BLOCKED** |

**Compteur : 6 PASS, 2 BLOCKED pour CHAQUE finaliste.** Aucun FAIL, aucun
NOT_VALID sur le chemin mesuré. FC-13/FC-13-CTRL exigent une VM jetable
ou une couche de fault-injection stockage — provisioning externe
indisponible dans cet environnement (pas de qemu/VBox/vmrun ; Hyper-V
refuse sans élévation ; `wsl --terminate` est un arrêt contrôlé, pas une
coupure dure — `kill` n'est pas une preuve power-loss, plan §35).

## 2. Outcome A / B / C (per pack gelé §21)

- **Outcome A (Native)** : conditions non remplies — tous les REQUIRED
  gates ne sont pas PASS (FC-13 BLOCKED). Présomption favorable sur tout
  le chemin mesuré, pas une conclusion.
- **Outcome B (DBOS)** : conditions non remplies — même contrainte FC-13.
- **Outcome C (aucun)** : non concluant — BLOCKED n'est pas FAIL ; les
  deux candidats satisfont tout le chemin mesurable.

**Décision A vs B : SOUS-DÉTERMINÉE sur les mesures disponibles** — égalité
parfaite 6-6 sur le P0 symétrique. La rubrique ne sélectionne pas
mécaniquement un gagnant ; le plan §40 exclut tout changement de règle a
posteriori et toute préférence de candidat.

## 3. Contrainte de ratification (gelé §92)

ADR-000 devient RATIFIED seulement si notamment :

```text
power-loss proof valid      ← SEULE CONDITION NON Satisfaite (FC-13, externe)
second-writer proof valid   ✓ (FC-14, 2 processus réels, les deux candidats)
M0 Native complete          ✓
M0 DBOS Go complete         ✓
Critical/High findings = 0  ✓
```

**Le gate restant est externe et physique** (VM jetable ou fault-injection
stockage). ADR-000 reste NOT_RATIFIED mécaniquement — aucune cérémonie ne
peut le contourner (plan §40, §65 TRUE blocker).

## 4. Cross-cutting dimensions (per pack gelé §22) — mesuré 2026-09-04

| Dimension | UNIFIA_NATIVE (mesuré) | DBOS_GO_SQLITE (mesuré) |
|---|---|---|
| Topologie | 1 process, Bun in-process | 2+ processes (binaire Go + workers autorité) |
| Binaire/packaging | intégré au harnais Bun (pas de binaire séparé en M0) | **24.1 MB** (`dbos-real-qualify.exe`, Go 1.25.12) |
| Démarrage (bind + /healthz) | init SQLite + schéma **62 ms** (moy. 5, 59-64) | **282 ms** (moy. 5, 275-294) ; healthz < 1 ms |
| Stockage | SQLite WAL, synchronous FULL | SQLite WAL, synchronous FULL (même system DB) |
| Windows | bun:sqlite natif | Go/Windows natif (modernc.org/sqlite via driver DBOS) |
| Upgrade | Bun upgrade | DBOS upstream (v1.0.0 épinglé) |
| Backup | file copy + VACUUM | SQLite .backup API |

Les dimensions restantes (mémoire RSS longue durée, throughput soutenu,
packaging final) relèvent du preflight Windows/packaging (I13/I14) et
n'altèrent pas la contrainte de ratification §92.

## 5. Chemin vers la décision (plan §68 restant)

1. **FC-13** : provisionner une VM jetable (Hyper-V élevé, qemu, ou
   équivalent) + coupure dure du disque virtuel — exécuter FC-13-CTRL
   puis FC-13 sur les deux finalistes.
2. Si les REQUIRED gates deviennent tous PASS pour un candidat (et pas
   l'autre), la rubrique §21 tranche mécaniquement A ou B.
3. Si les deux passent tout : l'évaluation architecturale finale (§21
   Outcome A/B) départage — hors périmètre M0 measurement.
4. Alors seulement : ADR-000 → RATIFIED (§92), puis production wiring
   (plan §17-§22).