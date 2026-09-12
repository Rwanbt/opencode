# P5-C500 — OpenWork extraction

**Statut :** `INTEGRATED` (design documenté, dépend de BD-2)
**Date :** 2026-08-01
**Parent :** P5-C500 (OpenWork extraction)

## Objectif

Extraire et intégrer les **fonctionnalités OpenWork** utiles (BD-2 resolved) dans Unifia, en respectant la licence MIT.

## BD-2 Statut

3 choix possibles pour `packages/enterprise/` :
- **A** : Delete (simplify, no OpenWork)
- **B** : Rename `enterprise → unifia-pro` (preserve, rebrand)
- **C** : Preserve as-is (no rebrand, future split)

**Recommandation** : Choix B si fonctionnel, sinon A.

## Fonctionnalités OpenWork cibles

- **Multi-tenant** : workspace isolation (si présent)
- **SSO** : SAML, OIDC (si présent)
- **Audit logging** : enterprise-grade (compatible avec P3-C300-D)
- **Quotas** : per-user resource limits
- **Billing** : Stripe integration (si présent)

## Plan

1. Auditer `packages/enterprise/` (4h)
2. Identifier les fonctionnalités MIT-compatibles
3. Renommer en `packages/unifia-pro/`
4. Rebrander les imports
5. Tests

## Estimation

- Audit : 4h
- Rename : 8h
- Rebrand : 16h
- Tests : 8h
- **Total : 36h (1 semaine)**

## Liens

- [BD-2 resolution](../docs/autonomy/BLOCKED-DECISIONS.md)
- [DO-NOT-IMPORT.md](../DO-NOT-IMPORT.md)
- [LICENSE-AUDIT-UNIFIA.md](../LICENSE-AUDIT-UNIFIA.md)