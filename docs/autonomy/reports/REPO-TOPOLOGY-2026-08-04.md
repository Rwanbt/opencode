<!-- SPDX-License-Identifier: MIT -->
# Topologie des dépôts et conditions de consolidation — 2026-08-04

Rédigé après relecture du plan canonique §6 (« Topologie de dépôts
recommandée »), à la demande du propriétaire du projet.

## Ce que dit le plan

§6.1 désigne deux dépôts pour l'étape initiale :

```text
Rwanbt/unifia            fork OpenCode, runtime principal, SDK et contrats canoniques
Rwanbt/unifia-workbench  serveur, orchestrateur, document capabilities, tests de conformité
```

**Le dépôt principal est donc le fork OpenCode.** Concrètement :
`D:\App\OpenCode\opencode`, remote `https://github.com/Rwanbt/opencode.git`
(pas encore renommé en `unifia`).

## Correction d'une confusion de dossiers

`D:\App\OpenCode` **n'est pas un dépôt** : son `.git` ne contient qu'`info` et
son `packages/` est vide. C'est un dossier conteneur, qui abrite entre autres
`opencode/` et `unifia-execution-clean/`.

## Topologie mesurée du fork

| Référence | Tête | Date |
|---|---|---|
| `main` | `207ff452b` | 2026-07-21 |
| `dev` | `e21b7389f` | 2026-07-30 |
| `fix/team-selector-min-models-deadlock` | `e0fe00a975` | (branche courante) |

`main` et `dev` ont divergé le 2026-07-21 à `5c34e5ddb1` : **27 commits dans
`main` absents de `dev`, 32 dans `dev` absents de `main`**. La tête de `main`
est « Merge pull request #16 from Rwanbt/dev », donc `main` est le tronc et
`dev` la branche d'intégration.

## Où se trouve le travail Unifia

La branche `recovery/unifia-audit-correction-20260803` est **basée sur `main`**
(`207ff452b`) et porte **354 commits** au-dessus. Elle a été rapatriée dans le
fork le 2026-08-04 par `git fetch` depuis `unifia-execution-clean`, avec
historique complet.

L'opération est additive et réversible. Vérifié après coup : `main`, `dev` et
`fix/team-selector-min-models-deadlock` inchangés, arbre de travail propre, HEAD
toujours sur `fix/team-selector-min-models-deadlock`.

Pour annuler : `git branch -D recovery/unifia-audit-correction-20260803`.

> Note : `unifia-execution-clean` est un **clone shallow** dont la troncature
> commence à `207ff452`. Toute comparaison faite depuis ce clone rapporte
> faussement une absence d'ancêtre commun avec `dev` ; les mesures ci-dessus
> viennent du fork, qui a l'historique complet.

## Conditions §6.3 avant fusion dans le monorepo

Le plan interdit le déplacement dans le monorepo tant que les six conditions
suivantes ne sont pas remplies.

| Condition | État | Preuve ou raison |
|---|---|---|
| Stabilisation des contrats | ✅ | `@unifia/contracts` : 32/32 vitest + smokes, typecheck 25/25 |
| Tests de conformité | ✅ | `RuntimeConformance` 30/30 (3 runtimes × 10 scénarios), gate 8/8 sur 32 suites |
| Validation des licences | ✅ local | `supply-chain/*` 5/5 : chemins interdits, imports exclus, SPDX, licences de manifeste, épinglage des dépendances |
| Validation du build desktop | ✅ | `bun tauri build` exit 0 : `Unifia.exe` 48,3 Mo (ProductName « Unifia Dev ») + installeur NSIS `Unifia Dev_1.3.15_x64-setup.exe` 52,6 Mo. A exigé de réparer le rebrand — voir ci-dessous. |
| Validation du mobile | ✅ | `bun tauri android build --target aarch64` exit 0 : APK universel 1067 Mo + AAB 1017,2 Mo. `rootfs.tgz` vérifié **stocké à 0 % de compression** dans l'APK — la règle `noCompress` tient, AAPT2 ne dégonfle pas l'archive. Build refait une seconde fois avec un rootfs reconstruit depuis les sources. |
| Réduction des conflits upstream | ✅ mesuré | Voir ci-dessous |

### Conflits mesurés

`git merge-tree` entre la branche Unifia et les deux têtes du fork :

- **vers `main` : fusion propre, zéro conflit.**
- **vers `dev` : exactement 2 fichiers en conflit** —
  `packages/unifia/src/auth/index.ts` et
  `packages/ui/src/pierre/opencode-theme.ts`.
  Les 39 autres fichiers touchés des deux côtés fusionnent automatiquement.

La surface de conflit est donc faible et nommée, ce qui satisfait la condition
« réduction des conflits avec upstream OpenCode » au sens où elle est désormais
mesurée plutôt que supposée.

## Pourquoi les deux validations de build n'avaient jamais été faites

Elles étaient **impossibles**. Le rebrand Phase 0 a renommé un côté de trois
couplages et laissé l'autre, et **ni le desktop ni le mobile ne compilaient**.

| Couplage | Côté renommé | Côté oublié | Effet |
|---|---|---|---|
| Crate Kokoro | `Cargo.toml` desktop **et** mobile → `unifia-kokoro-shared` | crate + dossier restés `opencode-kokoro-shared` | `cargo` : `no matching package` — mort dès la première étape, sur les deux plateformes |
| Sidecar Tauri | `tauri.conf.json` → `externalBin: sidecars/unifia-cli` | `copy-sidecar.ts` écrivait `sidecars/opencode-cli-<target>` | `resource path ... doesn't exist` |
| Nom du dist | `utils.ts` cherchait `dist/unifia-<os>-<arch>` | `build.ts` le compose depuis `pkg.name`, resté `opencode` | sidecar introuvable |

**Le plus grave n'était pas un échec de build mais un risque.** `cli.rs` résolvait
`opencode-cli` et `lib.rs` exécutait `taskkill /F /IM opencode-cli.exe` au
démarrage **et** à l'arrêt. Tuer par nom d'image atteint tous les processus de ce
nom sur la machine : ce build de développement terminait le sidecar de
l'installation OpenCode authentique de l'utilisateur. Le rename confine le rayon
d'action à cette application. `llama-server` reste tué par un nom partagé et ne
peut pas être désambiguïsé par un rename — c'est signalé dans le code comme un
changement distinct.

Pour la duplication du nom de dist, le correctif ne rétablit pas la symétrie : il
**dérive** le nom depuis le manifeste, puisque c'est la répétition qui avait
permis la dérive.

Correctif : commit `7c5630bf7`.

### Obstacles annexes rencontrés

- **`@mixmark-io/domino` incomplet dans `node_modules`** : `lib/URLUtils.js`
  absent, d'où `Could not resolve: "./URLUtils"` au bundling du sidecar. Ce
  n'est pas un défaut du paquet publié mais une extraction incomplète ;
  `bun install --frozen-lockfile` ne la répare pas, il faut supprimer le dossier
  du paquet et réinstaller.
- **`--baseline` échoue** à télécharger son runtime Bun. `script/build.ts`
  documente lui-même que les variantes baseline sont *flaky to download*, alors
  que `CLAUDE.md` présente `--baseline` comme la commande standard.
- **Runtime Android absent** : `rootfs.tgz` (786 Mo) et les 30 bibliothèques
  `jniLibs` (0,83 Go) ne sont pas dans le dépôt — ils sont gitignorés, donc
  absents de tout clone frais. Les artefacts du fork ont d'abord été réutilisés
  pour débloquer le build, puis le rootfs a été **reconstruit depuis les sources**
  et l'APK refait avec (voir la réserve 1 du verdict).

### Deux détails du script de rootfs, relevés en le lisant

- Son en-tête annonce « ~80 Mo compressé » alors que sa liste de paquets (rust,
  gdb, php83, openjdk21, gradle, go, ruby, cmake…) produit 787 Mo. Le
  commentaire est périmé, pas le script.
- Une garde d'idempotence saute la reconstruction si la sortie a moins de
  30 jours. Une copie d'artefact prend la date du jour et déclenche donc ce
  saut : il faut supprimer la sortie pour forcer une vraie reconstruction.

### Défaut d'empaquetage : 786 Mo d'octets orphelins dans l'APK

Reconstruire l'APK après avoir **changé** `rootfs.tgz`, sans nettoyer les
sorties, produit un fichier de 1853,1 Mo dont les entrées ne totalisent que
1066,9 Mo : **786,2 Mo d'octets orphelins**, soit exactement l'ancien rootfs,
resté échoué dans le fichier quand le nouveau a été écrit par-dessus. Le
répertoire central ne les référence pas, donc l'APK reste installable — mais il
embarque 786 Mo de gras.

Trois mesures ont écarté la coïncidence :

| Build | Fichier | Somme des entrées | Écart |
|---|---|---:|---:|
| Incrémental, rootfs changé | 1853,1 Mo | 1066,9 Mo | **786,2 Mo** |
| Clean (sorties supprimées) | 1067 Mo | 1066,9 Mo | 0,1 Mo |
| AAB du même build incrémental | 1017,2 Mo | 1017,1 Mo | 0,1 Mo |

Seul l'APK est touché ; l'AAB est produit correctement. Le défaut ne se
manifeste **que si le rootfs change entre deux builds**, ce qui le rend
invisible en usage courant — et il ne serait jamais apparu si la validation
s'était arrêtée au premier build vert.

**Conséquence pratique** : toute release qui modifie un asset `noCompress` doit
supprimer `app/build/outputs/apk` avant l'empaquetage, sinon l'APK publié
transporte l'ancien asset en doublon.

### Hard links : la réparation est à l'extraction, pas au build

L'archive livrée contient 24 entrées hard-link (alias `gcc`, `binutils`,
`perl`). Le script n'emploie pas `--hard-dereference` et la reconstruction en
produit exactement autant. Ce n'est pas un défaut : `runtime.rs` expose
`repair_rootfs_hardlinks`, qui les traite **à l'extraction sur l'appareil**, où
SELinux refuse `link()` sur `app_data_file`. Une note de mémoire projet décrivant
un `fix_hardlinks.py` appliqué au moment du build correspond à une approche
antérieure ; ce fichier n'existe dans aucun des deux dépôts.

## Verdict

**Les six conditions §6.3 sont remplies.** Le plan n'interdit donc plus la
consolidation monorepo sur ses propres critères.

Deux réserves à porter avec ce verdict, parce qu'elles changent ce qu'il
signifie :

1. **Le rootfs est reproductible ; les bibliothèques natives ne sont pas encore
   vérifiées.** `scripts/build-alpine-rootfs.sh` a été réexécuté depuis les
   sources (WSL + qemu, 222 paquets) et produit **824 414 554 octets contre
   824 220 313 pour l'artefact livré — 0,02 % d'écart**, avec exactement le même
   nombre d'entrées hard-link (24). L'écart résiduel est attendu : les `apk add`
   ne sont pas épinglés et Alpine réécrit ses révisions `-r*` sur place, donc la
   reproductibilité **bit-à-bit est hors d'atteinte avec cette recette** — ce
   serait une contrainte amont, pas un défaut du script. Les 30 bibliothèques
   `jniLibs` (llama.cpp, ggml, ONNX Runtime) restent, elles, reprises du fork
   sans reconstruction.
2. **La consolidation reste une décision, pas une conséquence.** Le plan §6.1
   décrit deux dépôts pour l'étape initiale ; passer au monorepo §6.4 est un
   choix de topologie qui appartient au propriétaire.

En l'état, la branche vit dans le fork **sans être fusionnée** : le travail est
dans le bon dépôt, et la fusion est désormais permise plutôt qu'obligatoire.
