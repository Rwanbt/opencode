# Threat model — observabilité native (Phase 1)

**Date** : 2026-07-10 | **Statut** : Accepté pour Phase 1

## Périmètre

Événements metadata/redacted non textuels stockés dans SQLite local, routes Hono locales et clé HMAC d’installation.

## Décisions de sécurité

- SQLite est **non chiffré au repos** en Phase 1. La protection dépend des permissions du profil utilisateur et du chiffrement disque de l’OS.
- Aucun prompt, réponse, argument/sortie d’outil, stack ou message d’erreur lisible n’est persisté en Phase 1.
- Les pseudonymes sont des HMAC-SHA256 avec une clé séparée de la DB.
- Les routes héritent de `JwtAuth.middleware()` et du bind loopback par défaut.
- La suppression par scope et la purge sont des capacités de premier ordre; les exports futurs seront séparés et redacted-only.

## Menaces et mitigations

| Menace | Mitigation Phase 1 | Limite connue |
|---|---|---|
| Lecture du fichier SQLite | permissions OS + avertissement UI | pas de chiffrement DB intégré |
| Corrélation inter-installations | HMAC avec secret local | rotation/perte de clé casse la corrélation historique |
| Exposition HTTP distante | loopback par défaut + JWT/Basic existants | mode distant doit être vérifié séparément |
| Fuite par sanitizer | bornes, court-circuit MIME, fail-closed, snapshots négatifs | contenu opt-in différé |
| Suppression incomplète | purge par scope + hook suppression session | backups externes hors contrôle |
| Crash avant flush | DB WAL/Drizzle, test d’intégrité | événements restés en mémoire perdus |

## Revue de sortie

La Phase 1 ne sort pas tant que les snapshots de confidentialité, tests d’ownership, tests de suppression et scénario no-network ne sont pas verts.

## Addendum Phase 3 — contenu opt-in (ADR-1032, 2026-07-12)

**Statut** : Accepté pour Phase 3.

La Phase 3 introduit un risque at-rest réel qui n'existait pas en Phase 1/2 : `local_content_redacted`/`local_full` stockent du texte lisible (potentiellement des secrets bruts au niveau `local_full`) dans le même fichier SQLite non chiffré.

| Menace ajoutée | Mitigation Phase 3 | Limite connue |
|---|---|---|
| Contenu lisible persisté au-delà de ce que l'utilisateur a explicitement accepté | Opt-in explicite par scope (session/project/workspace), TTL obligatoire max 30 jours, jamais un défaut global | Rien n'empêche un utilisateur d'opter en `local_full` sur un scope trop large (project) par erreur — pas de confirmation à deux étapes |
| Opt-in oublié qui reste actif | Expiration évaluée à chaque écriture (jamais de cache) + purge active horaire (`purgeExpiredOptIns`/`purgeExpiredContent`) | Fenêtre de jusqu'à 1h entre expiration réelle et purge active du contenu déjà écrit (la résolution passive empêche toute nouvelle écriture immédiatement, seule la purge des lignes existantes est différée) |
| Secrets bruts en `local_full` | Documenté explicitement comme un compromis du niveau "full" (ADR-1032, invariant 8 exempte `local_full`) ; `local_content_redacted` reste la valeur par défaut proposée dans l'UI | Un utilisateur qui choisit `local_full` accepte ce risque en connaissance de cause — pas de scan secondaire post-capture |
| Révocation incomplète | `POST /observability/privacy/revoke` efface le contenu ET l'opt-in dans le même appel, synchrone | Backups externes du fichier SQLite pris avant la révocation restent hors contrôle (même limite que Phase 1) |
| Chiffrement au repos toujours absent | Inchangé depuis Phase 1 — différé à une phase future, seule bornée dans le temps par le TTL du contenu lui-même | Le contenu `local_full` est donc en clair sur disque pendant toute la durée du TTL (jusqu'à 30 jours) |

Ce risque reste strictement opt-in et scope-isolé : un scope sans opt-in actif n'est affecté par aucune de ces menaces, l'invariant Phase 1 ("zéro contenu lisible") continue de s'appliquer par défaut.
