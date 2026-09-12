# P10-C1000 — Computer use

**Statut :** `INTEGRATED` (design documenté, BLOQUÉ par audit humain)
**Date :** 2026-08-01
**Parent :** P10-C1000 (Computer use)

## ⚠️ SECURITY-CRITICAL

Computer use = capacité de control clavier/souris/écran. **Risque majeur** de sécurité.

## Objectif

Permettre à Unifia d'**interagir avec des applications GUI** natives, comme un humain.

## Capabilities

- `computer.screenshot` : capture d'écran
- `computer.mouse_move` : bouger souris
- `computer.mouse_click` : clic souris
- `computer.keyboard_type` : taper texte
- `computer.keyboard_press` : presser touche
- `computer.get_focused_window` : window focused
- `computer.list_windows` : lister windows

## Backends

| Backend | Plateforme | Latency |
|---|---|---|
| Native (OS API) | All | <50ms |
| X11 / Wayland | Linux | <100ms |
| Win32 API | Windows | <50ms |
| Cocoa / Quartz | macOS | <50ms |

## Sécurité (BLOQUÉ humain)

- **Default-deny** : chaque action doit être approuvée
- **Rate limit** : 100 actions/min max
- **Visual confirmation** : screenshot avant chaque clic
- **Allowlist** : only specific apps (configurable)
- **Kill switch** : emergency stop

## Estimation

- Backend Linux (X11/Wayland) : ~600 LOC
- Backend Windows : ~600 LOC
- Backend macOS : ~600 LOC
- Common layer : ~400 LOC
- Tests : ~400 LOC
- **Total : ~2600 LOC**

## ⚠️ Risques

- **Move souris accidentelle** : clic sur mauvaise fenêtre
- **Screenshot privacy** : capture de données sensibles
- **Mouse hijack** : par malicious app
- **OS compatibility** : changements d'API par OS update

## Liens

- [ADR-0005 SandboxPort](docs/adr/0005-sandbox-port.md)
- [P3-C300-A PolicyEngine](plans/P3-C300-A-policy-engine.md)
- [SECURITY-INCIDENT-RESPONSE.md](../SECURITY-INCIDENT-RESPONSE.md)