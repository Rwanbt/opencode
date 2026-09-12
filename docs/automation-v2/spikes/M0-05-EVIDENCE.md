<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Unifia contributors -->

# M0-05 EVIDENCE — network-authority spike (ADR-023)

> Statut : **EVIDENCE_PINNED** (algorithmic layer validated)
> Date : 2026-09-01T17:30+02:00
> Source : `docs/automation-v2/spikes/m0-05-network-authority.ts`

## 0. Cadrage

Ce spike valide la **couche algorithmique** d'ADR-023 (Network
Egress / SSRF) en testant les patterns de classification IP
(plan §111). L'OS-level enforcement (containers, VM, OS firewall)
est platform-specific et M1.

**Code de production modifié** : aucun. Le spike n'utilise que
`node:net` (Bun standard).

**Commande de reproduction** :

```bash
cd D:\App\unifia\.worktrees\rev3m-20260901\design
bun docs/automation-v2/spikes/m0-05-network-authority.ts
```

**Dernière exécution** : 2026-09-01, 6 PASS / 2 NEEDS-OS-ENFORCEMENT / 0 FAIL.

## 1. Verdict par vecteur

| # | Vecteur | Verdict | Évidence |
|---|---|---|---|
| 1 | `isIP` reconnaît IPv4 | **PASS** | 5/5 IPv4 reconnues (127/10/192.168/169.254/8.8.8.8) |
| 2 | `isIP` reconnaît IPv6 | **PASS** | 4/4 IPv6 reconnues (::1/fe80/fc00/2001:db8) |
| 3 | Détection loopback (127/8, ::1) | **PASS** | 3/3 IPs classifiées correctement |
| 4 | Détection privée IPv4 (RFC 1918) | **NEEDS-OS-ENFORCEMENT** | patterns OK ; OS-level routing/firewall requis pour blocage réel |
| 5 | Détection privée IPv6 (fc00::/7) | **NEEDS-OS-ENFORCEMENT** | idem |
| 6 | Détection link-local (169.254/16, fe80::/10) | **PASS** | 3/3 IPs classifiées |
| 7 | Détection cloud metadata (169.254.169.254, fd00:ec2::254) | **PASS** | 2/2 IPs classifiées |
| 8 | Détection public IPv4 (control) | **PASS** | 3/3 IPs classifiées (8.8.8.8, 1.1.1.1, 208.67.222.222) |

## 2. Verdict agrégé

```text
PASS                  6
NEEDS-OS-ENFORCEMENT  2
FAIL                  0
```

## 3. Conclusion pour ADR-023

L'**évidence empirique** confirme que la couche algorithmique
d'ADR-023 est réalisable avec `node:net` (Bun) + patterns RFC.

Les 2 NEEDS-OS-ENFORCEMENT (privé IPv4/IPv6) ne sont **pas** des
FAIL : les algorithms reconnaissent correctement les ranges
privées. Mais pour un blocage effectif (empêcher un executor de
joindre une IP privée), il faut :
- Container network policy, ou
- VM-level firewall, ou
- OS-level routing rules.

La couche algorithmique fournit le **verdict** (cette IP est-elle
autorisée selon la policy ?), l'OS-level fournit l'**enforcement**
(empêcher la connexion au niveau TCP).

**Recommandation** : ADR-023 est faisable. Le futur
`@unifia/network-authority/` peut être créé maintenant. La
séparation algorithmique / OS-enforcement est saine.

## 4. Ce que le spike ne couvre pas

- DNS rebinding : nécessite un résolveur DNS qui retourne des IPs
  différentes entre deux requêtes. C'est un test HTTP, pas IP.
- Redirect chains : nécessite un client HTTP qui suit les 3xx.
- IDN / punycode : nécessite un parser DNS.
- Numeric IP (`http://2130706433/` = `127.0.0.1`) : nécessite
  l'URL parser pour normaliser.

Ces points sont M1 (`@unifia/network-authority/` test corpus).

## 5. Statut

| Élément | Statut |
|---|---|
| Code de production modifié | **NON** |
| Couche algorithmique | **VALIDÉE** |
| Couche OS-level | **M1** (à tester platform-specific) |
| Décision ADR-023 | **DÉJÀ RENDUE** (DECIDED) |

## Liens

- `docs/automation-v2/spikes/m0-05-network-authority.ts`
- `docs/adr/ADR-023-network-egress-ssrf-authority.md` (DECIDED)
- `docs/automation-v2/RISK_REGISTER.md`
- plan V2.3.1 §108-113, §147 (SSRF corpus), §205 (Network Track)
- ADR-001 (canonicalization) spike → `M0-02-EVIDENCE.md`
- ADR-003 (expression) spike → `M0-03-EVIDENCE.md`
- ADR-010 (secure storage) spike → `M0-04-EVIDENCE.md`
- ADR-000 (substrate) spike → `M0-01-EVIDENCE.md`
