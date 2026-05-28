# Lock Hierarchy — OpenCode

## Contexte TypeScript

OpenCode est un projet TypeScript/SolidJS. Il n'y a pas de mutex ou de locks système dans le sens C++/Rust.

Les "locks" fonctionnels sont des **patterns async** et des **états partagés réactifs** :

## Hiérarchie des états partagés (ordre de priorité)

```
Niveau 1 (Global)  : globalSDK.client (connexion HTTP au sidecar)
Niveau 2 (Sync)    : globalSync.data (état SSE synchronisé)
Niveau 3 (Layout)  : layout.projects, layout.sidebar (état UI)
Niveau 4 (Session) : session.store (état composant session)
Niveau 5 (Prompt)  : prompt.current() (état input utilisateur)
```

**Règle** : Ne jamais mettre à jour un état de niveau N depuis un callback qui observe un état de niveau N+1.

## Patterns de "lock" asynchrone

### setBusy pattern
```typescript
setBusy(directory, true)
try {
  await sdk.worktree.create(...)
} finally {
  setBusy(directory, false)
}
```

### Single-flight pattern (sidecar)
Le sidecar implémente `start.lock` (O_EXCL) pour empêcher les spawns concurrents du llama-server.

## Deadlocks connus

Aucun deadlock connu. Les composants SolidJS sont mono-threadés (JS event loop).

## Règle des effects

Un `createEffect` ne doit jamais modifier un signal qu'il observe (risque de boucle infinie). Utiliser `untrack()` pour les lectures non-réactives dans un effect.
