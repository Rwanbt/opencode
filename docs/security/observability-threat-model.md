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

## Addendum Phase 4 — exporters réseau optionnels (ADR-1026, 2026-07-12)

**Statut** : Accepté pour Phase 4.

La Phase 4 introduit le premier client réseau du module observability : un exporter optionnel (Langfuse en premier) qui envoie une `ExportProjection` (jamais une ligne brute) vers un service tiers. Par défaut (`exporters` non défini ou `[]`), ce risque est nul — aucun code réseau ne s'exécute, vérifié par `test/observability/exporter.test.ts`.

| Menace ajoutée | Mitigation Phase 4 | Limite connue |
|---|---|---|
| Fuite de contenu opt-in Phase 3 vers un tiers réseau | `ExportProjectionSchema` est `.strict()` et ne définit aucun champ de contenu texte — `local_content_redacted`/`local_full` ne peuvent structurellement pas atteindre un exporter, testé par un cas où l'appelant passe volontairement une ligne complète avec ces champs (`toExportProjection never surfaces Phase 3 opt-in content`) | Un futur champ de contenu ajouté par erreur à `ExportProjectionSchema` sans revue attentive romprait cette garantie — c'est pourquoi le schéma doit rester `.strict()` (ADR-1026) |
| Corrélation d'identifiants internes par un tiers réseau | `sessionId`/`projectId`/`workspaceId` sont HMACés avant export (même clé locale ADR-1027), jamais transmis en clair, y compris quand la DB locale les stocke en clair pour un accès authentifié local | Le tiers reçoit tout de même `traceId`/`spanId` en clair (ULID internes, non réutilisables comme identifiant utilisateur) — nécessaire pour reconstruire la structure trace/span côté exporter |
| Identifiants Langfuse (`publicKey`/`secretKey`) exposés dans la config | Stockés dans `opencode.json`/`opencode.jsonc` comme tout autre secret de config de ce projet (pas de mécanisme de coffre-fort dédié en Phase 4) | Même limite que toute clé API déjà présente dans la config OpenCode — pas spécifique à l'observabilité |
| Échec réseau silencieux masquant une perte de données d'export | Chaque échec d'exporter est retenté (backoff borné, 4 tentatives) puis loggé (`log.warn`) avec le nom de l'exporter | Retry borné, pas une file persistante — un batch perdu après ses tentatives n'est jamais rejoué au redémarrage (`docs/observability-phase4-admin.md`) |
| Fuite via un exporter tiers mal implémenté (futur exporter autre que Langfuse) | Le seul point d'entrée réseau sanctionné est `observability/exporters/*.ts`, un sous-répertoire dédié — tout nouvel exporter doit y vivre et n'a accès qu'à `ExportProjection`, jamais à `EventRow` | La frontière est une convention de répertoire + revue de code, pas une sandbox runtime — un exporter mal écrit pourrait en théorie importer `repository.ts` directement ; aucun mécanisme technique ne l'en empêche au runtime |
| Mapping Langfuse incorrect (champs/format erronés) | Format vérifié le 2026-07-12 contre le fichier OpenAPI brut officiel de Langfuse (pas seulement la doc résumée) — voir en-tête de `observability/exporters/langfuse.ts` | Jamais exercé contre une instance Langfuse réelle (acceptation serveur/auth non confirmées) — voir `docs/observability-phase4-admin.md` §"Limites connues" |
| Backfill accidentel d'un gros volume vers un exporter tiers | `backfillOnStart` est `false` par défaut — sans l'activer explicitement, seuls les events futurs sont exportés | Un utilisateur qui active `backfillOnStart` sans mesurer la taille de son historique local peut déclencher un envoi massif et inattendu vers le tiers configuré — pas de confirmation à deux étapes ni d'estimation de volume affichée avant activation |

Ce risque reste, comme la Phase 3, strictement opt-in : sans configuration explicite d'au moins un exporter, aucune de ces menaces ne s'applique.
