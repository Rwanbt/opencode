# Plan directeur V3 — Unifia Workbench

> **Objet :** intégrer les meilleurs éléments d’OpenWork et d’Open Cowork dans une architecture conçue dès le départ pour Unifia.  
> **Date de référence :** 20 juillet 2026  
> **Statut :** proposition d’architecture et feuille de route production-ready  
> **Remplace :** « Plan directeur V2 — OpenCode Fusion production-ready »

---

# 0. Verdict exécutif

L’intuition produit est bonne :

```text
OpenWork
+ Open Cowork
+ le runtime OpenCode enrichi
= une base très forte pour Unifia
```

En revanche, la stratégie suivante est déconseillée :

```text
1. fusionner entièrement OpenWork et Open Cowork ;
2. stabiliser une troisième application autonome ;
3. tenter ensuite de l’intégrer à Unifia.
```

Cette approche créerait temporairement plusieurs autorités concurrentes pour :

- les sessions ;
- les providers et modèles ;
- la boucle agentique ;
- les tools ;
- les permissions ;
- les secrets ;
- la mémoire ;
- les workspaces ;
- les MCP ;
- le stockage ;
- le packaging desktop.

Le coût principal ne serait pas la fusion initiale, mais la suppression ultérieure de tous ces doublons.

## Décision recommandée

Construire directement une architecture cible Unifia, tout en permettant au nouveau Workbench de fonctionner temporairement avec OpenCode upstream grâce à un adaptateur.

```text
Unifia Core
= unique runtime agentique, provider, session et tool authority

Unifia Workbench
= workspace, collaboration, artefacts, documents, browser,
  computer use, remote control et expérience Cowork

Unifia Capability Packs
= skills, MCP, connecteurs, renderers et automatisations isolées
```

## Choix de base

- **OpenWork est le donneur structurel principal** :
  - serveur indépendant du desktop ;
  - orchestrateur ;
  - intégration OpenCode ;
  - multi-workspace ;
  - clients distants ;
  - partage de capabilities ;
  - file sessions ;
  - architecture plus modulaire.

- **Open Cowork est le donneur fonctionnel principal** :
  - skills DOCX/PPTX/XLSX/PDF ;
  - sandbox WSL2/Lima ;
  - computer use ;
  - contrôle distant Slack/Feishu ;
  - UX de trace et de permissions ;
  - workflows bureautiques prêts à l’emploi.

- **Unifia reste l’unique source de vérité** pour :
  - le runtime agentique ;
  - les sessions ;
  - les providers ;
  - les tools ;
  - les permissions ;
  - les secrets ;
  - la mémoire ;
  - l’audit.

---

# 1. Positionnement produit cible

## 1.1 Nom

```text
Unifia
```

Sous-surfaces recommandées :

```text
Unifia Code      — développement logiciel et agents de code
Unifia Work      — fichiers, documents, recherche et collaboration
Unifia Design    — design systems, composants et artefacts visuels
Unifia Automate  — workflows, tâches récurrentes et connecteurs
```

Nom technique du projet d’intégration :

```text
Unifia Workbench
```

## 1.2 Positionnement

```text
Unifia est un environnement agentique local-first, multi-modèle et extensible
qui unifie le développement logiciel, les fichiers, les documents, les
applications, les artefacts et les workflows sous un même runtime sécurisé.
```

## 1.3 Objectif du Workbench

```text
Unifia Workbench
= OpenWork workspace/orchestration model
+ Open Cowork document/computer-use capabilities
+ Unifia runtime, policy, memory and tools
```

Le Workbench ne doit pas devenir un deuxième moteur agentique.

---

# 2. Pourquoi ne pas fusionner les deux dépôts intégralement

## 2.1 Doublons fonctionnels

Open Cowork possède déjà ses propres composants de :

- configuration ;
- base de données ;
- sessions ;
- mémoire ;
- skills ;
- tool execution ;
- agent runner ;
- IPC Electron.

OpenWork possède de son côté :

- un desktop ;
- un serveur ;
- un orchestrateur ;
- un routeur multi-workspace ;
- des types partagés ;
- des packages MCP et UI ;
- une couche de capabilities ;
- une intégration directe à OpenCode.

Une fusion par copie de fichiers produirait un produit à plusieurs cœurs.

## 2.2 Risque d’enfermement dans Electron

Les deux projets possèdent un desktop Electron, mais Unifia ne doit pas faire dépendre son domaine métier de l’IPC Electron.

Les capacités doivent être accessibles depuis :

- l’application desktop ;
- le CLI ;
- le mobile ;
- un serveur local ;
- une session distante ;
- un client MCP ;
- des tests headless.

## 2.3 Risque de migration tardive

Toute API créée uniquement pour faire communiquer OpenWork et Open Cowork devrait ensuite être remplacée par les API Unifia.

La V3 inverse donc la logique :

```text
les contrats Unifia sont définis en premier ;
OpenWork et Open Cowork sont adaptés à ces contrats.
```

## 2.4 Risque de licence

Open Cowork est distribué sous MIT, sous réserve de vérifier les composants tiers.

OpenWork utilise :

- MIT pour le code hors `/ee` ;
- une licence Fair Source distincte dans `/ee`.

Conséquence :

```text
Aucun code de /ee ne doit être importé dans Unifia
sans analyse juridique et décision de licence explicite.
```

Les fonctionnalités équivalentes doivent être :

- exclues ;
- obtenues sous une licence compatible ;
- ou réimplémentées proprement à partir d’une spécification fonctionnelle.

---

# 3. Matrice d’adoption

## 3.1 Éléments à reprendre d’OpenWork

| Domaine | Décision | Traitement |
|---|---|---|
| Server headless | Adopter | Adapter aux contrats Unifia |
| Orchestrator | Adopter | Remplacer le sidecar OpenCode par un RuntimeAdapter |
| Desktop shell | Inspirer/porter | Ne pas conserver deux shells |
| Multi-workspace router | Adopter | Brancher sur WorkspaceRuntime Unifia |
| File sessions | Adopter | Ajouter capabilities, quotas et audit |
| Remote client pairing | Adopter après audit | Jetons scopés et rotation |
| Capability discovery | Adopter | Registry Unifia comme autorité |
| Skills/plugins/MCP sharing | Adopter | Manifest Unifia typé |
| UI MCP | Adopter partiellement | Liste d’actions déclarative et limitée |
| OpenWork Den `/ee` | Exclure par défaut | Réimplémentation clean-room si nécessaire |

## 3.2 Éléments à reprendre d’Open Cowork

| Domaine | Décision | Traitement |
|---|---|---|
| Skills PPTX/DOCX/XLSX/PDF | Adopter en priorité | Convertir en Capability Packs |
| Sandbox WSL2/Lima | Porter après audit | Implémenter derrière SandboxPort |
| Computer use | Porter tardivement | Broker dédié, permissions critiques |
| Slack/Feishu remote control | Porter | RemoteTransport plugins |
| Trace Panel | Inspirer/porter | Alimenté par l’EventLog Unifia |
| Permission dialogs | Inspirer | ApprovalBroker unique |
| MCP transports | Comparer | Ne garder qu’une implémentation canonique |
| Agent runner | Ne pas reprendre | Unifia Core est l’autorité |
| Provider routing | Ne pas reprendre | Unifia Core est l’autorité |
| Session manager | Ne pas reprendre | Unifia Core est l’autorité |
| Memory manager | Ne pas reprendre tel quel | Migrer les idées utiles vers MemoryRuntime |
| Config store | Ne pas reprendre tel quel | Config versionnée Unifia |
| Electron IPC métier | Ne pas reprendre | Ports et API indépendants du shell |

## 3.3 Ce qui doit être réécrit plutôt que copié

- modèle de permissions ;
- stockage des secrets ;
- orchestration des approvals ;
- computer-use broker ;
- remote command authorization ;
- manifest de packages ;
- audit et observabilité ;
- migrations ;
- contrats runtime ;
- séparation UI/domaine ;
- intégration mobile.

---

# 4. Architecture cible

```text
┌───────────────────────────────────────────────────────────────────────┐
│                            UNIFIA SHELL                               │
│ Code │ Work │ Design │ Automate │ Mobile/Remote Client               │
├───────────────────────────────────────────────────────────────────────┤
│                         UNIFIA WORKBENCH                              │
│ Workspace UI │ Documents │ Artifacts │ Browser │ Computer Use        │
│ Remote Bridges │ Search │ Capability Hub │ Trace │ Approvals          │
├───────────────────────────────────────────────────────────────────────┤
│                         APPLICATION SERVICES                          │
│ WorkspaceRuntime │ ArtifactRuntime │ WorkflowRuntime │ MemoryRuntime  │
│ CapabilityRegistry │ RemoteRuntime │ DesktopAutomationBroker          │
├───────────────────────────────────────────────────────────────────────┤
│                           UNIFIA CORE                                 │
│ AgentRuntime │ SessionRuntime │ ToolRuntime │ ProviderRuntime         │
│ MCPRuntime │ ModelRouter │ ContextRuntime │ EventRuntime              │
├───────────────────────────────────────────────────────────────────────┤
│                      TRUST AND GOVERNANCE                             │
│ PolicyEngine │ ApprovalBroker │ SecretStore │ AuditRuntime            │
│ CapabilityEngine │ TaintTracker │ Quotas │ KillSwitches               │
├───────────────────────────────────────────────────────────────────────┤
│                       EXECUTION BACKENDS                              │
│ Native restricted │ Docker │ WSL2 │ Lima/Apple Container             │
│ Browser profile │ Document workers │ External MCP │ Local models      │
└───────────────────────────────────────────────────────────────────────┘
```

---

# 5. Autorités uniques

Un domaine ne peut avoir qu’un propriétaire canonique.

| Domaine | Autorité |
|---|---|
| Agent loop | Unifia Core |
| Providers et modèles | Unifia Core |
| Sessions | Unifia Core |
| Tools | Unifia Core |
| MCP client/runtime | Unifia Core |
| Workspace identity | WorkspaceRuntime |
| Fichiers et file sessions | WorkspaceRuntime |
| Artefacts | ArtifactRuntime |
| Mémoire | MemoryRuntime |
| Workflows | WorkflowRuntime |
| Skills/packages | CapabilityRegistry |
| Permissions | PolicyEngine |
| Approbations | ApprovalBroker |
| Secrets | SecretStore |
| Audit | AuditRuntime |
| Sandbox | SandboxBroker |
| Computer use | DesktopAutomationBroker |
| Remote commands | RemoteRuntime |

Règle :

```text
aucun module importé ne conserve sa propre autorité parallèle.
```

---

# 6. Topologie de dépôts recommandée

## 6.1 Étape initiale

Conserver deux dépôts afin de limiter les conflits avec OpenCode upstream :

```text
Rwanbt/unifia
  fork OpenCode
  runtime principal
  SDK et contrats canoniques
  UI d’intégration finale

Rwanbt/unifia-workbench
  serveur et orchestrateur adaptés
  document capabilities
  remote bridges
  sandbox backends
  computer-use broker
  tests de conformité
```

## 6.2 Intégration

Le Workbench communique avec Unifia par :

```text
@unifia/sdk
HTTP local versionné
SSE ou WebSocket pour les événements
MCP uniquement pour les capabilities destinées aux agents externes
```

## 6.3 Fusion de monorepo ultérieure

Le déplacement dans le monorepo Unifia ne doit intervenir qu’après :

- stabilisation des contrats ;
- tests de conformité ;
- validation des licences ;
- validation du build desktop ;
- validation du mobile ;
- réduction des conflits avec upstream OpenCode.

## 6.4 Structure cible possible

```text
unifia/
  apps/
    desktop/
    mobile/
    web/
    cli/
    workbench-server/
  packages/
    core/
    sdk/
    contracts/
    workspace-runtime/
    artifact-runtime/
    memory-runtime/
    workflow-runtime/
    policy-engine/
    approval-broker/
    capability-registry/
    sandbox-broker/
    document-capabilities/
    remote-bridges/
    computer-use/
    ui/
  capability-packs/
    docx/
    pptx/
    xlsx/
    pdf/
```

---

# 7. Contrats obligatoires avant portage

## 7.1 RuntimeAdapter

```ts
interface RuntimeAdapter {
  getInfo(): Promise<RuntimeInfo>
  listSessions(scope: WorkspaceScope): Promise<SessionSummary[]>
  createSession(input: CreateSessionInput): Promise<Session>
  sendPrompt(input: SendPromptInput): Promise<void>
  subscribeEvents(input: EventSubscription): AsyncIterable<RuntimeEvent>
  replyApproval(input: ApprovalReply): Promise<void>
  cancelSession(sessionId: string): Promise<void>
}
```

Implémentations initiales :

```text
OpenCodeRuntimeAdapter
UnifiaRuntimeAdapter
FakeRuntimeAdapter
```

## 7.2 WorkspacePort

```ts
interface WorkspacePort {
  register(input: RegisterWorkspaceInput): Promise<Workspace>
  open(id: WorkspaceId): Promise<WorkspaceHandle>
  read(session: FileSessionId, paths: string[]): Promise<FileReadResult[]>
  write(session: FileSessionId, writes: FileWrite[]): Promise<FileWriteResult[]>
  watch(session: FileSessionId): AsyncIterable<FileEvent>
  close(session: FileSessionId): Promise<void>
}
```

## 7.3 CapabilityPort

```ts
interface CapabilityPort {
  search(query: CapabilityQuery): Promise<CapabilityDescriptor[]>
  authorize(request: CapabilityRequest): Promise<AuthorizationDecision>
  execute(request: CapabilityExecutionRequest): Promise<CapabilityExecution>
  cancel(executionId: string): Promise<void>
}
```

## 7.4 ArtifactPort

```ts
interface ArtifactPort {
  create(input: ArtifactCreateInput): Promise<Artifact>
  version(input: ArtifactVersionInput): Promise<ArtifactVersion>
  render(input: ArtifactRenderInput): Promise<RenderResult>
  export(input: ArtifactExportInput): Promise<ExportResult>
}
```

## 7.5 SandboxPort

```ts
interface SandboxPort {
  inspect(): Promise<SandboxBackendInfo[]>
  prepare(policy: SandboxPolicy): Promise<SandboxHandle>
  execute(handle: SandboxHandle, request: ExecutionRequest): Promise<Execution>
  terminate(handle: SandboxHandle): Promise<void>
}
```

## 7.6 RemoteTransportPort

```ts
interface RemoteTransportPort {
  pair(input: PairingRequest): Promise<PairingSession>
  verify(envelope: RemoteEnvelope): Promise<RemoteIdentity>
  receive(): AsyncIterable<RemoteCommand>
  respond(input: RemoteResponse): Promise<void>
  revoke(identityId: string): Promise<void>
}
```

---

# 8. Principes non négociables

## 8.1 Pas de big-bang merge

Chaque capacité est intégrée verticalement :

```text
contrat
→ adaptateur
→ tests
→ policy
→ audit
→ UI
→ kill switch
```

## 8.2 Runtime unique

Open Cowork ne doit jamais lancer sa propre boucle agentique dans le produit final.

OpenWork ne doit pas embarquer un OpenCode parallèle lorsque le runtime Unifia est disponible.

## 8.3 Sécurité avant computer use

Le computer use ne peut pas être activé avant :

- ApprovalBroker ;
- PolicyEngine ;
- AuditRuntime ;
- screenshot redaction ;
- allowlist d’applications ;
- bouton d’arrêt d’urgence ;
- isolation des secrets ;
- tests d’injection visuelle ;
- replay protection.

## 8.4 Capability packs plutôt que logique codée dans l’UI

Les fonctions bureautiques deviennent des packages déclaratifs ou sandboxés :

```text
unifia.document.docx
unifia.document.pptx
unifia.document.xlsx
unifia.document.pdf
```

## 8.5 Compatibilité temporaire avec OpenCode upstream

Le Workbench doit pouvoir fonctionner avec :

```text
runtime = opencode
runtime = unifia
runtime = fake
```

Cela permet de développer les capacités sans bloquer le rebrand et la stabilisation du fork.

## 8.6 Provenance obligatoire

Tout code repris doit avoir :

- dépôt source ;
- commit source ;
- chemin source ;
- licence ;
- copyright ;
- modifications ;
- responsable de l’import.

## 8.7 Default deny

Les surfaces suivantes sont désactivées par défaut :

- computer use ;
- remote commands destructives ;
- agent terminal control ;
- agent browser control ;
- lifecycle hooks ;
- remote code packages ;
- accès global aux fichiers ;
- lecture de secrets ;
- réseau arbitraire.

---

# 9. Roadmap officielle V3

```text
Phase -2 — Audit licences et provenance
Phase -1 — Audit comparatif des trois codebases
Phase 0  — Rebrand Unifia, gouvernance et stratégie upstream
Phase 1  — CI, tests, builds et harness multi-runtime
Phase 2  — Contrats Unifia et adaptateurs de compatibilité
Phase 3  — Security foundation, capabilities et ApprovalBroker
Phase 4  — WorkspaceRuntime, stockage et migrations
Phase 5  — Extraction OpenWork : serveur, orchestrateur et multi-workspace
Phase 6  — Extraction Open Cowork : documents et artefacts bureautiques
Gate A   — Workbench headless stable
Phase 7  — Shell Unifia et expérience Code/Work
Phase 8  — SandboxBroker multi-backend
Phase 9  — Remote bridges contrôlés
Phase 10 — Browser et Computer Use contrôlés
Gate B   — Cowork local-first sécurisé
Phase 11 — Spec-driven development et OpenDesign
Phase 12 — Artifact Studio
Phase 13 — Memory et session intelligence
Phase 14 — Workflow automation
Phase 15 — Skill Hub et Marketplace
Phase 16 — MCP UI Control et Generative UI
Gate C   — Plateforme extensible stabilisée
Phase 17 — Release hardening
Phase 18 — Release publique
Phase 19 — Modules stratégiques post-production
```

---

# 10. Phase -2 — Audit licences et provenance

## Objectif

Déterminer précisément ce qui peut être repris, modifié, redistribué et rebrandé.

## Livrables

- `LICENSE-AUDIT-UNIFIA.md`
- `THIRD-PARTY-NOTICES.md`
- `UPSTREAM-PROVENANCE.md`
- `UPSTREAM-SOURCES.lock.json`
- matrice fichier → origine → licence ;
- liste des composants exclus ;
- modèle d’en-tête d’attribution ;
- procédure d’import.

## TODO

- Auditer la licence du fork OpenCode.
- Auditer OpenWork hors `/ee`.
- Auditer séparément OpenWork `/ee`.
- Exclure `/ee` de tout import automatisé.
- Auditer Open Cowork et ses assets.
- Auditer les skills DOCX/PPTX/XLSX/PDF.
- Auditer les binaires téléchargés.
- Auditer les scripts Python et Node embarqués.
- Auditer les modèles de prompt et fichiers de skills tiers.
- Vérifier les obligations de notice.
- Définir une procédure clean-room.
- Ajouter un scanner empêchant l’import accidentel de chemins interdits.
- Ajouter un contrôle CI des fichiers sans provenance.

## Critères de sortie

- 100 % des fichiers importés ont une provenance.
- Aucun fichier `/ee` n’est présent.
- Les notices sont générées dans les artefacts de release.
- Les licences incompatibles sont bloquées en CI.
- Les dépendances binaires sont répertoriées.

## Estimation

```text
Solo : 3 à 7 jours
Avec revue juridique externe : 1 à 3 semaines calendaires
```

---

# 11. Phase -1 — Audit comparatif des trois codebases

## Objectif

Vérifier le code réel de :

```text
Unifia/OpenCode fork
OpenWork
Open Cowork
```

et produire une matrice de convergence.

## Livrables

- `TRI-REPO-ARCHITECTURE-INVENTORY.md`
- `FEATURE-OWNERSHIP-MATRIX.md`
- `DUPLICATION-MATRIX.md`
- `PORTABILITY-ASSESSMENT.md`
- `SECURITY-GAP-MATRIX.md`
- `IMPORT-CANDIDATES.md`
- `DO-NOT-IMPORT.md`

## Axes d’audit

### Runtime

- sessions ;
- événements ;
- prompts ;
- providers ;
- tools ;
- MCP ;
- permissions ;
- annulation ;
- reprise ;
- coûts.

### Workspace

- identity ;
- storage ;
- watchers ;
- file sessions ;
- multi-workspace ;
- remote access ;
- migrations.

### Desktop

- Electron/Tauri boundaries ;
- IPC ;
- preload ;
- sandbox renderer ;
- update ;
- packaging ;
- deep links ;
- protocol handlers.

### Cowork

- documents ;
- artifacts ;
- browser ;
- GUI automation ;
- remote bridges ;
- trace ;
- memory ;
- skills.

### Qualité

- tests ;
- CI ;
- fichiers surdimensionnés ;
- dépendances ;
- dead code ;
- performance ;
- sécurité.

## Critères de sortie

- Chaque fonction a une autorité cible.
- Chaque module est classé :
  - adopter ;
  - adapter ;
  - réécrire ;
  - exclure ;
  - repousser.
- Les imports candidats sont liés à des commits précis.
- Aucun portage ne commence avant validation de cette matrice.

## Estimation

```text
Solo : 1 à 2 semaines
Équipe 2-3 : 3 à 7 jours
```

---

# 12. Phase 0 — Rebrand, gouvernance et stratégie upstream

## Objectif

Passer d’OpenCode Fusion à Unifia sans perdre la possibilité de suivre upstream.

## Livrables

- identité Unifia ;
- disclaimer non-affiliation ;
- `GOVERNANCE.md` ;
- `SECURITY.md` ;
- `CONTRIBUTING.md` ;
- `UPSTREAM-STRATEGY.md` ;
- conventions de nommage ;
- stratégie de migration config ;
- stratégie de branches.

## Stratégie Git

```text
upstream-opencode
upstream-openwork
upstream-open-cowork
origin-unifia
```

Branches possibles :

```text
upstream-sync/opencode
integration/workbench
integration/document-packs
integration/computer-use
release/*
```

## Règles d’import

- Importer des packages ciblés, pas les repos complets.
- Pinner chaque import à un commit.
- Conserver les notices.
- Maintenir les modifications sous forme de commits séparés.
- Générer un rapport de divergence upstream.
- Ne jamais synchroniser automatiquement une capacité dangereuse.
- Refaire les audits sécurité avant mise à jour majeure.

## Critères de sortie

- Le produit s’appelle Unifia.
- Le CLI et les configs possèdent une migration documentée.
- Les remotes upstream sont définis.
- Le processus d’import est reproductible.
- Aucun code fonctionnel majeur n’est encore fusionné.

## Estimation

```text
Solo : 3 à 7 jours
```

---

# 13. Phase 1 — CI, tests, builds et harness multi-runtime

## Objectif

Créer le harnais qui permettra de comparer OpenCode et Unifia sans régression.

## Livrables

- CI desktop/core/workbench ;
- lint/typecheck/tests ;
- FakeRuntime ;
- OpenCodeRuntimeAdapter test fixture ;
- conformance suite ;
- build smoke ;
- package smoke ;
- recording/replay ;
- fixtures de workspaces ;
- dependency scan ;
- SBOM initiale.

## Conformance suite

Les trois runtimes doivent réussir les scénarios :

- créer une session ;
- envoyer un prompt ;
- recevoir les événements ;
- demander une permission ;
- répondre à une permission ;
- annuler ;
- changer de workspace ;
- lire/écrire un artefact ;
- fermer proprement ;
- récupérer après crash.

## Critères de sortie

- CI verte.
- FakeRuntime déterministe.
- OpenCodeRuntimeAdapter passe la suite.
- Le Workbench peut démarrer sans UI.
- Les builds ne dépendent pas de secrets personnels.
- Les téléchargements de sidecars sont hashés.

## Estimation

```text
Solo : 1 à 2 semaines
Équipe 2-3 : 4 à 7 jours
```

---

# 14. Phase 2 — Contrats Unifia et adaptateurs

## Objectif

Stabiliser les limites entre Unifia Core et Workbench.

## Livrables

- `@unifia/contracts`
- `@unifia/sdk`
- `OpenCodeRuntimeAdapter`
- `UnifiaRuntimeAdapter`
- `FakeRuntimeAdapter`
- version negotiation ;
- OpenAPI ou schéma RPC ;
- SSE/WebSocket event protocol ;
- compatibility matrix.

## TODO

- Définir les types d’ID.
- Définir le modèle d’événements.
- Définir la reprise après déconnexion.
- Définir l’idempotence.
- Définir les erreurs stables.
- Définir les timeouts.
- Définir le backpressure.
- Définir l’annulation.
- Définir le versioning.
- Définir la redaction.
- Ajouter contract tests.
- Ajouter fuzz tests du protocole.
- Ajouter compatibilité N-1.

## Critères de sortie

- L’UI n’importe pas directement le cœur.
- Le Workbench fonctionne avec OpenCode ou Unifia.
- Les événements sont rejouables.
- Les erreurs sont typées.
- Le protocole refuse les versions incompatibles.

## Estimation

```text
Solo : 2 à 4 semaines
Équipe 2-3 : 1 à 2 semaines
```

---

# 15. Phase 3 — Security foundation, capabilities et ApprovalBroker

## Objectif

Installer la gouvernance avant l’import des surfaces Cowork.

## Livrables

- `THREAT-MODEL.md`
- `PolicyEngine`
- `CapabilityEngine`
- `ApprovalBroker`
- `AuditRuntime`
- `SecretStore`
- `TaintTracker` v0
- quotas ;
- kill switches ;
- security conformance suite.

## Capabilities minimales

```text
workspace.read[path]
workspace.write[path]
workspace.watch[path]
artifact.create[type]
artifact.export[type,path]
terminal.run[command-pattern]
network.request[host-pattern]
browser.navigate[host-pattern]
desktop.observe[app/window]
desktop.control[app/window/action]
remote.receive[transport/identity]
remote.respond[transport/identity]
secret.read[name]
package.install[id/publisher]
```

## Combinaisons critiques

```text
secret.read + network.request
desktop.control + secret.read
remote.receive + terminal.run
package.install + desktop.control
workspace.read[global] + network.request[*]
browser.cookies + network.request[*]
```

## Critères de sortie

- Default deny.
- Toute action sensible passe par PolicyEngine.
- Toute confirmation passe par ApprovalBroker.
- Toute action sensible est auditée.
- Les grants expirent et sont révocables.
- Les secrets sont redacted.
- Les combinaisons critiques sont bloquées ou confirmées JIT.

## Estimation

```text
Solo : 4 à 8 semaines
Équipe 2-3 : 2 à 4 semaines
```

---

# 16. Phase 4 — WorkspaceRuntime, stockage et migrations

## Objectif

Créer un workspace canonique avant de porter le serveur OpenWork.

## Modèle

```text
WorkspaceId
ProjectId
SessionId
FileSessionId
ArtifactId
CapabilityId
PolicyId
AuditEventId
RemoteIdentityId
```

## Livrables

- WorkspaceRuntime ;
- storage versionné ;
- transactions ;
- migrations ;
- crash recovery ;
- file sessions ;
- watchers ;
- inbox/outbox ;
- export/reset ;
- workspace health.

## Règles

- Tous les chemins passent par un resolver canonique.
- Les symlinks et junctions sont contrôlés.
- Les écritures sont transactionnelles lorsque possible.
- Les sessions distantes reçoivent un catalogue limité.
- Les quotas sont appliqués côté serveur.
- Les workspaces ne partagent ni cookies, ni mémoire, ni secrets par défaut.

## Critères de sortie

- 0 évasion de workspace dans la suite de sécurité.
- Migrations réversibles.
- Kill -9 sans corruption sur fixtures.
- File sessions courtes et révocables.
- Événements de fichiers ordonnés et reprenables.

## Estimation

```text
Solo : 3 à 6 semaines
Équipe 2-3 : 2 à 3 semaines
```

---

# 17. Phase 5 — Extraction OpenWork

## Objectif

Porter la structure utile d’OpenWork sans importer son autorité OpenCode.

## Modules prioritaires

```text
WorkbenchServer
WorkbenchOrchestrator
MultiWorkspaceRouter
RemotePairing
FileSessionAPI
CapabilityDiscovery
SharedTypes
```

## Adaptations obligatoires

- remplacer le lancement direct d’OpenCode par RuntimeAdapter ;
- remplacer les approvals internes par ApprovalBroker ;
- remplacer les chemins directs par WorkspaceRuntime ;
- remplacer les tokens génériques par des tokens scopés ;
- remplacer les logs par AuditRuntime + observabilité ;
- séparer le serveur du desktop ;
- supprimer toute dépendance à `/ee` ;
- rendre le sandbox injectable ;
- rendre le packaging reproductible.

## Critères de sortie

- Le serveur fonctionne headless.
- OpenCodeRuntimeAdapter passe les tests.
- UnifiaRuntimeAdapter passe les mêmes tests.
- Multi-workspace fonctionne sans relancer inutilement le cœur.
- Les file sessions sont permissionnées.
- Aucun code `/ee` n’est importé.
- Le desktop OpenWork n’est pas requis.

## Estimation

```text
Solo : 4 à 8 semaines
Équipe 2-3 : 2 à 4 semaines
```

---

# 18. Phase 6 — Extraction Open Cowork : documents et artefacts

## Objectif

Obtenir rapidement la valeur Cowork la moins dangereuse : produire des livrables.

## Capability Packs initiaux

```text
unifia.document.docx
unifia.document.pptx
unifia.document.xlsx
unifia.document.pdf
unifia.document.convert
unifia.document.inspect
```

## Architecture

Chaque pack contient :

```text
manifest typé
schéma d’input
schéma d’output
worker isolé
dépendances verrouillées
tests golden
limites de ressources
politique réseau
licence et provenance
```

## Règles

- Aucun pack ne parle directement au provider.
- Aucun pack ne possède sa propre session.
- Aucun pack n’accède aux secrets sans capability.
- Network off par défaut.
- Écriture uniquement dans un outbox autorisé.
- Les fichiers produits deviennent des ArtifactVersion.
- Les bibliothèques et templates sont inventoriés.

## Tests

- documents valides ;
- fichiers corrompus ;
- zip-slip ;
- path traversal ;
- bombes zip ;
- très gros documents ;
- images malformées ;
- formules tableur ;
- macros ;
- métadonnées sensibles ;
- reproductibilité partielle ;
- export/import round-trip.

## Critères de sortie

- Génération DOCX/PPTX/XLSX/PDF fonctionnelle.
- 100 % des sorties enregistrées comme artefacts.
- Aucun accès hors workspace.
- Aucun réseau non déclaré.
- Tests golden stables.
- Worker crash sans crash de l’application.

## Estimation

```text
Solo : 4 à 8 semaines
Équipe 2-3 : 2 à 4 semaines
```

---

# 19. Gate A — Workbench headless stable

## Conditions GO

- Licences et provenance validées.
- CI verte.
- Contrats versionnés.
- Fake/OpenCode/Unifia adapters conformes.
- PolicyEngine et ApprovalBroker actifs.
- WorkspaceRuntime stable.
- Serveur et orchestrateur headless.
- File sessions sûres.
- Documents et artefacts fonctionnels.
- Aucun code OpenWork `/ee`.
- Aucun deuxième runtime agentique.

## Conditions NO-GO

- Providers dupliqués.
- Sessions dupliquées.
- Permissions propres à un module importé.
- Path traversal ouvert.
- Sidecar non hashé.
- Fichier importé sans provenance.
- Worker document non isolé.

---

# 20. Phase 7 — Shell Unifia et expérience Code/Work

## Objectif

Intégrer le Workbench à l’expérience Unifia avant les capacités dangereuses.

## Navigation cible

```text
Code
Work
Design
Automate
```

## Fonctions Work V1

- workspace switcher ;
- chat/session ;
- fichiers ;
- recherche ;
- artefacts ;
- documents ;
- trace ;
- approvals ;
- activity log ;
- capability picker ;
- export.

## Règles UX

- Une session peut produire du code et des documents.
- Les artefacts sont partagés entre les modes.
- Les permissions utilisent le même langage visuel.
- Le changement de mode ne change pas de runtime.
- La provenance de chaque résultat est visible.
- Les actions destructives ont un preview.

## Critères de sortie

- Aucun deuxième desktop requis.
- Code et Work partagent les sessions.
- Un artefact créé dans Work s’ouvre dans Code/Design.
- Le shell reste utilisable sans réseau.
- Le mobile peut consommer les mêmes contrats en lecture.

## Estimation

```text
Solo : 4 à 8 semaines
Équipe 2-3 : 2 à 4 semaines
```

---

# 21. Phase 8 — SandboxBroker multi-backend

## Objectif

Unifier Docker/OpenWork et WSL2/Lima/Open Cowork derrière une politique unique.

## Backends

```text
native-restricted
docker
wsl2
lima
apple-container
remote-sandbox
```

## Sélection

La sélection dépend de :

- plateforme ;
- action ;
- niveau de risque ;
- outils requis ;
- coût de démarrage ;
- montage nécessaire ;
- politique utilisateur.

## Règles

- Aucun backend n’est considéré sûr uniquement par son nom.
- Les mounts sont allowlistés.
- Le workspace est monté avec le minimum de droits.
- Network off par défaut.
- Secrets injectés à la demande et retirés après usage.
- Les images sont pinées par digest.
- Les téléchargements sont hashés.
- Les processus ont CPU/RAM/durée limités.
- L’agent ne choisit pas seul un backend moins sûr.

## Critères de sortie

- Suite de conformité identique sur chaque backend.
- Aucune écriture hors mounts.
- Timeout et kill fiables.
- Logs redacted.
- Reprise propre après crash VM/container.
- Backend désactivable par kill switch.

## Estimation

```text
Solo : 4 à 8 semaines
Équipe 2-3 : 2 à 4 semaines
```

---

# 22. Phase 9 — Remote bridges contrôlés

## Objectif

Porter Slack et Feishu/Lark sous forme de transports, pas de runtimes.

## Architecture

```text
RemoteTransport
→ signature verification
→ pairing identity
→ command parser
→ PolicyEngine
→ ApprovalBroker local
→ RuntimeAdapter
→ response renderer
```

## Sécurité

- pairing local ;
- expiration ;
- rotation ;
- révocation ;
- signature de webhook ;
- anti-replay nonce/timestamp ;
- rate limiting ;
- allowlist de channels/users ;
- commandes lecture seule par défaut ;
- aucune clé dans les messages ;
- approval sur la machine hôte pour les actions sensibles ;
- pièces jointes isolées ;
- limitation de taille ;
- audit complet.

## Critères de sortie

- Une identité compromise est révoquée en moins d’une seconde localement.
- Un message rejoué est refusé.
- Une commande distante ne contourne jamais ApprovalBroker.
- Les transports peuvent être désactivés séparément.
- Les tokens sont stockés dans SecretStore.

## Estimation

```text
Solo : 3 à 6 semaines
Équipe 2-3 : 2 à 3 semaines
```

---

# 23. Phase 10 — Browser et Computer Use contrôlés

## Objectif

Apporter l’avantage principal d’Open Cowork sans donner un contrôle global implicite du poste.

## Séparation obligatoire

```text
BrowserAutomationBroker
DesktopObservationBroker
DesktopAutomationBroker
```

Observer n’implique pas contrôler.

## Browser

- profils isolés par workspace ;
- cookies isolés ;
- host allowlist ;
- download quarantine ;
- DOM snapshot ;
- screenshot ;
- navigation auditée ;
- formulaires sensibles détectés ;
- secrets non exposés au modèle par défaut.

## Desktop observation

- liste d’applications autorisées ;
- liste de fenêtres autorisées ;
- capture d’une fenêtre plutôt que de l’écran complet ;
- redaction OCR/vision des zones sensibles ;
- blocage password managers ;
- blocage fenêtres système critiques ;
- indicateur visuel permanent.

## Desktop control

- clic/saisie limités à une fenêtre autorisée ;
- rate limit ;
- max actions ;
- confirmation avant envoi/achat/suppression ;
- focus lock ;
- emergency stop global ;
- annulation clavier physique ;
- journal d’actions ;
- replay visuel optionnel ;
- pas d’élévation admin automatique.

## Critères de sortie

- Computer use off par défaut.
- Bouton d’arrêt testé.
- Aucun contrôle hors fenêtre autorisée.
- Password fields bloqués ou confirmés explicitement.
- Tests prompt injection visuelle.
- Tests clickjacking et changement de fenêtre.
- Tests de perte de focus.
- 100 % des actions enregistrées.

## Estimation

```text
Solo : 6 à 12 semaines
Équipe 2-3 : 3 à 6 semaines
```

---

# 24. Gate B — Cowork local-first sécurisé

## Conditions GO

- Workbench intégré dans Unifia.
- Documents stables.
- SandboxBroker stable.
- Remote bridges sûrs.
- Browser isolé.
- Computer use contrôlé.
- Emergency stop testé.
- Aucune fuite de secret.
- Aucune évasion de workspace.
- Audit complet.
- Toutes les surfaces ont un kill switch.

## Conditions NO-GO

- Computer use global.
- Remote commands en approval auto.
- Cookies partagés entre workspaces.
- Screenshot complet non redacted par défaut.
- Accès à un password manager.
- Backend native choisi silencieusement après échec de sandbox.
- Action financière ou publication sans confirmation.

---

# 25. Phase 11 — Spec-driven development et OpenDesign

Conserver l’objectif de la V2, avec renommage :

```text
.unifia/specs/
UNIFIA-DESIGN.md
```

## Ajouts V3

- Une spec peut cibler Code, Work, Design ou Automate.
- Les document packs peuvent consommer les design tokens.
- Les reviewers design produisent des ArtifactVersions.
- Les injections de règles sont visibles et auditables.
- Les specs peuvent déclarer les capabilities nécessaires.
- Une spec ne peut pas élargir les permissions du workspace.

## Estimation

```text
Solo : 4 à 8 semaines
```

---

# 26. Phase 12 — Artifact Studio

## Types prioritaires

```text
markdown
html
svg
json
table
image
pdf
docx
pptx
xlsx
design-tokens
component-preview
browser-capture
desktop-recording
```

## Ajouts V3

- artefacts bureautiques natifs ;
- provenance du capability pack ;
- diff sémantique DOCX/PPTX/XLSX lorsque possible ;
- preview sandboxée ;
- export vers outbox ;
- validation antivirus optionnelle ;
- metadata stripping ;
- lien à une action remote ou computer-use.

## Critères

- Chaque livrable Cowork est un artefact versionné.
- La source et les outils de génération sont visibles.
- Les previews ne déclenchent pas de macros/scripts.
- Les exports sont auditables.

## Estimation

```text
Solo : 4 à 8 semaines
```

---

# 27. Phase 13 — Memory et session intelligence

## Règle V3

Ne pas importer les stores mémoire OpenWork/Open Cowork comme autorités.

Créer une migration optionnelle vers MemoryRuntime.

## Ajouts

- source `openwork-import` ;
- source `open-cowork-import` ;
- inspection de provenance ;
- consentement avant promotion ;
- déduplication ;
- classification de sensibilité ;
- séparation code/work/personal ;
- aucune mémoire provenant d’un transport distant sans validation.

## Estimation

```text
Solo : 3 à 6 semaines
```

---

# 28. Phase 14 — Workflow automation

## Ajouts V3

Workflows initiaux :

```text
document-from-folder
weekly-project-report
code-review-to-presentation
research-to-brief
spreadsheet-analysis
remote-request-with-local-approval
browser-data-to-artifact
release-prep
```

Chaque step déclare :

- capability ;
- scope ;
- sandbox ;
- coût ;
- timeout ;
- retry ;
- output ;
- approval ;
- réversibilité.

## Estimation

```text
Solo : 4 à 8 semaines
```

---

# 29. Phase 15 — Skill Hub et Marketplace

## Catégories

```text
prompt-pack
document-pack
workflow-pack
renderer-pack
mcp-integration
remote-transport
sandbox-backend
provider-adapter
desktop-automation-adapter
```

## Ordre d’ouverture

```text
1. prompt/document/template packs
2. workflows déclaratifs
3. renderers sandboxés
4. MCP locaux signés
5. remote transports audités
6. code extensions signées
7. provider et desktop adapters après audit renforcé
```

## Règle de provenance

Les packages importés d’OpenWork/Open Cowork deviennent des packages Unifia normaux :

- manifest ;
- version ;
- hash ;
- signature ;
- permissions ;
- provenance ;
- tests ;
- kill switch.

## Estimation

```text
Solo : 5 à 10 semaines
```

---

# 30. Phase 16 — MCP UI Control et Generative UI

## Actions V1 autorisées

```text
workspace.open
workspace.switch
session.create
session.open
composer.setText
composer.send
artifact.open
artifact.create
capability.search
workflow.run
approval.show
```

## Actions critiques

```text
desktop.control
remote.pair
package.install
secret.read
terminal.run
browser.authenticate
policy.modify
```

Elles nécessitent :

- capability dédiée ;
- approval JIT ;
- audit ;
- confirmation visible ;
- interdiction aux UIs génératives non fiables.

## Estimation

```text
Solo : 3 à 6 semaines
```

---

# 31. Gate C — Plateforme extensible stabilisée

## Conditions GO

- Manifest typé.
- Registry canonique.
- Marketplace content-first.
- Packages importés traçables.
- UI actions déclaratives.
- Workflows reprenables.
- Mémoire visible et supprimable.
- Artefacts versionnés.
- Computer use et remote bridges restent révocables.
- Aucun P0/P1 sécurité.

---

# 32. Phase 17 — Release hardening

## Suites supplémentaires V3

### Runtime conformance

- OpenCode adapter ;
- Unifia adapter ;
- fake adapter ;
- N-1 protocol.

### Imported capability regression

- document packs ;
- sandbox backends ;
- remote transports ;
- computer use ;
- file sessions.

### Supply chain

- provenance completeness ;
- forbidden path `/ee` ;
- detached signatures ;
- hashes ;
- SBOM ;
- binary inventory ;
- reproducibility ;
- malicious update manifest.

### Security

- remote replay ;
- webhook forgery ;
- screenshot secret leakage ;
- visual prompt injection ;
- window focus swap ;
- symlink/junction escape ;
- zip-slip ;
- office macro handling ;
- sandbox fallback downgrade ;
- secret + network exfiltration ;
- package install escalation.

### Reliability

- crash orchestrator ;
- crash runtime ;
- crash worker document ;
- crash WSL2/Lima/Docker ;
- network interruption ;
- remote reconnect ;
- event replay ;
- workspace switch during execution.

## Estimation

```text
Solo : 4 à 8 semaines
Équipe 2-3 : 2 à 4 semaines
```

---

# 33. Phase 18 — Release publique

## Release channels

```text
Internal Preview
Private Alpha
Private Beta
Release Candidate
Stable
```

## Private Alpha

Inclut :

- Unifia Core ;
- Workbench ;
- documents ;
- artifacts ;
- workspace ;
- approvals.

Exclut par défaut :

- computer use ;
- remote destructive commands ;
- remote marketplace code.

## Private Beta

Ajoute :

- sandbox multi-backend ;
- remote read-only ;
- browser isolé ;
- computer use limité à des applications allowlistées.

## Stable

Nécessite :

- installers signés ;
- checksums ;
- SBOM ;
- notices ;
- rollback ;
- migration testée ;
- audit externe ciblé sur computer use et remote control.

---

# 34. Phase 19 — Modules post-production

- collaboration multi-utilisateur ;
- sync cloud optionnelle ;
- SSO/SAML/OIDC/SCIM réimplémenté hors `/ee` ;
- administration d’organisation ;
- connecteurs Google/Microsoft avancés ;
- mobile control complet ;
- scheduled cloud jobs ;
- marketplace payante ;
- Figma ;
- media orchestration ;
- browser fleet ;
- remote sandbox fleet ;
- enterprise policies.

Chaque module nécessite son RFC, son threat model et son audit de licence.

---

# 35. Kill switches obligatoires

```text
features.workbench.enabled
features.documentPacks.enabled
features.remoteBridges.enabled
features.remoteBridges.readOnly
features.remoteDestructiveActions.enabled
features.browser.enabled
features.browser.agentControl
features.computerUse.enabled
features.computerUse.observeOnly
features.computerUse.keyboard
features.computerUse.mouse
features.sandbox.nativeFallback
features.sandbox.wsl2
features.sandbox.lima
features.sandbox.docker
features.marketplace.enabled
features.marketplace.remoteCode
features.lifecycleHooks.enabled
features.memory.promptInjection
features.workflowAutomation.enabled
features.mcpUiControl.enabled
features.generativeUi.enabled
```

Règle :

```text
un échec de sandbox ne doit jamais activer silencieusement nativeFallback.
```

---

# 36. Stratégie de synchronisation upstream

## Fichier de verrouillage

```json
{
  "sources": [
    {
      "name": "openwork",
      "repository": "different-ai/openwork",
      "commit": "<sha>",
      "licenseScope": "MIT excluding /ee",
      "importedPaths": []
    },
    {
      "name": "open-cowork",
      "repository": "OpenCoworkAI/open-cowork",
      "commit": "<sha>",
      "licenseScope": "MIT subject to third-party audit",
      "importedPaths": []
    }
  ]
}
```

## Processus de mise à jour

```text
1. détecter une nouvelle version ;
2. générer le diff des chemins suivis ;
3. classifier sécurité/licence/feature ;
4. mettre à jour une branche isolée ;
5. exécuter la conformance suite ;
6. exécuter les tests de sécurité ;
7. revue humaine ;
8. fusion ciblée ;
9. mise à jour de provenance.
```

## Interdictions

- aucune mise à jour automatique de computer use ;
- aucune mise à jour automatique de sandbox ;
- aucune mise à jour automatique des scripts de téléchargement ;
- aucun import automatique depuis `/ee` ;
- aucune dépendance flottante pour les workers.

---

# 37. Risk register V3

| Risque | Niveau | Mitigation |
|---|---:|---|
| Fusion de trois runtimes | Critique | RuntimeAdapter et autorité unique |
| Import `/ee` incompatible | Critique | Scanner CI + provenance |
| Deux stores de sessions | Critique | SessionRuntime canonique |
| Deux systèmes de permissions | Critique | ApprovalBroker/PolicyEngine uniques |
| Open Cowork monolithique | Élevé | Extraction par capability |
| Divergence OpenCode upstream | Élevé | Contrats + adaptateur + sync isolée |
| Computer use détourné | Critique | Broker, allowlists, stop, audit |
| Remote command spoofing | Critique | Signature, anti-replay, pairing |
| Sandbox downgrade | Critique | Fail closed, pas de fallback silencieux |
| Documents malveillants | Élevé | Workers isolés, macros off, fuzz |
| Secret dans screenshot | Critique | Capture fenêtre + redaction |
| Cookie leakage | Élevé | Profils par workspace |
| Supply-chain package | Critique | Hash, signature, lockfile, SBOM |
| Installer trop lourd | Moyen | Assets à la demande et cache vérifié |
| Scope solo irréaliste | Élevé | Gates et releases verticales |
| Mobile divergent | Élevé | Contrats partagés, graceful degradation |
| UX trop complexe | Élevé | Modes progressifs et defaults sûrs |

---

# 38. Jalons verticaux recommandés

## Jalon 1 — Unifia Workbench Preview

```text
OpenCode/Unifia adapter
workspace
sessions
files
documents
artifacts
approvals
```

Valeur utilisateur :

> choisir un dossier, demander un rapport, récupérer un DOCX/PDF/PPTX sans quitter Unifia.

## Jalon 2 — Unifia Work Remote

```text
server
pairing
mobile/remote client
read-only remote commands
local approvals
```

Valeur utilisateur :

> suivre une tâche et demander une action depuis le téléphone sans exposer le poste.

## Jalon 3 — Unifia Browser

```text
browser profile
navigation
forms
downloads
artifacts
```

Valeur utilisateur :

> rechercher, collecter et transformer des informations Web dans un workspace isolé.

## Jalon 4 — Unifia Computer Use

```text
observe-only
allowlisted control
emergency stop
audit replay
```

Valeur utilisateur :

> automatiser progressivement une application desktop sans donner un contrôle global.

## Jalon 5 — Unifia Platform

```text
workflows
marketplace
memory
OpenDesign
generative UI
```

---

# 39. Estimation globale réaliste

Les estimations sont des ordres de grandeur, pas des engagements.

## Workbench Preview

```text
Solo expérimenté : 4 à 7 mois
Équipe 3 personnes : 2 à 4 mois
```

## Cowork sécurisé avec remote, sandbox et browser

```text
Solo expérimenté : 8 à 14 mois cumulés
Équipe 3-5 personnes : 4 à 8 mois
```

## Plateforme V3 production-ready complète

```text
Solo : 18 à 30 mois
Équipe 3-5 : 8 à 14 mois
```

Le computer use, la sécurité, le packaging multi-plateforme et la maintenance upstream expliquent l’essentiel de cette durée.

---

# 40. Définition production-ready V3

Unifia n’est pas production-ready parce qu’il contient les fonctions d’OpenWork et d’Open Cowork.

Il l’est uniquement si :

```text
1. Un seul runtime agentique existe.
2. Un seul système de sessions existe.
3. Un seul système de permissions existe.
4. Chaque import possède une provenance et une licence.
5. Aucun code /ee incompatible n’est distribué.
6. Les adapters OpenCode et Unifia passent la conformance suite.
7. Les documents sont produits dans des workers isolés.
8. Les remote commands sont signées, scopées et révocables.
9. Le computer use est désactivé par défaut et stoppable immédiatement.
10. Aucun fallback de sandbox dangereux n’est silencieux.
11. Les workspaces, cookies, secrets et mémoires sont isolés.
12. Toutes les actions sensibles sont auditées.
13. Tous les modules avancés ont un kill switch.
14. Les migrations et rollbacks sont testés.
15. Les releases sont signées, hashées et accompagnées d’une SBOM.
```

---

# 41. Ordre d’exécution résumé

```text
-2  Licences/provenance
-1  Audit tri-repo
 0  Rebrand/gouvernance/upstream
 1  CI et conformance harness
 2  Contrats et adapters
 3  Security/capabilities/approvals
 4  WorkspaceRuntime
 5  OpenWork server/orchestrator extraction
 6  Open Cowork document capabilities
 A  Workbench headless stable
 7  Shell Unifia Code/Work
 8  SandboxBroker
 9  Remote bridges
10  Browser/Computer Use
 B  Cowork sécurisé
11  Specs/OpenDesign
12  Artifact Studio
13  Memory
14  Workflows
15  Skill Hub/Marketplace
16  MCP UI/Generative UI
 C  Plateforme stabilisée
17  Hardening
18  Release publique
19  Modules post-production
```

---

# 42. Conclusion

La fusion est pertinente à condition de reformuler l’objectif.

La mauvaise question serait :

> Comment fusionner entièrement OpenWork et Open Cowork avant de les intégrer à Unifia ?

La bonne question est :

> Comment extraire les meilleures capacités d’OpenWork et d’Open Cowork derrière des contrats dont Unifia est déjà l’autorité ?

Décision finale :

```text
OpenWork fournit la charpente du Workbench.
Open Cowork fournit les capacités Cowork.
Unifia fournit le cœur, la sécurité, les données et l’identité produit.
```

Principe directeur :

> Unifia ne doit pas absorber deux applications. Il doit absorber des capacités, derrière des frontières stables, testées, permissionnées, auditables et remplaçables.
