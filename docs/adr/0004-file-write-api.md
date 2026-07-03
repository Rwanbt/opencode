# ADR-0004 : API d'écriture fichier pour l'éditeur humain (Phase 1 IDE)

**Date** : 2026-06-19 | **Statut** : Accepté

## Contexte

Le fork OpenCode mobile devient un IDE Android (roadmap dual-mode Agent ⇄ IDE,
Phase 1). Le `File` namespace (`packages/opencode/src/file/index.ts`) est
read-only : `init/status/read/list/mkdir/search`. Pour qu'un humain édite et
sauve un fichier, il faut une API d'écriture exposée par HTTP.

Les outils agent (`write`/`edit`/`apply_patch`) écrivent déjà sur disque, mais
leur modèle de conflit (`FileTime`) est **keyed par session agent** : il stocke
les read-times côté serveur par session. Un éditeur humain n'est pas une session
agent ; appliquer `FileTime` tel quel imposerait des pseudo-sessions et de
l'état serveur par buffer ouvert.

Cible prioritaire = Android, où les fichiers vivent souvent sur `/sdcard` via un
mount FUSE : `mtime` y est peu fiable et granulaire à la seconde.

Contrainte fork (ADR-0003) : `file/index.ts` et `routes/file.ts` sont des
fichiers upstream core. Les modifications doivent être entourées de
`// FORK: … // END FORK` et minimales.

## Décision

Ajouter au `File` namespace les fonctions `write` / `rename` / `move` / `delete`,
exposées par `POST /file/write`, `POST /file/rename`, `POST /file/move`,
`DELETE /file`.

**Périmètre 1a (CMT-1)** : `write` / `rename` / `move` / `delete` — text-only.
Le **format-on-save quitte 1a** : il n'a de sens qu'avec la reconciliation de
buffer de l'éditeur (PR 1b), et `Format.file` ne *throw* pas (best-effort,
réécrit en place) — sa gestion correcte appartient au consommateur frontend.

1. **Modèle de conflit = hash de contenu, stateless.** Le client envoie le
   `sha256` des octets qu'il a lus (`expectedHash`). `File.write` prend le verrou
   par fichier (`FileTime.withLock`), relit le disque, hashe, compare ; rejette
   `409` si mismatch, sinon écrit. Retourne un stamp `{hash, mtime, size}`.
   `expectedHash` absent ⇒ création autorisée **seulement si le fichier n'existe
   pas** (sur fichier existant : rejet — pas d'écrasement aveugle).
   `rename` / `move` / `delete` portent eux aussi un `expectedHash` **source**
   optionnel (sinon on peut supprimer/déplacer une version périmée).

2. **Read brut pour le round-trip.** `File.read` applique `s.trim()` (pour
   l'affichage/diff) : un client qui hashe « ce qu'il a lu » ne hasherait pas les
   octets disque. L'éditeur lit donc en mode **raw** (sans trim) ; le hash porte
   sur les octets exacts.

3. **Écriture atomique.** Écrire dans un fichier temporaire du même répertoire,
   `fsync`, puis `rename` atomique (intra-FS POSIX) — jamais de fichier tronqué
   sur crash / kill Android / sdcard plein / FUSE détaché. `FileTime.withLock`
   ne sérialise *que* dans ce process ; le hash est le garde **cross-process**,
   le temp+rename le garde **anti-corruption**.

4. **Sécurité réutilisée + durcie.** `assertInsideProject` + `AppFileSystem.resolve`
   sur **chaque** chemin (source ET destination). Pour un fichier **neuf** sous un
   dossier symlinké, résoudre le **parent existant** (pas le chemin textuel) —
   sinon `project/link/new.ts` avec `link`→dehors échappe. Aucun nouveau check
   conceptuel, mais résolution parent-aware.

5. **Erreurs typées (jamais d'`Error` nue → 500).** Le middleware mappe
   `NamedError`/`HTTPException` : conflit → `HTTPException(409)`, escape →
   `HTTPException(403)`, absent → `NotFoundError(404)`, payload invalide → zod
   `400`. `content` doit être texte (refus explicite binaire/base64).

6. **Events par opération.** `write` → `Updated{change|add}` + `File.Event.Edited`.
   `delete` → `Updated{unlink}`. `rename`/`move` → `Updated{unlink old}` +
   `Updated{add new}`. `LSP.touchFile` sur ancien ET nouveau chemin. Pas de
   `Edited` générique unique.

7. **rename/move** partagent un `move(from,to)` interne, lockent source+dest en
   **ordre canonique** (anti-deadlock) ; le refus de clobber est **best-effort**
   (POSIX `rename(2)` écrase ; pas de no-clobber atomique cross-platform en
   Node/Bun — documenté). `delete` d'un fichier inexistant → `404` explicite.

## Alternatives rejetées

- **Conflit via `mtime`+`size`** (comme `FileTime.assert`) : `mtime` non fiable
  sur FUSE/sdcard Android + granularité seconde → peut rater un conflit → perte
  silencieuse. Rejeté sur la cible prioritaire.
- **Réutiliser `FileTime` avec une session synthétique** : couple l'éditeur à la
  sémantique agent, impose de l'état serveur par buffer ouvert. Rejeté.
- **Format-on-save dans 1a** : `Format.file` ne throw pas et réécrit en place ;
  sa gestion correcte exige la reconciliation de buffer de l'éditeur. Déplacé en
  1b (CMT-1, outside voice codex).
- **Écriture directe non atomique** : risque de fichier tronqué sur erreur disque
  Android. Rejeté au profit de temp+fsync+rename.
- **No-clobber atomique** : pas de primitive cross-platform en Node/Bun
  (`renameat2 RENAME_NOREPLACE` Linux-only). Refus de clobber = best-effort
  documenté.

## Conséquences

- ✅ Détection de conflit robuste sur la cible mobile, sans état serveur.
- ✅ Aucune perte de données : écriture atomique (temp+fsync+rename).
- ✅ Backend 1a (write+rename+move+delete, text-only) testable seul (`bun test`),
  shippable avant toute UI.
- ✅ Erreurs HTTP typées → l'éditeur distingue conflit / escape / absent.
- ⚠️ Une lecture + un hash supplémentaires par save (négligeable, fichiers
  petits ; gros fichiers en read-only).
- ⚠️ Édition de `file/index.ts` + `routes/file.ts` (upstream) → blocs `// FORK:`
  requis, surface de merge upstream légèrement accrue.
- ⚠️ Refus de clobber best-effort (limite POSIX), à documenter pour l'UI 1b.
- ➡️ Format-on-save + reconciliation de buffer = PR 1b (avec l'éditeur CM6).
