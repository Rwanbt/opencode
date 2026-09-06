<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# AUTOMATE TRUST PATH — UNIFIA AUTOMATE

> Statut : **EVIDENCE_MAPPING_PINNED**
> Phase : **PRE-0** (livrable §9 du plan)
> Date : 2026-09-01T15:55+02:00
> Source : `BASELINE.md` (même dossier), code sur disque au SHA
> `24b04998e2fd861711036501ad3f6e41a63f8c32`.

Ce document classe **chaque surface impliquée par Automate** dans l'une des
quatre catégories :

- `REQUIRED_UNCHANGED` — la surface est OK pour Automate, ne pas la modifier.
- `REQUIRED_TO_MIGRATE` — la surface doit être migrée pour devenir substrate-grade.
- `REQUIRED_TO_HARDEN` — la surface existe mais n'a pas la propriété attendue.
- `OUT_OF_PATH` — la surface n'est pas dans le chemin Automate, la noter sans
  la toucher.

Pour chaque surface :

```text
- path
- symbol
- current responsibility
- current trust level
- reachable milestone
- first production exposure
- security findings
- required remediation
- classification
```

**Règle de lecture** : `INFERRED` = lecture statique sans exécution ;
`MEASURED` = commande lancée et sortie observée ; `UNVERIFIED` = à vérifier
en PRE-1.

---

## A. Cœur durable (workflow / approval / execution)

### A.1 `packages/workflow-runtime` — moteur d'exécution

| Champ | Valeur |
|---|---|
| Path | `packages/workflow-runtime/src/index.ts` (91 lignes) |
| Symbol | `WorkflowRuntime`, `InMemoryWorkflowStore`, `FileWorkflowStore`, `WorkflowDefinition`, `WorkflowState`, `WorkflowStep` |
| Current responsibility | Exécuteur séquentiel de `WorkflowStep` avec persistance `Map` ou fichier `<root>/.unifia/workflows/<id>.json`. Validation, switch `isEngaged("workflow-automation")`, approval par step, save entre steps. |
| Current trust level | **INSUFFISANT** pour « durable execution substrate » au sens du plan §34-40. Pas de timer durable, pas de digest canonique, pas d'effet identity, pas de classes d'effet, pas de `UNKNOWN_EXTERNAL_STATE`, pas d'effet-slot, pas de fencing. |
| Reachable milestone | **M0 substrate proof** (plan §194) — spike `schedule → HTTP A → durable approval → HTTP B` avec redémarrages et killings. Le `WorkflowRuntime` actuel **ne peut pas** servir directement de substrate ; il peut servir de référence fonctionnelle pour le contrat observable. |
| First production exposure | **M1 — Durable Core** : si ADR-000 choisit un substrate externe, ce package devient un *adapter* ; si ADR-000 choisit un kernel natif, ce package est réécrit. Dans les deux cas, l'API publique (`WorkflowDefinition`/`WorkflowState`/`WorkflowRuntime`) doit être revue pour porter `durableAuthorityId`, `durableAuthorityKind`, `deploymentId`, `workflowVersionId`, `triggerId`, `triggerEventId` (plan §43). |
| Security findings | (i) Pas de canonicalisation de `WorkflowDefinition` (un `version: number`, pas un identifiant immuable). (ii) `requiresApproval` est par step, pas un *digest* d'effet (plan §118). (iii) Le `FileWorkflowStore` écrit en JSON sans atomicité forte contre corruption (rename after `wx` create — bon, mais pas de checksum par write). |
| Required remediation | ADR-000 (substrate), ADR-001 (canonicalisation), ADR-002 (WorkflowDefinition/Version/IR), ADR-004 (durable history authority). Tant qu'ADR-000 n'est pas rendu, ce package est en **DEFERRED_WITH_CONTAINMENT** : il ne doit pas être l'autorité durable d'un run Automate GA. |
| Classification | `REQUIRED_TO_MIGRATE` |

### A.2 `packages/workflow-catalog` — catalogue

| Champ | Valeur |
|---|---|
| Path | `packages/workflow-catalog/` (présent, taille package.json 523 octets) |
| Symbol | non inspecté dans ce tour |
| Current responsibility | **INFERRED** — catalogue de définitions / templates. Pas de source mesurée du contenu. |
| Current trust level | **INFERRED** — pas mesuré |
| Reachable milestone | **M1** — le catalogue doit supporter le contrat de définition versionnée issu d'ADR-002 et le digest issu d'ADR-001. |
| First production exposure | **M1 — Durable Core** : un catalogue qui mute silencieusement briserait l'invariant « WorkflowVersion publiée = immutable » (§46 du plan). |
| Security findings | à mesurer (taille du code, manifest, signature). |
| Required remediation | Lecture de la source en PRE-1. Si elle référence un `WorkflowDefinition` mutable, classification passe à `REQUIRED_TO_HARDEN`. Sinon `REQUIRED_TO_MIGRATE` par alignement ADR-001/002. |
| Classification | **`REQUIRED_TO_MIGRATE` (présomption, à confirmer en PRE-1)** |

### A.3 `packages/workbench-orchestrator` — routeur multi-workspace

| Champ | Valeur |
|---|---|
| Path | `packages/workbench-orchestrator/src/index.ts` (7 929 octets) |
| Symbol | `MultiWorkspaceRouter`, `WorkbenchOrchestrator`, `WorkspaceLease`, `WorkspaceLimitError`, `UnknownWorkspaceError` |
| Current responsibility | Routage d'un **runtime unique partagé** par `WorkspaceScope` (un seul `RuntimeAdapter`, pas de multiplication). Gère l'ouverture / fermeture d'espaces, limite, sessions par workspace. |
| Current trust level | Bon en isolation (le routeur n'autorise rien lui-même), mais c'est **un point de passage obligé** pour toute session : si une fuite de scope existe, elle fuit Automate. À vérifier sur l'assertion `session.workspaceId !== workspaceId` (ligne 67 mesurée). |
| Reachable milestone | **M1** — un orchestrateur stable est un prérequis pour qu'Automate lance des `WorkflowRun` rattachés au bon `DeploymentScope`. |
| First production exposure | **M1** — premier `WorkflowRun` Automate |
| Security findings | INFERRED — pas de re-test runtime dans ce tour. Le code commente explicitement « The router does not assume its runtime is well behaved » — c'est une bonne posture défensive, à valider. |
| Required remediation | Lecture complète + test ciblé : un workflow lancé depuis workspace A ne doit pas pouvoir écrire dans workspace B même si l'ID de session est forgé. |
| Classification | `REQUIRED_TO_HARDEN` (couplage obligatoire) |

### A.4 `packages/workbench-server` — serveur principal

| Champ | Valeur |
|---|---|
| Path | `packages/workbench-server/src/index.ts` (97 040 octets) |
| Symbol | serveur Hono + SSE ; importe `ApprovalBroker`, `ArtifactStore`, `WorkflowRuntime`, `parseSpec`, `resolveEffectiveCapabilities`, `SkillRegistry` |
| Current responsibility | Surface serveur unique ; expose `startWorkflow`, les routes d'approbation, les routes d'artefact, le wire workbench. |
| Current trust level | Gros point de passage. C'est ici que vit la chaîne « définition → exécution → side-effect → audit ». Toute faille ici est une faille Automate. |
| Reachable milestone | **M1** — doit être aligné sur les contrats ADR-001/002/004/005. |
| First production exposure | **M1** |
| Security findings | (i) Le volume (97 Ko dans un seul fichier) dépasse la cible ≤ 500 LOC par fichier et la cible warning > 800 LOC du CLAUDE.md. (ii) `auth.ts` (16 Ko) est séparé — bon. (iii) `bootstrap.ts` (14 Ko) est séparé — à inspecter. |
| Required remediation | (1) Découpage en sous-modules alignés sur les ADR. (2) Test ciblé de la traversée « définition → approval → execution » par capability. (3) Vérifier que la route `startWorkflow` ne contourne pas `Capability Authority`. |
| Classification | `REQUIRED_TO_HARDEN` |

### A.5 `packages/workbench-shell` — modes du shell

| Champ | Valeur |
|---|---|
| Path | `packages/workbench-shell/` (présent) |
| Symbol | `SHELL_MODES` exporté et importé par `packages/app/src/context/mode.tsx` |
| Current responsibility | Contrat des modes (`code / work / design / automate`). Ajout du mode `automate` au registre. |
| Current trust level | Bon — surface de registre pure, pas d'effet. |
| Reachable milestone | **M1** — doit rester compatible avec `SHELL_MODES` à 4 entrées (cf. note dans `mode.tsx:5`). |
| First production exposure | déjà exposé (rail) |
| Security findings | Le test `check-mode-registry` (cité dans le commentaire `mode.tsx:6`) doit couvrir l'ajout. **NON MESURÉ** dans ce tour. |
| Required remediation | Vérifier le test `check-mode-registry`. Si absent, créer. |
| Classification | `REQUIRED_UNCHANGED` (post-vérification registry test) |

---

## B. Capability / policy / secret

### B.1 `packages/capability-runtime` — signatures Ed25519

| Champ | Valeur |
|---|---|
| Path | `packages/capability-runtime/src/index.ts` |
| Symbol | `Ed25519ManifestVerifier`, `createSecureCapabilityRegistry`, `signCapabilityManifest` |
| Current responsibility | Signer et vérifier des `CapabilityManifest` Ed25519. |
| Current trust level | Bon pour la **vérification**, mais **n'enforce pas** : un manifest vérifié peut toujours être ignoré à l'exécution si l'enforcer est ailleurs. |
| Reachable milestone | **M1** + **Security Core Track** (§203) |
| First production exposure | **M1** |
| Security findings | (i) Pas de rotation de clé documentée (ADR-010 §78). (ii) Pas de `keyRef` typé pour désigner la clé (le constructeur prend `string | Buffer`, ce qui est trop large). |
| Required remediation | (1) Typage fort de la clé publique. (2) Rotation + révocation (ADR-010). (3) Vérifier que `createSecureCapabilityRegistry` est l'unique entrée de vérification côté serveur. |
| Classification | `REQUIRED_TO_HARDEN` |

### B.2 `packages/contracts/src/p3.ts` — registre de capabilities

| Champ | Valeur |
|---|---|
| Path | `packages/contracts/src/p3.ts` |
| Symbol | `P3_CAPABILITIES`, `P3Capability`, `P3Decision`, `ApprovalConfig`, `validateApprovalConfig` |
| Current responsibility | Source de vérité de la liste fermée des capabilities (20 entrées). Définit `validateApprovalConfig` (refuse `mode: "auto"`). |
| Current trust level | Bon comme **contrat**. Ne fait rien à l'exécution. |
| Reachable milestone | **M1** |
| First production exposure | déjà exposé |
| Security findings | (i) `global auto approval is forbidden` est une **garantie purement textuelle** — c'est un contrat, pas une garde. À renforcer côté Capability Authority (enforcer). (ii) Le tableau `P3_CAPABILITIES` ne couvre pas explicitement les capabilities MCP/connector (cf. §115). |
| Required remediation | (1) Vérifier qu'aucun consommateur ne crée un `CapabilityRegistry` qui n'utilise pas `createSecureCapabilityRegistry`. (2) Prévoir la table des `ConnectorManifest` / `MCP Tool Contract` distincte. |
| Classification | `REQUIRED_TO_HARDEN` (alignement enforcer) |

### B.3 Secret Broker / Key Authority

| Champ | Valeur |
|---|---|
| Path | non identifié dans ce tour (le plan cite un « Secret Broker » et un « Key Authority » mais aucun package `@unifia/secret-broker` ou `@unifia/key-authority` n'est listé) |
| Symbol | — |
| Current responsibility | **UNVERIFIED** — un Secret Broker n'a pas été trouvé comme package dédié. Le code côté workbench-server gère des `Principal` et des `ScopedToken` (`auth.ts`, 16 Ko) — c'est de l'authentification, pas du secret broker au sens du plan. |
| Current trust level | **INSUFFISANT** pour Automate. Le plan §123 exige `CredentialRef / SecretRef / OAuthConnectionRef / BrowserAuthProfileRef` ; ce qui existe est plus proche d'un token de session. |
| Reachable milestone | **M1** (clé en main pour ADR-010) |
| First production exposure | **M1** — un secret qui fuit en clair à l'IA ou à l'historique est un NO-GO immédiat (plan §238). |
| Security findings | À mesurer. Risque principal : absence d'un *broker* central, ce qui oblige chaque executor à réinventer sa propre sécurité de stockage. |
| Required remediation | ADR-010. Soit créer un `@unifia/secret-broker`, soit incorporer la responsabilité dans `workbench-server` de manière mesurable. |
| Classification | **`REQUIRED_TO_MIGRATE` (présomption forte, à confirmer en PRE-1)** |

### B.4 Approval Authority

| Champ | Valeur |
|---|---|
| Path | `packages/contracts/src/approval-broker.ts` + `packages/app/src/pages/workbench/design-approval.ts` + `packages/app/e2e/design/design-approval-journey.spec.ts` |
| Symbol | `ApprovalBroker`, `ApprovalRequestRecord`, modal UI Design |
| Current responsibility | Chaîne d'approbation bout-en-bout pour la surface Design. Test e2e « modal expiré » prouve : annulation avec `cancelApproval` au broker, re-demande, démontage à la navigation (SESSION-2 §4). |
| Current trust level | Bon pour la surface Design. Le mapping « approval bind l'effet exact » (§118-119) n'est pas vérifié statiquement. |
| Reachable milestone | **M1** — un validateur statique de graphe qui prouve que `approval` est dans la chaîne causale de l'effet (et pas dans une branche parallèle) est nécessaire pour ADR-001 / ADR-005. |
| First production exposure | **M1** |
| Security findings | (i) Pas de static binding. (ii) Pas de multi-party (`1-of-N`, `N-of-M`, `distinct principal`, `no self approval`, `expiry`, `revocation` — §120). |
| Required remediation | (1) Étendre la couverture du test e2e à la traçabilité « approval → effect ». (2) Étendre le contrat `ApprovalBroker` aux modes multi-party. |
| Classification | `REQUIRED_TO_HARDEN` |

---

## C. Storage / artifact

### C.1 `packages/artifact-runtime` — store d'artefacts

| Champ | Valeur |
|---|---|
| Path | `packages/artifact-runtime/` |
| Symbol | `ArtifactStore` (importé par `workbench-server/src/index.ts:5`) |
| Current responsibility | Persistance des artefacts. Interface seulement — l'implémentation est ailleurs. |
| Current trust level | Le **store est autoritaire** sur l'`ArtifactRecord` au sens du plan §68. Mais l'interface actuelle (présumée) ne porte pas `OwnershipScope` + `DeploymentScope` + `taints` + `classification` + `origin` + `retentionPolicy` + `protectionEnvelope`. |
| Reachable milestone | **M1** — ADR-005. |
| First production exposure | **M1** |
| Security findings | (i) Caller control sur la classification (§71) : si l'API actuelle laisse l'appelant fixer `classification`, c'est un NO-GO. (ii) Pas de `protectionEnvelope` au niveau record. (iii) Pas de séparation des domaines de chiffrement (§76). |
| Required remediation | (1) Refuser au caller la fixation de `classification`, `taint`, `ownership`, `environment` (§71). (2) Ajouter `protectionEnvelope` à l'enregistrement. (3) Domaine de chiffrement par classe d'artefact. |
| Classification | `REQUIRED_TO_HARDEN` |

### C.2 `packages/artifact-studio` — UI

| Champ | Valeur |
|---|---|
| Path | `packages/artifact-studio/` |
| Symbol | non inspecté dans ce tour |
| Current responsibility | **INFERRED** — UI de gestion d'artefacts. |
| Current trust level | UI pure. Le danger est si elle décide de la classification côté caller. |
| Reachable milestone | **M1** |
| First production exposure | UI déjà présente |
| Security findings | À mesurer — vérifier qu'elle n'envoie jamais `classification` au store. |
| Required remediation | Test ciblé : l'UI ne peut pas forcer une classification supérieure à celle du scope. |
| Classification | `REQUIRED_TO_HARDEN` (présomption) |

### C.3 `packages/artifact-render` — moteur de rendu

| Champ | Valeur |
|---|---|
| Path | `packages/artifact-render/` |
| Symbol | non inspecté dans ce tour |
| Current responsibility | **INFERRED** — rendu (SVG/HTML/iframe sandboxée) |
| Current trust level | Le rendu est un *consommateur* d'artefacts. S'il décide de la classification, c'est un problème ; s'il ne fait que lire, c'est un consommateur de confiance. |
| Reachable milestone | **M1** |
| First production exposure | déjà exposé (Design) |
| Security findings | À mesurer. |
| Required remediation | (1) Test : un artefact `untrusted_external` reste étiqueté tel jusqu'à declassification explicite. |
| Classification | `OUT_OF_PATH` pour Automate tant qu'aucun noeud `browser.*` ou `desktop.*` n'est exécuté dans un `WorkflowRun`. (Reclasser en `REQUIRED_TO_HARDEN` si un profile expose ces noeuds.) |

---

## D. Surfaces Browser / Computer Use / MCP

### D.1 `packages/browser-runtime`

| Champ | Valeur |
|---|---|
| Path | `packages/browser-runtime/` |
| Symbol | non inspecté dans ce tour |
| Current responsibility | Worker navigateur + canaux contrôlables. |
| Current trust level | **INFERRED** — pas mesuré. Les plans P19-P20 du chantier parité OpenDesign (cf. INDEX.md) ont introduit la première iframe sandboxée, mais le détail du runtime d'isolation n'est pas vérifié. |
| Reachable milestone | **Browser Track B1/B2** (§210-211) — profile Browser n'est PAS la première cible (la cible est `Automate Core × local-single-node`). |
| First production exposure | **post-M3** |
| Security findings | À mesurer (BrowserContext comme boundary réseau — §145 — c'est insuffisant, le plan l'interdit). |
| Required remediation | ADR-013 / ADR-024. Doit s'appuyer sur Network Authority + OS enforcement, pas seulement Playwright. |
| Classification | `OUT_OF_PATH` pour la première cible (Automate Core × local-single-node) |

### D.2 `packages/computer-use-safety`

| Champ | Valeur |
|---|---|
| Path | `packages/computer-use-safety/` |
| Symbol | non inspecté dans ce tour |
| Current responsibility | **INFERRED** — garde-fous Computer Use |
| Current trust level | **INFERRED** |
| Reachable milestone | post-M3 (Computer Use non exigé pour local GA) |
| First production exposure | post-M3 |
| Security findings | À mesurer |
| Required remediation | ADR-014. |
| Classification | `OUT_OF_PATH` |

### D.3 `packages/mcp-transport` + `packages/mcp-ui-actions`

| Champ | Valeur |
|---|---|
| Path | `packages/mcp-transport/`, `packages/mcp-ui-actions/` |
| Symbol | non inspecté en détail dans ce tour |
| Current responsibility | Transport MCP et UI actions |
| Current trust level | SESSION-2 confirme que la frontière MCP Design est revalidée (D5 REAL, A6 PARTIAL). Reste : l'enforcer côté Automate. |
| Reachable milestone | **M1** (premier run MCP dans un WorkflowRun) |
| First production exposure | **M1** |
| Security findings | (i) Pas de Network Authority explicite pour le transport MCP distant (§132). (ii) Pas de clean env garanti pour MCP stdio (§131). (iii) Pas de Capability Authority systématique. |
| Required remediation | (1) MCP distant doit traverser Network Authority + auth + schema + Capability + Policy. (2) MCP stdio local ne doit pas recevoir `process.env`, SSH agent, Git credentials, cloud credentials, user filesystem. |
| Classification | `REQUIRED_TO_HARDEN` |

---

## E. UI Automate

### E.1 `packages/app/src/pages/workbench/automate-surface.tsx`

| Champ | Valeur |
|---|---|
| Path | `packages/app/src/pages/workbench/automate-surface.tsx` (8 164 octets) |
| Symbol | `AutomateSurface`, `decodeFile` |
| Current responsibility | UI qui liste les définitions (TanStack Query sur `.unifia/workflows/`), charge la définition sélectionnée, appelle `client.startWorkflow(workspaceId, definition)`, gère le cas `approvalRequired`, déclenche un `WorkbenchChat`. |
| Current trust level | La surface est purement cliente. **Zéro test** (cf. BASELINE §7.1). |
| Reachable milestone | **M1** — la surface ne peut pas être certifiée sans suite e2e + tests unitaires. |
| First production exposure | déjà exposé (rail) |
| Security findings | (i) `decodeFile` traite les fichiers base64 — à encadrer par une capability, pas par un `atob` libre. (ii) Le parsing `JSON.parse(decodeFile(file))` est suivi d'une validation minimale (`typeof definition.id !== "string" || definition.version !== 1 || !Array.isArray(definition.steps)`) — c'est superficiel pour un contrat qui doit être canonique. (iii) Pas de test sur le cas « grant retiré pendant l'opération » (§16.3 gate 2). |
| Required remediation | (1) Au minimum, un test unitaire par fonction exportée. (2) Un e2e pour les 8 sorties du §16.3. (3) Validation de schéma avant `startWorkflow` (probablement un sous-ensemble de `parseSpec` ou un nouveau validateur `WorkflowIR`). |
| Classification | `REQUIRED_TO_HARDEN` (enforcement + tests) |

### E.2 `packages/app/src/context/mode.tsx` — visibilité du rail

| Champ | Valeur |
|---|---|
| Path | `packages/app/src/context/mode.tsx` (5 174 octets) |
| Symbol | `useMode`, `ModeContextProvider`, `automateAccessible`, `setAutomateAccessible` |
| Current responsibility | Le rail cache Automate sauf si `workflow.run` est dans le `grants` du workspace actif. Le grant est **poussé** par `AutomateGrantBridge` (monté sous `WorkspaceWorkbenchProvider`, dans `directory-layout.tsx`) depuis le `09f1329a8d` `[arch-change]`. |
| Current trust level | Bon. La réactivité est correcte (re-évalue sur changement de `grants`). Le commentaire ligne 5-25 est précis sur le pourquoi de l'architecture. |
| Reachable milestone | **M1** |
| First production exposure | déjà exposé (rail) |
| Security findings | Le correctif `09f1329a8d` est marqué `[arch-change]` et **non confirmé par l'utilisateur** (L1). Tant que ce n'est pas tranché, la lignée Design porte une modification de hiérarchie de providers non validée. C'est un **bloquant externe** : la décision sort du scope de l'agent. |
| Required remediation | (1) Décision utilisateur : confirmer ou `git revert 09f1329a8d`. (2) Si confirmé : ajouter un test ciblé pour le scenario « grant retiré pendant qu'Automate est monté ». |
| Classification | `REQUIRED_TO_HARDEN` (en attente de décision utilisateur) |

---

## F. Surfaces auxiliaires

### F.1 `packages/enterprise`

| Chemin | Valeur |
|---|---|
| Current responsibility | RBAC, environnements, promotion, GitOps, audit, retention, KMS externe |
| Current trust level | **INFERRED** — pas mesuré dans ce tour. |
| Reachable milestone | **Enterprise Track E1/E2/E3** (§214-216) — post-M3, hors cible première. |
| First production exposure | post-M3 |
| Security findings | Risque : si l'enterprise runtime devient **autorité durable** parallèle au workflow-runtime, c'est une violation §2 du plan. |
| Required remediation | ADR-000 doit explicitement rejeter le scénario « enterprise devient autorité durable ». ADR-020 (ownership/deployment scope) doit garantir que `WorkflowRun.durableAuthorityId` est du côté workflow-runtime (ou substrate), pas enterprise. |
| Classification | `REQUIRED_UNCHANGED` pour la cible première, `REQUIRED_TO_HARDEN` quand `Automate Enterprise` est exposé |

### F.2 `packages/runtime-conformance`

| Chemin | Valeur |
|---|---|
| Current responsibility | Suite de conformance (capabilities, contracts). |
| Current trust level | Bon comme suite. La couverture est à mesurer. |
| Reachable milestone | **M1** — la conformance doit couvrir les ADR. |
| First production exposure | déjà exposé |
| Security findings | à mesurer. |
| Required remediation | Étendre la conformance pour ADR-001 (digest), ADR-002 (IR), ADR-004 (history authority), ADR-005 (artifact). |
| Classification | `REQUIRED_TO_MIGRATE` |

### F.3 `packages/contracts` — types partagés

| Chemin | Valeur |
|---|---|
| Current responsibility | 6 ports du Plan V3 (RuntimeAdapter, WorkspacePort, CapabilityPort, ArtifactPort, SandboxPort, RemoteTransportPort) + P3 + wire protocol. |
| Current trust level | Bon. C'est la racine. |
| Reachable milestone | **M1** — doit absorber les nouveaux contrats ADR-001/002/004/005/010 sans casser les 6 ports existants. |
| First production exposure | déjà exposé |
| Security findings | (i) `p3.ts` rejette `mode: "auto"` pour `ApprovalConfig` — c'est une garde textuelle, à renforcer côté serveur. |
| Required remediation | (1) Ajouter les types `WorkflowDefinition`/`WorkflowVersion`/`WorkflowRun` alignés §43. (2) Ajouter `DigestEnvelope`, `ArtifactRef`, `ArtifactRecord` alignés §64/§67/§68. (3) Ajouter `AtRestProtectionEnvelope` aligné §74. |
| Classification | `REQUIRED_TO_MIGRATE` |

### F.4 `packages/spec-runtime`

| Chemin | Valeur |
|---|---|
| Current responsibility | `parseSpec`, `resolveEffectiveCapabilities` (importé par `workbench-server/src/index.ts:7`) |
| Current trust level | **INFERRED** — pas mesuré dans ce tour. La fonction est centrale : c'est le validateur d'entrée d'un `WorkflowDefinition`. |
| Reachable milestone | **M1** |
| First production exposure | déjà exposé |
| Security findings | Risque : si le `Spec` est faiblement validé, on peut faire passer un `WorkflowDefinition` malformé. |
| Required remediation | (1) Vérifier que la validation rejette toute `WorkflowDefinition` non conforme au schéma ADR-002. (2) Test ciblé. |
| Classification | `REQUIRED_TO_HARDEN` |

---

## G. Synthèse par catégorie

### G.1 `REQUIRED_UNCHANGED`

| Surface | Pourquoi |
|---|---|
| `workbench-shell` | contrat de registre 4 modes, pas d'effet |

### G.2 `REQUIRED_TO_MIGRATE`

| Surface | Trigger ADR |
|---|---|
| `workflow-runtime` | ADR-000 (substrate) |
| `workflow-catalog` (présomption) | ADR-001, ADR-002 |
| Secret Broker / Key Authority (à identifier) | ADR-010 |
| `runtime-conformance` | ADR-001/002/004/005 |
| `contracts` | ADR-001/002/004/005/010 |

### G.3 `REQUIRED_TO_HARDEN`

| Surface | Action |
|---|---|
| `workbench-orchestrator` | test d'isolation scope |
| `workbench-server` | découpage + traversée capability |
| `capability-runtime` | rotation de clé, typage fort |
| `contracts/src/p3.ts` | enforcer côté serveur |
| `ApprovalBroker` | static binding + multi-party |
| `artifact-runtime` | protection envelope + caller-control |
| `artifact-studio` (présomption) | test caller-control |
| `mcp-transport` + `mcp-ui-actions` | Network Authority + clean env |
| `automate-surface.tsx` | suite unitaire + e2e (les 8 gates §16.3) |
| `mode.tsx` (rail Automate) | test grant retiré en cours |
| `spec-runtime` | validation stricte ADR-002 |

### G.4 `OUT_OF_PATH` (pour Automate Core × local-single-node)

| Surface | Pourquoi |
|---|---|
| `browser-runtime` | profile Browser, post-M3 |
| `computer-use-safety` | profile Computer Use, post-M3 |
| `artifact-render` | consommateur seulement (pas d'autorité) |
| `enterprise` | profile Enterprise, post-M3 |
| `desktop-runtime` | profile Desktop, post-M3 |
| `memory-runtime` | mémoire long-terme, hors chemin Automate V2.3.1 |
| `desktop`, `desktop-electron`, `mobile`, `web`, `console` | shells, pas durable kernel |
| `app` | consommateur UI |
| `unifia` | sidecar CLI |
| `ui`, `util`, `sdk`, `sdk-shared` | helpers / SDK public |
| `skill-hub` | catalogue de skills Design, hors runtime durable Automate |
| `slack`, `function`, `containers`, `document-packs` | domaine ad-hoc, à investiguer en PRE-1 |

### G.5 `ABSENT_NO_ACTION` (par décision §18 du plan)

| Surface | Statut |
|---|---|
| `workbench-sdk` | ABSENT — le client est généré par TanStack Query contre le wire workbench |
| `workbench-contracts` | ABSENT — fusionné dans `contracts` (`workbench-wire` subpath) |
| `workbench-core` | ABSENT — pas de module « core » à part l'orchestrator |
| `artifact-store` | ABSENT — store dans `artifact-runtime` |

---

## H. Trou d'autorité durable

**Constat agrégé** : aucun package du dépôt, à l'instant de l'inventaire, ne
satisfait les invariants du plan §1 (« un WorkflowRun possède exactement une
seule autorité durable »), §2 (« pas de double autorité »), §34-40 (substrate
candidats : Native / DBOS / Restate / Temporal). Le `WorkflowRuntime` actuel
est trop limité pour être ce substrate.

**Conséquence** : ADR-000 est **non-bypassable** avant tout M1. Aucun code
durable Automate ne peut être écrit avant qu'ADR-000 ait tranché.

**Décision à prendre** : la résolution d'ADR-000 (substrate) décidera si
`workflow-runtime` est réécrit en kernel natif, ou devient adapter d'un
substrate externe, ou est déprécié au profit d'un autre package.

---

## I. Suite

1. `RISK_REGISTER.md` — findings hors chemin, par surface.
2. Décision PRE-0 finale.
3. Si PRE-0 = GO, démarrer PRE-1 (`PACKAGE_MIGRATION_MAP.md`).
