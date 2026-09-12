<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

ADR-033 — Untrusted Code / Shell Security Review (LI-06)

Statut : CHANGES_REQUIRED_BEFORE_RATIFICATION
Date : 2026-09-02
Révision : 2026-09-03
Sources : ADR-009, ADR-019, ADR-023, ADR-024,
packages/contracts/src/connector.ts, docs/adr/0007-approval-broker.md

Status

La direction de sécurité est substrate-independent, mais le contrat antérieur
n'est pas ratifiable.

Important : 0007-approval-broker.md est actuellement PROPOSED, pas
DECIDED. ADR-033 dépend donc de son interface conceptuelle sans prétendre que
son contrat final est ratifié.

ADR-019 indique aussi que Code/Shell n'est pas dans la cible première
Automate Core × local-single-node × Windows. Aucun runtime shell GA avant
la gate LI-06.

Architecture

ExecutionIntent
  -> Provenance / taint analysis
  -> Policy Authority
  -> Capability Authority
  -> Approval Broker (si policy=require-approval)
  -> immutable ExecutionPlan + canonical digest
  -> Sandbox Driver (fail closed)
  -> FS / Network / Secret brokers
  -> bounded output streaming
  -> durable audit

Le workflow/LLM fournit une intention. Il ne décide jamais lui-même qu'une
approbation n'est pas nécessaire.

Intentions séparées

type ExecFileInvocation = {
  kind: "exec-file"
  executable: ArtifactRef | ToolRef
  args: readonly string[]
  stdin?: ArtifactRef | InlineText
}

type ShellScriptInvocation = {
  kind: "shell-script"
  interpreter: "sh" | "bash" | "powershell" | "cmd"
  script: ArtifactRef | InlineText
}

type WasmModuleInvocation = {
  kind: "wasm-module"
  module: ArtifactRef
  args: readonly string[]
}

Un module WASM n'est pas stocké en base64 dans command.

exec-file MUST être exécuté sans shell intermédiaire.
Les métacaractères dans argv restent des caractères littéraux et ne sont pas
blacklistés.

shell-script est une capability distincte, plus risquée, et sa policy
d'approbation est calculée en conséquence.

Sandbox

Le contrat expose une classe logique, pas une implémentation portable
imaginaire :

type SandboxClass = "os-sandbox" | "wasm"

Un backend OS spécifique résout os-sandbox.

Un futur backend microVM (ex. Firecracker) appartient au profil serveur Linux
et à un ADR dédié ; il n'est pas dans LI-06 initial ni dans le contrat
cross-platform.

Fail closed

Si le sandbox demandé n'est pas disponible ou ne peut pas prouver ses
invariants : SANDBOX_UNAVAILABLE / SANDBOX_INIT_FAILED.
Jamais de fallback vers un spawn non isolé.

Le superviseur hôte peut nécessiter des privilèges pour construire l'isolation,
mais le workload s'exécute non privilégié, sans ambient capabilities,
sans host filesystem et sans Docker socket.

Resource limits

Réutiliser/étendre un seul modèle commun au lieu de régresser par rapport à
connector.ts.

type ExecutionResourceLimits = {
  timeoutMs: number
  memoryMb: number
  cpuMs: number
  fds: number
  subprocesses: number
  diskBytes: number
  fileCount: number
  stdoutBytes: number
  stderrBytes: number
}

Le runtime impose ces limites pendant l'exécution.
Un .max() Zod sur la chaîne finale n'est pas un mécanisme de quota.

timeout / cancellation MUST tuer l'arbre de processus complet.

Filesystem

Aucun cwd libre ne constitue une frontière.

Le plan référence des grants du Filesystem Broker. La résolution se fait par
handles/canonicalisation sûre côté broker ; symlinks, junctions, reparse
points et TOCTOU doivent être couverts par les tests d'escape.

Host filesystem hors grants : indisponible.

Network

Pas de network: boolean.

Le plan référence une capability/grant compatible ADR-023 /
NetworkCapabilities. Absence de grant = deny all.

Toutes les connexions passent par la Network Authority ; aucun backend sandbox
ne peut ouvrir un chemin réseau parallèle.

Environment / secrets

L'environnement est explicite et auditable.

type EnvBinding =
  | { kind: "literal"; name: string; value: string }
  | { kind: "secret-ref"; name: string; secretRef: SecretRef }

aucun héritage ambiant par défaut ;

les secrets restent des SecretRef jusqu'au broker ;

aucun secret brut n'entre dans le digest public/audit public ;

la policy définit les noms autorisés ;

PATH et autres variables sensibles ne sont pas hérités implicitement.

Approval authority

requiresApproval est supprimé de l'intention utilisateur.

Policy Authority calcule :

"allow" | "deny" | "require-approval"

à partir de l'action, provenance/taint, capabilities, scope, principal et
policy.

Un workflow ou un LLM ne peut jamais s'auto-exempter.

Immutable ExecutionPlan

Après policy/capability resolution, le système crée un plan immuable contenant
au minimum :

intention normalisée ;

executable/module/script identity ;

argv ;

stdin digest/ref ;

filesystem grants ;

network grants ;

secret refs / env bindings ;

sandbox class + backend identity/version ;

resource limits ;

principal / workflowRunId / nodeId ;

policy decision + policy version ;

expiry / nonce si applicable.

Le plan est canonicalisé via ADR-001 puis digesté.

L'Approval Broker approuve ce digest complet.

Avant dispatch, le runtime recanonicalise/revérifie le plan.
Toute divergence => APPROVAL_STALE; aucune exécution.

Le remplacement du binaire/artifact après approbation doit également invalider
le plan via digest/content identity.

Output

stdout/stderr sont streamés avec limites en cours d'exécution.

Le résultat expose par exemple :

bytes observed ;

bytes retained ;

stdoutTruncated / stderrTruncated ;

digest du flux complet ;

exit code / signal ;

usage.

Les séquences de contrôle/ANSI non sûres sont neutralisées avant rendu UI.

Audit

Séparer :

audit metadata : IDs, digests, actor/principal, policy result, grants,
sandbox, usage, timestamps, terminal status ;

sensitive execution payload : commande/script/stdin/stdout/stderr,
chiffré, accès restreint, rétention explicite et redaction.

ADR-016 fixe actuellement 7 ans minimum pour l'audit log dans le cas
kernel natif. ADR-033 ne doit pas prétendre « 90 jours cf ADR-016 ».

Une éventuelle télémétrie détaillée 90 jours est une classe de données
différente et doit être nommée comme telle.

Error codes minimum

TIMEOUT
OOM
RESOURCE_LIMIT
NETWORK_DENIED
FILESYSTEM_DENIED
POLICY_DENIED
APPROVAL_DENIED
APPROVAL_STALE
SANDBOX_UNAVAILABLE
SANDBOX_INIT_FAILED
COMMAND_NOT_FOUND
PERMISSION_DENIED
OUTPUT_LIMIT
ARTIFACT_CHANGED
PROCESS_TREE_KILL_FAILED

Security gates

Avant LI-06 GA :

host filesystem escape = 0

symlink/junction/reparse escape = 0

network bypass = 0

ambient secret leak = 0

Capability bypass = 0

Secret Broker bypass = 0

orphan process = 0

fork/process bomb stopped

fd/file/output quotas enforced

timeout/cancel kills process tree

approval TOCTOU = 0

executable/artifact replacement after approval rejected

sandbox unavailable => fail closed

workflow/LLM auto-exemption approval = impossible

unsafe terminal control output neutralized

Gating

Contrat : pas DECIDED avant tests de contrat négatifs.

Runtime : post-ADR-019 reopening for a Code/Shell profile.

Aucun subprocess « simple » ne peut être livré comme raccourci.
