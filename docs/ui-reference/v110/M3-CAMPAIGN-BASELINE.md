# MiniMax M3 — Campaign Baseline (2026-09-13)

> **Statut** : Phase 0 COMPLETE — baseline gelee
> **BASE_SHA** : `9aabd75cd10ec4e9886424ee4420a4022199d871`
> **Branche** : `new-ui` (worktree `_a7-automate-memory`)
> **Mandat** : parité visuelle + comportementale + responsive + tests reproductibles sur chaque surface/format, sans dette, sans fake, sans merge work-design

---

## Phase 0 — Geler baseline

### BASE_SHA capturé
- `9aabd75cd10ec4e9886424ee4420a4022199d871` (commit `9aabd75cd1 refactor(session): Vague 4 P1-5 partial — extract SessionMobileTabsSection`)
- Poussé sur `origin/new-ui` à `21:12 Europe/Paris`
- Working tree : **propre** (0 fichiers non commités)

### Inventaire v110

| Fichier | Taille | Statut |
|---|---|---|
| `Unifia-UI-UX-v110-PORT-READY-R1.html` | 2.4 MB | source authoritative (gélée 2026-09-10) |
| `A1-CONTRACT.md` | 4.5 KB | manifest |
| `COMPONENT-MAP.md` | 4.8 KB | mapping surfaces |
| `INTERACTIONS.md` | 4.0 KB | contrat interactions |
| `OWNERSHIP.md` | 3.5 KB | OWNERSHIP |
| `PLAN-8-AGENTS.md` | 3.4 KB | plan 5 vagues |
| `PORTING.md` | 3.0 KB | doctrine |
| `RESPONSIVE-MATRIX.md` | 2.8 KB | responsive contract |
| `VISUAL-GATES.md` | 2.6 KB | visual gates |
| `QA/PORT-GATE-CERTIFICATION-2026-09-12.md` | 28.1 KB | audit report |

### Inventaire packages/app/src/pages (référence Phase 1)

```
pages/
├── layout/       (15+ sous-modules, 1074 LOC main + 196 LOC layout-contexts.ts)
├── session/      (15+ sous-modules, 979 LOC main)
└── workbench/    (25+ sous-modules)
```

### Dette en cours

- P1-5 Vagues 4-5 PARTIAL (ADR-037 documente — voir session-recap)
- Cartésian matrix : 0/2 (infra Chromium hang)
- Composant render tests : 14 test.todo() (deps installées, infra SSR detection fail)

### Suspension des refactors internes

Conformément au brief M3 : **ADR-037 suspendu**. Réduire session.tsx 979→800 LOC ou layout.tsx 1074→<800 n'apporte aucune parité visuelle. Les refactors sont relancés en Phase 17 seulement.

---

## Authority matrix (M3)

| Sujet | Source d'autorité |
|---|---|
| Apparence, structure, proportions | `Unifia-UI-UX-v110-PORT-READY-R1.html` (2.4 MB, frozen 2026-09-10) |
| Interactions | `INTERACTIONS.md` (devenu contrat exécutable) |
| Responsive | `RESPONSIVE-MATRIX.md` + comportement réel maquette |
| Gates | `VISUAL-GATES.md` |
| Fonctionnalités métier | Runtime Unifia existant |
| Conflit maquette ↔ runtime | Préserver le runtime, adapter UI autour |
| Fonction absente backend | Pas de fake ; implémenter ou rendre indisponible explicitement |
| Anciennes docs contradictoires | Maquette + comportement validé priment |

---

## Priorités (ordre M3)

1. **Harness + Shell** (conditions toutes les autres validations)
2. **Automate** (P1 absolu — plus gros écart maquette/runtime)
3. **Design** (deuxième plus gros écart)
4. **Memory** (workflow + responsive incomplets)
5. **Code** (parité visuelle à finir)
6. **Chat/modes** (fidélité/motion à pousser)
7. **Browser**
8. **Work** (parmi les plus avancés)
9. **Settings/User** (passe exhaustive)
10. **Responsive global** (revalidation transverse)
11. **Motion/A11y/Visual regression**
12. **Refactor interne** (seulement après parité)

---

## Anti-régression (règles strictes)

MiniMax M3 ne doit JAMAIS :
- Recréer un second Inspector/Explorer/panneau global
- Ajouter un bouton si la fonction existe déjà ailleurs
- Remplacer une capacité réelle par un mock
- Masquer un élément sur mobile sans workflow alternatif
- Déclarer une phase terminée parce que TypeScript compile
- Déclarer GO parce que port-gate-strict 5/5 passe
- Corriger uniquement le viewport où le bug a été signalé
- Introduire un nouveau breakpoint local quand l'autorité responsive existe déjà
- Utiliser des données locales fictives pour action backend
- Faire un gros refactor architectural pendant une correction visuelle
- Ignorer un test flaky (stabiliser ou prouver qu'il teste mal)
- Fermer une dette sur la foi d'un ancien rapport sans vérifier HEAD

---

## Gate de sortie « GO PORTAGE »

Une seule case rouge = NO-GO.

| Gate | Exigence |
|---|---|
| Parité structurelle | toutes les surfaces canoniques présentes |
| Parité comportementale | interactions critiques INTERACTIONS.md exécutables |
| Responsive | 6 familles de viewport validées |
| Buttons/actions | zéro contrôle mort |
| Runtime | zéro capacité réelle cassée par le port |
| Visual | visual regression approuvée |
| Design | vector/layers réellement montés |
| Automate | canvas/nodes/ports/Inspector/debug fonctionnels |
| Memory | Vault/Note/Graph utilisables desktop + mobile |
| Code | editor/terminal/Inspector/split/LSP validé |
| Browser | navigation + AI Activity + mobile validés |
| Work | Board/List/Runs/team cohérents |
| A11y | keyboard + Axe sans violation bloquante |
| Motion | cohérent + reduced-motion |
| Unit/typecheck | verts |
| E2E | verts sans hang/retry |
| Console | aucune exception inattendue |
| Audit 1 | aucun P0/P1 |
| Audit 2 | aucun nouveau P0/P1 |
| SHA | toutes les preuves correspondent au même commit |

---

*Baseline gelee par M3 le 2026-09-13 — phase 1 (acceptance matrix) demarre immediatement.*
