<!-- SPDX-License-Identifier: MIT -->
# Gate B — Cowork local-first sécurisé

Date : 2026-08-03
Base : `recovery/unifia-audit-correction-20260803`

## Verdict

**NO-GO — vérification partielle, aucune promotion effectuée.**

## Evidence

| Condition | État | Preuve | Manque |
|---|---|---|---|
| Workbench intégré | PARTIEL | `WorkbenchServer: 19/19`, routes Browser/Desktop | driver OS réel |
| Documents stables | GO local | `DocumentPackRegistry: 6/6`, golden hashes | validation CI distante |
| Sandbox stable | PARTIEL | `SandboxBroker: 4/4`, conformance 4/4 | drivers process réels |
| Remote bridges sûrs | PARTIEL | Slack/Feishu 5/5, anti-rejeu, allowlists | ingress persistant Feishu |
| Browser isolé | GO local | Playwright E2E 4/4, profils, allowlist, redaction | intégration production complète |
| Computer use contrôlé | PARTIEL | broker allowlist + routes + capability gate | driver OS réel |
| Emergency stop | PARTIEL | `KillSwitchRegistry` testé | test d’arrêt sur driver actif |
| Fuite de secret | PARTIEL | SecretStore scoped/TTL | audit runtime complet |
| Évasion workspace | GO local | workspace tokens + broker allowlists | test multi-process |
| Audit complet | PARTIEL | AuditRuntime + audits server/remote | couverture de toutes surfaces |
| Kill switches surfaces | PARTIEL | remote/browser/computer-use/document/workflow/marketplace registry | branchement de toutes surfaces |

## Conditions NO-GO encore actives

- Computer use réel non branché.
- Emergency stop non vérifié sur une session active réelle.
- Drivers Sandbox process non implémentés.
- Ingress Feishu persistant non raccordé au Worker.
- Gates CI/distantes et release non réalisées.

## Prochaine carte

Implémenter un driver Desktop OS injectable avec backend Windows borné, arrêt d’urgence testé, et garder l’action sensible derrière `desktop.control` + approval JIT.
