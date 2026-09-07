<!--
SPDX-License-Identifier: MIT
Copyright (c) 2026 Unifia contributors
-->

# WHY-NOT-VAULT-RG-GIT — Pourquoi un Knowledge Core dédié

> Document de cadrage Phase -1. Pourquoi une stack « vault Markdown +
> ripgrep + Git » ne suffit pas comme mémoire canonique pour Unifia, et
> quels échecs réels l'ont prouvé.

## TL;DR

Un agent qui s'appuie seulement sur (a) un dossier de fichiers
Markdown, (b) `rg`/recherche textuelle et (c) l'historique Git peut
récupérer du texte, mais **ne peut pas garantir** :

1. que le bon contexte est inclus au bon moment ;
2. que le contexte interdit ne fuit pas vers un provider non autorisé ;
3. que la mémoire est portable cross-éditeur et cross-machine sans
   reconstruction manuelle ;
4. qu'un agent externe ne lit pas ce qu'il ne doit pas lire ;
5. que les décisions et les ADR ne sont jamais silencieusement
   effacés ou réécrits.

Le Sovereign Knowledge Core V1 n'est pas un concurrent de ripgrep ; il
est la couche qui **décide** ce que ripgrep a le droit de chercher, où
et pour qui.

## Pourquoi la stack « naive » échoue

### A — Pas de policy, donc pas d'egress

`rg` retourne tout le texte. Il n'a pas la notion de restriction
portable, de classification, ni de destination. Un agent qui injecte
le résultat dans le prompt d'un provider cloud **envoie tout**. C'est
un vecteur de fuite de secrets, de chemins absolus, de fragments de
mémoire privée.

Référence d'incident : `docs/KNOWN_FAILURE_PATTERNS.md` §"Sécurité
(open items)" — `auth.json` plaintext, WebSocket auth en query param,
CORS regex trop permissif. Le `vault` ne corrige aucun de ces points
: il les héberge juste, sans les borner.

### B — Pas de lifecycle, donc perte de vérité

`git` historise, mais ne distingue pas :

- une note *active* d'une note *superseded* ;
- une *contrainte* (durable) d'un *brouillon* (jetable) ;
- une *décision* (engaging) d'une *réflexion* (exploratoire).

Conséquence : un agent qui lit `git log` peut très bien prendre un
brouillon pour une décision. Le Knowledge Core impose un lifecycle
explicite (`candidate` / `active` / `superseded` / `archived`) et un
champ `unifia_type` dans le frontmatter.

### C — Pas de graphe, donc navigation à l'aveugle

`rg` ne résout pas les wikilinks ni les backlinks. Un agent qui veut
savoir "quelles décisions ont été influencées par cet ADR" doit
parser lui-même, et c'est précisément la porte ouverte à
l'incohérence.

Référence : `docs/adr/0018-memory-system.md` (pré-existant) tente déjà
d'indexer le graphe ; le Knowledge Core V1 doit en faire un citoyen de
première classe (FTS5 + graph index), pas un side-effect.

### D — Pas de budget, donc coûts imprévisibles

`rg` retourne tout ce qui matche. Sans budget tokens explicite et sans
diversification, l'agent inonde le contexte. Le Knowledge Core produit
un `ContextPack` borné (`maxCandidates`, `maxPayloadBytes`,
`maxSnippetBytes`, `deadlineMs`).

Référence d'incident : `docs/KNOWN_ISSUES.md` "A.1 tokenizer
`length/4`" — l'estimation de tokens était grossière, menant à des
contextes trop grands ou tronqués silencieusement. Le Knowledge Core
doit publier un budget mesurable.

### E — Pas de rebuild garanti

Quand un index FTS est corrompu, un agent avec juste `rg` n'a aucun
moyen de reconstruire un index "sémantique" ou de tag de lifecycle. Le
Knowledge Core V1 doit pouvoir **tout reconstruire à partir du
Markdown** (Class A) et des métadonnées portables (Class B), sans
perte sémantique (runbook §12 "Derived Is Disposable").

### F — Édition externe non first-class

L'utilisateur édite son vault avec Obsidian, VS Code, Neovim, ou
l'éditeur natif d'Android. La stack `vault + rg` ne sait pas qui a
touché quoi, et perd la course. Référence d'incident :
`docs/KNOWN_FAILURE_PATTERNS.md` "WebView cache stale après `adb
install -r`" — l'édition externe n'est pas invalidante.

Le Knowledge Core V1 doit traiter l'édition externe comme un événement
de première classe, pas comme une anomalie.

### G — Pas de distinction Trust / Authority / Egress

Le principe P7 du plan gelé (Trust ≠ Authority ≠ Egress) exige trois
systèmes distincts :

- **Trust** : qui a écrit ce contenu.
- **Authority** : qui a le droit de le modifier.
- **Egress** : qui a le droit de le lire, dans quel contexte,
  vers quel provider.

`rg` ne distingue rien de tout ça. Le Knowledge Core trace les trois.

### H — Cycle de vie d'un agent multi-provider

L'agent peut passer de Claude à GPT à un LLM local selon la tâche.
Avec la stack naive, le vault est le même, mais :

- les memories "ne pas envoyer vers le cloud" ne sont pas signalées ;
- les memories "utiliser la mémoire" ne sont pas hydratées avec le
  bon provider.

Le Knowledge Core V1 publie un `ContextPack` qui contient un
`ProviderDestinationPlan` et un `EgressDecision` par item.

## Cas qui démontrent que la stack naive est insuffisante

Voir `PRODUCT-CASES.md` pour le détail. Résumé :

| ID | Cas | Échec de la stack naive |
|---|---|---|
| PC-01 | Sidecar stale après modif TS | Pas d'invalidation de l'index canonique ; CLI s'exécute contre l'ancien code |
| PC-02 | Bash tool schema bug (Gemma-4) | `rg` trouve le bug ; l'agent n'a pas la *contrainte* "Gemma-4 dry_run → description" dans son contexte |
| PC-03 | WebSocket auth en query param | `rg` ne sait pas que c'est une fuite ; l'agent peut écrire dans une note "auth query" sans classification |
| PC-04 | `auth.json` plaintext | Sans policy, l'agent peut recopier ce token dans une note Markdown → leakage via Git |
| PC-05 | Mobile CLI bundle stale | `rg` voit le bundle neuf mais le runtime Android sert encore l'ancien ; pas de notion de version runtime |
| PC-06 | Alpine hardlinks SELinux | `rg` n'a aucune opinion sur l'autorisation de la mutation ; un agent auto-réparateur peut re-tenter et re-échouer |
| PC-07 | OpenCL Adreno K-quants crash | `rg` ne porte pas l'attribut "device: Adreno 6xx → K-quants interdits" → l'agent réécrit la même config 5 fois |
| PC-08 | Reasoning budget capped 1024 (A.2) | `rg` ne sait pas que la décision "Qwen/DeepSeek → 8192, default 2048" existe ; l'agent n'a pas accès à l'ADR |
| PC-09 | `ragIndexedDirs` leak (B.1) | L'agent ne peut pas savoir que la LRU 64/30min est la policy ; il réintroduit un Set |
| PC-10 | `static mut PROXY_PORT` (B.A6) | `rg` ne propage pas la décision "AtomicU16 + compare_exchange" ; l'agent peut régresser |

10 cas. Largement > minimum 5 imposé par le runbook.

## Conclusion

Un Knowledge Core V1 n'est **pas** un moteur de recherche avancé. C'est
un système qui **borne** ce que la recherche a le droit de retourner, à
qui, sous quelle classification, et avec quel budget. Sans ce système,
Unifia ne peut pas revendiquer l'appellation "Sovereign" : sa mémoire
est lue, copiée et exfiltrée par défaut.

Voir `SOVEREIGN-CORE-V1-DOD.md` pour les critères mesurables, et
`PRODUCT-CASES.md` pour les incidents détaillés.
