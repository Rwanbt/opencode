---
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Unifia contributors
id: KNOW-0007
title: NativeKnowledgePort — TS/Rust split, bounded
status: ACCEPTED
date: 2026-08-29
sources:
  - plan gelé §22 (NativeKnowledgePort)
  - runbook V2 §8.4, §23 (All native calls are bounded)
---

# ADR-KNOW-0007 — NativeKnowledgePort

## Contexte

Le Knowledge Core V1 a des exigences de performance (FTS5,
graph, embeddings) et de sécurité (atomic write, WAL,
recovery) qui ne sont pas idiomatiques en TypeScript. Le code
doit vivre en Rust. Mais Rust ne doit pas devenir le cerveau
du système : la policy, le ContextRouter, l'orchestration
agent, la destination provider et le budget tokens restent
TypeScript.

Le risque est double :

1. **Trop de logique en Rust** : un bug Rust devient un blocage
   pour le produit, et la frontière entre les deux couches
   s'estompe.
2. **Trop peu de garde-fous Rust → TS** : un payload non borné
   fait exploser la mémoire du sidecar ou freeze le thread
   principal.

## Décision

L'interface `NativeKnowledgePort` est l'unique surface
Rust → TS du Knowledge Core. Elle est définie en
`@unifia/contracts/knowledge/native-knowledge-port.ts` et
implémentée en Rust dans
`crates/unifia-knowledge-core/src/port/`.

Méthodes (toutes async, toutes typées, toutes bornées) :

```ts
interface NativeKnowledgePort {
  retrieve(request: RetrievalRequest): Promise<RetrievalResponse>
  get(request: GetKnowledgeRequest): Promise<GetKnowledgeResponse>
  backlinks(request: BacklinkRequest): Promise<BacklinkResponse>
  executeMutation(intent: MutationIntent): Promise<MutationResult>
  startAdminTask(task: AdminTask): Promise<AdminTaskHandle>
  cancelAdminTask(id: string): Promise<void>
  subscribe(options: SubscribeOptions): AsyncIterable<KnowledgeEvent>
}
```

**Bornes obligatoires** (par défaut, configurables) :

- `retrieve` : `maxCandidates = 50`, `maxPayloadBytes = 1 MiB`,
  `maxSnippetBytes = 64 KiB`, `deadlineMs = 2_000` (desktop) /
  `4_000` (Android).
- `get` : `maxBytes = 1 MiB`, `deadlineMs = 2_000`.
- `backlinks` : `limit = 256`, `cursor` optionnel, `deadlineMs = 2_000`.
- `subscribe` : `maxEventBytes = 32 KiB`, `maxEventsPerInterval =
  100`, `coalescing = true`.

**Transport** : on réutilise le transport Tauri existant
(`invoke`/`tauri::command`) lorsque c'est possible. On n'invente
pas un second canal IPC. Sur le sidecar HTTP (mode dev / web),
l'interface est transport-agnostique : un adapter HTTP borné
est fourni.

**Erreurs** : toutes les erreurs Rust sont sérialisées via
`thiserror` côté Rust et un schéma Zod `.strict()` côté TS. Pas
de panic Rust qui traverse la frontière ; tout panic est
capturé en `KnowledgeError.Internal` avec contexte.

**Cancellation** : chaque appel porte un `AbortSignal` ; le
côté Rust vérifie le signal à chaque `await` interne et
libère les ressources avant de répondre.

**Pas de singleton** : le port est injecté, owner identifiable.
Le bootstrap se fait dans `packages/unifia/src/knowledge/index.ts`
qui compose les adaptateurs.

## Alternatives rejetées

- **Tout en TS** : impossible pour FTS5 performant, graph
  >10k nœuds, embeddings sur Android.
- **Tout en Rust** : viole la séparation des responsabilités,
  complique le ContextRouter et la policy, complique
  l'orchestration agent.
- **Un bus IPC custom (par exemple Cap'n Proto, protobuf)** :
  complique la maintenance, duplique le transport Tauri.
- **Pas de bornes, "on verra"** : viole le principe P23
  (All native calls are bounded). Un payload non borné est un
  crash latent.

## Conséquences

- Les phases 2.x implémentent le port en Rust, avec un
  test `crates/unifia-knowledge-core/tests/port_bounds.rs`
  qui assert 4 cas : oversized, timeout, cancellation, error
  serialization.
- Les phases 1.x implémentent les *types* du port en
  `@unifia/contracts/knowledge/`, sans aucune logique
  métier (les types sont des `interface` et des `Zod
  schema`).
- Le bridge Tauri est dans
  `packages/unifia/src/knowledge/native/transport.ts`. Aucun
  autre module ne peut appeler Rust directement.
- Android : le port fonctionne en `WASM` ou via Tauri command,
  selon les benchmarks Phase 0.2.

## Validation

- Phase 0.2 (spike NativeKnowledgePort) prouve les 4 cas.
- Phase 2.1 livre le crate et le transport.
- `E-06` du DoD teste le port borné.
