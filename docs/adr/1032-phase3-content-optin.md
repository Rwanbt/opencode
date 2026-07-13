# ADR-1032 : Capture de contenu opt-in Phase 3

**Date** : 2026-07-12 | **Statut** : Accepté

## Contexte

Jusqu'à la Phase 2, l'observabilité native n'a jamais persisté de contenu lisible (prompt, réponse, args/output d'outil, message d'erreur) — c'est l'invariant central documenté dans le rapport Phase 0. La Phase 3 introduit une capture de contenu réelle mais strictement opt-in, TTL-bornée et révocable, sans jamais retirer cet invariant pour un scope non opt-in.

## Décision

- Deux nouveaux niveaux de capture, distincts du `captureMode` global (`local_metadata`/`local_redacted`) : `local_content_redacted` (secrets/chemins/emails/tokens haute-entropie masqués) et `local_full` (texte brut borné, aucune substitution).
- L'opt-in est une entité séparée (`observability_content_optin`), scopée par `session`/`project`/`workspace`, avec `ttl_days` obligatoire (max 30 jours) et `expires_at_ms` dérivé — jamais un booléen permanent.
- Résolution la plus spécifique gagne : session > project > workspace. Ré-opt-in sur le même scope écrase le précédent (pas d'empilement).
- Expiration évaluée à chaque écriture (`resolveContentCaptureLevel`, aucun cache) ET balayée activement par un job périodique (`purgeExpiredOptIns`/`purgeExpiredContent`, `runtime.ts`).
- Le contenu capturé vit dans deux colonnes nullable de la table `observability_event` existante (`local_content_redacted_json`, `local_full_json`) plutôt qu'une table séparée, avec `content_expires_at_ms` copié depuis l'opt-in au moment de l'écriture — la purge de contenu n'a donc jamais besoin de joindre la table d'opt-in, même après révocation.
- `POST /observability/privacy/revoke` est immédiat : supprime la ligne d'opt-in ET efface le contenu déjà capturé pour ce scope, sans attendre le TTL.
- Le sanitizer existant (`sanitizeText`, jamais capable de retourner du contenu par construction) reste inchangé ; une fonction séparée (`captureContent` dans `sanitizer.ts`) est la seule à retourner du texte, et uniquement lorsqu'un appelant a déjà confirmé un opt-in actif.

## Conséquences

- `local_full` peut contenir des secrets/chemins/emails bruts si le texte source en contient — c'est un choix assumé du niveau "full", jamais celui de `local_content_redacted` ou des niveaux Phase 1/2.
- Un scope oublié en opt-in reste actif jusqu'à expiration du TTL (max 30 jours) ou révocation manuelle — pas de nettoyage instantané passif au-delà de la purge périodique horaire.
- La capture de contenu ajoute un coût par span (lecture opt-in + éventuel passage sanitizer) uniquement quand un opt-in est actif pour le scope ; le chemin non opt-in (immense majorité) reste inchangé (`withContentCapture` est un no-op sans opt-in).
