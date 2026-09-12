<!-- SPDX-License-Identifier: MIT -->
# Android transport — journal d'investigation (R-0025)

> Neuf hypothèses testées, neuf réfutées **par la mesure**. Ce document existe
> pour que personne ne les rejoue. Chaque ligne porte la commande exécutée et la
> sortie observée ; ce qui n'a pas été mesuré est marqué comme tel.
>
> Suivi : R-0025 dans `RISKS.md`, carte
> `projects/unifia/work/initiatives/unblock-android-agent-turns.md` du vault.

## Le symptôme

`POST /session/:id/prompt` répond **500** avec
`The socket connection was closed unexpectedly`, en **~15,3 s constant**, pour
tous les providers. Aucun tour d'agent n'aboutit sur Android.

Durées mesurées sur huit essais : `15,377` `15,210` `15,314` `15,289` `15,318`
`15,325` `15,238` `15,312` s. La constance est le fait le plus informatif du
dossier : c'est une échéance, pas un aléa.

## Comment reproduire

```bash
adb -s <serial> forward tcp:14096 tcp:14096
SID=$(curl -s -X POST http://127.0.0.1:14096/session \
  -H 'content-type: application/json' -d '{}' | python -c "import sys,json;print(json.load(sys.stdin)['id'])")
curl -s -m 200 -X POST "http://127.0.0.1:14096/session/$SID/prompt" \
  -H 'content-type: application/json' \
  -d '{"agent":"build","model":{"providerID":"openai","modelID":"gpt-5.6-luna"},"parts":[{"type":"text","text":"say OK"}]}' \
  -o /dev/null -w "http=%{http_code} t=%{time_total}s\n"
```

Appareil de référence : Xiaomi Mi 10 Pro (`cmi_eea`), Android 13, paquet
`ai.unifia.mobile`.

## Antériorité — ce n'est pas une régression du knowledge core

| Vérification | Commande | Résultat |
|---|---|---|
| A/B sur l'APK de l'utilisateur | réinstallation de `unifia-work-design-20260817-debug.apk` puis même prompt | **`http=500 t=15.24s`** |
| Le runtime mobile a-t-il changé ? | `git diff origin/dev HEAD -- packages/mobile` | **vide** |
| Le sidecar a-t-il touché au transport ? | `git diff --stat origin/dev HEAD -- packages/unifia/src` | **+17 499 / −7** — sept suppressions, aucune réseau |
| Les binaires sont-ils les mêmes ? | CRC via `unzip -v` sur les deux APK | `libbun_exec.so` `4a8b7824`, `libmusl_linker.so` `31a4b6de`, `libresolv_override.so` `164b106b`, `librust_pty.so` `e421d4ea`, `rootfs.tgz` `beaa00e7` — **identiques** |

Le défaut est **antérieur** à `feat/sovereign-knowledge-core` et indépendant de
la mise en scène d'assets faite pour rendre le build possible.

## Les neuf hypothèses réfutées

| # | Hypothèse | Ce qui l'a tuée |
|---|---|---|
| 1 | Le proxy CONNECT route mal le localhost | `NO_PROXY=127.0.0.1,localhost` posé ; `curl` depuis le runtime : direct **200**, via proxy **200**, vers localhost **200** |
| 2 | `LlamaEngine.loaded` ment → redémarrage du serveur | Copilot et OpenAI échouent à l'identique sans toucher au moteur local |
| 3 | Timeout provider / `chunkTimeout` | non configuré ; `provider.ts:722` passe `timeout: false` au fetch |
| 4 | Le petit modèle `learner` tape sur `local-llm` | `small_model` basculé sur `openai/gpt-5.6-luna` + redémarrage → identique |
| 5 | Le tunnel `adb forward` lâche | rejoué **depuis l'appareil** via `session.shell` : `http=500 t=15.31s` |
| 6 | Le port du proxy est périmé | proxy annoncé, port écoutant et `HTTP_PROXY` du sidecar : **42411 = 42411 = 42411** |
| 7 | Une politique seccomp bloque la pile socket | aucun `SIGSYS` ni `seccomp` en logcat ; **une violation tue le processus, elle ne rend pas `ECONNREFUSED`** — or le sidecar sert toutes ses autres routes pendant l'échec |
| 8 | Le shim DNS `libresolv_override.so` n'est pas chargé | instrumenté (`server.rs`, `debug!` → `info!`) : `I [OpenCode] LD_PRELOAD=.../libresolv_override.so` — il **est** chargé, et `SSL_CERT_FILE` est présent |
| 9 | Le sous-système LSP est sur le chemin critique | `lsp: false` dans la config du téléphone + redémarrage → **zéro ligne `service=lsp`** et `t=15.32s` |

**Cas particulier de l'hypothèse 2.** `LlamaEngine.loaded()` (`:1307`) appelle
`isLoaded()` (`:1347`), un `external fun` JNI qui interroge le moteur
**in-process**, alors que l'inférence est servie par le **processus enfant**
`llama-server` (`:1224`). Observé : `Command result: false` pendant que le
modèle servait. Conséquence documentée par l'auteur (`llm.rs:404-412`) : un
rechargement redondant appelle `stopServer()` sans condition. **C'est un vrai
défaut, à corriger — `LlamaService.isModelActive()` est la bonne réponse — mais
ce n'est pas la cause de ce 500.**

## Ce qui est établi

- Le réseau du téléphone fonctionne : `curl` atteint `registry.npmjs.org` (200)
  et l'API MiniMax depuis le runtime de l'app.
- Le proxy CONNECT fonctionne, y compris pour tunneler du localhost.
- Le shim DNS et le bundle CA sont en place.
- Le sidecar reste vivant : `/global/health`, `/session`, `/session/:id/shell`,
  `/experimental/tool/ids` répondent pendant et après chaque échec.
- **Le client HTTP de Bun est le seul élément qui échoue**, uniformément, y
  compris vers `127.0.0.1:14097`. Le log DEBUG le montre en `ECONNREFUSED` sur
  `registry.npmjs.org`, sur les modèles Copilot et sur les providers.

## L'état du log après retrait du LSP

C'est le point de reprise le plus utile. Avec `lsp: false`, le bruit disparaît
et il ne reste que ceci :

```
16:14:27  POST /prompt  status=started
          (15 secondes de silence complet)
16:14:42  ERROR service=server error=The socket connection was closed unexpectedly
16:14:42  status=completed duration=15312
```

**Une seule opération silencieuse consomme les quinze secondes.** Ni provider,
ni llm, ni config, ni auth ne journalisent quoi que ce soit entre les deux.

## Résultat de la trace Bun — 2026-08-31

Le build instrumenté, installé sur le Mi 10 Pro, a atteint
`GET https://api.githubcopilot.com/models` avec `200 OK`. Deux requêtes courtes
vers `POST https://api.githubcopilot.com/chat/completions` ont elles aussi
atteint Copilot en moins de deux secondes, mais ont reçu
`400 model_not_supported`. La panne observée sur cette version est donc un
**décalage entre le catalogue de modèles Copilot et les droits réellement
accordés au compte**, pas un `ECONNREFUSED` du transport Android.

Le marqueur `.bun_verbose_fetch` a été supprimé puis le sidecar redémarré. Il
ne doit être utilisé que ponctuellement : les traces Bun peuvent contenir des
en-têtes d'authentification et doivent être expurgées avant tout partage.

Un défaut distinct a aussi été découvert durant ce rebuild : si les binaires du
runtime existent déjà, `build-android.sh` sautait la régénération de
`unifia-cli.js`. L'APK pouvait alors embarquer un bundle TypeScript ancien,
notamment encore strict sur les clés inconnues de configuration, et échouer au
démarrage. Le script rafraîchit désormais ce bundle à chaque rebuild.

## Pièges rencontrés, à ne pas re-découvrir

- **`session.shell` ne préserve pas les sauts de ligne.** Un heredoc arrive avec
  son délimiteur collé (`PROBE_EOFn---n`) et écrit un fichier vide. Passer le
  contenu en base64 sur une seule ligne.
- **`adb shell input tap` est refusé** sur cet appareil (`INJECT_EVENTS`, MIUI).
  Il faut activer « Débogage USB (réglages de sécurité) » ou taper à la main.
- **Le choix « Local Mode / Remote Server » ne persiste pas** après un
  `force-stop` : le sidecar ne démarre qu'après un appui manuel. Tout script de
  redémarrage automatique s'arrête là.
- **La configuration est lue au démarrage.** Modifier `unifia.jsonc` sans
  redémarrer ne change rien — un test fait ainsi est non concluant, pas négatif.
- **Un retour arrière de version peut bricker l'application** (R-0026) : un
  bundle ancien avec un schéma `.strict()` rejetait les clés ajoutées par une
  version plus récente et provoquait un `ConfigInvalidError` au démarrage, sans
  message côté interface. Le schéma racine est maintenant permissif afin de
  préserver ces clés inconnues.
- **Le build release n'est pas `DEBUGGABLE`**, donc `run-as` est refusé ;
  l'accès au sandbox passe par `session.shell`, qui exige un serveur vivant.

## Outillage laissé en place

- `packages/unifia/script/android-memory-probe.ts` — `bun run probe:android`.
  Sondes déterministes du vault sur appareil, produit une `ProbeEvidence` réelle.
  `--with-agent --model provider/modele` ajoute la sonde qui exige un tour, et
  la laisse `NOT_EXECUTED` tant que R-0025 tient.
- `packages/unifia/src/provider/provider.ts` — un échec de `fetch` provider
  journalise provider, modèle, URL, méthode, durée et `aborted`. Cette
  instrumentation **ne s'est jamais déclenchée** pendant l'investigation, ce qui
  est en soi la preuve que l'échec est en amont de la résolution du provider.
- `packages/mobile/src-tauri/src/runtime/server.rs` — `LD_PRELOAD` et
  `SSL_CERT_FILE` passent de `debug!` muet à `info!`/`warn!`.

## État de l'appareil à la fin de l'investigation

Restauré : `unifia.jsonc` sans `logLevel` ni `lsp`, sauvegardes supprimées,
notes de sonde retirées de `.unifia/memory/`. L'APK installé est le build
instrumenté du 2026-08-31, avec le bundle courant et le correctif de lecture de
configuration.
