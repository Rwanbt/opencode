# ADR-1029 : Ordre, débordement et crash de la queue

**Date** : 2026-07-10 | **Statut** : Accepté

## Décision

- Producteur non bloquant, consommateur unique, ordre logique FIFO via `enqueueSeq` monotone.
- Bornes Phase 1 : 500 événements ou 64 MiB, batch 100, flush 250 ms, trois retries `50/250/1000 ms`.
- En débordement, supprimer d’abord les événements les plus anciens à faible priorité; préserver autant que possible les terminaux et événements portant coût/tokens/erreur.
- Si aucune place n’est libérable, rejeter le nouvel événement avec `queue_full` et incrémenter le compteur associé.
- Les retries conservent `enqueueSeq`; les lectures corrèlent `started`/terminal via `span_id`, jamais via la position.
- `record()` retourne toujours un `RecordResult` explicite.
- Une perte mémoire avant flush après SIGKILL est une limite connue et documentée; elle ne doit pas être présentée comme détectée.

## Conséquences

La télémétrie ne bloque pas le produit et expose ses pertes normales. La durabilité complète après crash nécessite une queue persistante et est différée.
