# ADR-1027 : Cycle de vie de `localInstallSecret`

**Date** : 2026-07-10 | **Statut** : Accepté

## Contexte

L’observabilité native doit pseudonymiser les identifiants sensibles sans utiliser un hash brut. La clé doit rester locale, stable entre redémarrages et indépendante de la base SQLite.

## Décision

- Générer 32 octets avec `node:crypto.randomBytes(32)` lors de la première activation.
- Stocker la clé dans `Global.Path.config/observability_hmac.key`, fichier dédié en `0600` (répertoire parent créé en `0700` si nécessaire).
- Ne jamais écrire la clé dans SQLite, les logs, l’UI ou les exports.
- Une clé absente avec une DB existante entraîne une nouvelle clé et donc une perte volontaire de corrélation historique.
- La rotation Phase 1 est manuelle (suppression du fichier puis redémarrage), avec avertissement explicite.
- Aucun backup automatique de la clé en Phase 1.

## Alternatives rejetées

- Stocker la clé dans SQLite : sauvegarde et suppression moins maîtrisables.
- Utiliser `randomUUID()` : entropie/format non adaptés à une clé HMAC dédiée.
- Réécrire les anciens événements lors d’une rotation : coûteux et risqué pour la confidentialité.

## Conséquences

La corrélation par utilisateur/chemin dépend de la conservation séparée du fichier secret. La perte du fichier augmente la confidentialité mais casse les statistiques historiques associées.
