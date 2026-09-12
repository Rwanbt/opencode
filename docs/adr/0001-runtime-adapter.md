---
id: 0001
title: RuntimeAdapter
status: PROPOSED
date: 2026-07-31
---

# ADR-0001: RuntimeAdapter OpenCode vs Unifia

**Statut :** `PROPOSED`
**Date :** 2026-07-31
**Décideurs :** Erwan, Hermes Agent (MiniMax M3)
**Source :** Plan V3 §7.1

## Contexte

Le fork Unifia doit pouvoir fonctionner avec **deux runtimes agentiques** pendant la transition :
1. **OpenCode runtime** (legacy) — le runtime actuel du fork `Rwanbt/unifia`
2. **Unifia runtime** (cible) — le nouveau runtime à construire (Phase 2+)

L'UI (Shell Unifia, app) doit être **runtime-agnostique** : elle ne doit pas savoir si elle parle à OpenCode ou Unifia.

## Décision

Nous adoptons le pattern **RuntimeAdapter** (port + adaptateur) avec **3 implémentations** :

```typescript
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

**Implémentations** :
1. `OpenCodeRuntimeAdapter` — wraps le runtime OpenCode existant (compat ascendante)
2. `UnifiaRuntimeAdapter` — wraps le nouveau runtime Unifia (cible)
3. `FakeRuntimeAdapter` — pour les tests, déterministe, sans I/O

**Sélection** : via une **variable d'environnement** ou un champ de config `runtime: "opencode" | "unifia" | "fake"`.

## Conséquences

### Positives
- ✅ **Compatibilité ascendante** : les utilisateurs existants gardent OpenCode
- ✅ **Migration progressive** : on peut basculer de OpenCode à Unifia par config
- ✅ **Tests** : FakeRuntime permet les tests sans dépendances externes
- ✅ **Découplage** : l'UI ne dépend pas du runtime

### Négatives
- ❌ **Complexité** : 3 implémentations à maintenir
- ❌ **Divergence des features** : certaines features d'Unifia ne seront pas dispo dans OpenCode
- ❌ **Testing matrix** : 3 × N cas de test à valider

### Neutres
- Le `UnifiaRuntimeAdapter` sera vide jusqu'à Phase 2 (construction du runtime Unifia)

## Alternatives considérées

### A. Un seul runtime (Unifia remplace OpenCode immédiatement)
- **Rejeté** : casse la compatibilité des utilisateurs existants, projet trop gros pour Phase 0-1

### B. Fork simple d'OpenCode avec renames
- **Rejeté** : le Plan V3 §0 dit explicitement "aucun module importé ne conserve sa propre autorité parallèle" — il faut un vrai runtime Unifia, pas un fork cosmétique

### C. Plugin runtime (OpenCode chargeable comme plugin Unifia)
- **Rejeté** : couplage trop fort, ne respecte pas le principe d'autorité unique

## Plan d'implémentation

- **Phase 1** : interfaces TypeScript dans `packages/contracts/`
- **Phase 1** : FakeRuntimeAdapter pour les tests
- **Phase 2** : OpenCodeRuntimeAdapter (wraps l'existant, peu de code)
- **Phase 2+** : UnifiaRuntimeAdapter (construit pendant Phase 2-4)

## Liens

- Plan V3 §5 (Autorités uniques)
- Plan V3 §7.1 (RuntimeAdapter)
- Plan V3 §8.2 (Runtime unique — règle)
- ADR-0002 (WorkspacePort) — sibling contract
- ADR-0003 (CapabilityPort) — sibling contract