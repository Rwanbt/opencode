<!-- SPDX-License-Identifier: MIT -->
# Prompt autonome Claude — Unifia V3

## Mission

Tu reprends et termines, de A a Z, le plan directeur V3 Unifia WorkBench/OpenWork/OpenCowork. Travaille de facon autonome dans le worktree d execution, sans attendre de validation intermediaire, mais ne declares jamais une etape terminee sans preuve reproductible.

## Contexte et chemins

- Worktree autorise : D:\App\OpenCode\unifia-execution-clean
- Branche attendue : recovery/unifia-audit-correction-20260803
- Plan canonique : D:\Documents\Obsidian\IA_Dev_Brain\OpenCode\Plan-directeur-V3-Unifia-WorkBench-OpenWork-OpenCowork.md
- Handoff : D:\Documents\Obsidian\IA_Dev_Brain\OpenCode\Handoff-Hermes-Unifia-2026-08-03.md
- Memoire projet : D:\Documents\Obsidian\IA_Dev_Brain\OpenCode\_memory\memory.md
- Journal : D:\Documents\Obsidian\IA_Dev_Brain\LOG.md
- Depot source protege : D:\App\OpenCode\opencode ; ne pas le modifier.
- Clones Hermes/AI-Workspace : ne pas les modifier.

## Etat confirme au 2026-08-04

- Commits recents : cc21930, a94601e, b986905, f11094a, 4e6a6cc, bc94400.
- Typecheck monorepo : 20/20 packages reussis.
- Skill Hub : 8/8 checks reussis.
- CapabilityRegistry : 6/6 checks reussis.
- WorkbenchServer : 49/49 checks reussis.
- Generative UI : renderer allowliste, IDs stricts, filtrage des props et actions serveur injectees.
- Routes presentes : /v1/skill-hub/search, /install, /update et /v1/ui/render.
- Durcissements presents : digests artefact/README, payloads versionnes, signatures trustees obligatoires, sorties immuables, refus downgrade de trust, detection /ee par segments.
- Bundles de sauvegarde : D:\App\OpenCode\unifia-execution-clean-gate-c-recheck-2026-08-04.bundle et bundles generative-ui/security precedents.
- Obsidian a ete mis a jour, mais le handoff contient aussi quelques lignes historiques imparfaites : conserver leur historique et ajouter des corrections, ne pas reecrire destructivement.

## Gate C actuel

Gate C est NO-GO. Les manques confirmes sont : consommateur DOM reel et E2 externe pour Generative UI, transports MCP JSON-RPC/STDIO, OAuth/JWT et rate limiting, OpenDesign, Artifact Studio, audit securite externe, supply-chain, reliability soak, migrations no-breaking, demo 90 minutes et release hardening.

## Regles absolues

1. Lis le plan canonique, le handoff, AGENTS.md et le rapport Gate C avant toute modification.
2. Verifie branche, status, diff et bundles avant chaque lot.
3. Ne modifie jamais D:\App\OpenCode\opencode ni les clones Hermes.
4. Aucun code OpenWork /ee ne doit etre importe. Aucun remoteCode non explicitement audite.
5. Pas de force-push, pas de push, pas de merge stable sans autorisation explicite.
6. Chaque lot doit etre petit, buildable, teste et commite avec un message Conventional Commit.
7. Avant chaque commit non trivial : typecheck package concerne, tests concernes, git diff --check, puis bundle local.
8. Ne traite pas des tests de package comme une preuve de production. Distingue PASS local, PASS externe et NON PROUVE.
9. Toute action externe, secret, credential, audit tiers, appareil reel ou publication qui manque doit etre documentee comme blocage, jamais simulee.
10. Sauvegarde Obsidian apres chaque etape : handoff, memory.md, LOG.md et rapport pertinent avec frontmatter/wikilinks conformes.

## Execution demandee

### Phase 1 — Reprise et couverture

- Reconstruis l etat d autorite depuis le plan canonique, le handoff et les rapports.
- Produis un tableau des phases 0 a 18 : fait avec preuve, partiel, non fait, bloque externe.
- Verifie que le miroir du plan dans docs/autonomy reste coherent sans modifier le plan canonique par accident.

### Phase 2 — Fermer tout ce qui est executable localement

- Complete les contrats et adaptateurs manquants du plan, en priorite les interfaces publiques et ports encore absents.
- Ajoute les tests unitaires, integration, replay/golden et migrations pour chaque service ajoute.
- Integre les routes Workbench uniquement avec scope workspace, default-deny, audit et allowlists serveur.
- Ajoute les transports MCP necessaires en couche abstraite, avec tests de protocole, timeouts, cancellation, auth et rate limit. Ne branche aucun fournisseur externe sans provenance.
- Implémente les surfaces OpenDesign/Artifact Studio uniquement dans la base Unifia, sans copier du code proprietaire ou /ee.
- Ajoute les manifests, licences, checksums et rapports de supply-chain pour toute dependance.
- Ajoute les gates CI/release et les scripts de conformance reproductibles.

### Phase 3 — Validation et securite

- Lance typecheck monorepo, tests packages, conformance, audit licences, scan secrets/dependances, tests de regression capability et tests de scope.
- Verifie que toute sortie de registry est immuable, que les signatures couvrent les bons champs, que les digests sont calcules et que les downgrades trust sont refuses.
- Verifie qu aucune route ne permet execution arbitraire, HTML/JavaScript non allowliste, path traversal, cross-workspace access ou fail-open.
- Si un vrai DOM est ajoute, execute un E2 navigateur reel avec preuve capturee et comportement action->broker->audit.
- Si une preuve externe est impossible localement, marque-la NON PROUVEE et fournis le protocole exact a executer.

### Phase 4 — Sauvegarde et livraison

- Apres chaque lot : commit, bundle, mise a jour Obsidian, rapport de preuves.
- A la fin : status propre ou liste precise des modifications non commitees, log des commandes et resultats, tableau PASS/FAIL/NO-GO.
- Mets a jour Gate C seulement avec des preuves ; ne le passes GO que si tous les criteres du plan sont satisfaits.
- Cree une unique prochaine carte MiniMax ou humaine si un blocage externe reste ; elle doit contenir fichiers autorises, commandes, preuve attendue et STOP conditions.

## Format de compte-rendu final obligatoire

- Resume executif.
- Phases terminees avec commits et preuves.
- Phases restantes avec raison exacte.
- Gates PASS/FAIL/NO-GO.
- Fichiers modifies et depots proteges verifies intacts.
- Bundles et chemins Obsidian.
- Une seule prochaine action executable.

Commence maintenant dans le worktree autorise. Ne demande pas une confirmation pour les operations locales, reversibles et couvertes par ces regles. Arrete uniquement sur une autorite externe manquante, un risque destructif non autorise ou une preuve impossible, et documente alors le blocage dans Obsidian.

