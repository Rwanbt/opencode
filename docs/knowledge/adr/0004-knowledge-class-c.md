---
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Unifia contributors
id: KNOW-0004
title: Class C — Local control state (jamais Git, jamais vault)
status: ACCEPTED
date: 2026-08-29
sources:
  - plan gelé §11 (Class C — Local Control State)
  - runbook V2 §8.1
---

# ADR-KNOW-0004 — Class C Local Control State

## Contexte

Une partie de l'état Knowledge doit être **strictement local** à la
machine : device_id, workspace IDs, PolicyGrants, EgressGrants,
MCP grants, locks, mutation WAL, control event log, local UI
state. Si cet état fuite dans Git ou dans le vault, la sécurité
du Sovereign Core s'effondre : un attaquant qui accède au
repository pourrait extraire tous les grants, et un commit
accidentel pourrait pousser des tokens ou des chemins absolus
vers un remote public.

## Décision

La **Class C** est stockée dans les **données applicatives OS**
(équivalent de `%LOCALAPPDATA%\com.unifia.knowledge\` sur Windows,
`~/.local/share/unifia/knowledge/` sur Linux,
`~/Library/Application Support/Unifia/knowledge/` sur macOS). Elle
est **strictement exclue** de Git (via `.gitignore` global et
`safe.directory` rules) et **strictement exclue** du vault
(`.unifia/` racine du vault est Class B, pas C ; Class C est à
côté de l'app, pas dans le vault).

Contenu de Class C :

- `device_id` : UUIDv7 généré au premier lancement, persistant
  jusqu'à réinitialisation explicite par l'utilisateur.
- `policy_grants.json` : PolicyGrants actifs, signés par le
  device_id.
- `egress_grants.json` : EgressGrants (qui peut envoyer quoi où),
  one-shot liés au hash et à la destination.
- `mcp_grants.json` : tokens MCP scopés au workspace, révocables.
- `mutation_wal/` : journal append-only des mutations de
  Class A et B (avant fsync + ack), purgé après ack réussi.
- `control_event_log/` : événements domain (`session.started`,
  `file.changed`, etc.) avec retention configurable.
- `locks/` : verrous inter-process.
- `local_ui_state/` : dernier contexte UI, restauration de
  session.
- `cache/` : caches non-durables (FTS5 en mémoire, embeddings
  récents).

## Alternatives rejetées

- **Stocker Class C dans le vault** : fuit dans Git, viole P6
  "Permissions Never Travel".
- **Stocker Class C dans `~/.unifia/config.json`** : mélange
  configuration et état, complique le GC, complique la
  rotation de device_id.
- **Stocker Class C dans un dossier `dotfile` à la racine du
  repo** : même problème Git.

## Conséquences

- `.gitignore` global exclut automatiquement
  `%LOCALAPPDATA%\com.unifia.knowledge\` et l'équivalent
  Unix/macOS.
- `knowledge doctor` refuse de scanner Class C et émet un
  avertissement si une trace Class C est trouvée dans le vault
  ou dans Git.
- Le transfer d'un device à un autre **n'inclut pas** la
  Class C ; l'utilisateur doit re-promoouvoir ses PolicyGrants
  sur le nouveau device. C'est une garantie de sécurité, pas
  un bug.
- La Class C est sauvegardable par l'OS (Time Machine,
  Windows Backup) mais jamais synchronisée par Unifia.
- `device_id` est révocable par un menu "Réinitialiser ce
  device" dans l'UI, qui wipe Class C et force un nouveau
  device_id.

## Validation

- Phase 2.5 livre `crates/unifia-knowledge-core/src/control_store/`
  avec un test
  `crates/unifia-knowledge-core/tests/control_store_isolation.rs`
  qui assert que Class C n'apparaît jamais dans le vault ni
  dans un commit Git simulé.
