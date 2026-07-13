# ADR-1028 : Authentification et ownership des routes locales

**Date** : 2026-07-10 | **Statut** : Accepté

## Contexte

Les routes OpenCode passent déjà par `JwtAuth.middleware()` dans `packages/opencode/src/server/server.ts:43`. Le middleware accepte Bearer JWT, Basic Auth configurée et, pour les WebSockets, des tickets courts. Les routes d’observabilité ne doivent pas inventer une seconde autorité.

## Décision

- Réutiliser `JwtAuth.middleware()` pour toutes les routes d’observabilité.
- En mode local sans secret configuré, l’accès reste celui du serveur existant; les nouvelles routes ne prétendent pas fournir une isolation multi-utilisateur.
- Le serveur doit rester bindé en loopback par défaut; toute exposition distante doit conserver l’authentification existante et être explicitement opt-in.
- L’ownership est vérifié à partir des relations réelles session → project/workspace, jamais via `userIdHmac`.
- Un scope non accessible répond `404` non révélateur (ou `403` selon la convention locale vérifiée par les tests), sans divulguer l’existence d’un événement.
- Les filtres `sessionId`, `projectId`, `workspaceId` sont validés avant toute requête SQLite.

## Preuves de code

- `packages/opencode/src/server/server.ts:43` installe `JwtAuth.middleware()` sur le control plane.
- `packages/opencode/src/server/auth-jwt.ts:164-259` implémente Bearer JWT, Basic Auth et le rejet `401`.
- `packages/opencode/src/server/instance.ts:57-61` montre le routage réel des sessions/projets à réutiliser pour l’ownership.

## Conséquences

La Phase 1 n’ajoute pas de token parallèle. Un approfondissement sera requis si le serveur distant ou un modèle multi-workspace expose une frontière d’utilisateur plus fine.
