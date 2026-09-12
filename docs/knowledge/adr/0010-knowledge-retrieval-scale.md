---
id: KNOW-0010
title: Échelle du retrieval — corpus partiel honnête avant index persistant
status: ACCEPTED
date: 2026-08-31
sources:
  - R-0018 (la falaise de retrieval, mesurée puis re-mesurée le 2026-08-31)
  - ADR-KNOW-0008 (recherche : lexical d'abord, vecteur ensuite)
---
<!-- SPDX-License-Identifier: MIT -->

# ADR-KNOW-0010 — Échelle du retrieval

> Voir aussi ADR-KNOW-0007 (`NativeKnowledgePort`, toutes les bornes) et le
> banc `packages/unifia/bench/knowledge-scale.ts`, qui produit les mesures
> citées plus bas.

## Contexte

V1 n'a pas d'index : `search` liste un espace, lit chaque note et score le
corps. Le coût est linéaire, et le deadline est la seule chose qui sépare un
gros vault d'un appel non borné. R-0018 l'a mesuré ; la mesure a été rejouée
quatre fois le 2026-08-31 avant d'écrire cet ADR, et elle tient : **~3,3 ms
par note**, deux seuils, à ~1 000 puis ~2 000 notes.

Trois faits changent la nature du problème par rapport à « c'est lent ».

**1. Le premier seuil dégrade en silence, le second efface.** Vers 1 000
notes le deadline de 2 s tronque et le second espace n'est plus atteint.
Vers 2 000, `list()` seul dépasse le budget : la recherche rend **zéro
résultat sans avoir lu une seule note**. Le plafond contractuel de
`deadlineMs` étant de 60 s, aucun deadline légal ne permet un scan complet
au-delà d'environ 18 000 notes.

**2. `list()` n'est pas un listing.** `source/vault.ts:161` lit et parse
chaque note pour n'en retenir que quatre champs, puis le routeur rappelle
`source.read()` note par note (`context/router.ts:181`). **Le corpus est lu
et parsé deux fois par recherche.** La moitié du coût mesuré paie une
information déjà obtenue.

**3. Le deadline ne coupe rien.** `context/deadline.ts` l'écrit :
« `KnowledgeSource` has no cancellation in its contract, so a call that
overruns cannot be stopped ». `withDeadline` cesse d'attendre ; le `list()`
abandonné parcourt le vault jusqu'au bout. À 6 000 notes la réponse revient à
2 s et la machine travaille encore 7,7 secondes — pour un résultat que
personne ne lira.

**4. La falaise se déplace.** Sur la même machine et le même corpus, une des
quatre passes a tourné à 1,2 ms/note au lieu de 3,3 : la troncature commence
à 500 notes dans une passe, à 2 000 dans une autre. Le seuil est une
propriété de la charge machine, pas du vault. Un chiffre de notes cité comme
limite est une plage.

**Cadrage produit.** La cible de V1 est une mémoire projet de quelques
centaines de notes, bien à l'intérieur de l'enveloppe mesurée. Ce n'est donc
pas un blocage produit ; c'est une limite dont la forme actuelle — *rendre
zéro et se taire* — est inacceptable indépendamment de sa position.

## Décision

**Le corpus partiel honnête d'abord ; l'index persistant seulement sur
preuve de besoin.**

1. **`KnowledgeSource.list()` devient annulable et incrémental.** Le contrat
   gagne un signal d'annulation et rend au fil de l'eau, de sorte qu'un
   budget épuisé arrête le travail au lieu de le laisser courir. Une passe
   interrompue rend ce qu'elle a lu, et la réponse dit combien de notes ont
   été examinées sur combien listées.
2. **Une recherche tronquée rend un corpus partiel, jamais zéro par
   épuisement du budget.** `sourcesQueried`, `truncated` et `excluded`
   continuent de dire exactement ce qui a été ouvert — la correction de
   R-0018 est conservée et devient la moitié d'une réponse utile plutôt que
   l'explication d'une réponse vide.
3. **Le double parcours est supprimé.** `list()` conserve ce qu'il a déjà
   parsé, ou rend de quoi scorer sans relire. C'est le seul gain de
   performance de cet ADR, et il est mécanique : il ne repose sur aucun
   nouveau stockage.
4. **Aucun index n'est introduit en V1.** L'ordre de balayage devient
   explicite — plus récent d'abord, ce que `list()` produit déjà — pour
   qu'un corpus partiel soit le plus pertinent possible et non un préfixe
   arbitraire du système de fichiers.

**Rien de tout cela n'est implémenté par cet ADR.** L'ADR existe avant le
code, délibérément : le point 1 est un changement du contrat
`KnowledgeSource`, qui touche toutes les sources et le routeur.

## Alternatives rejetées

**Index FTS5 persistant maintenant.** C'est la réponse évidente et elle est
prématurée. Elle introduit un état dérivé d'un vault que l'utilisateur édite
**hors de l'application** — dans Obsidian, par un `git pull`, par une
résolution de conflit. Un index a donc une classe d'erreurs entière qui
n'existe pas aujourd'hui : la péremption silencieuse, qui se manifeste comme
une note introuvable, c'est-à-dire exactement le défaut que R-0018 vient de
corriger, en pire, parce qu'un index périmé répond avec assurance.
L'invalidation demande un watcher fiable ; le seul écrit est dans un crate
qui n'est livré nulle part (R-0024). Enfin, l'index ne dispense pas du point
1 : une base de 20 000 notes veut aussi un scan annulable. On paierait donc
la conception la plus coûteuse **sans** obtenir la garantie qui manque.

**Relever le plafond de `deadlineMs`.** Déplace la falaise sans la changer de
forme, et transforme un appel d'outil en attente de plusieurs minutes. Le
plafond de 60 s est une borne de contrat, pas un réglage.

**Plafonner le vault et refuser au-delà.** Honnête, et inutilisable : le vault
appartient à l'utilisateur, qui n'a pas à le tailler pour l'outil. Un refus
franc reste préférable à un zéro silencieux, mais un corpus partiel est
préférable aux deux.

**Ne rien faire, documenter la limite.** C'est l'état actuel. Il laisse
debout un comportement où une recherche rend zéro résultat sur un vault qui
contient la réponse. La position de la falaise est discutable ; cette forme
d'échec ne l'est pas.

## Conséquences

- `KnowledgeSource` change de contrat : signal d'annulation et rendu
  incrémental. Toutes les sources (`vault`, `personal`, `session`,
  `external`) et le routeur sont touchés. C'est un changement de rupture
  interne, à faire en une étape isolée, sans changement de comportement joint.
- `ContextDiagnostics` gagne de quoi dire *combien* a été examiné, pas
  seulement *quels espaces*. « 340 notes examinées sur 2 100 » est une
  réponse ; « tronqué » n'en est pas tout à fait une.
- Le bench `bench/knowledge-scale.ts` reste la mesure de référence et doit
  être rejoué après implémentation. La variance mesurée impose **au moins
  trois passes** : une passe unique peut se tromper d'un facteur 2,5.
- `test/knowledge/context/scale.test.ts` continue de forcer le deadline
  plutôt que de construire un gros vault : le comportement doit tenir sur
  n'importe quelle machine, la vitesse non. Il gagne le cas « budget épuisé →
  corpus partiel non vide ».
- La revendication produit devient énonçable : *V1 balaie ce que le budget
  permet et dit ce qu'elle a lu.* Elle ne dépend plus d'un nombre de notes.

## Condition de réentrée de l'index

L'index persistant n'est pas rejeté, il est **conditionné**. Il revient quand
l'une de ces deux propositions est mesurée vraie :

1. Un usage réel vise un vault de plus de ~2 000 notes — la cible actuelle
   est une mémoire projet de quelques centaines, dix fois en deçà ;
2. le corpus partiel, une fois livré, est mesuré insuffisant : le rappel
   observé sur un vault réel manque des notes que l'utilisateur attendait.

Le second critère est le seul qui compte vraiment, et il exige d'avoir livré
le point 1 d'abord. C'est la raison de l'ordre choisi, et non une préférence
pour la petite étape.

Le jour venu, l'ADR de l'index devra trancher l'invalidation avant le format :
qui observe le vault, que fait une lecture pendant une reconstruction, et
comment un index périmé se signale au lieu de répondre.

## Ce que cet ADR ne corrige pas

Le coût par note. Un corpus partiel lit toujours ~3,3 ms par note ; il en lit
simplement moins, et le dit. La seule chose qui change la constante est un
index, et c'est précisément ce qui est différé ici.
