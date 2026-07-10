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
