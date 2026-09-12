<!-- SPDX-License-Identifier: MIT -->
# Rebrand Unifia — état vérifié au 2026-08-07

Chiffres relevés par scan direct ce jour, pas de mémoire.

## ✅ Fait et vérifié

### Identité applicative
- [x] **Identifiant desktop** — `ai.unifia.workbench.dev`, productName « Unifia Dev »
- [x] **Identifiant mobile** — `ai.unifia.mobile`, productName « Unifia Mobile »,
      **validé sur appareil réel** (Mi 10 Pro, `LlamaEngine initialized`)
- [x] **Binaire CLI** — `bin: { "unifia": "./bin/unifia" }`
- [x] **Crates Rust** — `unifia-kokoro-shared`, `unifia-desktop`, `unifia-mobile` (3/3)

### Mobile — chaîne complète
- [x] 7 symboles JNI `Java_ai_unifia_mobile_*`
- [x] Bibliothèque native `libunifia_mobile_lib.so`
- [x] Répertoires de paquet Kotlin `ai/unifia/mobile/`
- [x] Thème `Theme.unifia_mobile`
- [x] 6 chemins codés en dur (Kotlin ×2, Rust ×1, C ×3)
- [x] Migration des 2,4 Go de données on-device par coexistence

### Configuration
- [x] **Répertoire global** — `const app = "unifia"` → `~/.config/unifia`,
      `~/.local/share/unifia`, cache et state
- [x] **Nom du fichier de config** — `unifia.json` / `unifia.jsonc`
- [x] **Variables d'environnement, côté lecture** — 37 flags canoniques `UNIFIA_*`
      avec repli `OPENCODE_*` documenté dans `flag/flag.ts`

### Paquets
- [x] **34 paquets sous `@unifia/*`**

---

## ⬜ Reste à faire

Classé du plus mécanique au plus délicat.

### Fait le 2026-08-07
- [x] **Scope npm** — les 11 derniers paquets `@opencode-ai/*` renommés en
      `@unifia/*` : 1516 occurrences dans 461 fichiers. Décidé **maintenant**
      parce que le dépôt n'a encore aucun consommateur : la fenêtre pour
      renommer sans rupture se referme dès qu'un tiers importe le SDK.
      *Argument décisif : `publish.yml` publie sur npmjs.org — un fork qui
      publie sous le scope de l'amont squatte son espace de noms.*
- [x] **Nom du paquet CLI** — `opencode` → `unifia`
- [x] **58 occurrences dans 6 locales** — `en.ts` était déjà propre ; le rebrand
      avait été fait langue par langue et 6 des 18 étaient restées à mi-chemin
      (`ja` 23, `ko` 16, `bs` 7, `de`/`da`/`no` 4). Un utilisateur japonais
      voyait « OpenCode » là où un anglophone voyait « Unifia ».
- [x] **Clés `turbo.json` mortes** — `@opencode-ai/mobile#test` ne
      correspondait plus à rien depuis le renommage du paquet en
      `@unifia/mobile` : la tâche n'utilisait plus sa config dédiée, en silence.
- [x] **Les « 53 littéraux d'interface » étaient un faux positif** de mon scan :
      ce sont des **identifiants internes** (`OpenCodeWindow`,
      `registerOpenCodeTheme`), pas du texte visible.

### Demande une décision
- [ ] **Répertoire de config projet `.opencode/`** — 8 occurrences. État actuel
      incohérent : `.opencode/unifia.json`. Le renommer en `.unifia/` **casse les
      projets existants** qui ont déjà un `.opencode/` — il faut soit une
      migration, soit lire les deux
- [x] **5 lectures directes qui contournaient le shim** — routées le 2026-08-07.
      Avant cela, positionner le nom rebrandé ne faisait **rien** à ces endroits.
- [x] **Défaut de sécurité trouvé par ce contrôle** — `auth/index.ts` lisait
      `process.env.UNIFIA_AUTH_STORAGE` alors que les deux shells émettent
      l'ancien nom. La valeur n'arrivait jamais, le sélecteur retombait sur
      `"file"`, et les identifiants de fournisseurs étaient écrits **en clair**.
      Vérifié sur appareil : `auth.json` commençait par `{`. Corrigé.
- [ ] **Émission côté shells Rust** — laissée telle quelle **délibérément** :
      le shim lit les deux noms, donc la changer ne gagnerait rien et coûterait
      un rebuild APK plus une re-vérification sur appareil.

### Périmètre à trancher
- [ ] **Domaine `opencode.ai`** — 562 fichiers, dont **417 dans `packages/web`**
      (site vitrine amont). Hors `web` : 69 dans le cœur CLI, 38 dans `ui`,
      7 dans `app`, 4 dans `desktop`, 3 dans `mobile`.
      *`packages/web` est le site du projet amont, pas l'application. À décider :
      le rebrander, le supprimer du fork, ou le laisser tel quel.*

---

## 🔒 Ne doit **pas** changer

- [x] **`ai.opencode.desktop` / `ai.opencode.desktop.dev`** dans le CLI embarqué —
      c'est la **détection de l'application OpenCode officielle**. La renommer
      casserait la détection.
- [x] **`ai.opencode.managed`** — domaine de profil MDM macOS, convention amont.
- [x] **Traçabilité de provenance** — `UPSTREAM-SOURCES.lock.json`,
      `THIRD-PARTY-NOTICES.md`, `UPSTREAM-PROVENANCE.md` doivent continuer à
      nommer l'amont : c'est ce qui rend la conformité de licence vérifiable.

---

## Ce que « complètement rebrandé » veut dire

Trois niveaux, à ne pas confondre :

| Niveau | État |
|---|---|
| **Ce que l'utilisateur voit** — nom de l'app, binaire, fenêtres, config globale | **fait** |
| **Ce que l'utilisateur touche** — locales, littéraux UI, config projet | **partiel** |
| **Interne** — noms de paquets npm, variables d'environnement héritées, domaine | **partiel, et certains points ne doivent pas bouger** |

Le premier niveau est celui qui décide si l'application « est » Unifia. Il est
complet. Les deux autres sont de la cohérence, pas de l'identité — et deux items
(`.opencode/` projet, `packages/web`) ont des **conséquences externes** qui en
font des décisions, pas des tâches.
